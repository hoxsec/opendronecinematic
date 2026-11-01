import type { LatLon } from './geo';
import type { FlightPath } from './path';

export type AirspaceCategory = 'restricted' | 'controlled' | 'advisory';
export type AirspacePosition = [lon: number, lat: number];

export interface AirspaceZone {
  id: string;
  name: string;
  category: AirspaceCategory;
  /** Polygons → rings (outer, then holes) → WGS84 [longitude, latitude]. */
  polygons: AirspacePosition[][][];
  /** Informational labels only: vertical limits and activation are NOT evaluated. */
  lower?: string;
  upper?: string;
  description?: string;
}

export interface AirspaceData {
  source?: string;
  validUntil?: string;
  zones: AirspaceZone[];
}

export const AIRSPACE_MAX_BYTES = 10 * 1024 * 1024;
const MAX_ZONES = 5000;
const MAX_VERTICES = 200_000;
const fail = (message: string): never => {
  throw new Error(`Airspace: ${message}`);
};
const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : fail('expected a GeoJSON object.');
const text = (v: unknown, label: string): string | undefined => {
  if (v === undefined || v === null) return;
  if (typeof v !== 'string' || v.length > 2000)
    fail(`${label} must be text (up to 2,000 characters).`);
  return (v as string).trim() || undefined;
};
const unwrap = (lon: number, near: number) => lon + 360 * Math.round((near - lon) / 360);
const bounds = (ring: AirspacePosition[]) =>
  ring.reduce(
    (b, [x, y]) => [Math.min(b[0]!, x), Math.min(b[1]!, y), Math.max(b[2]!, x), Math.max(b[3]!, y)],
    [Infinity, Infinity, -Infinity, -Infinity],
  );

/** Strict, bounded import. Unsupported or malformed features never silently disappear. */
export function parseAirspaceGeoJson(json: string): AirspaceData {
  if (
    json.length > AIRSPACE_MAX_BYTES ||
    new TextEncoder().encode(json).byteLength > AIRSPACE_MAX_BYTES
  )
    fail('file exceeds the 10 MB limit.');
  const root = object(JSON.parse(json));
  if (root.type !== 'FeatureCollection' || !Array.isArray(root.features))
    fail('expected a GeoJSON FeatureCollection.');
  const features = root.features as unknown[];
  if (!features.length || features.length > MAX_ZONES) fail('expected 1–5,000 polygon features.');
  if (root.crs !== undefined)
    fail('remove/reproject the CRS declaration; WGS84 GeoJSON is required.');
  let vertices = 0;
  const ring = (value: unknown): AirspacePosition[] => {
    if (!Array.isArray(value) || value.length < 4) fail('rings need at least four positions.');
    const result = (value as unknown[]).map((p): AirspacePosition => {
      if (++vertices > MAX_VERTICES) fail('too many vertices (maximum 200,000).');
      if (
        !Array.isArray(p) ||
        p.length < 2 ||
        p.length > 3 ||
        !p.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
        Math.abs(p[0]) > 180 ||
        Math.abs(p[1]) > 90
      )
        fail('positions must be finite WGS84 [longitude, latitude] coordinates.');
      return [(p as number[])[0]!, (p as number[])[1]!];
    });
    const first = result[0]!;
    const last = result.at(-1)!;
    if (first[0] !== last[0] || first[1] !== last[1]) fail('polygon rings must be closed.');
    const flat = unwrapRing(result, first[0]);
    const area = flat.slice(1).reduce((sum, b, i) => {
      const a = flat[i]!;
      return sum + (a[0] - first[0]) * (b[1] - first[1]) - (b[0] - first[0]) * (a[1] - first[1]);
    }, 0);
    if (Math.abs(area) < 1e-16) fail('polygon ring has no area.');
    const box = bounds(flat);
    if (box[2]! - box[0]! >= 180) fail('split polygons spanning 180° or more of longitude.');
    return result;
  };
  const polygon = (v: unknown): AirspacePosition[][] => {
    if (!Array.isArray(v) || !v.length) fail('polygon needs an outer ring.');
    return (v as unknown[]).map(ring);
  };
  const ids = new Set<string>();
  const zones = features.map((value, i): AirspaceZone => {
    const f = object(value);
    if (f.type !== 'Feature') fail(`feature ${i + 1} is not a GeoJSON Feature.`);
    const g = object(f.geometry);
    const p = f.properties == null ? {} : object(f.properties);
    const id = f.id === undefined ? `zone-${i + 1}` : String(f.id);
    if (!['string', 'number', 'undefined'].includes(typeof f.id) || !id || ids.has(id))
      fail('feature IDs must be unique strings or numbers.');
    ids.add(id);
    const category = p.category ?? 'advisory';
    if (
      typeof category !== 'string' ||
      !['restricted', 'controlled', 'advisory'].includes(category)
    )
      fail(`feature ${i + 1} category must be restricted, controlled or advisory.`);
    let polygons: AirspacePosition[][][];
    if (g.type === 'Polygon') polygons = [polygon(g.coordinates)];
    else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates) && g.coordinates.length)
      polygons = g.coordinates.map(polygon);
    else fail(`feature ${i + 1}: only Polygon and MultiPolygon geometries are supported.`);
    return {
      id,
      name: text(p.name, 'name') ?? `Airspace ${i + 1}`,
      category: category as AirspaceCategory,
      polygons: polygons!,
      lower: text(p.lower, 'lower'),
      upper: text(p.upper, 'upper'),
      description: text(p.description, 'description'),
    };
  });
  const validUntil = text(root.validUntil, 'validUntil');
  if (
    validUntil &&
    (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(validUntil) ||
      !Number.isFinite(Date.parse(validUntil)))
  )
    fail('validUntil must be an ISO timestamp with a timezone.');
  return { source: text(root.source, 'source'), validUntil, zones };
}

