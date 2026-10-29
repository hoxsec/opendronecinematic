import {
  ArcType,
  Camera,
  CartographicGeocoderService,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Cesium3DTileset,
  Color,
  ConstantPositionProperty,
  CustomDataSource,
  DebugCameraPrimitive,
  DistanceDisplayCondition,
  EllipsoidTerrainProvider,
  Entity,
  HeadingPitchRange,
  HeightReference,
  Matrix4,
  HorizontalOrigin,
  ImageryLayer,
  LabelStyle,
  Math as CMath,
  OpenStreetMapImageryProvider,
  PerspectiveFrustum,
  PolylineDashMaterialProperty,
  PolylineGlowMaterialProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  SceneMode,
  VerticalOrigin,
  Viewer,
  defined,
} from 'cesium';
import {
  waypointHeight,
  type Dem,
  type FlightPath,
  type Geodetic,
  type Mission,
  type SafetyIssue,
} from '@odc/core';
import { OBSTACLE_LABELS, isAirfield, type Obstacle } from '@odc/core';
import {
  applySources,
  effectiveSources,
  type AppliedSources,
  type DataSourceSettings,
} from './sources';
import { sampleTerrainHeights } from './terrain';
import { applyPose, type CameraPose } from './pose';
import { applySunLight } from './lighting';
import { AXES, AxisGizmo, axisDirection, closestOnLine, gizmoAxis, type Axis } from './gizmo';
import { EntityBatch } from './entities';
import { yieldToBrowser } from './scheduling';

export type PickTarget =
  | { kind: 'waypoint' | 'poi'; id: string }
  | { kind: 'takeoff' }
  /** A corner of the survey outline, by index. */
  | { kind: 'vertex'; index: number };

export interface SceneEvents {
  /** A click on empty ground/buildings. */
  onGroundClick?(pos: Geodetic): void;
  /** A click on a mission object. */
  onSelect?(target: PickTarget, modifiers?: { toggle?: boolean; range?: boolean }): void;
  /** Continuous while dragging a mission object across the ground. */
  onDrag?(target: PickTarget, pos: Geodetic): void;
  onDragEnd?(target: PickTarget): void;
  /**
   * Continuous while dragging one of the selected object's axis arrows. `pos` is the object's new
   * position: only lat/lon change for x/y (east/north), only height for z (up).
   */
  onAxisDrag?(target: PickTarget, axis: Axis, pos: Geodetic): void;
}

const COLORS = {
  path: Color.fromCssColorString('#38bdf8'),
  error: Color.fromCssColorString('#ef4444'),
  warning: Color.fromCssColorString('#f59e0b'),
  waypoint: Color.fromCssColorString('#f8fafc'),
  selected: Color.fromCssColorString('#22d3ee'),
  poi: Color.fromCssColorString('#facc15'),
  takeoff: Color.fromCssColorString('#22c55e'),
  drone: Color.fromCssColorString('#f472b6'),
  survey: Color.fromCssColorString('#a3e635'),
  obstacle: Color.fromCssColorString('#f87171'),
  airfield: Color.fromCssColorString('#a78bfa'),
};

const ID_SEP = ':';
const entityId = (t: PickTarget) =>
  t.kind === 'takeoff'
    ? 'takeoff'
    : t.kind === 'vertex'
      ? `vertex${ID_SEP}${t.index}`
      : `${t.kind}${ID_SEP}${t.id}`;
function parseId(id: string): PickTarget | undefined {
  if (id === 'takeoff') return { kind: 'takeoff' };
  const [kind, ...rest] = id.split(ID_SEP);
  if (kind === 'vertex') return { kind, index: Number(rest[0]) };
  if (kind === 'waypoint' || kind === 'poi') return { kind, id: rest.join(ID_SEP) };
  return undefined;
}

const cart = (g: Geodetic) => Cartesian3.fromDegrees(g.lon, g.lat, g.height);

