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
  EllipsoidTerrainProvider,
  Entity,
  HeadingPitchRoll,
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
  sampleTerrainMostDetailed,
} from 'cesium';
import {
  waypointHeight,
  type FlightPath,
  type Geodetic,
  type Mission,
  type PathSample,
  type SafetyIssue,
} from '@odc/core';
import { applySources, type DataSourceSettings } from './sources';

export type PickTarget = { kind: 'waypoint' | 'poi'; id: string } | { kind: 'takeoff' };

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
};

const ID_SEP = ':';
const entityId = (t: PickTarget) =>
  t.kind === 'takeoff' ? 'takeoff' : `${t.kind}${ID_SEP}${t.id}`;
function parseId(id: string): PickTarget | undefined {
  if (id === 'takeoff') return { kind: 'takeoff' };
  const [kind, ...rest] = id.split(ID_SEP);
  if (kind === 'waypoint' || kind === 'poi') return { kind, id: rest.join(ID_SEP) };
  return undefined;
}

const cart = (g: Geodetic) => Cartesian3.fromDegrees(g.lon, g.lat, g.height);

/** The main 3D planning view: renders a mission and turns mouse input into planning events. */
export class MissionScene {
  readonly viewer: Viewer;
  private readonly missionLayer = new CustomDataSource('mission');
  private readonly droneLayer = new CustomDataSource('drone');
  private readonly handler: ScreenSpaceEventHandler;
  private readonly frustumCamera: Camera;
  private frustum?: DebugCameraPrimitive;
  private tilesets: Cesium3DTileset[] = [];
  private dragging?: PickTarget;
  private droneEntity?: Entity;
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

  async setSources(settings: DataSourceSettings): Promise<string[]> {
    const { tilesets, errors } = await applySources(
      this.viewer.scene,
      this.viewer.imageryLayers,
      settings,
      this.tilesets,
    );
    this.tilesets = tilesets;
    return errors;
  }

  /** Look at a location from the south at an oblique angle. duration 0 jumps instantly. */
  flyTo(lat: number, lon: number, range = 600, duration = 1.5) {
    const view = {
      destination: Cartesian3.fromDegrees(lon, lat - range / 111_000 / 1.2, range * 0.6),
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
      picked.primitive instanceof Cesium3DTileset &&
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

  /** Show the drone and its camera frustum at a point on the path. */
  setDrone(sample: PathSample | undefined, horizontalFovDeg: number, aspect: number) {
    if (!sample) {
      if (this.droneEntity) this.droneEntity.show = false;
      if (this.frustum) this.frustum.show = false;
      return;
    }
    const position = cart(sample.position);
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
    cam.setView({
      destination: position,
      orientation: new HeadingPitchRoll(
        CMath.toRadians(sample.yaw),
        CMath.toRadians(sample.pitch),
        0,
      ),
    });
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

  /**
   * Ellipsoid height of whatever lies beneath each position: the max of terrain and any 3D tiles,
   * so buildings count as obstacles. Undefined where nothing could be sampled.
   */
  async sampleGround(positions: { lat: number; lon: number }[]): Promise<(number | undefined)[]> {
    const { scene } = this.viewer;
    const carts = () => positions.map((p) => Cartographic.fromDegrees(p.lon, p.lat));
    let terrain: (number | undefined)[] = positions.map(() => 0);
    if (!(scene.terrainProvider instanceof EllipsoidTerrainProvider)) {
      try {
        terrain = (await sampleTerrainMostDetailed(scene.terrainProvider, carts())).map(
          (c) => c.height,
        );
      } catch {
        terrain = positions.map(() => undefined);
      }
    }
    if (this.tilesets.length === 0 || !scene.sampleHeightSupported) return terrain;
    try {
      const exclude = [...this.missionLayer.entities.values, ...this.droneLayer.entities.values];
      const tiles = await scene.sampleHeightMostDetailed(carts(), exclude);
      return terrain.map((h, i) => {
        const t = tiles[i]?.height;
        if (t === undefined || Number.isNaN(t)) return h;
        return h === undefined ? t : Math.max(h, t);
      });
    } catch {
      return terrain;
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