function unwrapRing(ring: AirspacePosition[], near: number): AirspacePosition[] {
  let previous = near;
  return ring.map(([lon, lat]) => {
    previous = unwrap(lon, previous);
    return [previous, lat];
  });
}

function inside([x, y]: AirspacePosition, ring: AirspacePosition[]) {
  let hit = false;
  for (let i = 1; i < ring.length; i++) {
    const [ax, ay] = ring[i - 1]!;
    const [bx, by] = ring[i]!;
    if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) hit = !hit;
  }
  return hit;
}

/** First intersection along AB, including collinear contact and polygon/hole boundaries. */
function contact(
  a: AirspacePosition,
  b: AirspacePosition,
  c: AirspacePosition,
  d: AirspacePosition,
) {
  const rx = b[0] - a[0],
    ry = b[1] - a[1];
  const sx = d[0] - c[0],
    sy = d[1] - c[1];
  const qx = c[0] - a[0],
    qy = c[1] - a[1];
  const cross = rx * sy - ry * sx;
  const eps = 1e-12;
  if (Math.abs(cross) > 1e-20) {
    const t = (qx * sy - qy * sx) / cross;
    const u = (qx * ry - qy * rx) / cross;
    return t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps
      ? Math.max(0, Math.min(1, t))
      : undefined;
  }
  if (Math.abs(qx * ry - qy * rx) > 1e-16) return;
  const len = rx * rx + ry * ry;
  if (len < 1e-24) {
    const edge = sx * sx + sy * sy;
    if (!edge) return Math.hypot(qx, qy) < eps ? 0 : undefined;
    const u = (-qx * sx - qy * sy) / edge;
    return Math.abs(qx * sy - qy * sx) < 1e-16 && u >= 0 && u <= 1 ? 0 : undefined;
  }
  const t0 = (qx * rx + qy * ry) / len;
  const t1 = ((d[0] - a[0]) * rx + (d[1] - a[1]) * ry) / len;
  const from = Math.max(0, Math.min(t0, t1));
  return from <= Math.min(1, Math.max(t0, t1)) + eps ? from : undefined;
}

export interface AirspaceConflict {
  /** Metadata only, so worker results don't copy large polygon coordinate arrays back to the UI. */
  zone: Omit<AirspaceZone, 'polygons'>;
  /** Approximate first contact on the sampled preview route (not transit to/from home). */
  distance: number;
  time: number;
  position: LatLon;
}

/**
 * Conservative horizontal footprint checks, irrespective of altitude, date or activation.
 * Tests whole segments, not just sample points, so narrow zones aren't skipped between samples.
 */
export function checkAirspace(path: FlightPath, zones: AirspaceZone[]): AirspaceConflict[] {
  const samples = path.sampleByDistance(Math.max(10, path.length / 5000));
  if (!samples.length) return [];
  const initial = path.sample(0);
  if (initial && samples[0]!.t > 0) samples.unshift(initial);
  const conflicts: AirspaceConflict[] = [];
  for (const zone of zones) {
    const { polygons, ...metadata } = zone;
    let first: AirspaceConflict | undefined;
    for (const polygon of polygons) {
      const outer = unwrapRing(polygon[0]!, polygon[0]![0]![0]);
      const [west, south, east, north] = bounds(outer) as [number, number, number, number];
      const near = (west + east) / 2;
      const rings = [outer, ...polygon.slice(1).map((r) => unwrapRing(r, near))];
      for (let i = 0; i < samples.length; i++) {
        const start = samples[Math.max(0, i - 1)]!,
          end = samples[i]!;
        if (first && start.s > first.distance) break;
        const a: AirspacePosition = [unwrap(start.position.lon, near), start.position.lat];
        const b: AirspacePosition = [unwrap(end.position.lon, a[0]), end.position.lat];
        if (
          Math.max(a[0], b[0]) < west ||
          Math.min(a[0], b[0]) > east ||
          Math.max(a[1], b[1]) < south ||
          Math.min(a[1], b[1]) > north
        )
          continue;
        let t = inside(a, outer) && !rings.slice(1).some((r) => inside(a, r)) ? 0 : undefined;
        if (t !== 0)
          for (const ring of rings)
            for (let j = 1; j < ring.length; j++) {
              const hit = contact(a, b, ring[j - 1]!, ring[j]!);
              if (hit !== undefined) t = Math.min(t ?? 1, hit);
            }
        if (t === undefined) continue;
        const distance = start.s + t * (end.s - start.s);
        if (!first || distance < first.distance)
          first = {
            zone: metadata,
            distance,
            time: start.t + t * (end.t - start.t),
            position: { lon: unwrap(a[0] + t * (b[0] - a[0]), 0), lat: a[1] + t * (b[1] - a[1]) },
          };
        break;
      }
    }
    if (first) conflicts.push(first);
  }
  return conflicts.sort((a, b) => a.distance - b.distance);
}