/** The main 3D planning view: renders a mission and turns mouse input into planning events. */
export class MissionScene {
  readonly viewer: Viewer;
  private readonly missionLayer = new CustomDataSource('mission');
  private readonly droneLayer = new CustomDataSource('drone');
  private readonly obstacleLayer = new CustomDataSource('obstacles');
  private readonly handler: ScreenSpaceEventHandler;
  private readonly frustumCamera: Camera;
  private frustum?: DebugCameraPrimitive;
  private applied?: AppliedSources;
  private sourcesQueue: Promise<unknown> = Promise.resolve();
  private dragging?: PickTarget;
  private pendingMove?: Cartesian2;
  private readonly removeDragUpdate: () => void;
  private readonly gizmo: AxisGizmo;
  /** The object showing the axis arrows. */
  private gizmoTarget?: PickTarget;
  private axisDrag?: {
    target: PickTarget;
    axis: Axis;
    start: Geodetic;
    origin: Cartesian3;
    dir: Cartesian3;
    t0: number;
  };
  private mission?: Mission;
  private renderedPath?: FlightPath;
  private pathSamples: ReturnType<FlightPath['sampleByDistance']> = [];
  private pathPositions: Cartesian3[] = [];
  private obstacleSnapshot?: { obstacles: Obstacle[]; ground: (number | undefined)[] };
  private droneEntity?: Entity;
  private dem?: Dem;
  private map2D = false;
  private map2DLayer?: ImageryLayer;
  events: SceneEvents = {};

  constructor(container: HTMLElement, hasIonToken: boolean) {
    this.viewer = new Viewer(container, {
      baseLayer: false,
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: hasIonToken ? true : [new CartographicGeocoderService()],
      homeButton: false,
      sceneModePicker: true,
      navigationHelpButton: false,
      fullscreenButton: false,
      selectionIndicator: false,
      infoBox: false,
      terrainProvider: new EllipsoidTerrainProvider(),
    });
    const { scene } = this.viewer;
    scene.morphStart.addEventListener((_transitioner, _oldMode, newMode) => {
      this.map2D = newMode === SceneMode.SCENE2D;
      this.updateMapVisibility();
    });
    scene.globe.depthTestAgainstTerrain = true;
    scene.globe.enableLighting = false;
    this.viewer.dataSources.add(this.missionLayer);
    this.viewer.dataSources.add(this.droneLayer);
    this.viewer.dataSources.add(this.obstacleLayer);
    this.gizmo = new AxisGizmo(this.viewer.camera);
    this.viewer.dataSources.add(this.gizmo.layer);

    this.frustumCamera = new Camera(scene);
    this.frustumCamera.frustum = new PerspectiveFrustum({
      fov: CMath.toRadians(70),
      aspectRatio: 16 / 9,
      near: 1,
      far: 40,
    });

    this.handler = new ScreenSpaceEventHandler(scene.canvas);
    this.handler.setInputAction(
      (e: ScreenSpaceEventHandler.PositionedEvent) => this.onDown(e.position),
      ScreenSpaceEventType.LEFT_DOWN,
    );
    this.handler.setInputAction(
      (e: ScreenSpaceEventHandler.MotionEvent) => this.onMove(e.endPosition),
      ScreenSpaceEventType.MOUSE_MOVE,
    );
    this.removeDragUpdate = scene.preUpdate.addEventListener(() => this.flushMove());
    this.handler.setInputAction(() => this.onUp(), ScreenSpaceEventType.LEFT_UP);
    this.handler.setInputAction(
      (e: ScreenSpaceEventHandler.PositionedEvent) => this.onClick(e.position),
      ScreenSpaceEventType.LEFT_CLICK,
    );
    // Cesium's event modifiers only cover one key at a time. Capture native modifiers so
    // Ctrl+Shift works too, and a selection gesture never starts a drag or camera orbit.
    scene.canvas.addEventListener('pointerdown', this.onModifiedSelect, true);
  }

