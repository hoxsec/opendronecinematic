import { WGS84_A, WGS84_E2, toDeg, toRad, wrap360 } from './geo';
import { clamp } from './camera';
import type { DroneProfile } from './profiles';

/** Live state of the virtual drone in fly mode. */
export interface DroneState {
  lat: number;
  lon: number;
  /** Ellipsoid height in metres. */
  height: number;
  /** Aircraft/camera heading, degrees clockwise from north. */
  yaw: number;
  /** Gimbal pitch, degrees (0 = horizon, -90 = straight down). */
  pitch: number;
  /** Velocity in metres per second, east/north/up. */
  vE: number;
  vN: number;
  vU: number;
  /** Ground (terrain or buildings) height under the drone, if known. */
  groundHeight?: number;
}

/**
 * Stick input, each axis -1..1. Mode-2 style: forward/right are the right stick (pitch/roll),
 * up/yaw the left stick (throttle/yaw). gimbal tilts the camera (positive = up).
 */
export interface FlyInput {
  forward: number;
  right: number;
  up: number;
  yaw: number;
  gimbal: number;
  /** Sport mode: fly at the airframe's top speed instead of cruise speed. */
  boost: boolean;
}

export const NO_INPUT: FlyInput = { forward: 0, right: 0, up: 0, yaw: 0, gimbal: 0, boost: false };

export interface FlyLimits {
  cruiseSpeed: number;
  maxSpeed: number;
  maxAscent: number;
  maxDescent: number;
  /** Horizontal acceleration / braking in m/s². */
  accel: number;
  verticalAccel: number;
  yawRate: number;
  gimbalRate: number;
  gimbalMin: number;
  gimbalMax: number;
  /** The sim never lets the drone get closer than this to the ground beneath it. */
  minClearance: number;
}

export function flyLimits(profile: DroneProfile): FlyLimits {
  return {
    cruiseSpeed: Math.min(profile.maxSpeed, Math.max(3, profile.maxSpeed * 0.5)),
    maxSpeed: profile.maxSpeed,
    maxAscent: profile.maxAscentSpeed,
    maxDescent: profile.maxDescentSpeed,
    accel: 4,
    verticalAccel: 3,
    yawRate: 75,
    gimbalRate: 45,
    gimbalMin: profile.gimbalPitchMin,
    gimbalMax: profile.gimbalPitchMax,
    minClearance: 2,
  };
}

/** Move `current` toward `target` by at most `maxDelta`. */
const approach = (current: number, target: number, maxDelta: number) =>
  current + clamp(target - current, -maxDelta, maxDelta);

/**
 * Advance the drone by dt seconds. Velocities chase the stick targets under acceleration limits,
 * like a real drone in normal (GPS) mode: release the sticks and it brakes to a hover.
 */
export function stepDrone(s: DroneState, input: FlyInput, dt: number, lim: FlyLimits): DroneState {
  // Frame timestamps can arrive slightly out of order; a non-positive step must be a no-op
  // (a negative acceleration budget would otherwise divide 0 by 0 at rest).
  if (!(dt > 0)) return s;
  const speed = input.boost ? lim.maxSpeed : lim.cruiseSpeed;
  const yaw = wrap360(s.yaw + clamp(input.yaw, -1, 1) * lim.yawRate * dt);
  const pitch = clamp(
    s.pitch + clamp(input.gimbal, -1, 1) * lim.gimbalRate * dt,
    lim.gimbalMin,
    lim.gimbalMax,
  );

  // Stick targets in the body frame, rotated to east/north.
  const sinY = Math.sin(toRad(yaw));
  const cosY = Math.cos(toRad(yaw));
  let tE = (sinY * input.forward + cosY * input.right) * speed;
  let tN = (cosY * input.forward - sinY * input.right) * speed;
  const tMag = Math.hypot(tE, tN);
  if (tMag > speed) {
    tE = (tE / tMag) * speed;
    tN = (tN / tMag) * speed;
  }
  const tU = input.up >= 0 ? input.up * lim.maxAscent : input.up * lim.maxDescent;

  // Limit the horizontal acceleration vector as a whole so diagonal moves aren't faster.
  let dE = tE - s.vE;
  let dN = tN - s.vN;
  const dMag = Math.hypot(dE, dN);
  const maxDv = lim.accel * dt;
  if (dMag > maxDv) {
    dE = (dE / dMag) * maxDv;
    dN = (dN / dMag) * maxDv;
  }
  const vE = s.vE + dE;
  const vN = s.vN + dN;
  let vU = approach(s.vU, tU, lim.verticalAccel * dt);

  // Metres to degrees using the WGS84 meridian and prime-vertical radii at this latitude.
  const sinLat = Math.sin(toRad(s.lat));
  const w = 1 - WGS84_E2 * sinLat * sinLat;
  const rMeridian = (WGS84_A * (1 - WGS84_E2)) / Math.pow(w, 1.5);
  const rPrime = WGS84_A / Math.sqrt(w);
  const lat = s.lat + toDeg((vN * dt) / rMeridian);
  const lon = s.lon + toDeg((vE * dt) / (rPrime * Math.cos(toRad(s.lat))));
  let height = s.height + vU * dt;

  if (s.groundHeight !== undefined && height < s.groundHeight + lim.minClearance) {
    height = s.groundHeight + lim.minClearance;
    vU = Math.max(0, vU);
  }
  return { ...s, lat, lon, height, yaw, pitch, vE, vN, vU };
}

export const horizontalSpeed = (s: DroneState) => Math.hypot(s.vE, s.vN);
