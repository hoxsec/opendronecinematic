import { EnuFrame, lerpAngle, vec, type Geodetic, type Vec3 } from './geo';
import { clamp, headingOf, lookAt, smoothstep } from './camera';
import { hoverSeconds, resolvePoi, waypointGeodetic, type Mission, type Waypoint } from './mission';
import { focalRange, lensAt, missionProfile, type DroneProfile } from './profiles';

export interface PathSample {
  /** Seconds since the aircraft reached the first waypoint. */
  t: number;
  /** Metres flown along the path. */
  s: number;
  /** Index of the waypoint that starts the current leg (or that the aircraft hovers at). */
  segment: number;
  /** Progress through the current leg, 0..1. */
  u: number;
  enu: Vec3;
  position: Geodetic;
  yaw: number;
  pitch: number;
  speed: number;
  /** 35mm-equivalent focal length (zoom). */
  focalMm: number;
}

interface Leg {
  from: number;
  length: number;
  /** Cumulative arc length at evenly spaced spline parameters, for arc-length lookups. */
  arc: number[];
  v0: number;
  v1: number;
  sStart: number;
  tStart: number;
  duration: number;
}

export interface WaypointTiming {
  arrive: number;
  depart: number;
  s: number;
}

export interface FlightPath {
  frame: EnuFrame;
  duration: number;
  length: number;
  timings: WaypointTiming[];
  sample(t: number): PathSample | undefined;
  /** Samples at a fixed time step, always including the final instant. */
  sampleEvery(dt: number): PathSample[];
  /** Samples at a fixed distance step along the path; each waypoint is always included. */
  sampleByDistance(spacing: number): PathSample[];
}

const ARC_STEPS = 48;
const MIN_SPEED = 0.1;