  private readonly onModifiedSelect = (event: PointerEvent) => {
    if (event.button !== 0 || !(event.ctrlKey || event.metaKey || event.shiftKey)) return;
    const bounds = this.viewer.scene.canvas.getBoundingClientRect();
    const target = this.pickTarget(
      new Cartesian2(event.clientX - bounds.left, event.clientY - bounds.top),
    );
    if (target?.kind !== 'waypoint') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.events.onSelect?.(target, {
      toggle: event.ctrlKey || event.metaKey,
      range: event.shiftKey,
    });
  };

  /** Apply data sources. Calls run one after another so overlapping changes can't interleave. */
  setSources(settings: DataSourceSettings, dem?: Dem): Promise<string[]> {
    const run = this.sourcesQueue.then(async () => {
      if (this.viewer.isDestroyed()) return [];
      this.applied = await applySources(
        this.viewer.scene,
        this.viewer.imageryLayers,
        settings,
        this.applied,
        dem,
      );
      this.dem = effectiveSources(settings).terrain === 'geotiff' ? dem : undefined;
      this.updateMapVisibility();
      return this.applied.errors;
    });
    this.sourcesQueue = run.catch(() => {});
    return run;
  }

  private updateMapVisibility() {
    const layers = this.viewer.imageryLayers;
    if (this.map2DLayer && !layers.contains(this.map2DLayer)) this.map2DLayer = undefined;
    if (this.map2D && !this.map2DLayer) {
      this.map2DLayer = layers.addImageryProvider(
        new OpenStreetMapImageryProvider({
          url: 'https://tile.openstreetmap.org/',
          maximumLevel: 19,
        }),
      );
    } else if (!this.map2D && this.map2DLayer) {
      layers.remove(this.map2DLayer);
      this.map2DLayer = undefined;
    }
    if (!this.applied) return;
    for (const tileset of this.applied.tilesets) tileset.show = !this.map2D;
    this.applied.buildings?.setVisible(!this.map2D);
    this.viewer.scene.globe.show = this.map2D || this.applied.showGlobe;
  }

  /**
   * Light the map by the sun at `time`. No shadows: at planning distances the shadow map aliases
   * into stripes on photogrammetry; the camera view and renders draw them.
   */
  setSun(time: Date) {
    applySunLight(this.viewer.scene, this.viewer.clock, time, false);
  }

  /**
   * Mouse-wheel zoom: `speed` multiplies Cesium's default step, `snappy` stops the camera as soon
   * as the wheel stops instead of letting it coast.
   */
  setZoom(speed: number, snappy: boolean) {
    const c = this.viewer.scene.screenSpaceCameraController;
    c.zoomFactor = 5 * speed;
    c.inertiaZoom = snappy ? 0 : 0.8;
  }

  /**
   * Look at a location from the south at an oblique angle. `groundHeight` (ellipsoid) keeps the
   * camera above high terrain. duration 0 jumps instantly.
   */
  flyTo(lat: number, lon: number, range = 600, duration = 1.5, groundHeight = 0) {
    const view = {
      destination: Cartesian3.fromDegrees(
        lon,
        lat - range / 111_000 / 1.2,
        groundHeight + range * 0.6,
      ),
      orientation: { heading: 0, pitch: CMath.toRadians(-35), roll: 0 },
    };
    if (duration === 0) this.viewer.camera.setView(view);
    else this.viewer.camera.flyTo({ ...view, duration });
  }

  /** Ground (terrain or 3D tiles) under a screen position. */
  pickGround(pos: Cartesian2): Geodetic | undefined {
    const { scene, camera } = this.viewer;
    const picked = scene.pick(pos);
    let c: Cartesian3 | undefined;
    if (
      defined(picked) &&
      (picked.primitive instanceof Cesium3DTileset ||
        this.applied?.buildings?.owns(picked.primitive)) &&
      scene.pickPositionSupported
    ) {
      c = scene.pickPosition(pos);
    }
    if (!c && scene.globe.show) {
      const ray = camera.getPickRay(pos);
      if (ray) c = scene.globe.pick(ray, scene);
    }
    if (!c) return undefined;
    const g = Cartographic.fromCartesian(c);
    return {
      lat: CMath.toDegrees(g.latitude),
      lon: CMath.toDegrees(g.longitude),
      height: g.height,
    };
  }

