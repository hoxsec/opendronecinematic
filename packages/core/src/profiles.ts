import type { Mission } from './mission';
import { toDeg } from './geo';

export type ExportFormat = 'litchi' | 'dji-kmz' | 'qgc' | 'mp-waypoints';

export type DroneFamily =
  'dji-consumer' | 'dji-legacy' | 'dji-enterprise' | 'generic' | 'ardupilot-px4';

/** Headings for grouping profiles in pickers, in display order. */
export const DRONE_FAMILIES: { id: DroneFamily; label: string }[] = [
  { id: 'dji-consumer', label: 'DJI consumer (DJI Fly)' },
  { id: 'dji-enterprise', label: 'DJI enterprise (DJI Pilot 2)' },
  { id: 'dji-legacy', label: 'DJI older (DJI GO 4)' },
  { id: 'ardupilot-px4', label: 'Open autopilots' },
  { id: 'generic', label: 'Other' },
];

export interface DroneProfile {
  id: string;
  name: string;
  family: DroneFamily;
  /** 35mm-equivalent focal length of the main camera. */
  equivalentFocalMm: number;
  /**
   * 35mm-equivalent focal lengths of the physical cameras, widest first, on drones with more
   * than one. Zooming past one switches to it, which shows as a jump in real footage.
   */
  lenses?: number[];
  /** Longest 35mm-equivalent focal length in video, digital zoom included. Default: 2x main. */
  maxFocalMm?: number;
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
   * DJI WPML enum values. `verified` values match DJI's Cloud API (docs and open-source demo);
   * the rest are community-sourced or extrapolated (see docs/exports.md).
   */
  wpml?: {
    droneEnumValue: number;
    droneSubEnumValue: number;
    payloadEnumValue: number;
    verified: boolean;
  };
  notes?: string;
}

/** Sensor area used by the stills (mm) and the still size (px). */
type Camera = [widthMm: number, heightMm: number, widthPx: number, heightPx: number];

const CAM = {
  '1/2.3in 12MP': [6.17, 4.55, 4000, 3000],
  '1/2in 48MP': [6.4, 4.8, 8000, 6000],
  '1/1.3in 12MP': [9.6, 7.2, 4000, 3000],
  '1/1.3in 48MP': [9.6, 7.2, 8064, 6048],
  '1in 20MP': [13.2, 8.8, 5472, 3648],
  '1in 50MP': [13.1, 9.8, 8192, 6144],
  '4/3 20MP': [17.3, 13, 5280, 3956],
  'full frame 45MP': [35.9, 24, 8192, 5460],
} satisfies Record<string, Camera>;

type Spec = Omit<
  DroneProfile,
  | 'id'
  | 'name'
  | 'family'
  | 'sensorWidthMm'
  | 'sensorHeightMm'
  | 'imageWidthPx'
  | 'imageHeightPx'
  | 'videoAspect'
> & { camera: Camera; videoAspect?: number };

function drone(id: string, name: string, family: DroneFamily, spec: Spec): DroneProfile {
  const { camera, ...rest } = spec;
  const [sensorWidthMm, sensorHeightMm, imageWidthPx, imageHeightPx] = camera;
  return {
    id,
    name,
    family,
    videoAspect: 16 / 9,
    sensorWidthMm,
    sensorHeightMm,
    imageWidthPx,
    imageHeightPx,
    ...rest,
  };
}

const enumOf = (drone: number, sub: number, payload: number, verified = true) => ({
  droneEnumValue: drone,
  droneSubEnumValue: sub,
  payloadEnumValue: payload,
  verified,
});

const FLY_KMZ = 'DJI Fly only loads KMZ by replacing a mission it created itself.';
const NO_WAYPOINTS = 'No waypoint missions or SDK support: use this profile for previz only.';
const GO4 = 'Fly exported missions with Litchi (DJI GO 4 has no mission import).';

