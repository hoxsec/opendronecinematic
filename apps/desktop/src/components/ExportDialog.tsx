import { useMemo, useState } from 'react';
import { missionProfile } from '@odc/core';
import { exportDjiKmz, exportLitchiCsv } from '@odc/exporters';
import { useStore } from '../store';
import { saveFile } from '../platform';
import { Field, NumberInput, Select } from './fields';

type Format = 'litchi' | 'dji-kmz';

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
];

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const mission = useStore((s) => s.mission);
  const profile = missionProfile(mission);
  const [format, setFormat] = useState<Format>(
    profile.exportFormats.includes('litchi') ? 'litchi' : 'dji-kmz',
  );
  const [densify, setDensify] = useState(false);
  const [spacing, setSpacing] = useState(10);
  const opts = { densify: densify ? spacing : 0 };

  const preview = useMemo(() => {
    try {
      return format === 'litchi' ? exportLitchiCsv(mission, opts) : exportDjiKmz(mission, opts);
    } catch (e) {
      return { data: undefined, warnings: [e instanceof Error ? e.message : String(e)] };
    }
  }, [mission, format, densify, spacing]);

  const base = mission.name.replace(/[^\w-]+/g, '_') || 'mission';
  const save = async () => {
    if (!preview.data) return;
    const ok =
      format === 'litchi'
        ? await saveFile(`${base}.csv`, preview.data, [{ name: 'Litchi CSV', extensions: ['csv'] }])
        : await saveFile(`${base}.kmz`, preview.data, [{ name: 'DJI KMZ', extensions: ['kmz'] }]);
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
