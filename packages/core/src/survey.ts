import { EnuFrame, bearing, haversine, toRad, wrap360, type LatLon } from './geo';
import {
  altFromHeight,
  createWaypoint,
  type Mission,
  type Waypoint,
  type WaypointAction,
} from './mission';
import { groundSampleDistance, type DroneProfile } from './profiles';

/** A lawnmower mapping grid over a polygon, flown with nadir distance-triggered photos. */
export interface SurveySpec {
  /** Area outline, at least 3 vertices, not closed (the last vertex joins the first). */
  polygon: LatLon[];
  /** Flight height above the ground in metres. Sets the ground sample distance. */
  height: number;
  /** Overlap between consecutive photos along a line, in percent. */
  frontOverlap: number;
  /** Overlap between neighbouring lines, in percent. */
  sideOverlap: number;
  /** Direction the lines run, degrees clockwise from north. */
  angle: number;
  /** Speed along the lines in m/s; undefined uses the mission speed. */
  speed?: number;
  /** Extend every line past the outline by this many metres so the edges are fully covered. */
  overshoot: number;
  /** Fly a second grid at right angles, for 3D reconstruction of vertical surfaces. */
  crosshatch: boolean;
  /** Gimbal pitch while mapping, -90 = straight down. */
  gimbalPitch: number;
  /**
   * Insert a waypoint every N metres along each line so the height follows the terrain.
   * 0 flies each line straight between its two ends.
   */
  terrainFollowSpacing: number;
}

export const DEFAULT_SURVEY: Omit<SurveySpec, 'polygon'> = {
  height: 60,
  frontOverlap: 75,
  sideOverlap: 65,
  angle: 0,
  overshoot: 5,
  crosshatch: false,
  gimbalPitch: -90,
  terrainFollowSpacing: 0,
};

export interface SurveyStats {
  /** Ground sample distance in cm/pixel at the survey height. */
  gsd: number;
  /** Ground covered by one nadir photo, across and along the flight line, in metres. */
  footprint: { across: number; along: number };
  lineSpacing: number;
  /** Distance between photos along a line. */
  triggerDistance: number;
  /** Polygon area in square metres. */
  area: number;
}

/** One planned point of a survey: a line end or a terrain-following point in between. */
export interface SurveyPoint extends LatLon {
  /** Direction of travel, used as a fixed heading so photos stay aligned with the grid. */
  heading: number;
  actions: WaypointAction[];
}

export interface SurveyPlan {
  points: SurveyPoint[];
  stats: SurveyStats;
  lines: number;
  /** Estimated number of photos, counting one at the start of every line. */
  photos: number;
}

/**
 * Footprint and spacing for a survey. The photo's long side (image width) lies across the line,
 * which is how mapping apps orient the camera and gives the fewest lines.
 */
export function surveyStats(profile: DroneProfile, spec: SurveySpec): SurveyStats {
  const gsd = groundSampleDistance(profile, spec.height);
  const across = (gsd * profile.imageWidthPx) / 100;
  const along = (gsd * profile.imageHeightPx) / 100;
  const frac = (pct: number) => 1 - Math.min(95, Math.max(0, pct)) / 100;
  return {
    gsd,
    footprint: { across, along },
    lineSpacing: across * frac(spec.sideOverlap),
    triggerDistance: along * frac(spec.frontOverlap),
    area: polygonArea(spec.polygon),
  };
}

type P2 = [number, number];

function project(polygon: LatLon[]) {
  const c = polygon.reduce((a, p) => ({ lat: a.lat + p.lat, lon: a.lon + p.lon }), {
    lat: 0,
    lon: 0,
  });
  const frame = new EnuFrame({
    lat: c.lat / polygon.length,
    lon: c.lon / polygon.length,
    height: 0,
  });
  const pts = polygon.map((p): P2 => {
    const [e, n] = frame.toEnu({ ...p, height: 0 });
    return [e, n];
  });
  return { frame, pts };
}

/** Area of a lat/lon polygon in square metres (planar, in a local tangent frame). */
export function polygonArea(polygon: LatLon[]): number {
  if (polygon.length < 3) return 0;
  const { pts } = project(polygon);
  let a = 0;
  pts.forEach(([x1, y1], i) => {
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    a += x1 * y2 - x2 * y1;
  });
  return Math.abs(a) / 2;
}

/** The bearing of the polygon's longest edge: lines parallel to it need the fewest turns. */
export function bestSurveyAngle(polygon: LatLon[]): number {
  let best = 0;
  let len = -1;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!;
    const d = haversine(a, b);
    if (d > len) {
      len = d;
      best = bearing(a, b);
    }
  });
  return Math.round(wrap360(best) % 180);
}

/** Intersections of the line `across = w` with the polygon, as sorted `along` coordinates. */
function crossings(pts: { u: number; w: number }[], w: number): number[] {
  const out: number[] = [];
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    // Half-open test so a vertex exactly on the line is counted once.
    if (a.w <= w === b.w <= w) return;
    out.push(a.u + ((w - a.w) / (b.w - a.w)) * (b.u - a.u));
  });
  return out.sort((x, y) => x - y);
}

