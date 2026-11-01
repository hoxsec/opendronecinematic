import { exportDjiKmz } from './dji-wpml';
import { exportLitchiCsv } from './litchi';
import { exportMissionPlannerWaypoints, exportQgcPlan, type Firmware } from './mavlink';
import { ExporterRegistry, type ExporterPlugin } from './registry';

export const BUILTIN_EXPORTERS: readonly ExporterPlugin[] = [
  {
    apiVersion: 1,
    id: 'litchi',
    name: 'Litchi CSV',
    extension: 'csv',
    profileFormat: 'litchi',
    supportsDensify: true,
    description: 'Import in Litchi Mission Hub (set heading mode to Custom). Max 99 waypoints.',
    export: exportLitchiCsv,
  },
  {
    apiVersion: 1,
    id: 'dji-kmz',
    name: 'DJI KMZ (WPML)',
    extension: 'kmz',
    profileFormat: 'dji-kmz',
    supportsDensify: true,
    description:
      'DJI Pilot 2 / FlightHub 2 for enterprise drones. DJI Fly needs the file-replace workaround (see docs).',
    export: exportDjiKmz,
  },
  {
    apiVersion: 1,
    id: 'qgc',
    name: 'QGroundControl .plan',
    extension: 'plan',
    profileFormat: 'qgc',
    supportsDensify: true,
    description:
      'PX4 and ArduPilot via QGroundControl (File → Open plan). Heights are relative to home.',
    options: [
      {
        id: 'firmware',
        label: 'Autopilot',
        type: 'select',
        default: 'px4',
        choices: [
          { value: 'px4', label: 'PX4' },
          { value: 'ardupilot', label: 'ArduPilot' },
        ],
      },
    ],
    export: (mission, options, values) =>
      exportQgcPlan(mission, { ...options, firmware: values.firmware as Firmware }),
  },
  {
    apiVersion: 1,
    id: 'mp-waypoints',
    name: 'Mission Planner .waypoints',
    extension: 'waypoints',
    profileFormat: 'mp-waypoints',
    supportsDensify: true,
    description: 'ArduPilot via Mission Planner (Plan → Load WP file). Plain MAVLink mission text.',
    export: exportMissionPlannerWaypoints,
  },
];

/** Each host owns its registry; no global registration side effects. */
export function createBuiltinExporterRegistry() {
  const registry = new ExporterRegistry();
  for (const plugin of BUILTIN_EXPORTERS) registry.register(plugin);
  return registry;
}