  private pickTarget(pos: Cartesian2): PickTarget | undefined {
    const picked = this.viewer.scene.pick(pos);
    const id = defined(picked) && picked.id instanceof Entity ? picked.id.id : undefined;
    return id ? parseId(id) : undefined;
  }

  /** The gizmo arrow under a screen position; looks past the marker dot it sits on. */
  private pickAxis(pos: Cartesian2): Axis | undefined {
    if (!this.gizmo.visible) return undefined;
    for (const picked of this.viewer.scene.drillPick(pos, 4)) {
      const axis = picked?.id instanceof Entity ? gizmoAxis(picked.id.id) : undefined;
      if (axis) return axis;
    }
    return undefined;
  }

  /** Where `pos` points along the axis line of the current axis drag. */
  private axisParam(pos: Cartesian2, origin: Cartesian3, dir: Cartesian3): number | undefined {
    const ray = this.viewer.camera.getPickRay(pos);
    return ray ? closestOnLine(origin, dir, ray.origin, ray.direction) : undefined;
  }

  private onDown(pos: Cartesian2) {
    const axis = this.pickAxis(pos);
    const gt = this.gizmoTarget;
    const start = gt && this.targetPosition(gt);
    if (axis && gt && start) {
      const origin = cart(start);
      const dir = axisDirection(origin, axis);
      const t0 = this.axisParam(pos, origin, dir);
      if (t0 === undefined) return;
      this.axisDrag = { target: gt, axis, start, origin, dir, t0 };
      this.viewer.scene.screenSpaceCameraController.enableInputs = false;
      this.events.onSelect?.(gt);
      return;
    }
    const t = this.pickTarget(pos);
    if (!t) return;
    this.dragging = t;
    this.viewer.scene.screenSpaceCameraController.enableInputs = false;
    this.setGizmoTarget(t);
    this.events.onSelect?.(t);
  }

  private onMove(pos: Cartesian2) {
    if (!this.axisDrag && !this.dragging) return;
    // Mouse events can arrive much faster than frames. Pick and edit only the latest position.
    this.pendingMove = Cartesian2.clone(pos, this.pendingMove);
    this.viewer.scene.requestRender();
  }

  private flushMove() {
    const pos = this.pendingMove;
    this.pendingMove = undefined;
    if (pos) this.applyMove(pos);
  }

  private applyMove(pos: Cartesian2) {
    const ad = this.axisDrag;
    if (ad) {
      const t = this.axisParam(pos, ad.origin, ad.dir);
      if (t === undefined) return;
      const p = Cartesian3.add(
        ad.origin,
        Cartesian3.multiplyByScalar(ad.dir, t - ad.t0, new Cartesian3()),
        new Cartesian3(),
      );
      const c = Cartographic.fromCartesian(p);
      if (!c) return;
      const moved: Geodetic =
        ad.axis === 'z'
          ? { ...ad.start, height: c.height }
          : {
              lat: CMath.toDegrees(c.latitude),
              lon: CMath.toDegrees(c.longitude),
              height: ad.start.height,
            };
      this.events.onAxisDrag?.(ad.target, ad.axis, moved);
      return;
    }
    if (!this.dragging) return;
    const g = this.pickGround(pos);
    if (g) this.events.onDrag?.(this.dragging, g);
  }

  private onUp() {
    const t = this.axisDrag?.target ?? this.dragging;
    if (!t) return;
    // Do not lose the last motion when release happens before the next frame.
    this.flushMove();
    this.dragging = undefined;
    this.axisDrag = undefined;
    this.viewer.scene.screenSpaceCameraController.enableInputs = true;
    this.events.onDragEnd?.(t);
  }

