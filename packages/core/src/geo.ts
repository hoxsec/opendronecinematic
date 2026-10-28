// WGS84 geodesy helpers. Everything here is plain math so it runs in Node and the browser.

export const WGS84_A = 6378137.0;
export const WGS84_F = 1 / 298.257223563;
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);

export type Vec3 = [number, number, number];

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Geodetic extends LatLon {
  /** Height above the WGS84 ellipsoid in metres. */
  height: number;
}

export const toRad = (deg: number) => (deg * Math.PI) / 180;
export const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Normalise an angle to [0, 360). */
export function wrap360(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** Normalise an angle to (-180, 180]. */
export function wrap180(deg: number): number {
  const d = wrap360(deg);
  return d > 180 ? d - 360 : d;
}

/** Interpolate between two headings along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  return wrap360(a + wrap180(b - a) * t);
}

export function geodeticToEcef({ lat, lon, height }: Geodetic): Vec3 {
  const phi = toRad(lat);
  const lam = toRad(lon);
  const sinPhi = Math.sin(phi);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  return [
    (n + height) * Math.cos(phi) * Math.cos(lam),
    (n + height) * Math.cos(phi) * Math.sin(lam),
    (n * (1 - WGS84_E2) + height) * sinPhi,
  ];
}

export function ecefToGeodetic([x, y, z]: Vec3): Geodetic {
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let phi = Math.atan2(z, p * (1 - WGS84_E2));
  let height = 0;
  for (let i = 0; i < 6; i++) {
    const sinPhi = Math.sin(phi);
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
    height = p / Math.cos(phi) - n;
    phi = Math.atan2(z, p * (1 - (WGS84_E2 * n) / (n + height)));
  }
  return { lat: toDeg(phi), lon: toDeg(lon), height };
}

/** A local East-North-Up tangent frame anchored at a geodetic origin. */
export class EnuFrame {
  readonly origin: Geodetic;
  private readonly o: Vec3;
  private readonly sinLat: number;
  private readonly cosLat: number;
  private readonly sinLon: number;
  private readonly cosLon: number;

  constructor(origin: Geodetic) {
    this.origin = origin;
    this.o = geodeticToEcef(origin);
    this.sinLat = Math.sin(toRad(origin.lat));
    this.cosLat = Math.cos(toRad(origin.lat));
    this.sinLon = Math.sin(toRad(origin.lon));
    this.cosLon = Math.cos(toRad(origin.lon));
  }

  toEnu(g: Geodetic): Vec3 {
    const [x, y, z] = geodeticToEcef(g);
    const dx = x - this.o[0];
    const dy = y - this.o[1];
    const dz = z - this.o[2];
    const { sinLat, cosLat, sinLon, cosLon } = this;
    return [
      -sinLon * dx + cosLon * dy,
      -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz,
      cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz,
    ];
  }

  fromEnu([e, n, u]: Vec3): Geodetic {
    const { sinLat, cosLat, sinLon, cosLon } = this;
    const dx = -sinLon * e - sinLat * cosLon * n + cosLat * cosLon * u;
    const dy = cosLon * e - sinLat * sinLon * n + cosLat * sinLon * u;
    const dz = cosLat * n + sinLat * u;
    return ecefToGeodetic([this.o[0] + dx, this.o[1] + dy, this.o[2] + dz]);
  }
}

/** Great-circle distance in metres (haversine on the mean radius). */
export function haversine(a: LatLon, b: LatLon): number {
  const r = 6371008.8;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b in degrees clockwise from true north. */
export function bearing(a: LatLon, b: LatLon): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return wrap360(toDeg(Math.atan2(y, x)));
}

export const vec = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  len: (a: Vec3) => Math.hypot(a[0], a[1], a[2]),
  dist: (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ],
};
