import { fmtTime } from '@odc/core';
import { useStore } from '../store';
import { Section } from './fields';
import { usePath } from '../derived';

export function SafetyPanel() {
  const safety = useStore((s) => s.safety);
  const pending = useStore((s) => s.safetyPending);
  const mission = useStore((s) => s.mission);
  const { setTime, select } = useStore.getState();
  const path = usePath();
  if (mission.waypoints.length === 0) return null;
  if (!safety)
    return (
      <Section title="Safety">
        {pending ? 'Checking in background…' : 'Safety check unavailable.'}
      </Section>
    );

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
      {pending && (
        <p className="note" role="status">
          Updating safety in the background. Results below are from the previous check.
        </p>
      )}
      <div
        className="battery"
        title="Estimated battery use, including transit from and back to takeoff"
      >
        <div
          style={{ width: `${Math.min(100, pct)}%` }}
          className={pct > 100 ? 'bad' : pct > 75 ? 'warn' : ''}
        />
      </div>
      <div className="safety-stats">
        <span>
          Estimated duration <strong>{fmtTime(safety.totalSeconds)}</strong>
        </span>
        <span>
          Battery used <strong>{pct}%</strong>
        </span>
        {safety.minClearance !== undefined && (
          <span>
            Minimum clearance <strong>{Math.round(safety.minClearance)} m</strong>
          </span>
        )}
        {safety.maxAgl !== undefined && (
          <span>
            Maximum height above ground <strong>{Math.round(safety.maxAgl)} m</strong>
          </span>
        )}
      </div>
      {safety.issues.length === 0 ? (
        <p className="ok">No issues found.</p>
      ) : (
        <ul className="issues">
          {safety.issues.map((i, k) => (
            <li key={k} className={i.severity}>
              <button className="issue-button" onClick={() => jump(i.from, i.waypointIndex)}>
                <strong className="issue-severity">
                  {i.severity === 'error' ? '⚠ Error' : '⚠ Warning'}
                </strong>
                <span>{i.message}</span>
                {i.from !== undefined && (
                  <span className="issue-distance">
                    Along route: {Math.round(i.from)} m
                    {i.to !== undefined && i.to !== i.from ? ` – ${Math.round(i.to)} m` : ''}
                  </span>
                )}
              </button>
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
