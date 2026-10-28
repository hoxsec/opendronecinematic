import { missionProfile, newId, profileFov } from '@odc/core';
import { OfflineRenderer } from '@odc/cesium-view';
import { getPath, sunTimeAt } from '../derived';
import { useStore } from '../store';
import { useView, type VideoFormat } from '../viewStore';
import { createEncoder, type VideoQuality } from './encoders';

export interface RenderRequest {
  format: VideoFormat;
  width: number;
  height: number;
  fps: number;
  quality: VideoQuality;
}

/**
 * Render the planned flight frame by frame into a take. Progress goes to the view store so the
 * camera HUD can show a live REC overlay; the result opens in the takes player.
 */
export async function renderFlight(req: RenderRequest) {
  const { mission, settings, dem, notify } = useStore.getState();
  const view = useView.getState();
  if (view.render) return;
  const path = getPath(mission);
  if (path.duration <= 0) {
    notify('Add at least two waypoints to render a flight.', 'error');
    return;
  }

  const controller = new AbortController();
  const profile = missionProfile(mission);
  const total = Math.max(1, Math.round(path.duration * req.fps));
  const progress = {
    format: req.format,
    width: req.width,
    height: req.height,
    fps: req.fps,
    frame: 0,
    total,
    bytes: 0,
    slowFrames: 0,
    startedAt: Date.now(),
    cancel: () => controller.abort(),
  };
  view.setRender({ ...progress });

  let renderer: OfflineRenderer | undefined;
  let encoder: Awaited<ReturnType<typeof createEncoder>> | undefined;
  try {
    renderer = await OfflineRenderer.create({
      width: req.width,
      height: req.height,
      settings,
      dem,
      shadows: view.shadows,
    });
    encoder = await createEncoder(req.format, renderer.canvas, {
      fps: req.fps,
      quality: req.quality,
    });
    for (let i = 0; i < total; i++) {
      const t = i / req.fps;
      const sample = path.sample(t)!;
      const fov = profileFov(profile, 'video', sample.focalMm).horizontal;
      const complete = await renderer.renderFrame(
        sample,
        fov,
        sunTimeAt(mission, t),
        controller.signal,
      );
      if (!complete) progress.slowFrames++;
      await encoder.addFrame(i);
      progress.frame = i + 1;
      progress.bytes = encoder.bytes;
      useView.getState().setRender({ ...progress });
    }
    const blob = await encoder.finish();
    const n = useView.getState().takes.length + 1;
    useView.getState().addTake({
      id: newId('take'),
      name: `Take ${n} · ${mission.name}`,
      format: req.format,
      url: URL.createObjectURL(blob),
      blob,
      width: renderer.canvas.width,
      height: renderer.canvas.height,
      fps: encoder.fps,
      duration: path.duration,
      createdAt: Date.now(),
    });
    notify(
      progress.slowFrames
        ? `Render done. ${progress.slowFrames} frame(s) timed out waiting for map tiles.`
        : 'Render done.',
    );
  } catch (e) {
    await encoder?.cancel().catch(() => {});
    if ((e as Error).name === 'AbortError') notify('Render cancelled.');
    else notify(`Render failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
  } finally {
    renderer?.destroy();
    useView.getState().setRender(undefined);
  }
}
