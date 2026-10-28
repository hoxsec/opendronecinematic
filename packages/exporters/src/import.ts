import { strFromU8, unzipSync } from 'fflate';
import {
  profileForWpml,
  createWaypoint,
  newId,
  type AltitudeMode,
  type GimbalMode,
  type HeadingMode,
  type LatLon,
  type Mission,
  type MissionSettings,
  type PointOfInterest,
  type WaypointAction,
} from '@odc/core';
import { MAV_CMD, MAV_FRAME } from './mavlink';

export interface ImportedWaypoint extends LatLon {
  /** Height in the plan's `heightRef`. */
  alt: number;
  speed?: number;
  heading: HeadingMode;
  headingDeg?: number;
  gimbal: GimbalMode;
  gimbalPitch?: number;
  /** Index into `ImportedPlan.pois`. */
  poi?: number;
  actions: WaypointAction[];
}

/** A POI whose `alt` is relative to the takeoff ground. */
export interface ImportedPoi extends LatLon {
  alt: number;
}

/** A mission read from another app's file, before ground heights are known. */
export interface ImportedPlan {
  format: string;
  name?: string;
  /** Takeoff / home position, when the file has one. */
  home?: LatLon;
  heightRef: AltitudeMode;
  waypoints: ImportedWaypoint[];
  pois: ImportedPoi[];
  settings: Partial<MissionSettings>;
  /** A matching drone profile, when the file says which aircraft it is for. */
  droneProfileId?: string;
  warnings: string[];
}

const num = (v: string | undefined) => {
  const n = Number(v);
  return v === undefined || v.trim() === '' || !Number.isFinite(n) ? undefined : n;
};

function poiIndex(pois: ImportedPoi[], p: ImportedPoi): number {
  const i = pois.findIndex(
    (q) =>
      Math.abs(q.lat - p.lat) < 1e-7 &&
      Math.abs(q.lon - p.lon) < 1e-7 &&
      Math.abs(q.alt - p.alt) < 0.05,
  );
  if (i >= 0) return i;
  pois.push(p);
  return pois.length - 1;
}

// ─── Litchi CSV ────────────────────────────────────────────────────────────────────────────────

/** Litchi Mission Hub CSV, as exported by Mission Hub or by this app. */
export function importLitchiCsv(text: string): ImportedPlan {
  const rows = text
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => r.split(','));
  const header = rows.shift()?.map((h) => h.trim().toLowerCase());
  if (!header?.includes('latitude') || !header.includes('longitude')) {
    throw new Error('Not a Litchi CSV: missing latitude/longitude columns.');
  }
  const col = (row: string[], name: string) => num(row[header.indexOf(name)]);
  const warnings: string[] = [];
  const pois: ImportedPoi[] = [];
  const skipped = new Set<number>();
  let agl = false;
  let curved = false;
  let interval = -1;

  const waypoints = rows.map((row): ImportedWaypoint => {
    if (col(row, 'altitudemode') === 1) agl = true;
    if ((col(row, 'curvesize(m)') ?? 0) > 0) curved = true;
    const actions: WaypointAction[] = [];
    for (let i = 1; i <= 15; i++) {
      const type = col(row, `actiontype${i}`);
      const param = col(row, `actionparam${i}`) ?? 0;
      if (type === undefined || type < 0) continue;
      if (type === 0) actions.push({ type: 'hover', seconds: param / 1000 });
      else if (type === 1) actions.push({ type: 'photo' });
      else if (type === 2) actions.push({ type: 'startRecording' });
      else if (type === 3) actions.push({ type: 'stopRecording' });
      else skipped.add(type);
    }
    const dist = col(row, 'photo_distinterval') ?? -1;
    const next = dist > 0 ? dist : -1;
    if (next !== interval) actions.push({ type: 'photoDistance', meters: Math.max(0, next) });
    interval = next;
    if ((col(row, 'photo_timeinterval') ?? -1) > 0) skipped.add(-1);

    const poiLat = col(row, 'poi_latitude') ?? 0;
    const poiLon = col(row, 'poi_longitude') ?? 0;
    const focus = col(row, 'gimbalmode') === 1 && (poiLat !== 0 || poiLon !== 0);
    const speed = col(row, 'speed(m/s)');
    return {
      lat: col(row, 'latitude')!,
      lon: col(row, 'longitude')!,
      alt: col(row, 'altitude(m)') ?? 0,
      speed: speed && speed > 0 ? speed : undefined,
      heading: focus ? 'poi' : 'fixed',
      headingDeg: col(row, 'heading(deg)') ?? 0,
      gimbal: focus ? 'poi' : 'fixed',
      gimbalPitch: col(row, 'gimbalpitchangle') ?? 0,
      poi: focus
        ? poiIndex(pois, { lat: poiLat, lon: poiLon, alt: col(row, 'poi_altitude(m)') ?? 0 })
        : undefined,
      actions,
    };
  });
  if (waypoints.some((w) => !Number.isFinite(w.lat) || !Number.isFinite(w.lon))) {
    throw new Error('Litchi CSV has rows without a valid latitude/longitude.');
  }
  if (skipped.has(-1)) warnings.push('Timed photo intervals are not supported and were skipped.');
  skipped.delete(-1);
  if (skipped.size) {
    warnings.push(
      `Skipped Litchi action types ${[...skipped].join(', ')} (only stay, photo and recording are supported).`,
    );
  }
  return {
    format: 'Litchi CSV',
    heightRef: agl ? 'AGL' : 'relativeToTakeoff',
    waypoints,
    pois,
    settings: { pathMode: curved ? 'smooth' : 'straight' },
    warnings,
  };
}