/** Centripetal Catmull-Rom (alpha = 0.5) between p1 and p2, Barry-Goldman form. */
function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 {
  const knot = (a: Vec3, b: Vec3) => Math.max(Math.sqrt(vec.dist(a, b)), 1e-4);
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const mix = (a: Vec3, b: Vec3, ta: number, tb: number) => vec.lerp(a, b, (t - ta) / (tb - ta));
  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

export function buildFlightPath(mission: Mission): FlightPath {
  const { takeoff, settings } = mission;
  const frame = new EnuFrame({ lat: takeoff.lat, lon: takeoff.lon, height: takeoff.groundHeight });
  const profile = missionProfile(mission);
  const wps = mission.waypoints;
  const pts = wps.map((wp) => frame.toEnu(waypointGeodetic(mission, wp)));
  const n = pts.length;

  const pointAt = (leg: number, u: number): Vec3 => {
    const p1 = pts[leg]!;
    const p2 = pts[leg + 1]!;
    if (settings.pathMode === 'straight') return vec.lerp(p1, p2, u);
    const p0 = pts[leg - 1] ?? vec.sub(vec.scale(p1, 2), p2);
    const p3 = pts[leg + 2] ?? vec.sub(vec.scale(p2, 2), p1);
    return catmullRom(p0, p1, p2, p3, u);
  };

  const speedOf = (wp: Waypoint) => Math.max(MIN_SPEED, wp.speed ?? settings.speed);

  const legs: Leg[] = [];
  const timings: WaypointTiming[] = [];
  let t = 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const arrive = t;
    t += hoverSeconds(wps[i]!);
    timings.push({ arrive, depart: t, s });
    if (i === n - 1) break;
    const arc = [0];
    let prev = pointAt(i, 0);
    for (let k = 1; k <= ARC_STEPS; k++) {
      const p = pointAt(i, k / ARC_STEPS);
      arc.push(arc[k - 1]! + vec.dist(prev, p));
      prev = p;
    }
    const length = arc[ARC_STEPS]!;
    const v0 = speedOf(wps[i]!);
    const v1 = speedOf(wps[i + 1]!);
    // Speed ramps linearly with distance, so leg time is the integral of ds / v(s).
    const duration =
      length === 0
        ? 0
        : Math.abs(v1 - v0) < 1e-9
          ? length / v0
          : (length * Math.log(v1 / v0)) / (v1 - v0);
    legs.push({ from: i, length, arc, v0, v1, sStart: s, tStart: t, duration });
    t += duration;
    s += length;
  }
  const duration = t;
  const length = s;

  const uAtDistance = (leg: Leg, d: number) => {
    const { arc } = leg;
    if (leg.length === 0) return 0;
    let lo = 0;
    let hi = ARC_STEPS;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (arc[mid]! < d) lo = mid;
      else hi = mid;
    }
    const span = arc[hi]! - arc[lo]!;
    const f = span > 0 ? (d - arc[lo]!) / span : 0;
    return (lo + f) / ARC_STEPS;
  };

  const tangentAt = (leg: number, u: number): Vec3 => {
    const du = 1e-3;
    return vec.sub(pointAt(leg, Math.min(1, u + du)), pointAt(leg, Math.max(0, u - du)));
  };

  const poiEnu = new Map(mission.pois.map((p) => [p.id, frame.toEnu(p)]));

  const orient = (wp: Waypoint, pos: Vec3, tangent: Vec3) => {
    const poi = resolvePoi(mission, wp);
    const target = poi ? poiEnu.get(poi.id) : undefined;
    const look = target ? lookAt(pos, target) : undefined;
    const yaw =
      wp.heading === 'poi' && look
        ? look.yaw
        : wp.heading === 'fixed'
          ? (wp.headingDeg ?? 0)
          : headingOf(tangent);
    const pitch =
      wp.gimbal === 'poi' && look ? look.pitch : (wp.gimbalPitch ?? settings.gimbalPitch);
    return { yaw, pitch: clamp(pitch, profile.gimbalPitchMin, profile.gimbalPitchMax) };
  };

  // Zoom. A zoomLock waypoint keeps the subject the size it had at its anchor: the last waypoint
  // without zoomLock (focal length and distance to its POI). Focal length scales with distance.
  const [fMin, fMax] = focalRange(profile);
  const focalOf = (wp: Waypoint) => clamp(wp.focalMm ?? profile.equivalentFocalMm, fMin, fMax);
  type Anchor = { f: number; d: number; poi: Vec3 };
  const anchors: (Anchor | undefined)[] = [];
  wps.forEach((wp, i) => {
    if (wp.zoomLock && i > 0) return anchors.push(anchors[i - 1]);
    const poi = resolvePoi(mission, wp);
    const target = poi ? poiEnu.get(poi.id) : undefined;
    anchors.push(
      target ? { f: focalOf(wp), d: vec.dist(pts[i]!, target), poi: target } : undefined,
    );
  });
  const lockedFocal = (a: Anchor, pos: Vec3) =>
    clamp((a.f * vec.dist(pos, a.poi)) / Math.max(a.d, 0.1), fMin, fMax);
  const locked = (i: number) => (wps[i]!.zoomLock ? anchors[i] : undefined);
  const focalAtWp = wps.map((wp, i) => {
    const a = locked(i);
    return a ? lockedFocal(a, pts[i]!) : focalOf(wp);
  });

  // seg is the waypoint index; u > 0 means "on the leg from seg to seg + 1".
  const make = (time: number, seg: number, u: number, sAbs: number, speed: number): PathSample => {
    let enu: Vec3;
    let tangent: Vec3;
    if (n < 2) {
      enu = pts[0]!;
      tangent = [0, 1, 0];
    } else {
      const leg = Math.min(seg, n - 2);
      const legU = seg > n - 2 ? 1 : u;
      enu = pointAt(leg, legU);
      tangent = tangentAt(leg, legU);
    }
    const a = orient(wps[seg]!, enu, tangent);
    let { yaw, pitch } = a;
    let focalMm = focalAtWp[seg]!;
    if (u > 0 && seg + 1 < n) {
      const b = orient(wps[seg + 1]!, enu, tangent);
      const k = smoothstep(u);
      yaw = lerpAngle(a.yaw, b.yaw, k);
      pitch = a.pitch + (b.pitch - a.pitch) * k;
      const lock = locked(seg + 1);
      // Ease zoom in log space so each second of a zoom looks equally fast.
      focalMm = lock ? lockedFocal(lock, enu) : focalMm * (focalAtWp[seg + 1]! / focalMm) ** k;
    }
    return {
      t: time,
      s: sAbs,
      segment: seg,
      u,
      enu,
      position: frame.fromEnu(enu),
      yaw,
      pitch,
      speed,
      focalMm,
    };
  };

  const sample = (time: number): PathSample | undefined => {
    if (n === 0) return undefined;
    const tc = clamp(time, 0, duration);
    for (let i = 0; i < n; i++) {
      const tm = timings[i]!;
      if (tc <= tm.depart) return make(tc, i, 0, tm.s, 0);
      const leg = legs[i];
      if (!leg) break;
      if (tc <= leg.tStart + leg.duration) {
        const tau = tc - leg.tStart;
        const k = leg.length > 0 ? (leg.v1 - leg.v0) / leg.length : 0;
        const d = Math.abs(k) < 1e-12 ? leg.v0 * tau : (leg.v0 * (Math.exp(k * tau) - 1)) / k;
        const dc = clamp(d, 0, leg.length);
        return make(tc, i, uAtDistance(leg, dc), leg.sStart + dc, leg.v0 + k * dc);
      }
    }
    return make(duration, n - 1, 0, length, 0);
  };

  const sampleEvery = (dt: number) => {
    const out: PathSample[] = [];
    if (n === 0) return out;
    const step = Math.max(dt, 1e-3);
    for (let tt = 0; tt < duration; tt += step) out.push(sample(tt)!);
    out.push(sample(duration)!);
    return out;
  };

  const sampleByDistance = (spacing: number) => {
    const out: PathSample[] = [];
    if (n === 0) return out;
    const step = Math.max(spacing, 0.1);
    for (const leg of legs) {
      const i = leg.from;
      out.push(make(timings[i]!.depart, i, 0, leg.sStart, leg.v0));
      const k = leg.length > 0 ? (leg.v1 - leg.v0) / leg.length : 0;
      for (let d = step; d < leg.length - step * 0.25; d += step) {
        const speed = leg.v0 + k * d;
        const tau = Math.abs(k) < 1e-12 ? d / leg.v0 : Math.log(speed / leg.v0) / k;
        out.push(make(leg.tStart + tau, i, uAtDistance(leg, d), leg.sStart + d, speed));
      }
    }
    out.push(make(duration, n - 1, 0, length, 0));
    return out;
  };

  return { frame, duration, length, timings, sample, sampleEvery, sampleByDistance };
}

/** A point on the flight where the real camera changes lens or enters or leaves digital zoom. */
export interface ZoomEvent {
  t: number;
  lensMm: number;
  digital: boolean;
}

/**
 * Where the drone would switch cameras or go digital while following the planned zoom. Lens
 * switches show as a visible jump in real footage; digital zoom softens the picture.
 */
export function zoomEvents(path: FlightPath, profile: DroneProfile, dt = 0.1): ZoomEvent[] {
  const out: ZoomEvent[] = [];
  let last: { lensMm: number; digital: boolean } | undefined;
  for (const s of path.sampleEvery(dt)) {
    const l = lensAt(profile, s.focalMm);
    const cur = { lensMm: l.lensMm, digital: l.digital > 1.01 };
    if (last && (cur.lensMm !== last.lensMm || cur.digital !== last.digital))
      out.push({ t: s.t, ...cur });
    last = cur;
  }
  return out;
}
