import type { EnuFrame, Vec3 } from './geo';

/** Obstacle classes extracted from OpenStreetMap by the desktop app's local data service. */
export type ObstacleKind =
  | 'mast'
  | 'tower'
  | 'chimney'
  | 'power_tower'
  | 'power_line'
  | 'wind_turbine'
  | 'crane'
  | 'aerodrome'
  | 'heliport';

export interface Obstacle {
  kind: ObstacleKind;
  name?: string;
  /** Height above ground in metres. */
  height: number;
  /** False when the height is a default for the kind rather than mapped in OSM. */
  heightTagged: boolean;
  /** [lon, lat] pairs: one point, or the vertices of a power line. */
  coords: [number, number][];
}

export const OBSTACLE_LABELS: Record<ObstacleKind, string> = {
  mast: 'mast',
  tower: 'tower',
  chimney: 'chimney',
  power_tower: 'power pylon',
  power_line: 'power line',
  wind_turbine: 'wind turbine',
  crane: 'crane',
  aerodrome: 'aerodrome',
  heliport: 'heliport',
};

export const isAirfield = (o: Obstacle) => o.kind === 'aerodrome' || o.kind === 'heliport';

/** An obstacle's points in a local frame, for repeated distance checks. */
export const obstacleEnu = (frame: EnuFrame, o: Obstacle) =>
  o.coords.map(([lon, lat]) => frame.toEnu({ lat, lon, height: frame.origin.height }));

/** Horizontal distance (metres) from an ENU point to a point or polyline from obstacleEnu(). */
export function distanceToPoints(pts: Vec3[], enu: Vec3): number {
  if (pts.length === 1) return Math.hypot(enu[0] - pts[0]![0], enu[1] - pts[0]![1]);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t =
      len2 > 0 ? Math.max(0, Math.min(1, ((enu[0] - a[0]) * dx + (enu[1] - a[1]) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(enu[0] - (a[0] + t * dx), enu[1] - (a[1] + t * dy)));
  }
  return best;
}
