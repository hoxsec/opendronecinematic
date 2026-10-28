import type { Mission } from './mission';
import { toDeg } from './geo';

export type ExportFormat = 'litchi' | 'dji-kmz' | 'qgc';

export interface DroneProfile {
  id: string;
  name: string;
  family: 'dji-consumer' | 'dji-enterprise' | 'generic' | 'ardupilot-px4';
  /** 35mm-equivalent focal length of the main camera. */
  equivalentFocalMm: number;
  /** Physical sensor size, used for ground-sample-distance maths. */
  sensorWidthMm: number;
  sensorHeightMm: number;
  imageWidthPx: number;
  imageHeightPx: number;
  /** Aspect of the recorded video frame (width / height). */
  videoAspect: number;
  maxSpeed: number;
  maxAscentSpeed: number;
  maxDescentSpeed: number;
  /** Advertised hover/flight time. Planning uses a reserve on top of this. */
  batteryMinutes: number;
  gimbalPitchMin: number;
  gimbalPitchMax: number;
  exportFormats: ExportFormat[];
  /**
   * DJI WPML enum values. Enterprise values come from the DJI Cloud API docs; consumer values
   * are community-sourced and unverified (see docs/exports.md).
   */
  wpml?: {
    droneEnumValue: number;
    droneSubEnumValue: number;
    payloadEnumValue: number;
    verified: boolean;
  };
  notes?: string;
}

const dji = { videoAspect: 16 / 9, maxAscentSpeed: 5, maxDescentSpeed: 4 };

export const DRONE_PROFILES: DroneProfile[] = [
  {
    id: 'dji-mini-4-pro',
    name: 'DJI Mini 4 Pro',
    family: 'dji-consumer',
    ...dji,
    equivalentFocalMm: 24,
    sensorWidthMm: 9.6,
    sensorHeightMm: 7.2,
    imageWidthPx: 8064,
    imageHeightPx: 6048,
    maxSpeed: 16,
    batteryMinutes: 34,
    gimbalPitchMin: -90,
    gimbalPitchMax: 60,
    exportFormats: ['litchi', 'dji-kmz'],
    wpml: { droneEnumValue: 68, droneSubEnumValue: 0, payloadEnumValue: 68, verified: false },
    notes: 'DJI Fly only loads KMZ by replacing a mission it created itself.',
  },
  {
    id: 'dji-air-3',
    name: 'DJI Air 3 (wide)',
    family: 'dji-consumer',
    ...dji,
    equivalentFocalMm: 24,
    sensorWidthMm: 9.6,
    sensorHeightMm: 7.2,
    imageWidthPx: 8064,
    imageHeightPx: 6048,
    maxSpeed: 21,
    maxAscentSpeed: 10,
    maxDescentSpeed: 10,
    batteryMinutes: 46,
    gimbalPitchMin: -90,
    gimbalPitchMax: 60,
    exportFormats: ['litchi', 'dji-kmz'],
    notes: 'DJI Fly only loads KMZ by replacing a mission it created itself.',
  },
  {
    id: 'dji-mavic-3',
    name: 'DJI Mavic 3 (Hasselblad)',
    family: 'dji-consumer',
    ...dji,
    equivalentFocalMm: 24,
    sensorWidthMm: 17.3,
    sensorHeightMm: 13,
    imageWidthPx: 5280,
    imageHeightPx: 3956,
    maxSpeed: 21,
    maxAscentSpeed: 8,
    maxDescentSpeed: 6,
    batteryMinutes: 46,
    gimbalPitchMin: -90,
    gimbalPitchMax: 35,
    exportFormats: ['litchi', 'dji-kmz'],
  },
  {
    id: 'dji-mavic-3e',
    name: 'DJI Mavic 3 Enterprise (M3E)',
    family: 'dji-enterprise',
    ...dji,
    equivalentFocalMm: 24,
    sensorWidthMm: 17.3,
    sensorHeightMm: 13,
    imageWidthPx: 5280,
    imageHeightPx: 3956,
    maxSpeed: 15,
    maxAscentSpeed: 8,
    maxDescentSpeed: 6,
    batteryMinutes: 45,
    gimbalPitchMin: -90,
    gimbalPitchMax: 35,
    exportFormats: ['dji-kmz'],
    wpml: { droneEnumValue: 77, droneSubEnumValue: 0, payloadEnumValue: 66, verified: true },
  },
  {
    id: 'dji-m30',
    name: 'DJI Matrice 30 (wide)',
    family: 'dji-enterprise',
    ...dji,
    equivalentFocalMm: 24,
    sensorWidthMm: 6.4,
    sensorHeightMm: 4.8,
    imageWidthPx: 4000,
    imageHeightPx: 3000,
    maxSpeed: 23,
    maxAscentSpeed: 6,
    maxDescentSpeed: 5,
    batteryMinutes: 41,
    gimbalPitchMin: -90,
    gimbalPitchMax: 45,
    exportFormats: ['dji-kmz'],
    wpml: { droneEnumValue: 67, droneSubEnumValue: 0, payloadEnumValue: 52, verified: true },
  },
  {
    id: 'dji-m350-h20',
    name: 'DJI Matrice 350 RTK + H20 (wide)',
    family: 'dji-enterprise',
    ...dji,
    equivalentFocalMm: 24,
    sensorWidthMm: 6.17,
    sensorHeightMm: 4.55,
    imageWidthPx: 4056,
    imageHeightPx: 3040,
    maxSpeed: 23,
    maxAscentSpeed: 6,
    maxDescentSpeed: 5,
    batteryMinutes: 55,
    gimbalPitchMin: -90,
    gimbalPitchMax: 30,
    exportFormats: ['dji-kmz'],
    wpml: { droneEnumValue: 89, droneSubEnumValue: 0, payloadEnumValue: 42, verified: true },
  },
  {
    id: 'ardupilot-px4-multirotor',
    name: 'ArduPilot / PX4 multirotor',
    family: 'ardupilot-px4',
    videoAspect: 16 / 9,
    equivalentFocalMm: 24,
    sensorWidthMm: 6.17,
    sensorHeightMm: 4.55,
    imageWidthPx: 4000,
    imageHeightPx: 3000,
    maxSpeed: 12,
    maxAscentSpeed: 3,
    maxDescentSpeed: 2,
    batteryMinutes: 20,
    gimbalPitchMin: -90,
    gimbalPitchMax: 30,
    exportFormats: ['qgc'],
    notes: 'QGroundControl .plan export arrives in milestone 2.',
  },
  {
    id: 'custom',
    name: 'Custom drone',
    family: 'generic',
    videoAspect: 16 / 9,
    equivalentFocalMm: 24,
    sensorWidthMm: 6.17,
    sensorHeightMm: 4.55,
    imageWidthPx: 4000,
    imageHeightPx: 3000,
    maxSpeed: 15,
    maxAscentSpeed: 5,
    maxDescentSpeed: 4,
    batteryMinutes: 25,
    gimbalPitchMin: -90,
    gimbalPitchMax: 30,
    exportFormats: ['litchi', 'dji-kmz', 'qgc'],
  },
];

