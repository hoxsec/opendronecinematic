import {
  Cartesian3,
  CesiumWidget,
  EllipsoidTerrainProvider,
  HeadingPitchRoll,
  Math as CMath,
  PerspectiveFrustum,
  type Cesium3DTileset,
} from 'cesium';
import type { PathSample } from '@odc/core';
import { applySources, type DataSourceSettings } from './sources';

/**
 * A second globe that renders exactly what the drone camera sees: same world, camera placed at
 * the sampled position with the profile's horizontal FOV. The container should have the video
 * frame's aspect ratio so the horizontal FOV maps 1:1.
 */
export class PovView {
  readonly widget: CesiumWidget;
  private tilesets: Cesium3DTileset[] = [];
  private recorder?: MediaRecorder;

  constructor(container: HTMLElement) {
    this.widget = new CesiumWidget(container, {
      baseLayer: false,
      terrainProvider: new EllipsoidTerrainProvider(),
      // Keep frames readable for canvas.captureStream() when recording.
      contextOptions: { webgl: { preserveDrawingBuffer: true } },
    });
    const { scene } = this.widget;
    scene.globe.depthTestAgainstTerrain = true;
    // The preview is driven by the plan, not the mouse.
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

  setPose(sample: PathSample, horizontalFovDeg: number) {
    const { camera } = this.widget;
    const frustum = camera.frustum as PerspectiveFrustum;
    // Cesium's fov is horizontal when the canvas is wider than tall.
    frustum.fov = CMath.toRadians(horizontalFovDeg);
    frustum.near = 0.5;
    camera.setView({
      destination: Cartesian3.fromDegrees(
        sample.position.lon,
        sample.position.lat,
        sample.position.height,
      ),
      orientation: new HeadingPitchRoll(
        CMath.toRadians(sample.yaw),
        CMath.toRadians(sample.pitch),
        0,
      ),
    });
  }

  get recording() {
    return this.recorder?.state === 'recording';
  }

  /** Start recording the preview canvas. Resolves with a WebM blob when stopRecording() is called. */
  startRecording(fps = 30): Promise<Blob> {
    const stream = this.widget.canvas.captureStream(fps);
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    this.recorder = recorder;
    const done = new Promise<Blob>((resolve) => {
      recorder.onstop = () =>
        resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
    });
    recorder.start(250);
    return done;
  }

  stopRecording() {
    if (this.recorder?.state === 'recording') this.recorder.stop();
  }

  destroy() {
    this.stopRecording();
    if (!this.widget.isDestroyed()) this.widget.destroy();
  }
}
