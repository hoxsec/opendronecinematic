import { strToU8, zipSync } from 'fflate';
import { buildFlightPath, missionProfile, type Mission, type WaypointAction } from '@odc/core';
import {
  heading180,
  round,
  toExportPoints,
  type ExportOptions,
  type ExportPoint,
  type ExportResult,
} from './points';

const WPML_NS = 'http://www.dji.com/wpmz/1.0.6';

export interface DjiExportOptions extends ExportOptions {
  /** Fixed timestamp for reproducible output (tests); defaults to now. */
  now?: number;
  author?: string;
}

export interface WpmlFiles {
  templateKml: string;
  waylinesWpml: string;
}

const FALLBACK_ENUM = { droneEnumValue: 77, droneSubEnumValue: 0, payloadEnumValue: 66 };

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Render `{ tag: value }` pairs as `<wpml:tag>value</wpml:tag>` lines. */
const tags = (indent: string, entries: [string, string | number][]) =>
  entries.map(([k, v]) => `${indent}<wpml:${k}>${v}</wpml:${k}>`).join('\n');

function missionConfig(mission: Mission, warnings: string[]) {
  const profile = missionProfile(mission);
  let e = profile.wpml;
  if (!e) {
    warnings.push(
      `${profile.name} has no known DJI WPML drone enum; using Mavic 3 Enterprise values. The target app may reject or re-map the file.`,
    );
    e = { ...FALLBACK_ENUM, verified: false };
  } else if (!e.verified) {
    warnings.push(`DJI WPML enum values for ${profile.name} are community-sourced and unverified.`);
  }
  const finish = { hover: 'noAction', returnHome: 'goHome', land: 'autoLand' }[
    mission.settings.finishAction
  ];
  return `    <wpml:missionConfig>
${tags('      ', [
  ['flyToWaylineMode', 'safely'],
  ['finishAction', finish],
  ['exitOnRCLost', 'executeLostAction'],
  ['executeRCLostAction', 'goBack'],
  ['takeOffSecurityHeight', 20],
  ['globalTransitionalSpeed', round(Math.min(mission.settings.speed * 2, profile.maxSpeed), 1)],
])}
      <wpml:droneInfo>
${tags('        ', [
  ['droneEnumValue', e.droneEnumValue],
  ['droneSubEnumValue', e.droneSubEnumValue],
])}
      </wpml:droneInfo>
      <wpml:payloadInfo>
${tags('        ', [
  ['payloadEnumValue', e.payloadEnumValue],
  ['payloadPositionIndex', 0],
])}
      </wpml:payloadInfo>
    </wpml:missionConfig>`;
}

function headingParam(p: ExportPoint) {
  const mode =
    p.headingMode === 'poi' && p.poi
      ? 'towardPOI'
      : p.headingMode === 'auto'
        ? 'followWayline'
        : 'smoothTransition';
  const poi = p.poi
    ? `${round(p.poi.lat, 8)},${round(p.poi.lon, 8)},${round(p.poi.height - (p.height - p.relAlt), 1)}`
    : '0,0,0';
  return `        <wpml:waypointHeadingParam>
${tags('          ', [
  ['waypointHeadingMode', mode],
  ['waypointHeadingAngle', round(heading180(p.yaw), 1)],
  ['waypointPoiPoint', poi],
  ['waypointHeadingAngleEnable', mode === 'smoothTransition' ? 1 : 0],
  ['waypointHeadingPathMode', 'followBadArc'],
])}
        </wpml:waypointHeadingParam>`;
}

function turnParam(p: ExportPoint, i: number, count: number, smooth: boolean) {
  const end = i === 0 || i === count - 1;
  const mode =
    end || !smooth
      ? 'toPointAndStopWithDiscontinuityCurvature'
      : 'toPointAndPassWithContinuityCurvature';
  return `        <wpml:waypointTurnParam>
${tags('          ', [
  ['waypointTurnMode', mode],
  ['waypointTurnDampingDist', 0],
])}
        </wpml:waypointTurnParam>`;
}

interface Action {
  func: string;
  params: [string, string | number][];
}