export function getProfile(id: string): DroneProfile {
  return DRONE_PROFILES.find((p) => p.id === id) ?? DRONE_PROFILES[DRONE_PROFILES.length - 1]!;
}

/** The mission's profile with any custom overrides applied. */
export function missionProfile(mission: Mission): DroneProfile {
  const base = getProfile(mission.droneProfileId);
  if (base.id !== 'custom' || !mission.customProfile) return base;
  const o = mission.customProfile;
  return {
    ...base,
    equivalentFocalMm: o.equivalentFocalMm ?? base.equivalentFocalMm,
    maxSpeed: o.maxSpeed ?? base.maxSpeed,
    batteryMinutes: o.batteryMinutes ?? base.batteryMinutes,
  };
}

/**
 * Field of view in degrees from a 35mm-equivalent focal length. "Equivalent" is defined on the
 * 43.27mm full-frame diagonal applied to the sensor's own aspect. A recorded frame with a wider
 * aspect (16:9 video on a 4:3 sensor) keeps the sensor width and crops the height.
 */
export function fovFromEquivalentFocal(
  equivalentFocalMm: number,
  sensorAspect: number,
  frameAspect = sensorAspect,
) {
  const diag = 43.267;
  const w = diag / Math.sqrt(1 + 1 / (sensorAspect * sensorAspect));
  const h = frameAspect >= sensorAspect ? w / frameAspect : w / sensorAspect;
  const fov = (mm: number) => toDeg(2 * Math.atan(mm / (2 * equivalentFocalMm)));
  return { horizontal: fov(w), vertical: fov(h), diagonal: fov(Math.hypot(w, h)) };
}

export function profileFov(profile: DroneProfile, frame: 'video' | 'photo' = 'video') {
  const sensorAspect = profile.sensorWidthMm / profile.sensorHeightMm;
  return fovFromEquivalentFocal(
    profile.equivalentFocalMm,
    sensorAspect,
    frame === 'video' ? profile.videoAspect : sensorAspect,
  );
}

/** Ground sample distance in cm/pixel for a nadir photo at the given height above ground. */
export function groundSampleDistance(profile: DroneProfile, heightAboveGround: number): number {
  const sensorAspect = profile.sensorWidthMm / profile.sensorHeightMm;
  const fullFrameWidth = 43.267 / Math.sqrt(1 + 1 / (sensorAspect * sensorAspect));
  const realFocalMm = (profile.equivalentFocalMm * profile.sensorWidthMm) / fullFrameWidth;
  return ((profile.sensorWidthMm * heightAboveGround) / (realFocalMm * profile.imageWidthPx)) * 100;
}
