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
  LabelStyle,
  Math as CMath,
  PerspectiveFrustum,
  PolylineDashMaterialProperty,
  PolylineGlowMaterialProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
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

export type PickTarget =
  | { kind: 'waypoint' | 'poi'; id: string }
  | { kind: 'takeoff' }
  /** A corner of the survey outline, by index. */
  | { kind: 'vertex'; index: number };

export interface SceneEvents {
  /** A click on empty ground/buildings. */
  onGroundClick?(pos: Geodetic): void;
  /** A click on a mission object. */
  onSelect?(target: PickTarget): void;
  /** Continuous while dragging a mission object across the ground. */
  onDrag?(target: PickTarget, pos: Geodetic): void;
  onDragEnd?(target: PickTarget): void;
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
  private droneEntity?: Entity;
  private dem?: Dem;
  events: SceneEvents = {};

  constructor(container: HTMLElement, hasIonToken: boolean) {
    this.viewer = new Viewer(container, {
      baseLayer: false,
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: hasIonToken ? true : [new CartographicGeocoderService()],
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      selectionIndicator: false,
      infoBox: false,
      terrainProvider: new EllipsoidTerrainProvider(),
    });
    const { scene } = this.viewer;
    scene.globe.depthTestAgainstTerrain = true;
    scene.globe.enableLighting = false;
    this.viewer.dataSources.add(this.missionLayer);
    this.viewer.dataSources.add(this.droneLayer);
    this.viewer.dataSources.add(this.obstacleLayer);

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
    this.handler.setInputAction(() => this.onUp(), ScreenSpaceEventType.LEFT_UP);
    this.handler.setInputAction(
      (e: ScreenSpaceEventHandler.PositionedEvent) => this.onClick(e.position),
      ScreenSpaceEventType.LEFT_CLICK,
    );
  }

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
      return this.applied.errors;
    });
    this.sourcesQueue = run.catch(() => {});
    return run;
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

  private onDown(pos: Cartesian2) {
    const t = this.pickTarget(pos);
    if (!t) return;
    this.dragging = t;
    this.viewer.scene.screenSpaceCameraController.enableInputs = false;
    this.events.onSelect?.(t);
  }

  private onMove(pos: Cartesian2) {
    if (!this.dragging) return;
    const g = this.pickGround(pos);
    if (g) this.events.onDrag?.(this.dragging, g);
  }

  private onUp() {
    if (!this.dragging) return;
    const t = this.dragging;
    this.dragging = undefined;
    this.viewer.scene.screenSpaceCameraController.enableInputs = true;
    this.events.onDragEnd?.(t);
  }

  private onClick(pos: Cartesian2) {
    if (this.pickTarget(pos)) return;
    const g = this.pickGround(pos);
    if (g) this.events.onGroundClick?.(g);
  }

  /** Redraw waypoints, POIs, takeoff and the flight path. */
  render(
    mission: Mission,
    path: FlightPath,
    opts: { selectedId?: string; issues?: SafetyIssue[] } = {},
  ) {
    const ents = this.missionLayer.entities;
    ents.suspendEvents();
    ents.removeAll();

    const outline = mission.survey?.polygon ?? [];
    if (outline.length >= 3) {
      ents.add({
        polygon: {
          hierarchy: Cartesian3.fromDegreesArray(outline.flatMap((p) => [p.lon, p.lat])),
          material: COLORS.survey.withAlpha(0.18),
        },
      });
    }
    if (outline.length >= 2) {
      const ring = outline.length >= 3 ? [...outline, outline[0]!] : outline;
      ents.add({
        polyline: {
          positions: Cartesian3.fromDegreesArray(ring.flatMap((p) => [p.lon, p.lat])),
          width: 2.5,
          material: COLORS.survey,
          clampToGround: true,
        },
      });
    }
    outline.forEach((p, index) => {
      ents.add({
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
    ents.add({
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
      const selected = wp.id === opts.selectedId;
      const color = selected ? COLORS.selected : COLORS.waypoint;
      ents.add({
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
      ents.add({
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
      ents.add({
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
      const samples = path.sampleByDistance(Math.max(1, path.length / 1500));
      ents.add({
        polyline: {
          positions: samples.map((s) => cart(s.position)),
          width: 6,
          material: new PolylineGlowMaterialProperty({ color: COLORS.path, glowPower: 0.2 }),
          arcType: ArcType.NONE,
        },
      });
      for (const issue of opts.issues ?? []) {
        if (issue.from === undefined || issue.to === undefined) continue;
        const span = samples.filter((s) => s.s >= issue.from! - 1 && s.s <= issue.to! + 1);
        if (span.length < 2) continue;
        ents.add({
          polyline: {
            positions: span.map((s) => cart(s.position)),
            width: 9,
            material: issue.severity === 'error' ? COLORS.error : COLORS.warning,
            arcType: ArcType.NONE,
          },
        });
      }
    }
    ents.resumeEvents();
    this.viewer.scene.requestRender();
  }

  /**
   * Draw mapped obstacles: a red mast from the ground to the top of each point obstacle, power
   * lines at their height, and airfields as labelled markers. `ground[i]` is the terrain height
   * under each obstacle's first point.
   */
  setObstacles(obstacles: Obstacle[], ground: (number | undefined)[]) {
    const ents = this.obstacleLayer.entities;
    ents.suspendEvents();
    ents.removeAll();
    obstacles.forEach((o, i) => {
      const base = ground[i] ?? 0;
      const [lon, lat] = o.coords[0]!;
      const name = o.name ?? OBSTACLE_LABELS[o.kind];
      if (isAirfield(o)) {
        ents.add({
          position: Cartesian3.fromDegrees(lon, lat, base),
          point: {
            pixelSize: 9,
            color: COLORS.airfield,
            outlineColor: Color.BLACK,
            outlineWidth: 1,
          },
          label: { ...label(`✈ ${name}`, COLORS.airfield), scale: 0.85 },
        });
        return;
      }
      const top = base + o.height;
      if (o.coords.length > 1) {
        ents.add({
          polyline: {
            positions: o.coords.map(([x, y]) => Cartesian3.fromDegrees(x, y, top)),
            width: 2,
            material: COLORS.obstacle.withAlpha(0.8),
            arcType: ArcType.NONE,
          },
        });
        return;
      }
      ents.add({
        polyline: {
          positions: [
            Cartesian3.fromDegrees(lon, lat, base),
            Cartesian3.fromDegrees(lon, lat, top),
          ],
          width: 3,
          material: COLORS.obstacle,
          arcType: ArcType.NONE,
        },
      });
      ents.add({
        position: Cartesian3.fromDegrees(lon, lat, top),
        point: { pixelSize: 6, color: COLORS.obstacle },
        label: {
          ...label(`${name} ${Math.round(o.height)} m`, COLORS.obstacle),
          scale: 0.75,
          distanceDisplayCondition: new DistanceDisplayCondition(0, 2500),
        },
      });
    });
    ents.resumeEvents();
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
  async sampleGround(positions: { lat: number; lon: number }[]): Promise<(number | undefined)[]> {
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

    const buildings = this.applied?.buildings;
    if (buildings) {
      await buildings.ensure(positions);
      ground = ground.map((h, i) =>
        max(h, buildings.heightAt(positions[i]!.lat, positions[i]!.lon)),
      );
    }
    const tilesets = this.applied?.tilesets ?? [];
    if (tilesets.length === 0 || !scene.sampleHeightSupported) return ground;
    try {
      const exclude = [
        ...this.missionLayer.entities.values,
        ...this.droneLayer.entities.values,
        ...this.obstacleLayer.entities.values,
      ];
      const tiles = await scene.sampleHeightMostDetailed(carts(), exclude);
      return ground.map((h, i) => max(h, tiles[i]?.height));
    } catch {
      return ground;
    }
  }

  destroy() {
    this.handler.destroy();
    if (!this.viewer.isDestroyed()) this.viewer.destroy();
  }
}

function label(text: string, color: Color) {
  return {
    text,
    font: '600 13px system-ui, sans-serif',
    fillColor: color,
    outlineColor: Color.BLACK,
    outlineWidth: 3,
    style: LabelStyle.FILL_AND_OUTLINE,
    verticalOrigin: VerticalOrigin.BOTTOM,
    horizontalOrigin: HorizontalOrigin.CENTER,
    pixelOffset: new Cartesian2(0, -14),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  };
}
