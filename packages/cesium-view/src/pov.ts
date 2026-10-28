import {
  Cartesian2,
  Cartographic,
  CesiumWidget,
  EllipsoidTerrainProvider,
  Math as CMath,
  PerspectiveFrustum,
  type Cesium3DTileset,
  type Scene,
} from 'cesium';
import type { Geodetic } from '@odc/core';
import { applySources, type DataSourceSettings } from './sources';
import { applyPose, type CameraPose } from './pose';

/**
 * A second globe that renders exactly what the drone camera sees: same world, camera placed at
 * the pose with the profile's horizontal FOV. The container should have the video frame's aspect
 * ratio so the horizontal FOV maps 1:1.
 */
export class PovView {
  readonly widget: CesiumWidget;
  private tilesets: Cesium3DTileset[] = [];

  constructor(container: HTMLElement) {
    this.widget = new CesiumWidget(container, {
      baseLayer: false,
      terrainProvider: new EllipsoidTerrainProvider(),
    });
    const { scene } = this.widget;
    scene.globe.depthTestAgainstTerrain = true;
    // The preview is driven by the plan or the fly controller, not by Cesium's mouse navigation.
    scene.screenSpaceCameraController.enableInputs = false;
  }

  async setSources(settings: DataSourceSettings) {
    const { tilesets, errors } = await applySources(
      this.widget.scene,
      this.widget.imageryLayers,
      settings,
      this.tilesets,
    );
    this.tilesets = tilesets;
    return errors;
  }

  setPose(pose: CameraPose, horizontalFovDeg: number) {
    const frustum = this.widget.camera.frustum as PerspectiveFrustum;
    // Cesium's fov is horizontal when the canvas is wider than tall.
    frustum.fov = CMath.toRadians(horizontalFovDeg);
    frustum.near = 0.5;
    applyPose(this.widget.camera, pose);
  }

  /** What the centre crosshair is pointing at: terrain or 3D tiles. */
  pickCenter(): Geodetic | undefined {
    return pickScreenCenter(this.widget.scene);
  }

  /**
   * Height of the ground (terrain or buildings) beneath a point, from what is currently loaded.
   * Cheap enough to call several times a second from the fly loop.
   */
  groundHeightAt(lat: number, lon: number): number | undefined {
    const { scene } = this.widget;
    const c = Cartographic.fromDegrees(lon, lat);
    const terrain = scene.globe.show ? scene.globe.getHeight(c) : undefined;
    let tiles: number | undefined;
    if (this.tilesets.length && scene.sampleHeightSupported) {
      try {
        tiles = scene.sampleHeight(c);
      } catch {
        tiles = undefined;
      }
    }
    if (terrain === undefined) return tiles;
    return tiles === undefined ? terrain : Math.max(terrain, tiles);
  }

  destroy() {
    if (!this.widget.isDestroyed()) this.widget.destroy();
  }
}

export function pickScreenCenter(scene: Scene): Geodetic | undefined {
  const canvas = scene.canvas;
  const center = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  let c = scene.pickPositionSupported ? scene.pickPosition(center) : undefined;
  if (!c && scene.globe.show) {
    const ray = scene.camera.getPickRay(center);
    if (ray) c = scene.globe.pick(ray, scene);
  }
  if (!c) return undefined;
  const g = Cartographic.fromCartesian(c);
  // Reject hits on the far side of the planet or the sky.
  if (!g || !Number.isFinite(g.height)) return undefined;
  return { lat: CMath.toDegrees(g.latitude), lon: CMath.toDegrees(g.longitude), height: g.height };
}
