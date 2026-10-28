import {
  buildFlightPath,
  resolvePoi,
  waypointHeight,
  type HeadingMode,
  type GimbalMode,
  type Mission,
  type PointOfInterest,
  type WaypointAction,
} from '@odc/core';

/** A flat, exporter-friendly waypoint with every height convention precomputed. */
export interface ExportPoint {
  lat: number;
  lon: number;
  /** Metres above the takeoff point's ground. */
  relAlt: number;
  /** Metres above the ground beneath the point (interpolated between waypoints when densified). */
  agl: number;
  /** Metres above the WGS84 ellipsoid. */
  height: number;
  speed: number;
  /** Planned camera yaw (deg from north) and gimbal pitch at this point. */
  yaw: number;
  pitch: number;
  headingMode: HeadingMode;
  gimbalMode: GimbalMode;
  poi?: PointOfInterest;
  actions: WaypointAction[];
  /** Index of the source waypoint if this point is one; undefined for densified in-between points. */
  waypointIndex?: number;
  /** Suggested corner radius for apps that round corners themselves. */
  curveSize: number;
}

export interface ExportOptions {
  /**
   * Replace the planned waypoints with points sampled every N metres along the previewed path,
   * each carrying the exact yaw/pitch. Use this when the flight must match the preview exactly
   * instead of relying on the drone app's own curve and POI logic. 0 or undefined = off.
   */
  densify?: number;
}

export interface ExportResult<T> {
  data: T;
  warnings: string[];
}

export function toExportPoints(mission: Mission, opts: ExportOptions = {}): ExportPoint[] {
  const path = buildFlightPath(mission);
  const wps = mission.waypoints;
  const takeoffGround = mission.takeoff.groundHeight;
  const smooth = mission.settings.pathMode === 'smooth';

  const curveAt = (i: number) => {
    if (!smooth || i === 0 || i === wps.length - 1) return 0;
    const before = path.timings[i]!.s - path.timings[i - 1]!.s;
    const after = path.timings[i + 1]!.s - path.timings[i]!.s;
    return round(Math.min(before, after) * 0.4, 1);
  };

  if (!opts.densify) {
    return wps.map((wp, i) => {
      const s = path.sample(path.timings[i]!.arrive)!;
      const height = waypointHeight(mission, wp);
      return {
        lat: wp.lat,
        lon: wp.lon,
        relAlt: height - takeoffGround,
        agl: height - wp.groundHeight,
        height,
        speed: wp.speed ?? mission.settings.speed,
        yaw: s.yaw,
        pitch: s.pitch,
        headingMode: wp.heading,
        gimbalMode: wp.gimbal,
        poi: wp.heading === 'poi' || wp.gimbal === 'poi' ? resolvePoi(mission, wp) : undefined,
        actions: wp.actions,
        waypointIndex: i,
        curveSize: curveAt(i),
      };
    });
  }

  const samples = path.sampleByDistance(opts.densify);
  const seen = new Set<number>();
  return samples.map((s, k) => {
    // sampleByDistance emits each waypoint as a sample with u === 0 at the start of its leg.
    const isWp = s.u === 0 && !seen.has(s.segment);
    if (isWp) seen.add(s.segment);
    const a = wps[s.segment]!;
    const b = wps[s.segment + 1] ?? a;
    const ground = a.groundHeight + (b.groundHeight - a.groundHeight) * s.u;
    const last = k === samples.length - 1;
    return {
      lat: s.position.lat,
      lon: s.position.lon,
      relAlt: s.position.height - takeoffGround,
      agl: s.position.height - ground,
      height: s.position.height,
      speed: Math.max(0.5, last ? (a.speed ?? mission.settings.speed) : s.speed),
      yaw: s.yaw,
      pitch: s.pitch,
      headingMode: 'fixed',
      gimbalMode: 'fixed',
      actions: isWp ? a.actions : [],
      waypointIndex: isWp ? s.segment : undefined,
      curveSize: 0,
    };
  });
}

export const round = (v: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/** Heading in the -180..180 range most drone firmwares expect. */
export const heading180 = (deg: number) => {
  const d = ((deg % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
};