// ─── DJI WPML / KMZ ────────────────────────────────────────────────────────────────────────────

/** Text content of the first `<wpml:tag>` (or plain `<tag>`) in an XML fragment. */
function tag(xml: string, name: string): string | undefined {
  const m = new RegExp(`<(?:wpml:)?${name}>([\\s\\S]*?)</(?:wpml:)?${name}>`).exec(xml);
  return m?.[1]?.trim();
}

function blocks(xml: string, name: string): string[] {
  return [
    ...xml.matchAll(new RegExp(`<(?:wpml:)?${name}>([\\s\\S]*?)</(?:wpml:)?${name}>`, 'g')),
  ].map((m) => m[1]!);
}

/** A DJI waypoint mission: `wpmz/waylines.wpml` (preferred) or `wpmz/template.kml`. */
export function importDjiWpml(xml: string, template?: string): ImportedPlan {
  const warnings: string[] = [];
  const pois: ImportedPoi[] = [];
  const folder = blocks(xml, 'Folder')[0] ?? xml;
  const placemarks = blocks(folder, 'Placemark');
  if (placemarks.length === 0) throw new Error('No waypoints found in the DJI file.');

  const isWayline = tag(folder, 'executeHeightMode') !== undefined;
  const heightMode =
    tag(folder, 'executeHeightMode') ??
    tag(tag(folder, 'waylineCoordinateSysParam') ?? '', 'heightMode') ??
    'relativeToStartPoint';
  let heightRef: AltitudeMode = 'relativeToTakeoff';
  if (heightMode === 'realTimeFollowSurface' || heightMode === 'aboveGroundLevel')
    heightRef = 'AGL';
  else if (heightMode === 'WGS84' || heightMode === 'EGM96') {
    heightRef = 'ellipsoid';
    if (heightMode === 'EGM96')
      warnings.push(
        'Heights are above sea level (EGM96) and were read as WGS84 ellipsoid heights.',
      );
  }

  const globalHeight = num(tag(folder, 'globalHeight'));
  const globalSpeed = num(tag(folder, 'autoFlightSpeed'));
  let smooth = false;
  let pitch: number | undefined;
  const skipped = new Set<string>();
  const stops = new Set<number>();

  const waypoints = placemarks.map((pm): ImportedWaypoint => {
    const [lon, lat] = (tag(pm, 'coordinates') ?? '').split(',').map(Number);
    const alt = isWayline
      ? num(tag(pm, 'executeHeight'))
      : tag(pm, 'useGlobalHeight') === '1'
        ? globalHeight
        : heightRef === 'ellipsoid'
          ? (num(tag(pm, 'ellipsoidHeight')) ?? num(tag(pm, 'height')))
          : num(tag(pm, 'height'));
    const speed = tag(pm, 'useGlobalSpeed') === '1' ? undefined : num(tag(pm, 'waypointSpeed'));

    const turn = tag(pm, 'waypointTurnMode') ?? '';
    if (turn.includes('Pass') || turn === 'coordinateTurn') smooth = true;
    if (tag(pm, 'useStraightLine') === '0') smooth = true;

    const hp = tag(pm, 'waypointHeadingParam') ?? '';
    const mode = tag(hp, 'waypointHeadingMode') ?? 'followWayline';
    const angle = num(tag(hp, 'waypointHeadingAngle')) ?? 0;
    let heading: HeadingMode = 'auto';
    let poi: number | undefined;
    if (mode === 'towardPOI') {
      const [plat, plon, palt] = (tag(hp, 'waypointPoiPoint') ?? '').split(',').map(Number);
      if (Number.isFinite(plat) && Number.isFinite(plon) && (plat !== 0 || plon !== 0)) {
        heading = 'poi';
        poi = poiIndex(pois, { lat: plat!, lon: plon!, alt: palt ?? 0 });
      }
    } else if (mode === 'smoothTransition' || mode === 'fixed' || mode === 'manually') {
      heading = 'fixed';
    }

    // Gimbal pitch: the template's per-point setting, else the last absolute rotate action.
    const pointPitch = num(tag(pm, 'gimbalPitchAngle'));
    const actions: WaypointAction[] = [];
    for (const group of blocks(pm, 'actionGroup')) {
      const trigger = tag(group, 'actionTriggerType');
      for (const action of blocks(group, 'action')) {
        const func = tag(action, 'actionActuatorFunc');
        if (trigger === 'multipleDistance' && func === 'takePhoto') {
          actions.push({
            type: 'photoDistance',
            meters: num(tag(group, 'actionTriggerParam')) ?? 0,
          });
          const end = num(tag(group, 'actionGroupEndIndex'));
          if (end !== undefined) stops.add(end);
          continue;
        }
        if (trigger === 'betweenAdjacentPoints' && func === 'gimbalEvenlyRotate') continue;
        if (trigger !== 'reachPoint') {
          skipped.add(`${func} (${trigger})`);
          continue;
        }
        if (func === 'hover')
          actions.push({ type: 'hover', seconds: num(tag(action, 'hoverTime')) ?? 0 });
        else if (func === 'takePhoto') actions.push({ type: 'photo' });
        else if (func === 'startRecord') actions.push({ type: 'startRecording' });
        else if (func === 'stopRecord') actions.push({ type: 'stopRecording' });
        else if (func === 'gimbalRotate' || func === 'gimbalEvenlyRotate')
          pitch = num(tag(action, 'gimbalPitchRotateAngle')) ?? pitch;
        else if (func === 'rotateYaw' || func === 'focus' || func === 'zoom') skipped.add(func!);
        else skipped.add(func ?? '?');
      }
    }
    const gimbalPitch = pointPitch ?? pitch;
    // The next leg's evenly-rotate target is the following point's pitch.
    const between = blocks(pm, 'actionGroup').find(
      (g) => tag(g, 'actionTriggerType') === 'betweenAdjacentPoints',
    );
    const nextPitch = between ? num(tag(between, 'gimbalPitchRotateAngle')) : undefined;
    if (nextPitch !== undefined) pitch = nextPitch;

    return {
      lat: lat!,
      lon: lon!,
      alt: alt ?? globalHeight ?? 0,
      speed,
      heading,
      headingDeg: heading === 'fixed' ? ((angle % 360) + 360) % 360 : undefined,
      gimbal: 'fixed',
      gimbalPitch,
      poi,
      actions,
    };
  });
  // multipleDistance groups end at a point index; stop interval photos there.
  for (const end of stops) {
    const w = waypoints[end];
    if (w && !w.actions.some((a) => a.type === 'photoDistance'))
      w.actions.push({ type: 'photoDistance', meters: 0 });
  }
  if (skipped.size) warnings.push(`Skipped unsupported DJI actions: ${[...skipped].join(', ')}.`);

  const config = tag(template ?? xml, 'missionConfig') ?? '';
  const finish = tag(config, 'finishAction');
  const ref = tag(template ?? xml, 'takeOffRefPoint');
  const [hlat, hlon] = (ref ?? '').split(',').map(Number);
  const droneEnum = num(tag(config, 'droneEnumValue'));
  const profile = profileForWpml(
    droneEnum,
    num(tag(config, 'droneSubEnumValue')),
    num(tag(config, 'payloadEnumValue')),
  );

  return {
    format: 'DJI WPML',
    home:
      ref && Number.isFinite(hlat) && Number.isFinite(hlon)
        ? { lat: hlat!, lon: hlon! }
        : undefined,
    heightRef,
    waypoints,
    pois,
    settings: {
      pathMode: smooth ? 'smooth' : 'straight',
      ...(globalSpeed ? { speed: globalSpeed } : {}),
      ...(finish === 'goHome'
        ? { finishAction: 'returnHome' as const }
        : finish === 'autoLand'
          ? { finishAction: 'land' as const }
          : finish
            ? { finishAction: 'hover' as const }
            : {}),
    },
    droneProfileId: profile?.id,
    warnings,
  };
}

