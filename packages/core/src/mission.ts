import type { Geodetic, LatLon } from './geo';

/**
 * How waypoint `alt` values are interpreted.
 * - relativeToTakeoff: metres above the takeoff point's ground (Litchi / DJI default)
 * - AGL: metres above the ground directly beneath the waypoint
 * - ellipsoid: metres above the WGS84 ellipsoid (what Cesium renders natively)
 */
export type AltitudeMode = 'relativeToTakeoff' | 'AGL' | 'ellipsoid';

/** Where the aircraft nose points. */
export type HeadingMode = 'auto' | 'fixed' | 'poi';

/** Where the gimbal points vertically. */
export type GimbalMode = 'fixed' | 'poi';

export type WaypointAction =
  | { type: 'hover'; seconds: number }
  | { type: 'photo' }
  | { type: 'startRecording' }
  | { type: 'stopRecording' };

export interface Waypoint {
  id: string;
  lat: number;
  lon: number;
  /** Altitude in metres, interpreted according to Mission.altitudeMode. */
  alt: number;
  /** Ground height (ellipsoid metres) beneath the waypoint, captured when placed or sampled. */
  groundHeight: number;
  /** Target speed in m/s when passing this waypoint; speed ramps linearly between waypoints. */
  speed?: number;
  heading: HeadingMode;
  /** Degrees clockwise from north, used when heading === 'fixed'. */
  headingDeg?: number;
  gimbal: GimbalMode;
  /** Degrees, 0 = horizon, -90 = straight down. Used when gimbal === 'fixed'. */
  gimbalPitch?: number;
  /** POI used by heading/gimbal 'poi' modes; falls back to the mission's first POI. */
  poiId?: string;
  actions: WaypointAction[];
}

export interface PointOfInterest extends LatLon {
  id: string;
  name: string;
  /** Ellipsoid height of the point the camera should look at. */
  height: number;
}

export interface Takeoff extends LatLon {
  /** Ellipsoid height of the ground at the takeoff point. */
  groundHeight: number;
}

export interface MissionSettings {
  /** Default cruise speed in m/s. */
  speed: number;
  /** Default gimbal pitch in degrees. */
  gimbalPitch: number;
  /** 'smooth' flies a centripetal Catmull-Rom spline, 'straight' flies straight legs. */
  pathMode: 'smooth' | 'straight';
  finishAction: 'hover' | 'returnHome' | 'land';
}

/** User overrides for the 'custom' drone profile. */
export interface CustomProfileOverrides {
  equivalentFocalMm?: number;
  maxSpeed?: number;
  batteryMinutes?: number;
}

export interface Mission {
  version: 1;
  id: string;
  name: string;
  droneProfileId: string;
  customProfile?: CustomProfileOverrides;
  altitudeMode: AltitudeMode;
  takeoff: Takeoff;
  waypoints: Waypoint[];
  pois: PointOfInterest[];
  settings: MissionSettings;
}

export const DEFAULT_SETTINGS: MissionSettings = {
  speed: 5,
  gimbalPitch: -20,
  pathMode: 'smooth',
  finishAction: 'hover',
};

let counter = 0;
export function newId(prefix: string): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createMission(takeoff: Takeoff, droneProfileId = 'dji-mini-4-pro'): Mission {
  return {
    version: 1,
    id: newId('m'),
    name: 'Untitled mission',
    droneProfileId,
    altitudeMode: 'relativeToTakeoff',
    takeoff,
    waypoints: [],
    pois: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function createWaypoint(
  init: Partial<Waypoint> & Pick<Waypoint, 'lat' | 'lon' | 'alt' | 'groundHeight'>,
): Waypoint {
  return {
    id: newId('wp'),
    heading: 'auto',
    gimbal: 'fixed',
    actions: [],
    ...init,
  };
}

/** Absolute ellipsoid height for a waypoint. */
export function waypointHeight(mission: Mission, wp: Waypoint): number {
  switch (mission.altitudeMode) {
    case 'relativeToTakeoff':
      return mission.takeoff.groundHeight + wp.alt;
    case 'AGL':
      return wp.groundHeight + wp.alt;
    case 'ellipsoid':
      return wp.alt;
  }
}

/** Convert an absolute ellipsoid height back into the mission's altitude mode for a waypoint. */
export function altFromHeight(mission: Mission, groundHeight: number, height: number): number {
  switch (mission.altitudeMode) {
    case 'relativeToTakeoff':
      return height - mission.takeoff.groundHeight;
    case 'AGL':
      return height - groundHeight;
    case 'ellipsoid':
      return height;
  }
}

/** Re-express every waypoint's alt in a new altitude mode without moving it. */
export function changeAltitudeMode(mission: Mission, mode: AltitudeMode): Mission {
  const next: Mission = { ...mission, altitudeMode: mode };
  return {
    ...next,
    waypoints: mission.waypoints.map((wp) => ({
      ...wp,
      alt: round2(altFromHeight(next, wp.groundHeight, waypointHeight(mission, wp))),
    })),
  };
}

export function waypointGeodetic(mission: Mission, wp: Waypoint): Geodetic {
  return { lat: wp.lat, lon: wp.lon, height: waypointHeight(mission, wp) };
}

export function resolvePoi(mission: Mission, wp: Waypoint): PointOfInterest | undefined {
  return mission.pois.find((p) => p.id === wp.poiId) ?? mission.pois[0];
}

export function hoverSeconds(wp: Waypoint): number {
  return wp.actions.reduce((s, a) => (a.type === 'hover' ? s + a.seconds : s), 0);
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Parse and minimally validate a saved project file. */
export function parseMission(json: string): Mission {
  const m = JSON.parse(json) as Mission;
  if (m?.version !== 1 || !Array.isArray(m.waypoints) || !m.takeoff) {
    throw new Error('Not an OpenDroneCinematic mission file (version 1).');
  }
  return { ...m, pois: m.pois ?? [], settings: { ...DEFAULT_SETTINGS, ...m.settings } };
}

export function serializeMission(m: Mission): string {
  return JSON.stringify(m, null, 2);
}
