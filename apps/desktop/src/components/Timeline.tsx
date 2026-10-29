import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { fmtTime, type Mission, type ZoomEvent } from '@odc/core';
import { PLAYBACK_RATES, useStore } from '../store';
import { usePath } from '../derived';
import { useView } from '../viewStore';
import { runAnalysis } from '../analysisWorker';
import { advancePlayback, rulerTicks, timeAtPointer } from '../timelineMath';

export function Timeline({ onRender }: { onRender: () => void }) {
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const rate = useStore((s) => s.playbackRate);
  const mission = useStore((s) => s.mission);
  const selectedIds = useStore((s) => s.selectedWaypointIds);
  const rendering = useView((s) => !!s.render);
  const fly = useView((s) => s.fly);
  const { setTime, setPlaying, setPlaybackRate, select } = useStore.getState();
  const path = usePath();
  const duration = path.duration;
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [zoomResult, setZoomResult] = useState<{ mission: Mission; events: ZoomEvent[] }>();
  const zooms = zoomResult?.mission === mission ? zoomResult.events : [];
  const dragging = useRef<number | undefined>(undefined);
  const pendingTime = useRef<number | undefined>(undefined);
  const scrubFrame = useRef<number | undefined>(undefined);
  const pct = (t: number) => `${duration ? (t / duration) * 100 : 0}%`;

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    if (track.current) observer.observe(track.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (mission.waypoints.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      runAnalysis({ kind: 'zoom', mission }, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted && result.kind === 'zoom')
            setZoomResult({ mission, events: result.events });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            useStore.getState().notify(`Timeline analysis failed: ${String(error)}`, 'error');
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [mission]);

  useEffect(() => {
    if (!playing || fly) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const st = useStore.getState();
      const t = advancePlayback(st.time, now - last, st.playbackRate, duration);
      last = now;
      st.setTime(t);
      if (t >= duration) {
        st.setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, fly]);

  useEffect(() => {
    if (time > duration) setTime(duration);
  }, [time, duration, setTime]);

  useEffect(
    () => () => {
      if (scrubFrame.current !== undefined) cancelAnimationFrame(scrubFrame.current);
    },
    [],
  );

  const togglePlay = () => {
    if (fly || !duration) return;
    if (!playing && time >= duration) setTime(0);
    setPlaying(!playing);
  };
  const flushScrub = () => {
    if (scrubFrame.current !== undefined) cancelAnimationFrame(scrubFrame.current);
    scrubFrame.current = undefined;
    if (pendingTime.current !== undefined) setTime(pendingTime.current);
    pendingTime.current = undefined;
  };
  const scrub = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pendingTime.current = timeAtPointer(e.clientX, rect.left, rect.width, duration);
    if (scrubFrame.current === undefined) scrubFrame.current = requestAnimationFrame(flushScrub);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (fly || !duration) return;
    const step = e.shiftKey ? 5 : 1;
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? duration
          : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
            ? Math.max(0, time - step)
            : e.key === 'ArrowRight' || e.key === 'ArrowUp'
              ? Math.min(duration, time + step)
              : undefined;
    if (next !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      setPlaying(false);
      setTime(next);
    } else if (e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      togglePlay();
    }
  };

  return (
    <div className="timeline">
      <div className="timeline-controls">
        <button
          className="timeline-play"
          onClick={togglePlay}
          disabled={!duration || fly}
          title="Play / pause (Space)"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="mono timeline-time">
          {fmtTime(time)} <span>/ {fmtTime(duration)}</span>
        </span>
        <label
          className="playback-rate"
          title="Preview speed only; does not change flight speed or rendered video"
        >
          Playback
          <select
            aria-label="Playback speed"
            value={rate}
            onChange={(e) => setPlaybackRate(Number(e.target.value))}
          >
            {PLAYBACK_RATES.map((speed) => (
              <option key={speed} value={speed}>
                {speed}×
              </option>
            ))}
          </select>
        </label>
        <span className="mono timeline-distance">
          {Math.round(path.length).toLocaleString()} m route
        </span>
        <button
          onClick={onRender}
          disabled={!duration || rendering || fly}
          title="Render the drone camera to MP4 / WebM / GIF"
        >
          🎬 Render…
        </button>
      </div>
      <div className="timeline-track" ref={track}>
        <div className="timeline-ruler" aria-hidden="true">
          {rulerTicks(duration, Math.max(2, Math.floor(width / 100))).map((t) => (
            <span key={t} style={{ left: pct(t) }}>
              {fmtTime(t)}
            </span>
          ))}
        </div>
        <div
          className={`timeline-scrubber${fly || !duration ? ' disabled' : ''}`}
          role="slider"
          aria-label="Timeline position"
          aria-valuemin={0}
          aria-valuemax={duration || 0}
          aria-valuenow={Math.min(time, duration)}
          aria-valuetext={`${fmtTime(time)} of ${fmtTime(duration)}`}
          aria-disabled={fly || !duration}
          tabIndex={fly || !duration ? -1 : 0}
          onKeyDown={onKey}
          onPointerDown={(e) => {
            if (e.button !== 0 || fly || !duration) return;
            e.preventDefault();
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
            dragging.current = e.pointerId;
            setPlaying(false);
            scrub(e);
          }}
          onPointerMove={(e) => {
            if (dragging.current === e.pointerId) scrub(e);
          }}
          onPointerUp={(e) => {
            if (dragging.current !== e.pointerId) return;
            scrub(e);
            flushScrub();
            dragging.current = undefined;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            flushScrub();
            dragging.current = undefined;
          }}
          onLostPointerCapture={() => {
            flushScrub();
            dragging.current = undefined;
          }}
        >
          <div className="timeline-progress" style={{ width: pct(time) }} />
          <div className="timeline-playhead" style={{ left: pct(time) }}>
            <span />
          </div>
          {zooms.map((z) => (
            <span
              key={z.t}
              className={`timeline-zoom ${z.digital ? 'digital' : 'lens'}`}
              style={{ left: pct(z.t) }}
              title={`${fmtTime(z.t)}: ${z.digital ? 'digital zoom' : 'lens switch'} · ${z.lensMm} mm`}
            />
          ))}
        </div>
        <div className="timeline-waypoints" aria-label="Waypoint markers">
          {path.timings.map((tm, i) => {
            const wp = mission.waypoints[i];
            return (
              <button
                key={wp?.id ?? i}
                className={`timeline-waypoint${wp && selectedIds.includes(wp.id) ? ' selected' : ''}`}
                style={{ left: pct(tm.arrive) }}
                disabled={fly}
                title={`Waypoint ${i + 1} · ${fmtTime(tm.arrive)} · Ctrl-click to toggle, Shift-click for range`}
                onClick={(e) => {
                  setPlaying(false);
                  setTime(tm.arrive);
                  select(wp?.id, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey });
                }}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