export function importDjiKmz(bytes: Uint8Array): ImportedPlan {
  const files = unzipSync(bytes);
  const find = (suffix: string) => {
    const key = Object.keys(files).find((k) => k.toLowerCase().endsWith(suffix));
    return key ? strFromU8(files[key]!) : undefined;
  };
  const template = find('template.kml');
  const waylines = find('waylines.wpml');
  const main = waylines ?? template ?? find('.kml');
  if (!main) throw new Error('The KMZ has no wpmz/template.kml or wpmz/waylines.wpml.');
  return importDjiWpml(main, template);
}

// ─── MAVLink: QGC .plan and Mission Planner .waypoints ─────────────────────────────────────────

interface RawItem {
  command: number;
  frame: number;
  params: (number | null)[];
}

const p = (it: RawItem, i: number) => {
  const v = it.params[i];
  return v === null || v === undefined || !Number.isFinite(v) ? undefined : v;
};

const SUPPORTED: Set<number> = new Set(Object.values(MAV_CMD));

function fromMavlink(
  format: string,
  items: RawItem[],
  home: LatLon | undefined,
  firmware: 'px4' | 'ardupilot' | undefined,
): ImportedPlan {
  const warnings: string[] = [];
  const pois: ImportedPoi[] = [];
  const waypoints: ImportedWaypoint[] = [];
  const settings: Partial<MissionSettings> = { pathMode: 'straight', finishAction: 'hover' };
  const skipped = new Set<number>();
  let speed: number | undefined;
  let pitch: number | undefined;
  let roi: number | undefined;
  let pending: WaypointAction[] = [];
  const frames = new Set<number>();
  const attach = (a: WaypointAction) => {
    const last = waypoints[waypoints.length - 1];
    if (last) last.actions.push(a);
    else pending.push(a);
  };

  for (const it of items) {
    switch (it.command) {
      case MAV_CMD.NAV_WAYPOINT: {
        const lat = p(it, 4);
        const lon = p(it, 5);
        if (lat === undefined || lon === undefined || (lat === 0 && lon === 0)) break;
        frames.add(it.frame);
        const hold = p(it, 0) ?? 0;
        const yaw = p(it, 3);
        waypoints.push({
          lat,
          lon,
          alt: p(it, 6) ?? 0,
          speed,
          heading: roi !== undefined ? 'poi' : yaw !== undefined ? 'fixed' : 'auto',
          headingDeg:
            roi === undefined && yaw !== undefined ? ((yaw % 360) + 360) % 360 : undefined,
          gimbal: roi !== undefined ? 'poi' : 'fixed',
          gimbalPitch: pitch,
          poi: roi,
          actions: [...pending, ...(hold > 0 ? [{ type: 'hover' as const, seconds: hold }] : [])],
        });
        pending = [];
        break;
      }
      case MAV_CMD.NAV_TAKEOFF:
        break;
      case MAV_CMD.NAV_RETURN_TO_LAUNCH:
        settings.finishAction = 'returnHome';
        break;
      case MAV_CMD.NAV_LAND:
        settings.finishAction = 'land';
        break;
      case MAV_CMD.DO_CHANGE_SPEED: {
        const v = p(it, 1);
        if (v !== undefined && v > 0) speed = v;
        break;
      }
      case MAV_CMD.DO_SET_ROI:
      case MAV_CMD.DO_SET_ROI_LOCATION: {
        const lat = p(it, 4);
        const lon = p(it, 5);
        // DO_SET_ROI with mode 0 (or no location) clears it.
        if (lat === undefined || lon === undefined || (lat === 0 && lon === 0)) roi = undefined;
        else roi = poiIndex(pois, { lat, lon, alt: p(it, 6) ?? 0 });
        break;
      }
      case MAV_CMD.DO_SET_ROI_NONE:
        roi = undefined;
        break;
      case MAV_CMD.DO_MOUNT_CONTROL:
      case MAV_CMD.DO_GIMBAL_MANAGER_PITCHYAW:
        pitch = p(it, 0) ?? pitch;
        break;
      case MAV_CMD.DO_SET_CAM_TRIGG_DIST:
        attach({ type: 'photoDistance', meters: Math.max(0, p(it, 0) ?? 0) });
        break;
      case MAV_CMD.IMAGE_START_CAPTURE:
        if ((p(it, 1) ?? 0) > 0) skipped.add(it.command);
        else attach({ type: 'photo' });
        break;
      case MAV_CMD.VIDEO_START_CAPTURE:
        attach({ type: 'startRecording' });
        break;
      case MAV_CMD.VIDEO_STOP_CAPTURE:
        attach({ type: 'stopRecording' });
        break;
      default:
        skipped.add(it.command);
    }
  }
  if (waypoints.length === 0) throw new Error(`${format} has no waypoints.`);
  if (skipped.size) {
    warnings.push(
      `Skipped ${[...skipped].map((c) => (SUPPORTED.has(c) ? `${c} (interval capture)` : c)).join(', ')}: MAVLink commands without an equivalent here.`,
    );
  }

  let heightRef: AltitudeMode = 'relativeToTakeoff';
  if (frames.size > 1)
    warnings.push('Waypoints mix altitude frames; all were read as relative to home.');
  else if (frames.has(MAV_FRAME.GLOBAL_TERRAIN_ALT)) heightRef = 'AGL';
  else if (frames.has(MAV_FRAME.GLOBAL)) {
    heightRef = 'ellipsoid';
    warnings.push('Altitudes are above sea level (AMSL) and were read as WGS84 ellipsoid heights.');
  }
  return {
    format,
    home,
    heightRef,
    waypoints,
    pois,
    settings,
    droneProfileId: firmware ? 'ardupilot-px4-multirotor' : undefined,
    warnings,
  };
}

