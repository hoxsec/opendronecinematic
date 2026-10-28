import type { Mission, WaypointAction } from '@odc/core';
import {
  round,
  toExportPoints,
  type ExportOptions,
  type ExportPoint,
  type ExportResult,
} from './points';

/** MAVLink MAV_CMD values used by the exporter and importer. */
export const MAV_CMD = {
  NAV_WAYPOINT: 16,
  NAV_RETURN_TO_LAUNCH: 20,
  NAV_LAND: 21,
  NAV_TAKEOFF: 22,
  DO_CHANGE_SPEED: 178,
  DO_SET_ROI_LOCATION: 195,
  DO_SET_ROI_NONE: 197,
  DO_SET_ROI: 201,
  DO_MOUNT_CONTROL: 205,
  DO_SET_CAM_TRIGG_DIST: 206,
  DO_GIMBAL_MANAGER_PITCHYAW: 1000,
  IMAGE_START_CAPTURE: 2000,
  VIDEO_START_CAPTURE: 2500,
  VIDEO_STOP_CAPTURE: 2501,
} as const;

/** MAV_FRAME values. */
export const MAV_FRAME = {
  GLOBAL: 0,
  MISSION: 2,
  GLOBAL_RELATIVE_ALT: 3,
  GLOBAL_TERRAIN_ALT: 10,
} as const;

export type Firmware = 'px4' | 'ardupilot';

export interface MavlinkExportOptions extends ExportOptions {
  firmware?: Firmware;
}

/** One mission item. NaN params mean "unchanged / firmware default" (null in .plan JSON). */
export interface MavItem {
  command: number;
  frame: number;
  params: [number, number, number, number, number, number, number];
}

const nav = (p: ExportPoint, hold: number, yaw: number): MavItem => ({
  command: MAV_CMD.NAV_WAYPOINT,
  frame: MAV_FRAME.GLOBAL_RELATIVE_ALT,
  params: [hold, 0, 0, yaw, round(p.lat, 8), round(p.lon, 8), round(p.relAlt, 2)],
});

const cmd = (command: number, ...params: number[]): MavItem => {
  const ps = [...params, 0, 0, 0, 0, 0, 0, 0].slice(0, 7) as MavItem['params'];
  return { command, frame: MAV_FRAME.MISSION, params: ps };
};

function actionItems(a: WaypointAction): MavItem[] {
  switch (a.type) {
    case 'hover':
      return []; // folded into the waypoint's hold time
    case 'photo':
      return [cmd(MAV_CMD.IMAGE_START_CAPTURE, 0, 0, 1, 0)];
    case 'startRecording':
      return [cmd(MAV_CMD.VIDEO_START_CAPTURE, 0, 0)];
    case 'stopRecording':
      return [cmd(MAV_CMD.VIDEO_STOP_CAPTURE, 0)];
    case 'photoDistance':
      return [cmd(MAV_CMD.DO_SET_CAM_TRIGG_DIST, round(a.meters, 2), 0, a.meters > 0 ? 1 : 0)];
  }
}

/**
 * The mission as a flat MAVLink item list, shared by the QGC .plan and Mission Planner exports.
 * Heights are relative to home (MAV_FRAME_GLOBAL_RELATIVE_ALT). DO commands placed before a
 * waypoint take effect when the vehicle heads for it, so speed, gimbal and ROI changes come
 * before the waypoint they belong to and camera actions after it.
 */
