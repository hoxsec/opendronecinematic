import { wrap180, wrap360 } from './geo';
import type { Mission } from './mission';

/**
 * Sun position and the day's light, from the NOAA solar calculator (about 0.01° for years
 * 1800-2100). Elevations are geometric, without atmospheric refraction, which is how the usual
 * golden/blue hour definitions are stated.
 */
export interface SunPosition {
  /** Degrees clockwise from north. */
  azimuth: number;
  /** Degrees above the horizon; negative below it. */
  elevation: number;
}

const RAD = Math.PI / 180;
const sin = (d: number) => Math.sin(d * RAD);
const cos = (d: number) => Math.cos(d * RAD);

export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  const jd = date.getTime() / 86_400_000 + 2_440_587.5;
  const t = (jd - 2_451_545) / 36_525;
  const l0 = wrap360(280.46646 + t * (36000.76983 + t * 0.0003032));
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c =
    sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    sin(2 * m) * (0.019993 - 0.000101 * t) +
    sin(3 * m) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * sin(omega);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * cos(omega);
  const decl = Math.asin(sin(eps) * sin(lambda)) / RAD;

  // Equation of time, minutes.
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eot =
    (4 / RAD) *
    (y * sin(2 * l0) -
      2 * e * sin(m) +
      4 * e * y * sin(m) * cos(2 * l0) -
      0.5 * y * y * sin(4 * l0) -
      1.25 * e * e * sin(2 * m));

  const utcMinutes = (date.getTime() / 60_000) % 1440;
  const solarMinutes = (((utcMinutes + eot + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = solarMinutes / 4 - 180;

  const cosZenith = sin(lat) * sin(decl) + cos(lat) * cos(decl) * cos(hourAngle);
  const elevation = 90 - Math.acos(Math.max(-1, Math.min(1, cosZenith))) / RAD;
  const azimuth = wrap360(
    Math.atan2(sin(hourAngle), cos(hourAngle) * sin(lat) - Math.tan(decl * RAD) * cos(lat)) / RAD +
      180,
  );
  return { azimuth, elevation };
}

export type LightPhase = 'night' | 'blue' | 'golden' | 'day';

/** Golden hour: sun between 4° below and 6° above the horizon; blue hour: 6° to 4° below. */
export function lightPhase(elevation: number): LightPhase {
  if (elevation >= 6) return 'day';
  if (elevation >= -4) return 'golden';
  if (elevation >= -6) return 'blue';
  return 'night';
}

export interface PhaseSpan {
  phase: LightPhase;
  start: Date;
  end: Date;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * Local midnight that starts the day containing `date`, for a location `utcOffset` minutes ahead
 * of UTC.
 */
export function localMidnight(date: Date, utcOffset: number): Date {
  const shifted = date.getTime() + utcOffset * MINUTE;
  return new Date(shifted - (((shifted % DAY) + DAY) % DAY) - utcOffset * MINUTE);
}

/** The light phases of the local day containing `date`, in order, sampled each minute. */
export function dayPhases(date: Date, lat: number, lon: number, utcOffset: number): PhaseSpan[] {
  const start = localMidnight(date, utcOffset).getTime();
  const spans: PhaseSpan[] = [];
  for (let t = start; t <= start + DAY; t += MINUTE) {
    const phase = lightPhase(sunPosition(new Date(t), lat, lon).elevation);
    const last = spans[spans.length - 1];
    if (last?.phase === phase) last.end = new Date(t);
    else spans.push({ phase, start: new Date(t), end: new Date(t) });
  }
  return spans;
}

/** Where the sun sits relative to the camera's view direction. */
export type SunRelation = 'backlit' | 'side-left' | 'side-right' | 'front-lit';

/**
 * 'backlit' when the camera looks towards the sun (within 45°), 'front-lit' when the sun is
 * behind it (within 45°), otherwise side light from the left or right of the frame.
 */
export function sunRelation(cameraYaw: number, sun: SunPosition): SunRelation {
  const rel = wrap180(sun.azimuth - cameraYaw);
  if (Math.abs(rel) <= 45) return 'backlit';
  if (Math.abs(rel) >= 135) return 'front-lit';
  return rel > 0 ? 'side-right' : 'side-left';
}

/**
 * True when the sun disc is inside the camera frame (or within `margin` degrees of it), where it
 * flares the lens and blows out the exposure.
 */
export function sunInFrame(
  cameraYaw: number,
  cameraPitch: number,
  hFovDeg: number,
  vFovDeg: number,
  sun: SunPosition,
  margin = 2,
): boolean {
  if (sun.elevation < -1) return false;
  return (
    Math.abs(wrap180(sun.azimuth - cameraYaw)) <= hFovDeg / 2 + margin &&
    Math.abs(sun.elevation - cameraPitch) <= vFovDeg / 2 + margin
  );
}

/** Circular mean of headings in degrees; undefined for an empty list. */
export function meanHeading(yaws: number[]): number | undefined {
  if (!yaws.length) return undefined;
  const x = yaws.reduce((s, y) => s + cos(y), 0);
  const yy = yaws.reduce((s, y) => s + sin(y), 0);
  const mean = Math.atan2(yy, x) / RAD;
  // Rounding noise around north would otherwise wrap to 360.
  return Math.abs(mean) < 1e-9 ? 0 : wrap360(mean);
}

/**
 * A default shoot time: the start of the evening golden hour on the local day of `now`, or local
 * noon where there is none (polar day or night).
 */
export function defaultShootTime(now: Date, lat: number, lon: number, utcOffset: number): Date {
  const spans = dayPhases(now, lat, lon, utcOffset);
  const noon = localMidnight(now, utcOffset).getTime() + DAY / 2;
  const evening = spans.find((s) => s.phase === 'golden' && s.start.getTime() > noon);
  return evening?.start ?? new Date(noon);
}

/**
 * The mission's shoot start and its location's UTC offset. Without a saved time this is the
 * evening golden hour of `now`'s day, in the computer's time zone.
 */
export function missionShoot(
  mission: Mission,
  now = new Date(),
): { start: Date; utcOffset: number } {
  if (mission.shoot) {
    const start = new Date(mission.shoot.start);
    if (Number.isFinite(start.getTime())) return { start, utcOffset: mission.shoot.utcOffset };
  }
  const utcOffset = -now.getTimezoneOffset();
  const { lat, lon } = mission.takeoff;
  return { start: defaultShootTime(now, lat, lon, utcOffset), utcOffset };
}