const flattenPlanItems = (items: unknown[], warnings: string[]): RawItem[] =>
  items.flatMap((raw) => {
    const it = raw as Record<string, unknown>;
    if (it.type === 'SimpleItem') return [it as unknown as RawItem];
    // Survey, corridor and structure scans carry their generated items.
    const transect = it.TransectStyleComplexItem as { Items?: unknown[] } | undefined;
    if (transect?.Items) return flattenPlanItems(transect.Items, warnings);
    warnings.push(`Skipped a QGC "${String(it.complexItemType ?? it.type)}" item.`);
    return [];
  });

export function importQgcPlan(text: string): ImportedPlan {
  let json: {
    fileType?: string;
    mission?: { items?: unknown[]; plannedHomePosition?: number[]; firmwareType?: number };
  };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('Not a QGroundControl .plan file (invalid JSON).');
  }
  if (json.fileType !== 'Plan' || !Array.isArray(json.mission?.items)) {
    throw new Error('Not a QGroundControl .plan file.');
  }
  const flattenWarnings: string[] = [];
  const items = flattenPlanItems(json.mission.items, flattenWarnings);
  const [lat, lon] = json.mission.plannedHomePosition ?? [];
  const plan = fromMavlink(
    'QGC plan',
    items,
    lat && lon ? { lat, lon } : undefined,
    json.mission.firmwareType === 3 ? 'ardupilot' : 'px4',
  );
  plan.warnings.unshift(...flattenWarnings);
  return plan;
}