  private onClick(pos: Cartesian2) {
    if (this.pickTarget(pos) || this.pickAxis(pos)) return;
    this.setGizmoTarget(undefined);
    const g = this.pickGround(pos);
    if (g) this.events.onGroundClick?.(g);
  }

  /** Current position of a mission object in the last rendered mission. */
  private targetPosition(t: PickTarget): Geodetic | undefined {
    const m = this.mission;
    if (!m) return undefined;
    switch (t.kind) {
      case 'takeoff':
        return { ...m.takeoff, height: m.takeoff.groundHeight };
      case 'waypoint': {
        const wp = m.waypoints.find((w) => w.id === t.id);
        return wp && { lat: wp.lat, lon: wp.lon, height: waypointHeight(m, wp) };
      }
      case 'poi':
        return m.pois.find((p) => p.id === t.id);
      case 'vertex': {
        const v = m.survey?.polygon[t.index];
        return v && { lat: v.lat, lon: v.lon, height: this.groundHeightAt(v.lat, v.lon) ?? 0 };
      }
    }
  }

  private setGizmoTarget(t: PickTarget | undefined) {
    this.gizmoTarget = t;
    const pos = t && this.targetPosition(t);
    if (!pos) this.gizmoTarget = undefined;
    // Survey corners are clamped to the ground, so they only move east/north.
    this.gizmo.set(pos && cart(pos), t?.kind === 'vertex' ? ['x', 'y'] : AXES);
    this.viewer.scene.requestRender();
  }

  /**
   * Best synchronous estimate of the ground height (ellipsoid) at a location, from the DEM, loaded
   * terrain tiles, 3D tiles and offline buildings. For live drags; `sampleGround` is exact.
   */
  groundHeightAt(lat: number, lon: number): number | undefined {
    const { scene } = this.viewer;
    const c = Cartographic.fromDegrees(lon, lat);
    // Outside the DEM (or without terrain) the globe is a flat 0 m; that's no ground reading.
    let h = this.dem
      ? this.dem.heightAt(lat, lon)
      : scene.terrainProvider instanceof EllipsoidTerrainProvider
        ? undefined
        : scene.globe.getHeight(c);
    const higher = (t: number | undefined) => {
      if (t !== undefined && !Number.isNaN(t)) h = h === undefined ? t : Math.max(h, t);
    };
    higher(this.applied?.buildings?.heightAt(lat, lon));
    if ((this.applied?.tilesets.length ?? 0) > 0 && scene.sampleHeightSupported) {
      const exclude = [
        ...this.missionLayer.entities.values,
        ...this.droneLayer.entities.values,
        ...this.obstacleLayer.entities.values,
        ...this.gizmo.layer.entities.values,
      ];
      higher(scene.sampleHeight(c, exclude));
    }
    return h;
  }

