import { WGS84_A, WGS84_E2, toDeg, toRad, type LatLon } from './geo';

/** Coordinate systems a DEM raster can be in. Everything else must be reprojected first. */
export type DemCrs =
  { kind: 'geographic' } | { kind: 'webMercator' } | { kind: 'utm'; zone: number; south: boolean };

/** A north-up elevation raster. Pixel (0, 0) is the top-left one. */
export interface DemGrid {
  width: number;
  height: number;
  /** Row-major heights, `width * height` values. */
  data: ArrayLike<number>;
  /** CRS coordinates of the top-left corner of the top-left pixel. */
  originX: number;
  originY: number;
  /** Pixel size in CRS units; resY is negative for north-up rasters. */
  resX: number;
  resY: number;
  noData?: number;
  crs: DemCrs;
}

export interface LatLonBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** EPSG code to a supported DEM CRS, or undefined. */
export function crsFromEpsg(code: number): DemCrs | undefined {
  if (code === 4326 || code === 4979 || code === 4258) return { kind: 'geographic' };
  if (code === 3857 || code === 900913) return { kind: 'webMercator' };
  if (code > 32600 && code <= 32660) return { kind: 'utm', zone: code - 32600, south: false };
  if (code > 32700 && code <= 32760) return { kind: 'utm', zone: code - 32700, south: true };
  // ETRS89 / UTM zones 28N-38N share the GRS80 ellipsoid, which matches WGS84 to millimetres.
  if (code >= 25828 && code <= 25838) return { kind: 'utm', zone: code - 25800, south: false };
  return undefined;
}

const K0 = 0.9996;
const EP2 = WGS84_E2 / (1 - WGS84_E2);
const E4 = WGS84_E2 * WGS84_E2;
const E6 = E4 * WGS84_E2;
const M0 = 1 - WGS84_E2 / 4 - (3 * E4) / 64 - (5 * E6) / 256;

const meridianArc = (phi: number) =>
  WGS84_A *
  (M0 * phi -
    ((3 * WGS84_E2) / 8 + (3 * E4) / 32 + (45 * E6) / 1024) * Math.sin(2 * phi) +
    ((15 * E4) / 256 + (45 * E6) / 1024) * Math.sin(4 * phi) -
    ((35 * E6) / 3072) * Math.sin(6 * phi));

const centralMeridian = (zone: number) => (zone - 1) * 6 - 180 + 3;

/** Lat/lon to UTM easting/northing (Snyder's series, sub-millimetre inside a zone). */
export function toUtm(p: LatLon, zone: number, south: boolean): [number, number] {
  const phi = toRad(p.lat);
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sin * sin);
  const t = Math.tan(phi) ** 2;
  const c = EP2 * cos * cos;
  const a = toRad(p.lon - centralMeridian(zone)) * cos;
  const x =
    K0 *
    n *
    (a + ((1 - t + c) * a ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120);
  const y =
    K0 *
    (meridianArc(phi) +
      n *
        Math.tan(phi) *
        ((a * a) / 2 +
          ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24 +
          ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720));
  return [x + 500000, south ? y + 10000000 : y];
}

export function fromUtm(easting: number, northing: number, zone: number, south: boolean): LatLon {
  const x = easting - 500000;
  const y = south ? northing - 10000000 : northing;
  const mu = y / K0 / (WGS84_A * M0);
  const e1 = (1 - Math.sqrt(1 - WGS84_E2)) / (1 + Math.sqrt(1 - WGS84_E2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sin = Math.sin(phi1);
  const cos = Math.cos(phi1);
  const c1 = EP2 * cos * cos;
  const t1 = Math.tan(phi1) ** 2;
  const n1 = WGS84_A / Math.sqrt(1 - WGS84_E2 * sin * sin);
  const r1 = (WGS84_A * (1 - WGS84_E2)) / (1 - WGS84_E2 * sin * sin) ** 1.5;
  const d = x / (n1 * K0);
  const phi =
    phi1 -
    ((n1 * Math.tan(phi1)) / r1) *
      ((d * d) / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6) / 720);
  const lam =
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5) / 120) /
    cos;
  return { lat: toDeg(phi), lon: centralMeridian(zone) + toDeg(lam) };
}