export function importMissionPlannerWaypoints(text: string): ImportedPlan {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!/^QGC WPL 1\d0/.test(lines[0] ?? ''))
    throw new Error('Not a QGC WPL / Mission Planner file.');
  let home: LatLon | undefined;
  const items: RawItem[] = [];
  for (const l of lines.slice(1)) {
    const f = l.split(/\s+/).map(Number);
    if (f.length < 12) continue;
    const it = { command: f[3]!, frame: f[2]!, params: f.slice(4, 11) };
    if (f[0] === 0) home = { lat: it.params[4]!, lon: it.params[5]! };
    else items.push(it);
  }
  // WPL writes 0 for unset yaw; treat it as "firmware decides" rather than "face north".
  for (const it of items)
    if (it.command === MAV_CMD.NAV_WAYPOINT && it.params[3] === 0) it.params[3] = null;
  return fromMavlink('Mission Planner waypoints', items, home, 'ardupilot');
}

// ─── Dispatch and conversion ───────────────────────────────────────────────────────────────────

export const IMPORT_EXTENSIONS = ['csv', 'kmz', 'kml', 'wpml', 'plan', 'waypoints', 'txt'];

/** Read any supported mission file by its extension (falling back to sniffing the content). */
export function importMissionFile(name: string, bytes: Uint8Array): ImportedPlan {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'kmz' || (bytes[0] === 0x50 && bytes[1] === 0x4b)) return importDjiKmz(bytes);
  const text = strFromU8(bytes).replace(/^﻿/, '');
  const head = text.trimStart();
  if (ext === 'plan' || head.startsWith('{')) return importQgcPlan(text);
  if (head.startsWith('QGC WPL')) return importMissionPlannerWaypoints(text);
  if (ext === 'kml' || ext === 'wpml' || head.startsWith('<')) return importDjiWpml(text);
  if (ext === 'csv' || head.toLowerCase().startsWith('latitude')) return importLitchiCsv(text);
  throw new Error(`Unrecognised mission file: ${name}`);
}

