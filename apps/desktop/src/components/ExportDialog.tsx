import { useEffect, useMemo, useState } from 'react';
import { missionProfile } from '@odc/core';
import { exporterDefaults, type ExportResult, type ExporterValue } from '@odc/exporters';
import { useStore } from '../store';
import { saveFile } from '../platform';
import { exportPlugins } from '../exportPlugins';
import { useAirspace, useAirspaceConflicts } from '../airspaceStore';
import { Field, NumberInput, Select } from './fields';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const mission = useStore((s) => s.mission);
  const profile = missionProfile(mission);
  const formats = useMemo(() => exportPlugins.list(), []);
  const [format, setFormat] = useState<string>(profile.exportFormats[0] ?? formats[0]!.id);
  const plugin = exportPlugins.get(format);
  const [densify, setDensify] = useState(false);
  const [spacing, setSpacing] = useState(10);
  const [values, setValues] = useState<Record<string, ExporterValue>>(() =>
    exporterDefaults(plugin),
  );
  const request = useMemo(
    () => ({ mission, format, densify: densify ? spacing : 0, values }),
    [mission, format, densify, spacing, values],
  );
  const [prepared, setPrepared] = useState<{
    request: typeof request;
    result?: ExportResult<string | Uint8Array>;
    error?: string;
  }>();
  const [saveError, setSaveError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const pending = prepared?.request !== request;
  const preview = pending ? undefined : prepared?.result;
  const error = saveError ?? (pending ? undefined : prepared?.error);
  const layer = useAirspace((s) => s.layer);
  const crossings = useAirspaceConflicts();
  const zoomed = mission.waypoints.some(
    (w) => w.zoomLock || (w.focalMm !== undefined && w.focalMm !== profile.equivalentFocalMm),
  );
  const unsupported = plugin.profileFormat && !profile.exportFormats.includes(plugin.profileFormat);

  // Async extensions can finish out of order. Never show/save the previous request's bytes.
  useEffect(() => {
    let active = true;
    setSaveError(undefined);
    void exportPlugins
      .run(request.format, request.mission, { densify: request.densify }, request.values)
      .then(
        (result) => {
          if (active) setPrepared({ request, result });
        },
        (error) => {
          if (active)
            setPrepared({ request, error: error instanceof Error ? error.message : String(error) });
        },
      );
    return () => {
      active = false;
    };
  }, [request]);

  const save = async () => {
    if (!preview || pending || saving) return;
    setSaving(true);
    try {
      const base = mission.name.replace(/[^\w-]+/g, '_') || 'mission';
      const ok = await saveFile(`${base}.${plugin.extension}`, preview.data, [
        { name: plugin.name, extensions: [plugin.extension] },
      ]);
      if (ok) {
        useStore.getState().notify(`Exported ${plugin.name}.`);
        onClose();
      }
    } catch (error) {
      setSaveError(
        `Could not save export: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="export-title">Export mission</h2>
        <fieldset disabled={saving} className="export-options">
          <Field label="Format">
            <Select
              value={format}
              options={formats.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(id) => {
                setFormat(id);
                setValues(exporterDefaults(exportPlugins.get(id)));
                setDensify(false);
              }}
            />
          </Field>
          <p className="muted">{plugin.description}</p>
          {(plugin.options ?? []).map((option) => (
            <Field key={option.id} label={option.label}>
              {option.type === 'select' ? (
                <Select
                  value={String(values[option.id])}
                  options={[...option.choices]}
                  onChange={(v) => setValues((s) => ({ ...s, [option.id]: v }))}
                />
              ) : option.type === 'number' ? (
                <NumberInput
                  value={Number(values[option.id])}
                  min={option.min}
                  max={option.max}
                  step={option.step}
                  onChange={(v) => setValues((s) => ({ ...s, [option.id]: v }))}
                />
              ) : (
                <input
                  type="checkbox"
                  checked={Boolean(values[option.id])}
                  onChange={(e) => setValues((s) => ({ ...s, [option.id]: e.target.checked }))}
                />
              )}
            </Field>
          ))}
          {plugin.supportsDensify && (
            <label className="check">
              <input
                type="checkbox"
                checked={densify}
                onChange={(e) => setDensify(e.target.checked)}
              />
              Match preview exactly (densify the path with baked camera angles)
            </label>
          )}
          {densify && (
            <Field label="Point spacing">
              <NumberInput value={spacing} min={1} suffix="m" onChange={setSpacing} />
            </Field>
          )}
        </fieldset>
        {unsupported && (
          <p className="note">{profile.name} is not usually flown with this format.</p>
        )}
        {!plugin.profileFormat && (
          <p className="note">
            Extension exporter: aircraft compatibility is unverified. Validate the file in the
            target app before flying.
          </p>
        )}
        {zoomed && (
          <p className="note">
            Zoom is preview-only: the exported mission keeps the {profile.equivalentFocalMm} mm main
            camera. Set the zoom on the remote during the flight.
          </p>
        )}
        <p className="note">
          {layer
            ? crossings.pending
              ? 'Airspace route check in progress.'
              : crossings.error
                ? 'Airspace check unavailable.'
                : `${crossings.conflicts.length} potential horizontal airspace crossing(s) in ${layer.fileName}.`
            : 'No airspace file loaded.'}{' '}
          Check Safety and official airspace/NOTAM sources before flying. Exports do not grant
          permission.
        </p>
        {pending && <p role="status">Preparing export…</p>}
        {error && (
          <p className="note" role="alert">
            {error}
          </p>
        )}
        {!!preview?.warnings.length && (
          <ul className="issues">
            {preview.warnings.map((w, i) => (
              <li key={i} className="warning">
                {w}
              </li>
            ))}
          </ul>
        )}
        <div className="button-row end">
          <button disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={!preview || pending || saving || mission.waypoints.length < 2}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save file…'}
          </button>
        </div>
      </div>
    </div>
  );
}