function waypointActions(a: WaypointAction): Action | undefined {
  switch (a.type) {
    case 'hover':
      return { func: 'hover', params: [['hoverTime', round(a.seconds, 1)]] };
    case 'photo':
      return {
        func: 'takePhoto',
        params: [
          ['payloadPositionIndex', 0],
          ['useGlobalPayloadLensIndex', 0],
        ],
      };
    case 'startRecording':
      return {
        func: 'startRecord',
        params: [
          ['payloadPositionIndex', 0],
          ['useGlobalPayloadLensIndex', 0],
        ],
      };
    case 'stopRecording':
      return { func: 'stopRecord', params: [['payloadPositionIndex', 0]] };
    case 'photoDistance':
      // Becomes a multipleDistance action group spanning the legs, see actionGroups.
      return undefined;
  }
}

const takePhoto = waypointActions({ type: 'photo' })!;

/** For each point that starts interval photos: the spacing and the index where they stop. */
function photoRuns(points: ExportPoint[]) {
  const runs = new Map<number, { meters: number; end: number }>();
  let open: { start: number; meters: number } | undefined;
  const close = (end: number) => {
    if (open && end > open.start) runs.set(open.start, { meters: open.meters, end });
    open = undefined;
  };
  points.forEach((p, i) => {
    const a = p.actions.filter((x) => x.type === 'photoDistance').pop();
    if (!a) return;
    close(i);
    if (a.meters > 0) open = { start: i, meters: a.meters };
  });
  close(points.length - 1);
  return runs;
}

const gimbalParams = (pitch: number): [string, string | number][] => [
  ['gimbalPitchRotateAngle', round(pitch, 1)],
  ['payloadPositionIndex', 0],
];

function actionGroups(
  points: ExportPoint[],
  i: number,
  nextGroupId: () => number,
  photoRun?: { meters: number; end: number },
) {
  const p = points[i]!;
  const groups: string[] = [];
  const group = (
    trigger: string,
    start: number,
    endIdx: number,
    actions: Action[],
    triggerParam?: number,
  ) =>
    `        <wpml:actionGroup>
${tags('          ', [
  ['actionGroupId', nextGroupId()],
  ['actionGroupStartIndex', start],
  ['actionGroupEndIndex', endIdx],
  ['actionGroupMode', 'sequence'],
])}
          <wpml:actionTrigger>
            <wpml:actionTriggerType>${trigger}</wpml:actionTriggerType>${
              triggerParam === undefined
                ? ''
                : `
            <wpml:actionTriggerParam>${triggerParam}</wpml:actionTriggerParam>`
            }
          </wpml:actionTrigger>
${actions
  .map(
    (a, k) => `          <wpml:action>
            <wpml:actionId>${k}</wpml:actionId>
            <wpml:actionActuatorFunc>${a.func}</wpml:actionActuatorFunc>
            <wpml:actionActuatorFuncParam>
${tags('              ', a.params)}
            </wpml:actionActuatorFuncParam>
          </wpml:action>`,
  )
  .join('\n')}
        </wpml:actionGroup>`;

  const atPoint: Action[] = [];
  if (i === 0) {
    atPoint.push({
      func: 'gimbalRotate',
      params: [
        ['gimbalHeadingYawBase', 'north'],
        ['gimbalRotateMode', 'absoluteAngle'],
        ['gimbalPitchRotateEnable', 1],
        ['gimbalPitchRotateAngle', round(p.pitch, 1)],
        ['gimbalRollRotateEnable', 0],
        ['gimbalRollRotateAngle', 0],
        ['gimbalYawRotateEnable', 0],
        ['gimbalYawRotateAngle', 0],
        ['gimbalRotateTimeEnable', 0],
        ['gimbalRotateTime', 0],
        ['payloadPositionIndex', 0],
      ],
    });
  }
  for (const a of p.actions) {
    const action = waypointActions(a);
    if (action) atPoint.push(action);
  }
  if (atPoint.length) groups.push(group('reachPoint', i, i, atPoint));
  if (photoRun) {
    groups.push(group('multipleDistance', i, photoRun.end, [takePhoto], round(photoRun.meters, 1)));
  }

  // Tilt evenly toward the next point's pitch over the whole leg for smooth gimbal moves.
  const next = points[i + 1];
  if (next)
    groups.push(
      group('betweenAdjacentPoints', i, i + 1, [
        { func: 'gimbalEvenlyRotate', params: gimbalParams(next.pitch) },
      ]),
    );
  return groups.join('\n');
}