/** Ground heights (WGS84 ellipsoid) for an imported plan, sampled by the caller. */
export interface ImportGrounds {
  home: number;
  waypoints: (number | undefined)[];
}

/** Where an imported plan takes off: its home, else its first waypoint. */
export const importHome = (plan: ImportedPlan): LatLon => plan.home ?? plan.waypoints[0]!;

/** Build a mission from an imported plan, keeping the base mission's id and drone by default. */
export function importedToMission(
  plan: ImportedPlan,
  base: Mission,
  grounds: ImportGrounds,
): Mission {
  const home = importHome(plan);
  const pois: PointOfInterest[] = plan.pois.map((p, i) => ({
    id: newId('poi'),
    name: `POI ${i + 1}`,
    lat: p.lat,
    lon: p.lon,
    height: grounds.home + p.alt,
  }));
  const waypoints = plan.waypoints.map((w, i) =>
    createWaypoint({
      lat: w.lat,
      lon: w.lon,
      alt: w.alt,
      groundHeight: grounds.waypoints[i] ?? grounds.home,
      speed: w.speed,
      heading: w.heading,
      headingDeg: w.headingDeg,
      gimbal: w.gimbal,
      gimbalPitch: w.gimbalPitch,
      poiId: w.poi !== undefined ? pois[w.poi]?.id : undefined,
      actions: w.actions,
    }),
  );
  return {
    ...base,
    name: plan.name ?? base.name,
    droneProfileId: plan.droneProfileId ?? base.droneProfileId,
    altitudeMode: plan.heightRef,
    takeoff: { lat: home.lat, lon: home.lon, groundHeight: grounds.home },
    waypoints,
    pois,
    settings: { ...base.settings, ...plan.settings },
    survey: undefined,
  };
}