export const DRONE_PROFILES: DroneProfile[] = [
  // ─── DJI consumer (DJI Fly) ──────────────────────────────────────────────────────────────────
  drone('dji-mini-2', 'DJI Mini 2 / Mini SE', 'dji-consumer', {
    camera: CAM['1/2.3in 12MP'],
    equivalentFocalMm: 24,
    maxSpeed: 16,
    maxAscentSpeed: 5,
    maxDescentSpeed: 3.5,
    batteryMinutes: 31,
    gimbalPitchMin: -90,
    gimbalPitchMax: 0,
    exportFormats: ['litchi'],
  }),
  drone('dji-mini-4k', 'DJI Mini 4K / Mini 2 SE', 'dji-consumer', {
    camera: CAM['1/2.3in 12MP'],
    equivalentFocalMm: 24,
    maxSpeed: 16,
    maxAscentSpeed: 5,
    maxDescentSpeed: 3.5,
    batteryMinutes: 31,
    gimbalPitchMin: -90,
    gimbalPitchMax: 0,
    exportFormats: [],
    notes: NO_WAYPOINTS,
  }),
  drone('dji-mini-3', 'DJI Mini 3', 'dji-consumer', {
    camera: CAM['1/1.3in 12MP'],
    equivalentFocalMm: 24,
    maxSpeed: 16,
    maxAscentSpeed: 5,
    maxDescentSpeed: 5,
    batteryMinutes: 38,
    gimbalPitchMin: -90,
    gimbalPitchMax: 60,
    exportFormats: ['litchi'],
  }),
  drone('dji-mini-3-pro', 'DJI Mini 3 Pro', 'dji-consumer', {
    camera: CAM['1/1.3in 48MP'],
    equivalentFocalMm: 24,
    maxSpeed: 16,
    maxAscentSpeed: 5,
    maxDescentSpeed: 5,
    batteryMinutes: 34,
    gimbalPitchMin: -90,
    gimbalPitchMax: 60,
    exportFormats: ['litchi'],
  }),
  drone('dji-mini-4-pro', 'DJI Mini 4 Pro', 'dji-consumer', {
    camera: CAM['1/1.3in 48MP'],
    equivalentFocalMm: 24,
    maxFocalMm: 96,
    maxSpeed: 16,
    maxAscentSpeed: 5,
    maxDescentSpeed: 4,
    batteryMinutes: 34,
    gimbalPitchMin: -90,
    gimbalPitchMax: 60,
    exportFormats: ['litchi', 'dji-kmz'],
    wpml: enumOf(68, 0, 68, false),
    notes: FLY_KMZ,
  }),
  drone('dji-mini-5-pro', 'DJI Mini 5 Pro', 'dji-consumer', {
    camera: CAM['1in 50MP'],
    equivalentFocalMm: 24,
    maxSpeed: 18,
    maxAscentSpeed: 5,
    maxDescentSpeed: 5,
    batteryMinutes: 36,
    gimbalPitchMin: -90,
    gimbalPitchMax: 55,
    exportFormats: ['dji-kmz'],
    notes: FLY_KMZ,
  }),
  drone('dji-lito-1', 'DJI Lito 1', 'dji-consumer', {
    camera: CAM['1/2in 48MP'],
    equivalentFocalMm: 24,
    maxSpeed: 18,
    maxAscentSpeed: 6,
    maxDescentSpeed: 3,
    batteryMinutes: 36,
    gimbalPitchMin: -90,
    gimbalPitchMax: 35,
    exportFormats: [],
    notes: `${NO_WAYPOINTS} Specs from early reviews; lens and speed assumed equal to the Lito X1.`,
  }),
  drone('dji-lito-x1', 'DJI Lito X1', 'dji-consumer', {
    camera: CAM['1/1.3in 48MP'],
    equivalentFocalMm: 24,
    maxSpeed: 18,
    maxAscentSpeed: 6,
    maxDescentSpeed: 3,
    batteryMinutes: 36,
    gimbalPitchMin: -90,
    gimbalPitchMax: 35,
    exportFormats: [],
    notes: `${NO_WAYPOINTS} Specs from early reviews.`,
  }),
  drone('dji-flip', 'DJI Flip', 'dji-consumer', {
    camera: CAM['1/1.3in 48MP'],
    equivalentFocalMm: 24,
    maxSpeed: 12,
    maxAscentSpeed: 5,
    maxDescentSpeed: 5,
    batteryMinutes: 31,
    gimbalPitchMin: -90,
    gimbalPitchMax: 35,
    exportFormats: [],
    notes: NO_WAYPOINTS,
  }),
  drone('dji-neo', 'DJI Neo', 'dji-consumer', {
    camera: [6.4, 4.8, 4000, 3000],
    equivalentFocalMm: 13,
    maxSpeed: 8,
    maxAscentSpeed: 2,
    maxDescentSpeed: 2,
    batteryMinutes: 18,
    gimbalPitchMin: -90,
    gimbalPitchMax: 60,
    exportFormats: [],
    notes: NO_WAYPOINTS,
  }),
  drone('dji-air-2', 'DJI Mavic Air 2', 'dji-consumer', {
    camera: CAM['1/2in 48MP'],
    equivalentFocalMm: 24,
    maxSpeed: 19,
    maxAscentSpeed: 4,
    maxDescentSpeed: 5,
    batteryMinutes: 34,
    gimbalPitchMin: -90,
    gimbalPitchMax: 0,
    exportFormats: ['litchi'],
  }),
  drone('dji-air-2s', 'DJI Air 2S', 'dji-consumer', {
    camera: CAM['1in 20MP'],
    equivalentFocalMm: 22,
    maxSpeed: 19,
    maxAscentSpeed: 6,
    maxDescentSpeed: 6,
    batteryMinutes: 31,
    gimbalPitchMin: -90,
    gimbalPitchMax: 0,
    exportFormats: ['litchi'],
  }),
  drone('dji-air-3', 'DJI Air 3 (wide)', 'dji-consumer', {
    camera: CAM['1/1.3in 48MP'],
    equivalentFocalMm: 24,
    lenses: [24, 70],
    maxFocalMm: 210,
    maxSpeed: 21,
    maxAscentSpeed: 10,
    maxDescentSpeed: 10,
    batteryMinutes: 46,
    gimbalPitchMin: -90,
    gimbalPitchMax: 60,
    exportFormats: ['litchi', 'dji-kmz'],
    notes: FLY_KMZ,
  }),
  drone('dji-air-3s', 'DJI Air 3S (wide)', 'dji-consumer', {
    camera: CAM['1in 50MP'],
    equivalentFocalMm: 24,
    lenses: [24, 70],
    maxFocalMm: 210,
    maxSpeed: 21,
    maxAscentSpeed: 10,
    maxDescentSpeed: 10,
    batteryMinutes: 45,
    gimbalPitchMin: -90,
    gimbalPitchMax: 60,
    exportFormats: ['dji-kmz'],
    notes: FLY_KMZ,
  }),
  drone('dji-mavic-3', 'DJI Mavic 3 / Classic / Cine (Hasselblad)', 'dji-consumer', {
    camera: CAM['4/3 20MP'],
    equivalentFocalMm: 24,
    maxSpeed: 21,
    maxAscentSpeed: 8,
    maxDescentSpeed: 6,
    batteryMinutes: 46,
    gimbalPitchMin: -90,
    gimbalPitchMax: 35,
    exportFormats: ['litchi', 'dji-kmz'],
  }),
  drone('dji-mavic-3-pro', 'DJI Mavic 3 Pro (Hasselblad)', 'dji-consumer', {
    camera: CAM['4/3 20MP'],
    equivalentFocalMm: 24,
    lenses: [24, 70, 166],
    maxFocalMm: 672,
    maxSpeed: 21,
    maxAscentSpeed: 8,
    maxDescentSpeed: 6,
    batteryMinutes: 43,
    gimbalPitchMin: -90,
    gimbalPitchMax: 35,
    exportFormats: ['dji-kmz'],
    notes: FLY_KMZ,
  }),
  drone('dji-mavic-4-pro', 'DJI Mavic 4 Pro (Hasselblad)', 'dji-consumer', {
    camera: [17.3, 11.5, 12288, 8192],
    equivalentFocalMm: 28,
    lenses: [28, 70, 168],
    maxFocalMm: 672,
    maxSpeed: 25,
    maxAscentSpeed: 8,
    maxDescentSpeed: 6,
    batteryMinutes: 51,
    gimbalPitchMin: -90,
    gimbalPitchMax: 70,
    exportFormats: ['dji-kmz'],
    notes: FLY_KMZ,
  }),
  drone('dji-avata-2', 'DJI Avata 2', 'dji-consumer', {
    camera: CAM['1/1.3in 48MP'],
    equivalentFocalMm: 12,
    maxSpeed: 27,
    maxAscentSpeed: 6,
    maxDescentSpeed: 6,
    batteryMinutes: 23,
    gimbalPitchMin: -85,
    gimbalPitchMax: 80,
    exportFormats: [],
    notes: `FPV drone. ${NO_WAYPOINTS}`,
  }),

  // ─── DJI enterprise (DJI Pilot 2) ────────────────────────────────────────────────────────────
  drone('dji-mavic-3e', 'DJI Mavic 3 Enterprise (M3E)', 'dji-enterprise', {
    camera: CAM['4/3 20MP'],
    equivalentFocalMm: 24,
    maxSpeed: 15,
    maxAscentSpeed: 8,
    maxDescentSpeed: 6,
    batteryMinutes: 45,
    gimbalPitchMin: -90,
    gimbalPitchMax: 35,
    exportFormats: ['dji-kmz'],
    wpml: enumOf(77, 0, 66),
  }),
  drone('dji-mavic-3t', 'DJI Mavic 3 Thermal (M3T, wide)', 'dji-enterprise', {
    camera: CAM['1/2in 48MP'],
    equivalentFocalMm: 24,
    maxSpeed: 15,
    maxAscentSpeed: 8,
    maxDescentSpeed: 6,
    batteryMinutes: 45,
    gimbalPitchMin: -90,
    gimbalPitchMax: 35,
    exportFormats: ['dji-kmz'],
    wpml: enumOf(77, 1, 67),
  }),
  drone('dji-mavic-3m', 'DJI Mavic 3 Multispectral (M3M, RGB)', 'dji-enterprise', {
    camera: CAM['4/3 20MP'],
    equivalentFocalMm: 24,
    maxSpeed: 15,
    maxAscentSpeed: 8,
    maxDescentSpeed: 6,
    batteryMinutes: 43,
    gimbalPitchMin: -90,
    gimbalPitchMax: 35,
    exportFormats: ['dji-kmz'],
    wpml: enumOf(77, 2, 68),
  }),
  drone('dji-m3d', 'DJI Matrice 3D (Dock 2)', 'dji-enterprise', {
    camera: CAM['4/3 20MP'],
    equivalentFocalMm: 24,
    maxSpeed: 21,
    maxAscentSpeed: 6,
    maxDescentSpeed: 6,
    batteryMinutes: 50,
    gimbalPitchMin: -90,
    gimbalPitchMax: 35,
    exportFormats: ['dji-kmz'],
    wpml: enumOf(91, 0, 80),
  }),
  drone('dji-m3td', 'DJI Matrice 3TD (Dock 2, wide)', 'dji-enterprise', {
    camera: CAM['1/2in 48MP'],
    equivalentFocalMm: 24,
    maxSpeed: 21,
    maxAscentSpeed: 6,
    maxDescentSpeed: 6,
    batteryMinutes: 50,
    gimbalPitchMin: -90,
    gimbalPitchMax: 35,
    exportFormats: ['dji-kmz'],
    wpml: enumOf(91, 1, 81),
  }),
  drone('dji-m4e', 'DJI Matrice 4E (wide)', 'dji-enterprise', {
    camera: CAM['4/3 20MP'],
    equivalentFocalMm: 24,
    maxSpeed: 21,
    maxAscentSpeed: 10,
    maxDescentSpeed: 8,
    batteryMinutes: 49,
    gimbalPitchMin: -90,
    gimbalPitchMax: 35,
    exportFormats: ['dji-kmz'],
    wpml: enumOf(99, 0, 88, false),
  }),
  drone('dji-m4t', 'DJI Matrice 4T (wide)', 'dji-enterprise', {
    camera: CAM['1/1.3in 48MP'],
    equivalentFocalMm: 24,
    maxSpeed: 21,
    maxAscentSpeed: 10,
    maxDescentSpeed: 8,
    batteryMinutes: 49,
    gimbalPitchMin: -90,
    gimbalPitchMax: 35,
    exportFormats: ['dji-kmz'],
    wpml: enumOf(99, 1, 89, false),
  }),
  drone('dji-m4d', 'DJI Matrice 4D (Dock 3, wide)', 'dji-enterprise', {
    camera: CAM['4/3 20MP'],
    equivalentFocalMm: 24,
    maxSpeed: 21,
    maxAscentSpeed: 10,
    maxDescentSpeed: 8,
    batteryMinutes: 54,
    gimbalPitchMin: -90,
    gimbalPitchMax: 35,
    exportFormats: ['dji-kmz'],
    wpml: enumOf(100, 0, 98, false),
  }),
  drone('dji-m4td', 'DJI Matrice 4TD (Dock 3, wide)', 'dji-enterprise', {
    camera: CAM['1/1.3in 48MP'],
    equivalentFocalMm: 24,
    maxSpeed: 21,
    maxAscentSpeed: 10,
    maxDescentSpeed: 8,
    batteryMinutes: 54,
    gimbalPitchMin: -90,
    gimbalPitchMax: 35,
    exportFormats: ['dji-kmz'],
    wpml: enumOf(100, 1, 99, false),
  }),
  drone('dji-m30', 'DJI Matrice 30 (wide)', 'dji-enterprise', {
    camera: [6.4, 4.8, 4000, 3000],
    equivalentFocalMm: 24,
    maxSpeed: 23,
    maxAscentSpeed: 6,
    maxDescentSpeed: 5,
    batteryMinutes: 41,
    gimbalPitchMin: -90,
    gimbalPitchMax: 45,
    exportFormats: ['dji-kmz'],
    wpml: enumOf(67, 0, 52),
  }),
  drone('dji-m30t', 'DJI Matrice 30T (wide)', 'dji-enterprise', {
    camera: [6.4, 4.8, 4000, 3000],
    equivalentFocalMm: 24,
    maxSpeed: 23,
    maxAscentSpeed: 6,
    maxDescentSpeed: 5,
    batteryMinutes: 41,
    gimbalPitchMin: -90,
    gimbalPitchMax: 45,
    exportFormats: ['dji-kmz'],
    wpml: enumOf(67, 1, 53),
  }),
  drone('dji-m300-h20', 'DJI Matrice 300 RTK + H20 (wide)', 'dji-enterprise', {
    camera: [6.17, 4.55, 4056, 3040],
    equivalentFocalMm: 24,
    maxSpeed: 23,
    maxAscentSpeed: 6,
    maxDescentSpeed: 5,
    batteryMinutes: 55,
    gimbalPitchMin: -90,
    gimbalPitchMax: 30,
    exportFormats: ['dji-kmz'],
    wpml: enumOf(60, 0, 42),
  }),
  drone('dji-m300-p1', 'DJI Matrice 300 RTK + P1 (35 mm)', 'dji-enterprise', {
    camera: CAM['full frame 45MP'],
    videoAspect: 3 / 2,
    equivalentFocalMm: 35,
    maxSpeed: 23,
    maxAscentSpeed: 6,
    maxDescentSpeed: 5,
    batteryMinutes: 55,
    gimbalPitchMin: -90,
    gimbalPitchMax: 30,
    exportFormats: ['dji-kmz'],
    wpml: enumOf(60, 0, 50),
  }),
  drone('dji-m350-h20', 'DJI Matrice 350 RTK + H20 (wide)', 'dji-enterprise', {
    camera: [6.17, 4.55, 4056, 3040],
    equivalentFocalMm: 24,
    maxSpeed: 23,
    maxAscentSpeed: 6,
    maxDescentSpeed: 5,
    batteryMinutes: 55,
    gimbalPitchMin: -90,
    gimbalPitchMax: 30,
    exportFormats: ['dji-kmz'],
    wpml: enumOf(89, 0, 42),
  }),
  drone('dji-m350-h30', 'DJI Matrice 350 RTK + H30 (wide)', 'dji-enterprise', {
    camera: CAM['1/1.3in 48MP'],
    equivalentFocalMm: 24,
    maxSpeed: 23,
    maxAscentSpeed: 6,
    maxDescentSpeed: 5,
    batteryMinutes: 55,
    gimbalPitchMin: -90,
    gimbalPitchMax: 30,
    exportFormats: ['dji-kmz'],
    wpml: enumOf(89, 0, 82, false),
  }),
  drone('dji-m350-p1', 'DJI Matrice 350 RTK + P1 (35 mm)', 'dji-enterprise', {
    camera: CAM['full frame 45MP'],
    videoAspect: 3 / 2,
    equivalentFocalMm: 35,
    maxSpeed: 23,
    maxAscentSpeed: 6,
    maxDescentSpeed: 5,
    batteryMinutes: 55,
    gimbalPitchMin: -90,
    gimbalPitchMax: 30,
    exportFormats: ['dji-kmz'],
    wpml: enumOf(89, 0, 50),
  }),
  drone('dji-m350-l2', 'DJI Matrice 350 RTK + L2 (RGB)', 'dji-enterprise', {
    camera: CAM['4/3 20MP'],
    equivalentFocalMm: 24,
    maxSpeed: 23,
    maxAscentSpeed: 6,
    maxDescentSpeed: 5,
    batteryMinutes: 55,
    gimbalPitchMin: -90,
    gimbalPitchMax: 30,
    exportFormats: ['dji-kmz'],
    wpml: enumOf(89, 0, 84, false),
  }),
  drone('dji-inspire-3', 'DJI Inspire 3 (X9-8K Air, 24 mm)', 'dji-enterprise', {
    camera: [35.9, 24, 8192, 5456],
    equivalentFocalMm: 24,
    maxSpeed: 26,
    maxAscentSpeed: 8,
    maxDescentSpeed: 8,
    batteryMinutes: 28,
    gimbalPitchMin: -90,
    gimbalPitchMax: 30,
    exportFormats: [],
    notes: 'Inspire 3 waypoints are planned in its own app, which has no file import.',
  }),
  drone('dji-phantom-4-rtk', 'DJI Phantom 4 RTK', 'dji-enterprise', {
    camera: CAM['1in 20MP'],
    equivalentFocalMm: 24,
    maxSpeed: 16,
    maxAscentSpeed: 6,
    maxDescentSpeed: 3,
    batteryMinutes: 30,
    gimbalPitchMin: -90,
    gimbalPitchMax: 0,
    exportFormats: [],
    notes: 'Plan surveys in DJI GS RTK, which imports KML/KMZ area outlines rather than missions.',
  }),

  // ─── Older DJI (DJI GO 4, flown with Litchi) ─────────────────────────────────────────────────
  drone('dji-mavic-2-pro', 'DJI Mavic 2 Pro', 'dji-legacy', {
    camera: CAM['1in 20MP'],
    equivalentFocalMm: 28,
    maxSpeed: 20,
    maxAscentSpeed: 5,
    maxDescentSpeed: 3,
    batteryMinutes: 31,
    gimbalPitchMin: -90,
    gimbalPitchMax: 30,
    exportFormats: ['litchi'],
    notes: GO4,
  }),
  drone('dji-mavic-2-zoom', 'DJI Mavic 2 Zoom (24 mm)', 'dji-legacy', {
    camera: CAM['1/2.3in 12MP'],
    equivalentFocalMm: 24,
    maxSpeed: 20,
    maxAscentSpeed: 5,
    maxDescentSpeed: 3,
    batteryMinutes: 31,
    gimbalPitchMin: -90,
    gimbalPitchMax: 30,
    exportFormats: ['litchi'],
    notes: GO4,
  }),
  drone('dji-mavic-pro', 'DJI Mavic Pro', 'dji-legacy', {
    camera: CAM['1/2.3in 12MP'],
    equivalentFocalMm: 26,
    maxSpeed: 18,
    maxAscentSpeed: 5,
    maxDescentSpeed: 3,
    batteryMinutes: 27,
    gimbalPitchMin: -90,
    gimbalPitchMax: 30,
    exportFormats: ['litchi'],
    notes: GO4,
  }),
  drone('dji-mavic-air', 'DJI Mavic Air', 'dji-legacy', {
    camera: [6.17, 4.55, 4056, 3040],
    equivalentFocalMm: 24,
    maxSpeed: 19,
    maxAscentSpeed: 4,
    maxDescentSpeed: 3,
    batteryMinutes: 21,
    gimbalPitchMin: -90,
    gimbalPitchMax: 0,
    exportFormats: ['litchi'],
    notes: GO4,
  }),
  drone('dji-spark', 'DJI Spark', 'dji-legacy', {
    camera: [6.17, 4.55, 3968, 2976],
    equivalentFocalMm: 25,
    maxSpeed: 14,
    maxAscentSpeed: 3,
    maxDescentSpeed: 3,
    batteryMinutes: 16,
    gimbalPitchMin: -85,
    gimbalPitchMax: 0,
    exportFormats: ['litchi'],
    notes: GO4,
  }),
  drone('dji-phantom-4-pro', 'DJI Phantom 4 Pro / Pro V2.0', 'dji-legacy', {
    camera: CAM['1in 20MP'],
    equivalentFocalMm: 24,
    maxSpeed: 20,
    maxAscentSpeed: 6,
    maxDescentSpeed: 4,
    batteryMinutes: 30,
    gimbalPitchMin: -90,
    gimbalPitchMax: 30,
    exportFormats: ['litchi'],
    notes: GO4,
  }),
  drone('dji-phantom-4', 'DJI Phantom 4 / Advanced', 'dji-legacy', {
    camera: CAM['1/2.3in 12MP'],
    equivalentFocalMm: 20,
    maxSpeed: 20,
    maxAscentSpeed: 6,
    maxDescentSpeed: 4,
    batteryMinutes: 28,
    gimbalPitchMin: -90,
    gimbalPitchMax: 30,
    exportFormats: ['litchi'],
    notes: GO4,
  }),
  drone('dji-inspire-2-x5s', 'DJI Inspire 2 + X5S (15 mm)', 'dji-legacy', {
    camera: CAM['4/3 20MP'],
    equivalentFocalMm: 30,
    maxSpeed: 26,
    maxAscentSpeed: 6,
    maxDescentSpeed: 4,
    batteryMinutes: 27,
    gimbalPitchMin: -90,
    gimbalPitchMax: 30,
    exportFormats: ['litchi'],
    notes: GO4,
  }),

  // ─── Open autopilots and custom ──────────────────────────────────────────────────────────────
  drone('ardupilot-px4-multirotor', 'ArduPilot / PX4 multirotor', 'ardupilot-px4', {
    camera: [6.17, 4.55, 4000, 3000],
    equivalentFocalMm: 24,
    maxSpeed: 12,
    maxAscentSpeed: 3,
    maxDescentSpeed: 2,
    batteryMinutes: 20,
    gimbalPitchMin: -90,
    gimbalPitchMax: 30,
    exportFormats: ['qgc', 'mp-waypoints'],
  }),
  // Keep last: getProfile falls back to it for unknown ids.
  drone('custom', 'Custom drone', 'generic', {
    camera: [6.17, 4.55, 4000, 3000],
    equivalentFocalMm: 24,
    maxSpeed: 15,
    maxAscentSpeed: 5,
    maxDescentSpeed: 4,
    batteryMinutes: 25,
    gimbalPitchMin: -90,
    gimbalPitchMax: 30,
    exportFormats: ['litchi', 'dji-kmz', 'qgc', 'mp-waypoints'],
  }),
];

