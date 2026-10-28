import { useEffect, useMemo } from 'react';
import { fmtTime, zoomEvents } from '@odc/core';
import { useStore } from '../store';
import { useCamera, usePath } from '../derived';
import { useView } from '../viewStore';

export function Timeline({ onRender }: { onRender: () => void }) {
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const mission = useStore((s) => s.mission);
  const rendering = useView((s) => !!s.render);
  const fly = useView((s) => s.fly);
  const { setTime, setPlaying, select } = useStore.getState();
  const path = usePath();
  const duration = path.duration;
  const { profile } = useCamera();
  const zooms = useMemo(() => zoomEvents(path, profile), [path, profile]);
  const pct = (t: number) => `${duration ? (t / duration) * 100 : 0}%`;

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const st = useStore.getState();
      const t = st.time + (now - last) / 1000;
      last = now;
      if (t >= duration) {
        st.setTime(duration);
        st.setPlaying(false);
        return;
      }
      st.setTime(t);
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);

  // Keep the cursor valid when the path gets shorter.
  useEffect(() => {
    if (time > duration) setTime(duration);
  }, [time, duration, setTime]);

  const togglePlay = () => {
    if (!playing && time >= duration) setTime(0);
    setPlaying(!playing);
  };

  return (
    <div className="timeline">
      <button onClick={togglePlay} disabled={duration === 0 || fly} title="Play / pause (Space)">
        {playing ? '❚❚' : '▶'}
      </button>
      <button
        onClick={onRender}
        disabled={duration === 0 || rendering || fly}
        title="Render the drone camera to MP4 / WebM / GIF"
      >
        🎬 Render…
      </button>
      <span className="mono">
        {fmtTime(time)} / {fmtTime(duration)}
      </span>
      <div className="track">
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.01}
          value={time}
          disabled={fly}
          onChange={(e) => {
            setPlaying(false);
            setTime(Number(e.target.value));
          }}
        />
        <div className="zoom-marks">
          {zooms.map((z) => (
            <span
              key={z.t}
              className={z.digital ? 'digital' : 'lens'}
              style={{ left: pct(z.t) }}
              title={
                z.digital
                  ? `${fmtTime(z.t)}: digital zoom on the ${z.lensMm} mm camera`
                  : `${fmtTime(z.t)}: switches to the ${z.lensMm} mm camera (a jump in real footage)`
              }
            >
              {z.digital ? '' : z.lensMm}
            </span>
          ))}
        </div>
        <div className="ticks">
          {path.timings.map((tm, i) => (
            <button
              key={mission.waypoints[i]?.id ?? i}
              className="tick"
              style={{ left: `${duration ? (tm.arrive / duration) * 100 : 0}%` }}
              title={`Waypoint ${i + 1} at ${fmtTime(tm.arrive)}`}
              onClick={() => {
                setPlaying(false);
                setTime(tm.arrive);
                select(mission.waypoints[i]?.id);
              }}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>
      <span className="mono muted">{Math.round(path.length)} m</span>
    </div>
  );
}
