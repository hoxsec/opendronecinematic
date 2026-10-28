import { fmtTime } from '@odc/core';
import { useStore } from '../store';
import { Section } from './fields';
import { usePath } from '../derived';

export function SafetyPanel() {
  const safety = useStore((s) => s.safety);
  const mission = useStore((s) => s.mission);
  const { setTime, select } = useStore.getState();
  const path = usePath();
  if (mission.waypoints.length === 0) return null;
  if (!safety) return <Section title="Safety">Checking…</Section>;

  const errors = safety.issues.filter((i) => i.severity === 'error').length;
  const pct = Math.round(safety.batteryUsedFraction * 100);
  const jump = (from?: number, wpIndex?: number) => {
    if (wpIndex !== undefined) {
      select(mission.waypoints[wpIndex]?.id);
      setTime(path.timings[wpIndex]?.arrive ?? 0);
      return;
    }
    if (from === undefined) return;
    // Find the first waypoint timing past this distance and interpolate the time.
    const i = path.timings.findIndex((t) => t.s > from);
    const a = path.timings[Math.max(0, i - 1)]!;
    const b = path.timings[i] ?? a;
    const f = b.s > a.s ? (from - a.s) / (b.s - a.s) : 0;
    setTime(a.depart + (b.arrive - a.depart) * f);
  };

  return (
    <Section title={errors ? `Safety · ${errors} error${errors > 1 ? 's' : ''}` : 'Safety'}>
      <div
        className="battery"
        title="Estimated battery use, including transit from and back to takeoff"
      >
        <div
          style={{ width: `${Math.min(100, pct)}%` }}
          className={pct > 100 ? 'bad' : pct > 75 ? 'warn' : ''}
        />
      </div>
      <p className="stats">
        ~{fmtTime(safety.totalSeconds)} total · {pct}% battery
        {safety.minClearance !== undefined &&
          ` · min clearance ${Math.round(safety.minClearance)} m`}
        {safety.maxAgl !== undefined && ` · max ${Math.round(safety.maxAgl)} m AGL`}
      </p>
      {safety.issues.length === 0 ? (
        <p className="ok">No issues found.</p>
      ) : (
        <ul className="issues">
          {safety.issues.map((i, k) => (
            <li key={k} className={i.severity} onClick={() => jump(i.from, i.waypointIndex)}>
              {i.message}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Checks use the loaded terrain and 3D tiles and are planning aids only. Always verify
        airspace rules and fly with line of sight.
      </p>
    </Section>
  );
}
