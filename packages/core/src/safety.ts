import { vec } from './geo';
import { waypointGeodetic, type Mission } from './mission';
import type { FlightPath, PathSample } from './path';
import { missionProfile } from './profiles';

export interface SafetyLimits {
  /** Minimum metres between the aircraft and terrain/buildings below it. */
  minClearance: number;
  /** Regulatory ceiling above ground (120 m in the EU/UK, ~122 m / 400 ft in the US). */
  maxAgl: number;
  /** Maximum horizontal distance from takeoff. */
  maxDistance: number;
  /** Fraction of the battery to keep in reserve, 0..1. */
  batteryReserve: number;
}

export const DEFAULT_LIMITS: SafetyLimits = {
  minClearance: 10,
  maxAgl: 120,
  maxDistance: 1500,
  batteryReserve: 0.25,
};

export type SafetyCode = 'clearance' | 'ceiling' | 'distance' | 'speed' | 'climb' | 'battery';

export interface SafetyIssue {
  severity: 'error' | 'warning';
  code: SafetyCode;
  message: string;
  /** Path distance range (metres) the issue covers, for highlighting the path. */
  from?: number;
  to?: number;
  waypointIndex?: number;
}

export interface SafetyReport {
  issues: SafetyIssue[];
  /** Mission time from the first waypoint to the last, in seconds. */
  pathSeconds: number;
  /** Including climb-out from takeoff, transit to the first waypoint and return home. */
  totalSeconds: number;
  batteryUsedFraction: number;
  minClearance?: number;
  maxAgl?: number;
}

/**
 * Evaluate a planned flight. `groundHeights[i]` is the ellipsoid height of whatever lies beneath
 * `samples[i]` (terrain or 3D tiles); undefined entries are skipped.
 */
export function evaluateSafety(
  mission: Mission,
  path: FlightPath,
  samples: PathSample[],
  groundHeights: (number | undefined)[],
  limits: SafetyLimits = DEFAULT_LIMITS,
): SafetyReport {
  const profile = missionProfile(mission);
  const issues: SafetyIssue[] = [];
  let minClear: number | undefined;
  let maxAgl: number | undefined;

  const ranges = (fails: (s: PathSample, i: number) => boolean) => {
    const out: { from: number; to: number; i: number }[] = [];
    let open: { from: number; to: number; i: number } | undefined;
    samples.forEach((s, i) => {
      if (fails(s, i)) {
        if (open) open.to = s.s;
        else open = { from: s.s, to: s.s, i };
      } else if (open) {
        out.push(open);
        open = undefined;
      }
    });
    if (open) out.push(open);
    return out;
  };

  const clearanceAt = (s: PathSample, i: number) => {
    const g = groundHeights[i];
    return g === undefined ? undefined : s.position.height - g;
  };

  samples.forEach((s, i) => {
    const c = clearanceAt(s, i);
    if (c === undefined) return;
    minClear = minClear === undefined ? c : Math.min(minClear, c);
    maxAgl = maxAgl === undefined ? c : Math.max(maxAgl, c);
  });

  for (const r of ranges((s, i) => (clearanceAt(s, i) ?? Infinity) < limits.minClearance)) {
    issues.push({
      severity: 'error',
      code: 'clearance',
      message: `Less than ${limits.minClearance} m clearance over terrain/buildings (${fmtRange(r)}).`,
      from: r.from,
      to: r.to,
    });
  }
  for (const r of ranges((s, i) => (clearanceAt(s, i) ?? -Infinity) > limits.maxAgl)) {
    issues.push({
      severity: 'warning',
      code: 'ceiling',
      message: `Above ${limits.maxAgl} m AGL (${fmtRange(r)}).`,
      from: r.from,
      to: r.to,
    });
  }
  for (const r of ranges((s) => Math.hypot(s.enu[0], s.enu[1]) > limits.maxDistance)) {
    issues.push({
      severity: 'warning',
      code: 'distance',
      message: `More than ${limits.maxDistance} m from takeoff (${fmtRange(r)}).`,
      from: r.from,
      to: r.to,
    });
  }

  mission.waypoints.forEach((wp, i) => {
    const v = wp.speed ?? mission.settings.speed;
    if (v > profile.maxSpeed) {
      issues.push({
        severity: 'error',
        code: 'speed',
        message: `Waypoint ${i + 1}: ${v} m/s exceeds the ${profile.name} limit of ${profile.maxSpeed} m/s.`,
        waypointIndex: i,
      });
    }
  });

  path.timings.forEach((tm, i) => {
    const next = path.timings[i + 1];
    if (!next) return;
    const legTime = next.arrive - tm.depart;
    if (legTime <= 0) return;
    const dz =
      waypointGeodetic(mission, mission.waypoints[i + 1]!).height -
      waypointGeodetic(mission, mission.waypoints[i]!).height;
    const rate = dz / legTime;
    const limit = rate > 0 ? profile.maxAscentSpeed : profile.maxDescentSpeed;
    if (Math.abs(rate) > limit) {
      issues.push({
        severity: 'warning',
        code: 'climb',
        message: `Leg ${i + 1}→${i + 2}: ${rate > 0 ? 'climbs' : 'descends'} at ${Math.abs(rate).toFixed(1)} m/s (limit ${limit} m/s); the drone will fly it slower than planned.`,
        waypointIndex: i,
      });
    }
  });

  // Rough endurance model: climb to the first waypoint, cruise there and back, descend home.
  let transit = 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first && last) {
    const cruise = Math.max(1, mission.settings.speed);
    const home = path.frame.toEnu({ ...mission.takeoff, height: mission.takeoff.groundHeight });
    const horiz = (p: PathSample) => Math.hypot(p.enu[0] - home[0], p.enu[1] - home[1]);
    transit =
      Math.max(0, first.enu[2]) / profile.maxAscentSpeed +
      horiz(first) / cruise +
      horiz(last) / cruise +
      Math.max(0, last.enu[2]) / profile.maxDescentSpeed;
  }
  const totalSeconds = path.duration + transit;
  const battery = profile.batteryMinutes * 60;
  const used = totalSeconds / battery;
  if (used > 1) {
    issues.push({
      severity: 'error',
      code: 'battery',
      message: `Estimated ${fmtTime(totalSeconds)} exceeds the ${profile.batteryMinutes} min battery.`,
    });
  } else if (used > 1 - limits.batteryReserve) {
    issues.push({
      severity: 'warning',
      code: 'battery',
      message: `Estimated ${fmtTime(totalSeconds)} leaves less than ${Math.round(limits.batteryReserve * 100)}% battery reserve.`,
    });
  }

  return {
    issues,
    pathSeconds: path.duration,
    totalSeconds,
    batteryUsedFraction: used,
    minClearance: minClear,
    maxAgl,
  };
}

/** Distance between two path samples, ignoring altitude. */
export const horizontalDistance = (a: PathSample, b: PathSample) =>
  vec.len([a.enu[0] - b.enu[0], a.enu[1] - b.enu[1], 0]);

const fmtRange = (r: { from: number; to: number }) =>
  `${Math.round(r.from)}–${Math.round(r.to)} m along path`;

export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};
