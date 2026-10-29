import type { Geodetic, LatLon } from './geo';
import type { SurveySpec } from './survey';

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
  | { type: 'stopRecording' }
  /** Take a photo every `meters` from here on; 0 stops interval photos. */
  | { type: 'photoDistance'; meters: number };

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
  /** 35mm-equivalent focal length (zoom); unset means the main camera's. Eases between waypoints. */
  focalMm?: number;
  /**
   * Zoom on the leg into this waypoint so the POI keeps the size it had at the last waypoint
   * without zoomLock: the dolly zoom. `focalMm` is ignored.
   */
  zoomLock?: boolean;
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

/** When the shoot is planned, for sun position and lighting. */
export interface ShootTime {
  /** Takeoff moment, ISO 8601 in UTC. */
  start: string;
  /** Minutes the shoot location's clock is ahead of UTC, for showing local times. */
  utcOffset: number;
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
  /** Mapping area and grid parameters, when the mission is (or was generated as) a survey. */
  survey?: SurveySpec;
  /** Planned shoot time; unset means today's evening golden hour. */
  shoot?: ShootTime;
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

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const record = (value: unknown) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const validPosition = (value: unknown) => {
  if (!record(value)) return false;
  const p = value as { lat: number; lon: number };
  return (
    finiteNumber(p.lat) && Math.abs(p.lat) <= 90 && finiteNumber(p.lon) && Math.abs(p.lon) <= 180
  );
};

function requireProject(condition: unknown, field: string): asserts condition {
  if (!condition) throw new Error(`Invalid OpenDroneCinematic project: ${field}.`);
}

/** Validate before replacing a live project; corrupt files must never break the editor or recovery. */
export function parseMission(json: string): Mission {
  const m = JSON.parse(json) as Mission;
  if (!record(m) || m?.version !== 1 || !Array.isArray(m.waypoints) || !m.takeoff) {
    throw new Error('Not an OpenDroneCinematic mission file (version 1).');
  }
  requireProject(
    typeof m.id === 'string' && m.id.length > 0 && typeof m.name === 'string',
    'project ID or name',
  );
  requireProject(
    typeof m.droneProfileId === 'string' && m.droneProfileId.length > 0,
    'drone profile',
  );
  requireProject(
    ['relativeToTakeoff', 'AGL', 'ellipsoid'].includes(m.altitudeMode),
    'altitude mode',
  );
  requireProject(
    validPosition(m.takeoff) && finiteNumber(m.takeoff.groundHeight),
    'takeoff coordinates or ground height',
  );
  requireProject(m.settings === undefined || record(m.settings), 'mission settings');
  const settings = { ...DEFAULT_SETTINGS, ...m.settings };
  requireProject(
    finiteNumber(settings.speed) && finiteNumber(settings.gimbalPitch),
    'mission speed or gimbal pitch',
  );
  requireProject(
    ['smooth', 'straight'].includes(settings.pathMode) &&
      ['hover', 'returnHome', 'land'].includes(settings.finishAction),
    'path mode or finish action',
  );
  const ids = new Set<string>();
  const uniqueId = (id: unknown) => {
    if (typeof id !== 'string' || !id || ids.has(id)) return false;
    ids.add(id);
    return true;
  };
  for (const [i, w] of m.waypoints.entries()) {
    const label = `waypoint ${i + 1}`;
    requireProject(
      validPosition(w) && uniqueId(w?.id) && finiteNumber(w.alt) && finiteNumber(w.groundHeight),
      `${label} coordinates, height, or ID`,
    );
    requireProject(
      ['auto', 'fixed', 'poi'].includes(w.heading) && ['fixed', 'poi'].includes(w.gimbal),
      `${label} camera modes`,
    );
    for (const field of ['speed', 'headingDeg', 'gimbalPitch', 'focalMm'] as const)
      requireProject(w[field] === undefined || finiteNumber(w[field]), `${label} ${field}`);
    requireProject(
      w.zoomLock === undefined || typeof w.zoomLock === 'boolean',
      `${label} zoom lock`,
    );
    requireProject(w.poiId === undefined || typeof w.poiId === 'string', `${label} POI reference`);
    requireProject(Array.isArray(w.actions), `${label} actions`);
    for (const a of w.actions) {
      requireProject(record(a), `${label} action`);
      requireProject(
        ['hover', 'photo', 'startRecording', 'stopRecording', 'photoDistance'].includes(a.type),
        `${label} action type`,
      );
      if (a.type === 'hover') requireProject(finiteNumber(a.seconds), `${label} hover duration`);
      if (a.type === 'photoDistance')
        requireProject(finiteNumber(a.meters), `${label} photo distance`);
    }
  }
  const pois = m.pois ?? [];
  requireProject(Array.isArray(pois), 'points of interest');
  for (const p of pois)
    requireProject(
      validPosition(p) && uniqueId(p?.id) && typeof p.name === 'string' && finiteNumber(p.height),
      'POI coordinates, height, name, or ID',
    );
  if (m.survey !== undefined) {
    requireProject(
      record(m.survey) && Array.isArray(m.survey.polygon) && m.survey.polygon.every(validPosition),
      'survey outline',
    );
    for (const field of [
      'height',
      'frontOverlap',
      'sideOverlap',
      'angle',
      'overshoot',
      'gimbalPitch',
      'terrainFollowSpacing',
    ] as const)
      requireProject(finiteNumber(m.survey[field]), `survey ${field}`);
    requireProject(
      typeof m.survey.crosshatch === 'boolean' &&
        (m.survey.speed === undefined || finiteNumber(m.survey.speed)),
      'survey options',
    );
  }
  if (m.customProfile !== undefined) {
    requireProject(record(m.customProfile), 'custom drone profile');
    for (const value of Object.values(m.customProfile))
      requireProject(finiteNumber(value), 'custom drone specification');
  }
  if (m.shoot !== undefined)
    requireProject(
      record(m.shoot) &&
        typeof m.shoot.start === 'string' &&
        Number.isFinite(Date.parse(m.shoot.start)) &&
        finiteNumber(m.shoot.utcOffset),
      'shoot date or UTC offset',
    );
  return { ...m, pois, settings };
}

export function serializeMission(m: Mission): string {
  return JSON.stringify(m, null, 2);
}
