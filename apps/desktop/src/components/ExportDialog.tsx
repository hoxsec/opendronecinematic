import { useMemo, useState } from 'react';
import { missionProfile, type ExportFormat } from '@odc/core';
import {
  exportDjiKmz,
  exportLitchiCsv,
  exportMissionPlannerWaypoints,
  exportQgcPlan,
  type ExportResult,
  type Firmware,
} from '@odc/exporters';
import { useStore } from '../store';
import { saveFile } from '../platform';
import { Field, NumberInput, Select } from './fields';

type Format = ExportFormat;

const FORMATS: { value: Format; label: string; help: string }[] = [
  {
    value: 'litchi',
    label: 'Litchi CSV',
    help: 'Import in Litchi Mission Hub (set heading mode to Custom). Max 99 waypoints.',
  },
  {
    value: 'dji-kmz',
    label: 'DJI KMZ (WPML)',
    help: 'DJI Pilot 2 / FlightHub 2 for enterprise drones. DJI Fly needs the file-replace workaround (see docs).',
  },
  {
    value: 'qgc',
    label: 'QGroundControl .plan',
    help: 'PX4 and ArduPilot via QGroundControl (File → Open plan). Heights are relative to home.',
  },
  {
    value: 'mp-waypoints',
    label: 'Mission Planner .waypoints',
    help: 'ArduPilot via Mission Planner (Plan → Load WP file). Plain MAVLink mission text.',
  },
];

const FILES: Record<Format, { ext: string; name: string }> = {
  litchi: { ext: 'csv', name: 'Litchi CSV' },
  'dji-kmz': { ext: 'kmz', name: 'DJI KMZ' },
  qgc: { ext: 'plan', name: 'QGroundControl plan' },
  'mp-waypoints': { ext: 'waypoints', name: 'Mission Planner waypoints' },
};

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const mission = useStore((s) => s.mission);
  const profile = missionProfile(mission);
  const zoomed = mission.waypoints.some(
    (w) => w.zoomLock || (w.focalMm !== undefined && w.focalMm !== profile.equivalentFocalMm),
  );
  const [format, setFormat] = useState<Format>(profile.exportFormats[0] ?? 'litchi');
  const [densify, setDensify] = useState(false);
  const [spacing, setSpacing] = useState(10);
  const [firmware, setFirmware] = useState<Firmware>('px4');
  const opts = { densify: densify ? spacing : 0, firmware };

  const preview = useMemo((): ExportResult<string | Uint8Array | undefined> => {
    try {
      switch (format) {
        case 'litchi':
          return exportLitchiCsv(mission, opts);
        case 'dji-kmz':
          return exportDjiKmz(mission, opts);
        case 'qgc':
          return exportQgcPlan(mission, opts);
        case 'mp-waypoints':
          return exportMissionPlannerWaypoints(mission, opts);
      }
    } catch (e) {
      return { data: undefined, warnings: [e instanceof Error ? e.message : String(e)] };
    }
  }, [mission, format, densify, spacing, firmware]);

  const base = mission.name.replace(/[^\w-]+/g, '_') || 'mission';
  const save = async () => {
    if (!preview.data) return;
    const file = FILES[format];
    const ok = await saveFile(`${base}.${file.ext}`, preview.data, [
      { name: file.name, extensions: [file.ext] },
    ]);
    if (ok) {
      useStore.getState().notify(`Exported ${FORMATS.find((f) => f.value === format)!.label}.`);
      onClose();
    }
  };

  const unsupported = !profile.exportFormats.includes(format);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Export mission</h2>
        <Field label="Format">
          <Select value={format} options={FORMATS} onChange={setFormat} />
        </Field>
        <p className="muted">{FORMATS.find((f) => f.value === format)!.help}</p>
        {format === 'qgc' && (
          <Field label="Autopilot">
            <Select<Firmware>
              value={firmware}
              options={[
                { value: 'px4', label: 'PX4' },
                { value: 'ardupilot', label: 'ArduPilot' },
              ]}
              onChange={setFirmware}
            />
          </Field>
        )}
        <label className="check">
          <input type="checkbox" checked={densify} onChange={(e) => setDensify(e.target.checked)} />
          Match preview exactly (densify the path with baked camera angles)
        </label>
        {densify && (
          <Field label="Point spacing">
            <NumberInput value={spacing} min={1} suffix="m" onChange={setSpacing} />
          </Field>
        )}
        {unsupported && (
          <p className="note">{profile.name} is not usually flown with this format.</p>
        )}
        {zoomed && (
          <p className="note">
            Zoom is preview-only: the exported mission keeps the {profile.equivalentFocalMm} mm main
            camera. Set the zoom on the remote during the flight.
          </p>
        )}
        {preview.warnings.length > 0 && (
          <ul className="issues">
            {preview.warnings.map((w) => (
              <li key={w} className="warning">
                {w}
              </li>
            ))}
          </ul>
        )}
        <div className="button-row end">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={!preview.data || mission.waypoints.length < 2}
            onClick={save}
          >
            Save file…
          </button>
        </div>
      </div>
    </div>
  );
}
