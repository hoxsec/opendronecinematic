import {
  Cartesian2,
  Cartographic,
  CesiumWidget,
  EllipsoidTerrainProvider,
  Math as CMath,
  PerspectiveFrustum,
  type Scene,
} from 'cesium';
import type { Dem, Geodetic } from '@odc/core';
import { applySources, type AppliedSources, type DataSourceSettings } from './sources';
import { applyPose, type CameraPose } from './pose';
import { applySunLight } from './lighting';

/**
 * A second globe that renders exactly what the drone camera sees: same world, camera placed at
 * the pose with the profile's horizontal FOV. The container should have the video frame's aspect
 * ratio so the horizontal FOV maps 1:1.
 */
export class PovView {
  readonly widget: CesiumWidget;
  private applied?: AppliedSources;
  private sourcesQueue: Promise<unknown> = Promise.resolve();

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

  /** Apply data sources; overlapping calls run in order, like MissionScene.setSources. */
  setSources(settings: DataSourceSettings, dem?: Dem): Promise<string[]> {
    const run = this.sourcesQueue.then(async () => {
      if (this.widget.isDestroyed()) return [];
      this.applied = await applySources(
        this.widget.scene,
        this.widget.imageryLayers,
        settings,
        this.applied,
        dem,
      );
      return this.applied.errors;
    });
    this.sourcesQueue = run.catch(() => {});
    return run;
  }

  setPose(pose: CameraPose, horizontalFovDeg: number) {
    const frustum = this.widget.camera.frustum as PerspectiveFrustum;
    // Cesium's fov is horizontal when the canvas is wider than tall.
    frustum.fov = CMath.toRadians(horizontalFovDeg);
    frustum.near = 0.5;
    applyPose(this.widget.camera, pose);
  }

  /** Light the view by the sun at `time`, with or without shadows. */
  setSun(time: Date, shadows: boolean) {
    applySunLight(this.widget.scene, this.widget.clock, time, shadows);
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
    let tiles = this.applied?.buildings?.heightAt(lat, lon);
    if (this.applied?.tilesets.length && scene.sampleHeightSupported) {
      try {
        const h = scene.sampleHeight(c);
        if (h !== undefined) tiles = tiles === undefined ? h : Math.max(tiles, h);
      } catch {
        /* keep what we have */
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