/**
 * The profile a DJI KMZ was made for: the closest match on drone enum, sub-type and payload.
 * Undefined when no profile shares the drone enum.
 */
export function profileForWpml(drone?: number, sub?: number, payload?: number) {
  let best: DroneProfile | undefined;
  let bestScore = 0;
  for (const p of DRONE_PROFILES) {
    if (!p.wpml || p.wpml.droneEnumValue !== drone) continue;
    const score =
      1 +
      (p.wpml.droneSubEnumValue === sub ? 2 : 0) +
      (p.wpml.payloadEnumValue === payload ? 1 : 0);
    if (score > bestScore) [best, bestScore] = [p, score];
  }
  return best;
}

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

/** Shortest and longest 35mm-equivalent focal length the drone can shoot video at. */
export function focalRange(profile: DroneProfile): [number, number] {
  const min = profile.equivalentFocalMm;
  return [min, Math.max(min, profile.maxFocalMm ?? min * 2)];
}

/**
 * Which physical camera a focal length uses (the longest lens not longer than it) and how much
 * digital zoom on top, 1 meaning none.
 */
export function lensAt(
  profile: DroneProfile,
  focalMm: number,
): { lensMm: number; digital: number } {
  const lenses = profile.lenses ?? [profile.equivalentFocalMm];
  let lensMm = lenses[0]!;
  for (const l of lenses) if (l <= focalMm * 1.001) lensMm = l;
  return { lensMm, digital: Math.max(1, focalMm / lensMm) };
}

/** Field of view of the profile's camera, at its main focal length or the one given. */
export function profileFov(
  profile: DroneProfile,
  frame: 'video' | 'photo' = 'video',
  focalMm = profile.equivalentFocalMm,
) {
  const sensorAspect = profile.sensorWidthMm / profile.sensorHeightMm;
  return fovFromEquivalentFocal(
    focalMm,
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
