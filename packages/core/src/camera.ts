import { toDeg, wrap360, type Vec3 } from './geo';

export interface Orientation {
  /** Degrees clockwise from true north, [0, 360). */
  yaw: number;
  /** Degrees, 0 = horizon, negative = down. */
  pitch: number;
}

/** Yaw/pitch that points a camera at `from` toward `to`, both in the same ENU frame. */
export function lookAt(from: Vec3, to: Vec3): Orientation {
  const de = to[0] - from[0];
  const dn = to[1] - from[1];
  const du = to[2] - from[2];
  return {
    yaw: wrap360(toDeg(Math.atan2(de, dn))),
    pitch: toDeg(Math.atan2(du, Math.hypot(de, dn))),
  };
}

/** Compass bearing of a horizontal ENU direction vector. */
export function headingOf(dir: Vec3): number {
  return wrap360(toDeg(Math.atan2(dir[0], dir[1])));
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Hermite smoothstep: eases in and out so camera moves don't snap at waypoints. */
export const smoothstep = (t: number) => t * t * (3 - 2 * t);
