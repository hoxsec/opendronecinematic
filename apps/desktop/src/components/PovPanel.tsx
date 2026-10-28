import { useEffect, useRef } from 'react';
import { PovView } from '@odc/cesium-view';
import { useStore } from '../store';
import { useCamera, usePath } from '../derived';
import { saveFile } from '../platform';

export function PovPanel() {
  const ref = useRef<HTMLDivElement>(null);
  const povRef = useRef<PovView | undefined>(undefined);
  const settings = useStore((s) => s.settings);
  const time = useStore((s) => s.time);
  const recording = useStore((s) => s.recording);
  const path = usePath();
  const { fov, profile } = useCamera();
  const sample = path.sample(time);

  useEffect(() => {
    const pov = new PovView(ref.current!);
    povRef.current = pov;
    return () => pov.destroy();
  }, []);

  useEffect(() => {
    povRef.current?.setSources(settings);
  }, [settings]);

  useEffect(() => {
    if (sample) povRef.current?.setPose(sample, fov.horizontal);
  }, [sample, fov.horizontal]);

  // Recording follows the store flag so the timeline can stop it at the end of playback.
  useEffect(() => {
    const pov = povRef.current;
    if (!pov) return;
    if (recording && !pov.recording) {
      pov.startRecording().then(async (blob) => {
        const name = `${useStore.getState().mission.name.replace(/[^\w-]+/g, '_') || 'flight'}-preview.webm`;
        await saveFile(name, blob, [{ name: 'WebM video', extensions: ['webm'] }]);
      });
    } else if (!recording && pov.recording) {
      pov.stopRecording();
    }
  }, [recording]);

  return (
    <div className="pov">
      <div className="pov-frame" style={{ aspectRatio: String(profile.videoAspect) }}>
        <div ref={ref} className="pov-canvas" />
        <div className="pov-hud">
          {sample ? (
            <>
              <span>HDG {sample.yaw.toFixed(0)}°</span>
              <span>GMB {sample.pitch.toFixed(0)}°</span>
              <span>{sample.speed.toFixed(1)} m/s</span>
              <span>FOV {fov.horizontal.toFixed(0)}°</span>
            </>
          ) : (
            <span>Add waypoints to preview the shot</span>
          )}
          {recording && <span className="rec">● REC</span>}
        </div>
        <div className="pov-thirds" />
      </div>
    </div>
  );
}