export function buildMavlinkItems(
  mission: Mission,
  opts: MavlinkExportOptions = {},
): ExportResult<MavItem[]> {
  const warnings: string[] = [];
  const points = toExportPoints(mission, opts);
  const items: MavItem[] = [];
  if (points.length === 0) return { data: items, warnings };

  const first = points[0]!;
  const { takeoff } = mission;
  items.push({
    command: MAV_CMD.NAV_TAKEOFF,
    frame: MAV_FRAME.GLOBAL_RELATIVE_ALT,
    params: [
      0,
      0,
      0,
      NaN,
      round(takeoff.lat, 8),
      round(takeoff.lon, 8),
      round(Math.max(5, first.relAlt), 2),
    ],
  });

  let speed: number | undefined;
  let pitch: number | undefined;
  let roi: string | undefined;
  for (const p of points) {
    if (speed === undefined || Math.abs(p.speed - speed) > 0.05) {
      speed = p.speed;
      items.push(cmd(MAV_CMD.DO_CHANGE_SPEED, 1, round(speed, 1), -1, 0));
    }

    const poi = (p.headingMode === 'poi' || p.gimbalMode === 'poi') && p.poi ? p.poi : undefined;
    const roiKey = poi ? `${poi.lat},${poi.lon},${poi.height}` : undefined;
    if (roiKey !== roi) {
      if (poi) {
        const rel = poi.height - mission.takeoff.groundHeight;
        items.push({
          command: MAV_CMD.DO_SET_ROI_LOCATION,
          frame: MAV_FRAME.GLOBAL_RELATIVE_ALT,
          params: [0, 0, 0, 0, round(poi.lat, 8), round(poi.lon, 8), round(rel, 2)],
        });
      } else {
        items.push(cmd(MAV_CMD.DO_SET_ROI_NONE, 0));
      }
      roi = roiKey;
      pitch = undefined;
    }
    // With an ROI set the firmware aims the gimbal itself.
    if (!poi && (pitch === undefined || Math.abs(p.pitch - pitch) > 0.05)) {
      pitch = p.pitch;
      // MAV_MOUNT_MODE_MAVLINK_TARGETING = 2
      items.push(cmd(MAV_CMD.DO_MOUNT_CONTROL, round(pitch, 1), 0, 0, 0, 0, 0, 2));
    }

    const hold = p.actions.reduce((s, a) => (a.type === 'hover' ? s + a.seconds : s), 0);
    // Yaw: fixed headings are written out; "along path" and POI leave it to the firmware.
    const yaw = p.headingMode === 'fixed' ? round(((p.yaw % 360) + 360) % 360, 1) : NaN;
    items.push(nav(p, round(hold, 1), yaw));
    for (const a of p.actions) items.push(...actionItems(a));
  }

  const last = points[points.length - 1]!;
  if (mission.settings.finishAction === 'returnHome') {
    items.push({ ...cmd(MAV_CMD.NAV_RETURN_TO_LAUNCH), frame: MAV_FRAME.GLOBAL_RELATIVE_ALT });
  } else if (mission.settings.finishAction === 'land') {
    items.push({
      command: MAV_CMD.NAV_LAND,
      frame: MAV_FRAME.GLOBAL_RELATIVE_ALT,
      params: [0, 0, 0, NaN, round(last.lat, 8), round(last.lon, 8), 0],
    });
  }
  if (mission.settings.pathMode === 'smooth' && !opts.densify) {
    warnings.push(
      'PX4 and ArduPilot fly straight legs between waypoints. Enable "Match preview exactly" to keep the smooth curves.',
    );
  }
  return { data: items, warnings };
}

const isNav = (c: number) =>
  c === MAV_CMD.NAV_WAYPOINT ||
  c === MAV_CMD.NAV_TAKEOFF ||
  c === MAV_CMD.NAV_LAND ||
  c === MAV_CMD.NAV_RETURN_TO_LAUNCH;

/**
 * QGroundControl .plan (JSON) for PX4 or ArduPilot. The planned home height is the takeoff
 * ground's WGS84 ellipsoid height; QGC only displays it, as every item is relative to home.
 */
export function exportQgcPlan(
  mission: Mission,
  opts: MavlinkExportOptions = {},
): ExportResult<string> {
  const { data, warnings } = buildMavlinkItems(mission, opts);
  const { takeoff, settings } = mission;
  const plan = {
    fileType: 'Plan',
    version: 1,
    groundStation: 'QGroundControl',
    mission: {
      version: 2,
      firmwareType: opts.firmware === 'ardupilot' ? 3 : 12,
      vehicleType: 2,
      cruiseSpeed: round(settings.speed, 1),
      hoverSpeed: round(settings.speed, 1),
      plannedHomePosition: [
        round(takeoff.lat, 8),
        round(takeoff.lon, 8),
        round(takeoff.groundHeight, 2),
      ],
      items: data.map((it, i) => ({
        ...(it.frame === MAV_FRAME.GLOBAL_RELATIVE_ALT && isNav(it.command)
          ? { AMSLAltAboveTerrain: null, Altitude: it.params[6], AltitudeMode: 1 }
          : {}),
        autoContinue: true,
        command: it.command,
        doJumpId: i + 1,
        frame: it.frame,
        // JSON.stringify turns NaN into null, which is how QGC writes "unset".
        params: it.params,
        type: 'SimpleItem',
      })),
    },
    geoFence: { circles: [], polygons: [], version: 2 },
    rallyPoints: { points: [], version: 2 },
  };
  return { data: JSON.stringify(plan, null, 4) + '\n', warnings };
}

/**
 * Mission Planner / ArduPilot "QGC WPL 110" text. Line 0 is home, with its height written as the
 * WGS84 ellipsoid height (Mission Planner replaces it with the vehicle's real home on upload).
 */
export function exportMissionPlannerWaypoints(
  mission: Mission,
  opts: MavlinkExportOptions = {},
): ExportResult<string> {
  const { data, warnings } = buildMavlinkItems(mission, { ...opts, firmware: 'ardupilot' });
  const { takeoff } = mission;
  const fmt = (v: number) => (Number.isFinite(v) ? String(v) : '0');
  const line = (seq: number, current: number, it: MavItem) =>
    [seq, current, it.frame, it.command, ...it.params.map(fmt), 1].join('\t');
  const home: MavItem = {
    command: MAV_CMD.NAV_WAYPOINT,
    frame: MAV_FRAME.GLOBAL,
    params: [
      0,
      0,
      0,
      0,
      round(takeoff.lat, 8),
      round(takeoff.lon, 8),
      round(takeoff.groundHeight, 2),
    ],
  };
  const lines = ['QGC WPL 110', line(0, 1, home), ...data.map((it, i) => line(i + 1, 0, it))];
  return { data: lines.join('\n') + '\n', warnings };
}
