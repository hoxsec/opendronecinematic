import { EnuFrame, wrap180, type Vec3 } from './geo';
import { altFromHeight, createWaypoint, type Mission, type Waypoint } from './mission';

/** One sample of a freely flown path, recorded in fly mode. */
export interface TrackPoint {
  t: number;
  lat: number;
  lon: number;
  height: number;
  yaw: number;
  pitch: number;
  /** Ground height under the drone when sampled. */
  groundHeight: number;
}

export interface SimplifyOptions {
  /** Max deviation of the flown position from the simplified path, metres. */
  positionTolerance: number;
  /** Max deviation of the camera yaw from the interpolated yaw, degrees. */
  yawTolerance: number;
  /** Max deviation of the gimbal pitch, degrees. */
  pitchTolerance: number;
}

export const DEFAULT_SIMPLIFY: SimplifyOptions = {
  positionTolerance: 2,
  yawTolerance: 12,
  pitchTolerance: 6,
};

/**
 * Ramer–Douglas–Peucker generalised to position *and* camera angles: a point is kept when its
 * position, yaw or pitch strays from the straight interpolation between the kept neighbours
 * by more than the tolerance. Returns the indices of the kept points, always including both ends.
 */
export function simplifyTrack(
  points: TrackPoint[],
  opts: SimplifyOptions = DEFAULT_SIMPLIFY,
): number[] {
  if (points.length <= 2) return points.map((_, i) => i);
  const frame = new EnuFrame(points[0]!);
  const enu: Vec3[] = points.map((p) => frame.toEnu(p));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const error = (i: number, a: number, b: number) => {
    const span = points[b]!.t - points[a]!.t;
    const f = span > 0 ? (points[i]!.t - points[a]!.t) / span : 0;
    const pa = enu[a]!;
    const pb = enu[b]!;
    const pi = enu[i]!;
    const dx = pi[0] - (pa[0] + (pb[0] - pa[0]) * f);
    const dy = pi[1] - (pa[1] + (pb[1] - pa[1]) * f);
    const dz = pi[2] - (pa[2] + (pb[2] - pa[2]) * f);
    const yawLerp = points[a]!.yaw + wrap180(points[b]!.yaw - points[a]!.yaw) * f;
    const pitchLerp = points[a]!.pitch + (points[b]!.pitch - points[a]!.pitch) * f;
    // Time-based interpolation also catches speed changes along a straight line.
    return Math.max(
      Math.hypot(dx, dy, dz) / opts.positionTolerance,
      Math.abs(wrap180(points[i]!.yaw - yawLerp)) / opts.yawTolerance,
      Math.abs(points[i]!.pitch - pitchLerp) / opts.pitchTolerance,
    );
  };

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const e = error(i, a, b);
      if (e > worst) {
        worst = e;
        at = i;
      }
    }
    if (worst > 1 && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return [...keep.keys()].filter((i) => keep[i]);
}

/**
 * Turn a recorded flight into waypoints with fixed heading/gimbal keyframes. Speeds come from
 * the average speed flown over each leg, so the replay keeps the pilot's pacing. Spots where the
 * pilot paused become hovers.
 */
export function waypointsFromTrack(
  mission: Mission,
  points: TrackPoint[],
  opts: SimplifyOptions = DEFAULT_SIMPLIFY,
): Waypoint[] {
  const kept = simplifyTrack(points, opts);
  const frame = new EnuFrame(points[0] ?? { lat: 0, lon: 0, height: 0 });
  const legSpeed = (a: number, b: number) => {
    let dist = 0;
    for (let i = a; i < b; i++) {
      const p = frame.toEnu(points[i]!);
      const q = frame.toEnu(points[i + 1]!);
      dist += Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    }
    const dt = points[b]!.t - points[a]!.t;
    return { dist, dt, speed: dt > 0 ? dist / dt : 0 };
  };

  return kept.map((idx, k) => {
    const p = points[idx]!;
    const next = kept[k + 1];
    const leg = next !== undefined ? legSpeed(idx, next) : undefined;
    const wp = createWaypoint({
      lat: p.lat,
      lon: p.lon,
      groundHeight: p.groundHeight,
      alt: Math.round(altFromHeight(mission, p.groundHeight, p.height) * 10) / 10,
      heading: 'fixed',
      headingDeg: Math.round(p.yaw * 10) / 10,
      gimbal: 'fixed',
      gimbalPitch: Math.round(p.pitch * 10) / 10,
      speed: leg ? Math.max(1, Math.round(leg.speed * 10) / 10) : undefined,
    });
    // A leg flown at under 0.3 m/s for a while is the pilot holding position.
    if (leg && leg.dt > 1.5 && leg.dist / leg.dt < 0.3) {
      wp.actions = [{ type: 'hover', seconds: Math.round(leg.dt * 10) / 10 }];
    }
    return wp;
  });
}
