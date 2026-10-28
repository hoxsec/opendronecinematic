import type { Mission, WaypointAction } from '@odc/core';
import { round, toExportPoints, type ExportOptions, type ExportResult } from './points';

const MAX_WAYPOINTS = 99;
const MAX_ACTIONS = 15;

const HEADER = [
  'latitude',
  'longitude',
  'altitude(m)',
  'heading(deg)',
  'curvesize(m)',
  'rotationdir',
  'gimbalmode',
  'gimbalpitchangle',
  ...Array.from({ length: MAX_ACTIONS }, (_, i) => [
    `actiontype${i + 1}`,
    `actionparam${i + 1}`,
  ]).flat(),
  'altitudemode',
  'speed(m/s)',
  'poi_latitude',
  'poi_longitude',
  'poi_altitude(m)',
  'poi_altitudemode',
  'photo_timeinterval',
  'photo_distinterval',
];

// Litchi action codes: 0 stay (ms), 1 take photo, 2 start recording, 3 stop recording.
// Interval photos are not an action in Litchi but a per-leg column, handled separately.
const actionCode = (a: WaypointAction): [number, number] | undefined => {
  switch (a.type) {
    case 'hover':
      return [0, Math.round(a.seconds * 1000)];
    case 'photo':
      return [1, 0];
    case 'startRecording':
      return [2, 0];
    case 'stopRecording':
      return [3, 0];
    case 'photoDistance':
      return undefined;
  }
};

/**
 * Litchi Mission Hub CSV. Heights are relative to takeoff unless the mission uses AGL, which
 * Litchi supports natively. Import the file in Mission Hub with heading mode set to "Custom".
 */
export function exportLitchiCsv(mission: Mission, opts: ExportOptions = {}): ExportResult<string> {
  const warnings: string[] = [];
  const points = toExportPoints(mission, opts);
  const agl = mission.altitudeMode === 'AGL';

  if (points.length > MAX_WAYPOINTS) {
    warnings.push(
      `Litchi supports at most ${MAX_WAYPOINTS} waypoints; this export has ${points.length}. Increase the densify spacing or split the mission.`,
    );
  }

  // photo_distinterval applies to the leg leaving a waypoint, so carry it until it changes.
  let photoInterval = -1;
  const rows = points.map((p) => {
    for (const a of p.actions)
      if (a.type === 'photoDistance') photoInterval = a.meters > 0 ? a.meters : -1;
    const codes = p.actions.map(actionCode).filter((c) => c !== undefined);
    const actions = codes.slice(0, MAX_ACTIONS);
    if (codes.length > MAX_ACTIONS) {
      warnings.push(
        `Waypoint ${(p.waypointIndex ?? 0) + 1}: only the first ${MAX_ACTIONS} actions are exported.`,
      );
    }
    const actionCols: number[] = [];
    for (let i = 0; i < MAX_ACTIONS; i++) {
      const a = actions[i];
      actionCols.push(a ? a[0] : -1, a ? a[1] : 0);
    }
    const poiRelAlt = p.poi ? p.poi.height - mission.takeoff.groundHeight : 0;
    // gimbalmode: 0 disabled, 1 focus POI, 2 interpolate between waypoint pitches.
    const gimbalMode = p.gimbalMode === 'poi' && p.poi ? 1 : 2;
    return [
      round(p.lat, 8),
      round(p.lon, 8),
      round(agl ? p.agl : p.relAlt, 1),
      ((round(p.yaw, 1) % 360) + 360) % 360,
      p.curveSize > 0 ? Math.max(0.2, p.curveSize) : 0,
      0,
      gimbalMode,
      round(p.pitch, 1),
      ...actionCols,
      agl ? 1 : 0,
      round(p.speed, 1),
      p.poi ? round(p.poi.lat, 8) : 0,
      p.poi ? round(p.poi.lon, 8) : 0,
      p.poi ? round(poiRelAlt, 1) : 0,
      0,
      -1,
      photoInterval > 0 ? round(photoInterval, 1) : -1,
    ].join(',');
  });

  return { data: [HEADER.join(','), ...rows].join('\n') + '\n', warnings };
}