export function buildWpml(mission: Mission, opts: DjiExportOptions = {}): ExportResult<WpmlFiles> {
  const warnings: string[] = [];
  const points = toExportPoints(mission, opts);
  if (points.length < 2) warnings.push('DJI waypoint missions need at least 2 waypoints.');
  if (points.length > 65535) warnings.push('DJI WPML supports at most 65535 waypoints.');
  const path = buildFlightPath(mission);
  const now = opts.now ?? Date.now();
  const config = missionConfig(mission, warnings);
  const smooth = mission.settings.pathMode === 'smooth' || !!opts.densify;
  const author = esc(opts.author ?? 'OpenDroneCinematic');

  let groupId = 0;
  const templateGroups = () => groupId++;
  const runs = photoRuns(points);
  const placemarks = (wayline: boolean) => {
    groupId = 0;
    return points
      .map((p, i) => {
        const coords = `${round(p.lon, 8)},${round(p.lat, 8)}`;
        const common = wayline
          ? tags('        ', [
              ['index', i],
              ['executeHeight', round(p.relAlt, 1)],
              ['waypointSpeed', round(p.speed, 1)],
            ])
          : tags('        ', [
              ['index', i],
              ['ellipsoidHeight', round(p.height, 2)],
              ['height', round(p.relAlt, 1)],
              ['useGlobalHeight', 0],
              ['useGlobalSpeed', 0],
              ['waypointSpeed', round(p.speed, 1)],
              ['useGlobalHeadingParam', 0],
              ['useGlobalTurnParam', 0],
              ['gimbalPitchAngle', round(p.pitch, 1)],
            ]);
        return `      <Placemark>
        <Point>
          <coordinates>${coords}</coordinates>
        </Point>
${common}
${headingParam(p)}
${turnParam(p, i, points.length, smooth)}
        <wpml:useStraightLine>${smooth ? 0 : 1}</wpml:useStraightLine>
${actionGroups(points, i, templateGroups, runs.get(i))}
      </Placemark>`;
      })
      .join('\n');
  };

  const head = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="${WPML_NS}">
  <Document>`;

  const templateKml = `${head}
    <wpml:author>${author}</wpml:author>
    <wpml:createTime>${now}</wpml:createTime>
    <wpml:updateTime>${now}</wpml:updateTime>
${config}
    <Folder>
${tags('      ', [
  ['templateType', 'waypoint'],
  ['templateId', 0],
])}
      <wpml:waylineCoordinateSysParam>
${tags('        ', [
  ['coordinateMode', 'WGS84'],
  ['heightMode', 'relativeToStartPoint'],
])}
      </wpml:waylineCoordinateSysParam>
${tags('      ', [
  ['autoFlightSpeed', round(mission.settings.speed, 1)],
  ['globalHeight', round(points[0]?.relAlt ?? 50, 1)],
  ['caliFlightEnable', 0],
  ['gimbalPitchMode', 'usePointSetting'],
  ['globalWaypointTurnMode', 'toPointAndStopWithDiscontinuityCurvature'],
  ['globalUseStraightLine', smooth ? 0 : 1],
])}
${placemarks(false)}
    </Folder>
  </Document>
</kml>
`;

  const waylinesWpml = `${head}
${config}
    <Folder>
${tags('      ', [
  ['templateId', 0],
  ['executeHeightMode', 'relativeToStartPoint'],
  ['waylineId', 0],
  ['distance', round(path.length, 1)],
  ['duration', round(path.duration, 1)],
  ['autoFlightSpeed', round(mission.settings.speed, 1)],
])}
${placemarks(true)}
    </Folder>
  </Document>
</kml>
`;

  return { data: { templateKml, waylinesWpml }, warnings };
}

/** A DJI Pilot 2 / FlightHub 2 compatible .kmz archive. */
export function exportDjiKmz(
  mission: Mission,
  opts: DjiExportOptions = {},
): ExportResult<Uint8Array> {
  const { data, warnings } = buildWpml(mission, opts);
  const mtime = new Date(opts.now ?? Date.now());
  const zip = zipSync(
    {
      'wpmz/template.kml': [strToU8(data.templateKml), { mtime }],
      'wpmz/waylines.wpml': [strToU8(data.waylinesWpml), { mtime }],
    },
    { level: 6 },
  );
  return { data: zip, warnings };
}