  /** Redraw waypoints, POIs, takeoff and the flight path. */
  render(
    mission: Mission,
    path: FlightPath,
    opts: { selectedId?: string; selectedIds?: string[]; issues?: SafetyIssue[] } = {},
  ) {
    this.mission = mission;
    const ents = new EntityBatch(this.missionLayer.entities);

    const outline = mission.survey?.polygon ?? [];
    if (outline.length >= 3) {
      ents.upsert({
        id: 'survey:fill',
        polygon: {
          hierarchy: Cartesian3.fromDegreesArray(outline.flatMap((p) => [p.lon, p.lat])),
          material: COLORS.survey.withAlpha(0.18),
        },
      });
    }
    if (outline.length >= 2) {
      const ring = outline.length >= 3 ? [...outline, outline[0]!] : outline;
      ents.upsert({
        id: 'survey:outline',
        polyline: {
          positions: Cartesian3.fromDegreesArray(ring.flatMap((p) => [p.lon, p.lat])),
          width: 2.5,
          material: COLORS.survey,
          clampToGround: true,
        },
      });
    }
    outline.forEach((p, index) => {
      ents.upsert({
        id: entityId({ kind: 'vertex', index }),
        position: Cartesian3.fromDegrees(p.lon, p.lat),
        point: {
          pixelSize: 10,
          color: COLORS.survey,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    });

    const { takeoff } = mission;
    ents.upsert({
      id: entityId({ kind: 'takeoff' }),
      position: cart({ ...takeoff, height: takeoff.groundHeight }),
      point: {
        pixelSize: 16,
        color: COLORS.takeoff,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: label('H', COLORS.takeoff),
    });

    mission.waypoints.forEach((wp, i) => {
      const height = waypointHeight(mission, wp);
      const selected = wp.id === opts.selectedId || opts.selectedIds?.includes(wp.id);
      const color = selected ? COLORS.selected : COLORS.waypoint;
      ents.upsert({
        id: entityId({ kind: 'waypoint', id: wp.id }),
        position: cart({ lat: wp.lat, lon: wp.lon, height }),
        point: {
          pixelSize: selected ? 16 : 12,
          color,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: label(String(i + 1), color),
      });
      // Stem down to the ground so heights are readable in 3D.
      ents.upsert({
        id: `stem:${wp.id}`,
        polyline: {
          positions: [
            cart({ lat: wp.lat, lon: wp.lon, height }),
            cart({ lat: wp.lat, lon: wp.lon, height: wp.groundHeight }),
          ],
          width: 1.5,
          material: new PolylineDashMaterialProperty({
            color: color.withAlpha(0.7),
            dashLength: 8,
          }),
          arcType: ArcType.NONE,
        },
      });
    });

    for (const poi of mission.pois) {
      const selected = poi.id === opts.selectedId;
      ents.upsert({
        id: entityId({ kind: 'poi', id: poi.id }),
        position: cart(poi),
        point: {
          pixelSize: selected ? 18 : 14,
          color: COLORS.poi,
          outlineColor: selected ? COLORS.selected : Color.BLACK,
          outlineWidth: 3,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: label(poi.name, COLORS.poi),
      });
    }

    if (path.length > 0) {
      if (path !== this.renderedPath) {
        this.renderedPath = path;
        this.pathSamples = path.sampleByDistance(Math.max(1, path.length / 1500));
        this.pathPositions = this.pathSamples.map((s) => cart(s.position));
      }
      const samples = this.pathSamples;
      ents.upsert({
        id: 'flight:path',
        polyline: {
          positions: this.pathPositions,
          width: 6,
          material: new PolylineGlowMaterialProperty({ color: COLORS.path, glowPower: 0.2 }),
          arcType: ArcType.NONE,
        },
      });
      for (const [index, issue] of (opts.issues ?? []).entries()) {
        if (issue.from === undefined || issue.to === undefined) continue;
        const span = samples.filter((s) => s.s >= issue.from! - 1 && s.s <= issue.to! + 1);
        if (span.length < 2) continue;
        ents.upsert({
          id: `flight:issue:${index}`,
          polyline: {
            positions: span.map((s) => cart(s.position)),
            width: 9,
            material: issue.severity === 'error' ? COLORS.error : COLORS.warning,
            arcType: ArcType.NONE,
          },
        });
      }
    }
    ents.finish();

    // Follow the selection (also when picked from a panel); takeoff and survey corners have no
    // selection of their own, so they keep the arrows until something else is clicked.
    const sel = opts.selectedId;
    const gt = this.gizmoTarget;
    if (sel) {
      const kind = mission.waypoints.some((w) => w.id === sel) ? 'waypoint' : 'poi';
      this.setGizmoTarget({ kind, id: sel });
    } else if (gt?.kind === 'waypoint' || gt?.kind === 'poi') {
      this.setGizmoTarget(undefined);
    } else {
      this.setGizmoTarget(gt);
    }
    this.viewer.scene.requestRender();
  }

  /**
   * Draw mapped obstacles: a red mast from the ground to the top of each point obstacle, power
   * lines at their height, and airfields as labelled markers. `ground[i]` is the terrain height
   * under each obstacle's first point.
   */
  setObstacles(obstacles: Obstacle[], ground: (number | undefined)[]) {
    const previous = this.obstacleSnapshot;
    if (
      previous &&
      previous.obstacles.length === obstacles.length &&
      obstacles.every(
        (o, i) => o === previous.obstacles[i] && Object.is(ground[i], previous.ground[i]),
      )
    )
      return;
    this.obstacleSnapshot = { obstacles: [...obstacles], ground: [...ground] };
    const ents = new EntityBatch(this.obstacleLayer.entities);
    obstacles.forEach((o, i) => {
      const base = ground[i] ?? 0;
      const [lon, lat] = o.coords[0]!;
      const name = o.name ?? OBSTACLE_LABELS[o.kind];
      if (isAirfield(o)) {
        ents.upsert({
          id: `obstacle:${i}:marker`,
          position: Cartesian3.fromDegrees(lon, lat, base),
          point: {
            pixelSize: 14,
            color: COLORS.airfield,
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: hazardLabel(`AIRFIELD · ${name}`),
        });
        return;
      }
      const top = base + o.height;
      if (o.coords.length > 1) {
        ents.upsert({
          id: `obstacle:${i}:line`,
          polyline: {
            positions: o.coords.map(([x, y]) => Cartesian3.fromDegrees(x, y, top)),
            width: 5,
            material: COLORS.obstacle,
            depthFailMaterial: COLORS.obstacle.withAlpha(0.65),
            arcType: ArcType.NONE,
          },
        });
      } else
        ents.upsert({
          id: `obstacle:${i}:line`,
          polyline: {
            positions: [
              Cartesian3.fromDegrees(lon, lat, base),
              Cartesian3.fromDegrees(lon, lat, top),
            ],
            width: 5,
            material: COLORS.obstacle,
            depthFailMaterial: COLORS.obstacle.withAlpha(0.65),
            arcType: ArcType.NONE,
          },
        });
      ents.upsert({
        id: `obstacle:${i}:marker`,
        position: Cartesian3.fromDegrees(lon, lat, top),
        point: {
          pixelSize: 12,
          color: COLORS.obstacle,
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: hazardLabel(
          `HAZARD · ${name}\n${o.heightTagged ? '' : '~'}${Math.round(o.height)} m above ground`,
        ),
      });
    });
    ents.finish();
    this.viewer.scene.requestRender();
  }

  /** Show the drone and its camera frustum at a pose (path sample or live fly-mode state). */
  setDrone(pose: CameraPose | undefined, horizontalFovDeg: number, aspect: number) {
    if (!pose) {
      if (this.droneEntity) this.droneEntity.show = false;
      if (this.frustum) this.frustum.show = false;
      return;
    }
    const position = cart(pose.position);
    if (!this.droneEntity) {
      this.droneEntity = this.droneLayer.entities.add({
        position: new ConstantPositionProperty(position),
        point: {
          pixelSize: 14,
          color: COLORS.drone,
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
    this.droneEntity.show = true;
    (this.droneEntity.position as ConstantPositionProperty).setValue(position);

    const cam = this.frustumCamera;
    (cam.frustum as PerspectiveFrustum).fov = CMath.toRadians(horizontalFovDeg);
    (cam.frustum as PerspectiveFrustum).aspectRatio = aspect;
    applyPose(cam, pose);
    if (!this.frustum) {
      this.frustum = this.viewer.scene.primitives.add(
        new DebugCameraPrimitive({
          camera: cam,
          color: COLORS.drone.withAlpha(0.35),
          updateOnChange: true,
          show: true,
        }),
      );
    }
    this.frustum!.show = true;
  }

  /** Chase view for the mini-map in fly mode: high above and behind the drone, looking down. */
  followDrone(pose: CameraPose, range = 350) {
    const { camera } = this.viewer;
    const target = cart(pose.position);
    camera.lookAt(
      target,
      new HeadingPitchRange(CMath.toRadians(pose.yaw), CMath.toRadians(-55), range),
    );
    // lookAt locks the camera to the target; release it so normal navigation works afterwards.
    camera.lookAtTransform(Matrix4.IDENTITY);
  }

  /**
   * Ellipsoid height of whatever lies beneath each position: the max of terrain, 3D tiles and
   * offline buildings, so buildings count as obstacles. Undefined where nothing could be sampled.
   */
  async sampleGround(
    positions: { lat: number; lon: number }[],
    signal?: AbortSignal,
  ): Promise<(number | undefined)[]> {
    signal?.throwIfAborted();
    const { scene } = this.viewer;
    const carts = () => positions.map((p) => Cartographic.fromDegrees(p.lon, p.lat));
    let ground: (number | undefined)[] = positions.map(() => 0);
    const dem = this.dem;
    if (dem) {
      // Read the raster directly: exact, synchronous, and independent of loaded tiles.
      ground = positions.map((p) => dem.heightAt(p.lat, p.lon));
    } else if (!(scene.terrainProvider instanceof EllipsoidTerrainProvider)) {
      try {
        ground = await sampleTerrainHeights(scene.terrainProvider, carts());
      } catch {
        ground = positions.map(() => undefined);
      }
    }
    const max = (h: number | undefined, t: number | undefined) =>
      t === undefined || Number.isNaN(t) ? h : h === undefined ? t : Math.max(h, t);

    signal?.throwIfAborted();

    const buildings = this.applied?.buildings;
    if (buildings) {
      await buildings.ensure(positions, signal);
      signal?.throwIfAborted();
      ground = ground.map((h, i) =>
        max(h, buildings.heightAt(positions[i]!.lat, positions[i]!.lon)),
      );
    }
    const tilesets = this.applied?.tilesets ?? [];
    if (tilesets.length === 0 || !scene.sampleHeightSupported) return ground;
    const exclude = [
      ...this.missionLayer.entities.values,
      ...this.droneLayer.entities.values,
      ...this.obstacleLayer.entities.values,
      ...this.gizmo.layer.entities.values,
    ];
    // Detailed height sampling performs GPU work. Hundreds of probes in a single call
    // monopolize the main thread after a drop; bounded batches leave room for input.
    const positionsToSample = carts();
    for (let start = 0; start < positions.length; start += 4) {
      signal?.throwIfAborted();
      if (this.viewer.isDestroyed()) return ground;
      try {
        const tiles = await scene.sampleHeightMostDetailed(
          positionsToSample.slice(start, start + 4),
          exclude,
        );
        tiles.forEach((tile, i) => {
          ground[start + i] = max(ground[start + i], tile?.height);
        });
      } catch {
        // Keep the terrain/building result for batches that cannot be sampled.
      }
      await yieldToBrowser();
    }
    signal?.throwIfAborted();
    return ground;
  }

  destroy() {
    this.viewer.scene.canvas.removeEventListener('pointerdown', this.onModifiedSelect, true);
    this.removeDragUpdate();
    this.pendingMove = undefined;
    this.handler.destroy();
    if (!this.viewer.isDestroyed()) this.viewer.destroy();
  }
}

function label(text: string, color: Color) {
  return {
    text,
    font: '600 15px system-ui, sans-serif',
    fillColor: color,
    outlineColor: Color.BLACK,
    outlineWidth: 3,
    showBackground: true,
    backgroundColor: Color.fromCssColorString('#0b1120').withAlpha(0.92),
    backgroundPadding: new Cartesian2(7, 5),
    style: LabelStyle.FILL_AND_OUTLINE,
    verticalOrigin: VerticalOrigin.BOTTOM,
    horizontalOrigin: HorizontalOrigin.CENTER,
    pixelOffset: new Cartesian2(0, -20),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  };
}

function hazardLabel(text: string) {
  return {
    ...label(text, Color.WHITE),
    font: '700 16px system-ui, sans-serif',
    distanceDisplayCondition: new DistanceDisplayCondition(0, 10_000),
  };
}