/** Line segments covering the polygon at one grid angle, in local ENU coordinates. */
function gridSegments(pts: P2[], angle: number, spacing: number, footprint: number) {
  const a = toRad(angle);
  // `along` runs in the line direction, `across` to its right.
  const along: P2 = [Math.sin(a), Math.cos(a)];
  const across: P2 = [Math.cos(a), -Math.sin(a)];
  const rot = pts.map(([e, n]) => ({
    u: e * along[0] + n * along[1],
    w: e * across[0] + n * across[1],
  }));
  const wMin = Math.min(...rot.map((p) => p.w));
  const wMax = Math.max(...rot.map((p) => p.w));
  const width = wMax - wMin;
  // Enough lines that the outer footprints reach both edges, centred on the polygon.
  const count = Math.max(1, Math.ceil(Math.max(0, width - footprint) / spacing - 1e-9) + 1);
  const first = (wMin + wMax) / 2 - ((count - 1) * spacing) / 2;
  const toEnu = (u: number, w: number): P2 => [
    u * along[0] + w * across[0],
    u * along[1] + w * across[1],
  ];

  const lines: { start: P2; end: P2 }[][] = [];
  for (let k = 0; k < count; k++) {
    // Nudge lines that land exactly on the outline inside so they still intersect it.
    const w = Math.min(wMax - 1e-6, Math.max(wMin + 1e-6, first + k * spacing));
    const xs = crossings(rot, w);
    const segs: { start: P2; end: P2 }[] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      segs.push({ start: toEnu(xs[i]!, w), end: toEnu(xs[i + 1]!, w) });
    }
    if (segs.length) lines.push(segs);
  }
  return lines;
}

/**
 * Lay out a serpentine survey: each line starts distance-triggered photos at its first point and
 * stops them at its last, so the turns between lines take no photos.
 */
export function planSurvey(profile: DroneProfile, spec: SurveySpec): SurveyPlan {
  const stats = surveyStats(profile, spec);
  if (spec.polygon.length < 3 || stats.lineSpacing <= 0) {
    return { points: [], stats, lines: 0, photos: 0 };
  }
  const { frame, pts } = project(spec.polygon);
  const angles = spec.crosshatch ? [spec.angle, spec.angle + 90] : [spec.angle];
  const points: SurveyPoint[] = [];
  let lineCount = 0;
  let photos = 0;
  let last: P2 | undefined;

  const toLatLon = ([e, n]: P2): LatLon => {
    const g = frame.fromEnu([e, n, 0]);
    return { lat: g.lat, lon: g.lon };
  };

  for (const angle of angles) {
    const lines = gridSegments(pts, angle, stats.lineSpacing, stats.footprint.across);
    // Start each grid at whichever end is closest to where the previous one finished.
    if (last && lines.length > 1) {
      const head = lines[0]![0]!.start;
      const tail = lines[lines.length - 1]![0]!.start;
      if (dist(last, tail) < dist(last, head)) lines.reverse();
    }
    let forward = true;
    if (last && lines[0]) {
      const segs = lines[0];
      forward = dist(last, segs[0]!.start) <= dist(last, segs[segs.length - 1]!.end);
    }
    for (const line of lines) {
      const segs = forward
        ? line
        : [...line].reverse().map((s) => ({ start: s.end, end: s.start }));
      for (const seg of segs) {
        const len = dist(seg.start, seg.end);
        if (len < 1e-3) continue;
        const dir: P2 = [(seg.end[0] - seg.start[0]) / len, (seg.end[1] - seg.start[1]) / len];
        const o = spec.overshoot;
        const start: P2 = [seg.start[0] - dir[0] * o, seg.start[1] - dir[1] * o];
        const end: P2 = [seg.end[0] + dir[0] * o, seg.end[1] + dir[1] * o];
        const total = len + 2 * o;
        const heading = wrap360((Math.atan2(dir[0], dir[1]) * 180) / Math.PI);

        const steps =
          spec.terrainFollowSpacing > 0
            ? Math.max(1, Math.ceil(total / spec.terrainFollowSpacing))
            : 1;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const p: P2 = [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
          const actions: WaypointAction[] =
            i === 0
              ? [{ type: 'photoDistance', meters: round(stats.triggerDistance, 1) }]
              : i === steps
                ? [{ type: 'photoDistance', meters: 0 }]
                : [];
          points.push({ ...toLatLon(p), heading: round(heading, 1), actions });
        }
        photos += Math.floor(total / stats.triggerDistance) + 1;
        lineCount++;
        last = end;
      }
      forward = !forward;
    }
  }
  return { points, stats, lines: lineCount, photos };
}

/**
 * Turn a survey layout into waypoints at `spec.height` above the ground. `grounds[i]` is the
 * ellipsoid ground height under `plan.points[i]`; missing values use the takeoff ground.
 */
export function surveyWaypoints(
  mission: Mission,
  spec: SurveySpec,
  plan: SurveyPlan,
  grounds: (number | undefined)[] = [],
): Waypoint[] {
  return plan.points.map((p, i) => {
    const groundHeight = grounds[i] ?? mission.takeoff.groundHeight;
    return createWaypoint({
      lat: p.lat,
      lon: p.lon,
      groundHeight,
      alt: round(altFromHeight(mission, groundHeight, groundHeight + spec.height), 1),
      speed: spec.speed,
      heading: 'fixed',
      headingDeg: p.heading,
      gimbal: 'fixed',
      gimbalPitch: spec.gimbalPitch,
      actions: p.actions,
    });
  });
}

const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