function toCrs(crs: DemCrs, p: LatLon): [number, number] {
  switch (crs.kind) {
    case 'geographic':
      return [p.lon, p.lat];
    case 'webMercator':
      return [WGS84_A * toRad(p.lon), WGS84_A * Math.log(Math.tan(Math.PI / 4 + toRad(p.lat) / 2))];
    case 'utm':
      return toUtm(p, crs.zone, crs.south);
  }
}

function fromCrs(crs: DemCrs, x: number, y: number): LatLon {
  switch (crs.kind) {
    case 'geographic':
      return { lat: y, lon: x };
    case 'webMercator':
      return {
        lat: toDeg(2 * Math.atan(Math.exp(y / WGS84_A)) - Math.PI / 2),
        lon: toDeg(x / WGS84_A),
      };
    case 'utm':
      return fromUtm(x, y, crs.zone, crs.south);
  }
}

/**
 * Bilinear height lookups in a DEM. `offset` is added to every value, typically the geoid
 * height so orthometric (above sea level) rasters become WGS84 ellipsoid heights.
 */
export class Dem {
  readonly bounds: LatLonBounds;

  constructor(
    readonly grid: DemGrid,
    readonly offset = 0,
  ) {
    const { originX: x0, originY: y0, width, height, resX, resY, crs } = grid;
    const x1 = x0 + width * resX;
    const y1 = y0 + height * resY;
    // Sample the edges, not just the corners: projected grids are curved in lat/lon.
    const edge: LatLon[] = [];
    for (let i = 0; i <= 8; i++) {
      const fx = x0 + ((x1 - x0) * i) / 8;
      const fy = y0 + ((y1 - y0) * i) / 8;
      edge.push(
        fromCrs(crs, fx, y0),
        fromCrs(crs, fx, y1),
        fromCrs(crs, x0, fy),
        fromCrs(crs, x1, fy),
      );
    }
    this.bounds = {
      south: Math.min(...edge.map((p) => p.lat)),
      north: Math.max(...edge.map((p) => p.lat)),
      west: Math.min(...edge.map((p) => p.lon)),
      east: Math.max(...edge.map((p) => p.lon)),
    };
  }

  /** Ellipsoid height at a point, or undefined outside the raster or over no-data pixels. */
  heightAt(lat: number, lon: number): number | undefined {
    const g = this.grid;
    const [x, y] = toCrs(g.crs, { lat, lon });
    // Pixel-is-area: value i sits at the centre of pixel i.
    const fx = (x - g.originX) / g.resX - 0.5;
    const fy = (y - g.originY) / g.resY - 0.5;
    if (fx < -0.5 || fy < -0.5 || fx > g.width - 0.5 || fy > g.height - 0.5) return undefined;
    const cx = Math.min(g.width - 1, Math.max(0, fx));
    const cy = Math.min(g.height - 1, Math.max(0, fy));
    const i0 = Math.floor(cx);
    const j0 = Math.floor(cy);
    const i1 = Math.min(g.width - 1, i0 + 1);
    const j1 = Math.min(g.height - 1, j0 + 1);
    const tx = cx - i0;
    const ty = cy - j0;
    let sum = 0;
    let weight = 0;
    const add = (i: number, j: number, w: number) => {
      const v = g.data[j * g.width + i]!;
      if (w <= 0 || !Number.isFinite(v) || v === g.noData || v < -1000) return;
      sum += v * w;
      weight += w;
    };
    add(i0, j0, (1 - tx) * (1 - ty));
    add(i1, j0, tx * (1 - ty));
    add(i0, j1, (1 - tx) * ty);
    add(i1, j1, tx * ty);
    return weight > 1e-9 ? sum / weight + this.offset : undefined;
  }
}
