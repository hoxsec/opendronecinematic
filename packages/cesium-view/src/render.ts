import {
  CesiumWidget,
  EllipsoidTerrainProvider,
  Math as CMath,
  PerspectiveFrustum,
  RequestScheduler,
  type Cesium3DTileset,
  type Event,
} from 'cesium';
import type { Dem } from '@odc/core';
import type { LocalBuildings } from './localBuildings';
import { applySources, type DataSourceSettings } from './sources';
import { applyPose, type CameraPose } from './pose';

// Fires whenever any Cesium network request completes. Public at runtime but missing from the
// typings, so it is accessed defensively; without it the renderer falls back to polling.
const requestCompleted = (RequestScheduler as unknown as { requestCompletedEvent?: Event })
  .requestCompletedEvent;

export interface OfflineRendererOptions {
  width: number;
  height: number;
  horizontalFovDeg: number;
  settings: DataSourceSettings;
  /** The loaded GeoTIFF DEM, when the settings use one for terrain. */
  dem?: Dem;
  /** Give up waiting for tiles on a frame after this long and render what is loaded. */
  tileTimeoutMs?: number;
}

/**
 * Renders frames one at a time at an exact pixel size, waiting for terrain, imagery and 3D tiles
 * to finish loading before each frame. Output quality is independent of the machine's frame rate.
 */
export class OfflineRenderer {
  private readonly host: HTMLDivElement;
  private readonly widget: CesiumWidget;
  private tilesets: Cesium3DTileset[] = [];
  private buildings?: LocalBuildings;
  private readonly timeout: number;

  private constructor(private readonly opts: OfflineRendererOptions) {
    this.timeout = opts.tileTimeoutMs ?? 8000;
    // Off-screen but laid out: WebGL needs a real, sized element to render into.
    this.host = document.createElement('div');
    const dpr = window.devicePixelRatio || 1;
    Object.assign(this.host.style, {
      position: 'fixed',
      left: `${-opts.width / dpr - 100}px`,
      top: '0',
      width: `${opts.width / dpr}px`,
      height: `${opts.height / dpr}px`,
      pointerEvents: 'none',
    });
    document.body.appendChild(this.host);
    this.widget = new CesiumWidget(this.host, {
      baseLayer: false,
      terrainProvider: new EllipsoidTerrainProvider(),
      useDefaultRenderLoop: false,
      useBrowserRecommendedResolution: false,
      contextOptions: { webgl: { preserveDrawingBuffer: true, antialias: true } },
      creditContainer: document.createElement('div'),
    });
    const { scene } = this.widget;
    scene.globe.depthTestAgainstTerrain = true;
    scene.screenSpaceCameraController.enableInputs = false;
    // Consecutive frames overlap almost entirely, so keep plenty of tiles cached instead of
    // evicting and re-downloading them (Cesium's default cache is only 100 tiles).
    scene.globe.tileCacheSize = 2000;
    scene.globe.preloadSiblings = true;
    this.widget.resize();
    // Pin the exact output size: fractional devicePixelRatios can round the CSS-derived size,
    // and H.264 needs even dimensions. The manual render loop never resizes again.
    this.widget.canvas.width = opts.width;
    this.widget.canvas.height = opts.height;
    const frustum = this.widget.camera.frustum as PerspectiveFrustum;
    frustum.aspectRatio = opts.width / opts.height;
    frustum.fov = CMath.toRadians(opts.horizontalFovDeg);
    frustum.near = 0.5;
  }

  static async create(opts: OfflineRendererOptions) {
    const r = new OfflineRenderer(opts);
    const { tilesets, buildings } = await applySources(
      r.widget.scene,
      r.widget.imageryLayers,
      opts.settings,
      undefined,
      opts.dem,
    );
    for (const t of tilesets) t.maximumScreenSpaceError = 4;
    r.tilesets = tilesets;
    r.buildings = buildings;
    return r;
  }

  get canvas(): HTMLCanvasElement {
    return this.widget.canvas;
  }

  private loaded() {
    return (
      this.widget.scene.globe.tilesLoaded &&
      this.tilesets.every((t) => t.tilesLoaded) &&
      (this.buildings?.idle ?? true)
    );
  }

  /** Render one frame at the pose, waiting for tiles. Returns false if it timed out waiting. */
  async renderFrame(pose: CameraPose, signal?: AbortSignal): Promise<boolean> {
    applyPose(this.widget.camera, pose);
    const start = performance.now();
    let stable = 0;
    // Tile requests are only issued during render, so keep rendering until two loaded frames
    // in a row (the second one draws everything that finished loading).
    while (stable < 2) {
      if (signal?.aborted) throw new DOMException('Render cancelled', 'AbortError');
      this.widget.render();
      if (this.loaded()) stable++;
      else {
        stable = 0;
        if (performance.now() - start > this.timeout) {
          this.widget.render();
          return false;
        }
        await this.waitForData(16);
      }
    }
    return true;
  }

  /**
   * Wait for the next tile request to complete, or `ms` at most. Background windows throttle
   * timers to ~1 s, but network completions still arrive promptly, so a minimised render keeps
   * going at network speed instead of crawling.
   */
  private waitForData(ms: number) {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        remove();
        resolve();
      };
      const timer = setTimeout(done, ms);
      const remove = requestCompleted?.addEventListener(done) ?? (() => {});
    });
  }

  destroy() {
    if (!this.widget.isDestroyed()) this.widget.destroy();
    this.host.remove();
  }
}
