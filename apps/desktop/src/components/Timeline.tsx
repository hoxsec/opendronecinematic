import { useEffect } from 'react';
import { fmtTime } from '@odc/core';
import { useStore } from '../store';
import { usePath } from '../derived';

export function Timeline() {
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const recording = useStore((s) => s.recording);
  const mission = useStore((s) => s.mission);
  const { setTime, setPlaying, setRecording, select } = useStore.getState();
  const path = usePath();
  const duration = path.duration;

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
        st.setRecording(false);
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

  const record = () => {
    if (recording) {
      setRecording(false);
      setPlaying(false);
      return;
    }
    setTime(0);
    setRecording(true);
    setPlaying(true);
  };

  return (
    <div className="timeline">
      <button onClick={togglePlay} disabled={duration === 0} title="Play / pause (Space)">
        {playing ? '❚❚' : '▶'}
      </button>
      <button
        onClick={record}
        disabled={duration === 0}
        className={recording ? 'danger' : ''}
        title="Record the drone view to WebM"
      >
        {recording ? '■ Stop' : '● Rec'}
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
          onChange={(e) => {
            setPlaying(false);
            setTime(Number(e.target.value));
          }}
        />
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
