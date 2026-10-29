import {
  focalRange,
  lensAt,
  type GimbalMode,
  type HeadingMode,
  type Waypoint,
  type WaypointAction,
} from '@odc/core';
import { useStore } from '../store';
import { useCamera, usePath } from '../derived';
import { Field, NumberInput, Section } from './fields';

const HEADINGS: { value: HeadingMode; label: string }[] = [
  { value: 'auto', label: 'Along path' },
  { value: 'poi', label: 'Face POI' },
  { value: 'fixed', label: 'Fixed' },
];
const GIMBALS: { value: GimbalMode; label: string }[] = [
  { value: 'fixed', label: 'Fixed pitch' },
  { value: 'poi', label: 'Track POI' },
];

const altLabel = {
  relativeToTakeoff: 'Alt (takeoff)',
  AGL: 'Alt (AGL)',
  ellipsoid: 'Alt (ellipsoid)',
} as const;

export function WaypointPanel() {
  const mission = useStore((s) => s.mission);
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedWaypointIds);
  const { select, removeWaypoint, moveWaypoint, setMode } = useStore.getState();
  const mode = useStore((s) => s.mode);
  const selected = mission.waypoints.find((w) => w.id === selectedId);

  return (
    <Section
      title={`Waypoints (${mission.waypoints.length})`}
      actions={
        <button
          className={mode === 'addWaypoint' ? 'active' : ''}
          onClick={() => setMode(mode === 'addWaypoint' ? 'select' : 'addWaypoint')}
        >
          {mode === 'addWaypoint' ? 'Done' : '+ Add'}
        </button>
      }
    >
      {mission.waypoints.length === 0 && (
        <p className="muted">Click “+ Add”, then click the globe to place waypoints.</p>
      )}
      <ol className="list">
        {mission.waypoints.map((wp, i) => (
          <li
            key={wp.id}
            className={selectedIds.includes(wp.id) ? 'selected' : ''}
            onClick={(e) => select(wp.id, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey })}
          >
            <b>{i + 1}</b>
            <span>
              {wp.alt.toFixed(0)} m · {(wp.speed ?? mission.settings.speed).toFixed(1)} m/s
              {wp.heading === 'poi' && ' · POI'}
              {wp.actions.length > 0 && ` · ${wp.actions.length} act`}
            </span>
            <span className="row-actions">
              <button
                title="Move up"
                onClick={(e) => (e.stopPropagation(), moveWaypoint(wp.id, -1))}
              >
                ↑
              </button>
              <button
                title="Move down"
                onClick={(e) => (e.stopPropagation(), moveWaypoint(wp.id, 1))}
              >
                ↓
              </button>
              <button title="Delete" onClick={(e) => (e.stopPropagation(), removeWaypoint(wp.id))}>
                ✕
              </button>
            </span>
          </li>
        ))}
      </ol>
      {mission.waypoints.length > 1 && (
        <p className="muted small">Ctrl-click to toggle · Shift-click to select a range</p>
      )}
      {selected && (
        <WaypointEditor
          wp={selected}
          index={mission.waypoints.indexOf(selected)}
          ids={selectedIds}
        />
      )}
    </Section>
  );
}

function WaypointEditor({ wp, index, ids }: { wp: Waypoint; index: number; ids: string[] }) {
  const mission = useStore((s) => s.mission);
  const { updateWaypoints, setTime } = useStore.getState();
  const { profile } = useCamera();
  const [minFocal, maxFocal] = focalRange(profile);
  const path = usePath();
  const targets = mission.waypoints.filter((w) => ids.includes(w.id));
  const bulk = targets.length > 1;
  const common = <T,>(read: (w: Waypoint) => T): T | undefined => {
    const value = read(targets[0] ?? wp);
    return targets.every((w) => Object.is(read(w), value)) ? value : undefined;
  };
  const up = (patch: Partial<Waypoint>) => updateWaypoints(ids.length ? ids : [wp.id], patch);
  const has = (t: WaypointAction['type']) =>
    targets.every((w) => w.actions.some((a) => a.type === t));
  const mixed = (t: WaypointAction['type']) =>
    !has(t) && targets.some((w) => w.actions.some((a) => a.type === t));
  const toggle = (t: 'photo' | 'startRecording' | 'stopRecording') =>
    updateWaypoints(ids, (w) => ({
      actions: has(t)
        ? w.actions.filter((a) => a.type !== t)
        : [...w.actions.filter((a) => a.type !== t), { type: t }],
    }));
  const setHover = (seconds: number) =>
    updateWaypoints(ids, (w) => ({
      actions: [
        ...w.actions.filter((a) => a.type !== 'hover'),
        ...(seconds > 0 ? [{ type: 'hover' as const, seconds }] : []),
      ],
    }));
  const setInterval = (meters: number) =>
    updateWaypoints(ids, (w) => ({
      actions: [
        ...w.actions.filter((a) => a.type !== 'photoDistance'),
        { type: 'photoDistance' as const, meters: Math.max(0, meters) },
      ],
    }));
  const needsPoi =
    targets.some((w) => w.heading === 'poi' || w.gimbal === 'poi') && mission.pois.length === 0;

  return (
    <div className="editor">
      <header>
        <h3>{bulk ? `${targets.length} waypoints selected` : `Waypoint ${index + 1}`}</h3>
        <button onClick={() => setTime(path.timings[index]?.arrive ?? 0)}>View camera</button>
      </header>
      {bulk ? (
        <p className="note">
          Changes apply to all selected waypoints. “Mixed” means their values differ; untouched
          settings are preserved.
        </p>
      ) : (
        <p className="mono muted">
          {wp.lat.toFixed(6)}, {wp.lon.toFixed(6)}
        </p>
      )}
      <div className="grid2">
        <Field label={altLabel[mission.altitudeMode]}>
          <NumberInput
            value={common((w) => w.alt)}
            placeholder="Mixed"
            suffix="m"
            onChange={(alt) => up({ alt })}
          />
        </Field>
        <Field label="Speed">
          <NumberInput
            value={common((w) => w.speed ?? mission.settings.speed)}
            placeholder="Mixed"
            step={0.5}
            min={0.5}
            suffix="m/s"
            onChange={(speed) => up({ speed })}
          />
        </Field>
        <Field label="Heading">
          <select
            value={common((w) => w.heading) ?? ''}
            onChange={(e) => up({ heading: e.target.value as HeadingMode })}
          >
            <option value="" disabled>
              Mixed
            </option>
            {HEADINGS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </Field>
        {targets.some((w) => w.heading === 'fixed') ? (
          <Field label="Heading °">
            <NumberInput
              value={common((w) => w.headingDeg ?? 0)}
              placeholder="Mixed"
              min={0}
              max={359}
              suffix="°"
              onChange={(headingDeg) => up({ headingDeg })}
            />
          </Field>
        ) : (
          <span />
        )}
        <Field label="Gimbal">
          <select
            value={common((w) => w.gimbal) ?? ''}
            onChange={(e) => up({ gimbal: e.target.value as GimbalMode })}
          >
            <option value="" disabled>
              Mixed
            </option>
            {GIMBALS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>
        {targets.some((w) => w.gimbal === 'fixed') ? (
          <Field label="Pitch">
            <NumberInput
              value={common((w) => w.gimbalPitch ?? mission.settings.gimbalPitch)}
              placeholder="Mixed"
              min={-90}
              max={30}
              suffix="°"
              onChange={(gimbalPitch) => up({ gimbalPitch })}
            />
          </Field>
        ) : (
          <span />
        )}
      </div>
      {targets.some((w) => w.heading === 'poi' || w.gimbal === 'poi') &&
        mission.pois.length > 0 && (
          <Field label="POI">
            <select
              value={common((w) => w.poiId ?? mission.pois[0]!.id) ?? ''}
              onChange={(e) => up({ poiId: e.target.value })}
            >
              <option value="" disabled>
                Mixed
              </option>
              {mission.pois.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      {needsPoi && (
        <p className="note">
          Add a POI for this waypoint to face; until then it behaves as “along path”.
        </p>
      )}
      {bulk ? (
        <>
          <Field label="Zoom (35mm equivalent)">
            <NumberInput
              value={common((w) => w.focalMm ?? minFocal)}
              placeholder="Mixed"
              min={minFocal}
              max={maxFocal}
              suffix="mm"
              onChange={(focalMm) =>
                up({ focalMm: Math.max(minFocal, Math.min(maxFocal, focalMm)), zoomLock: false })
              }
            />
          </Field>
          <label className="check">
            <input
              type="checkbox"
              checked={targets.every((w) => !!w.zoomLock)}
              ref={(el) => {
                if (el) el.indeterminate = common((w) => !!w.zoomLock) === undefined;
              }}
              onChange={(e) => up({ zoomLock: e.target.checked })}
            />
            Keep subject size (dolly zoom)
          </label>
        </>
      ) : (
        <ZoomEditor wp={wp} index={index} up={up} />
      )}
      <div className="grid2">
        <Field label="Hover">
          <NumberInput
            value={common((w) => {
              const a = w.actions.find((a) => a.type === 'hover');
              return a?.type === 'hover' ? a.seconds : 0;
            })}
            placeholder="Mixed"
            min={0}
            suffix="s"
            onChange={setHover}
          />
        </Field>
        <Field
          label="Photo every"
          hint="Take a photo every N metres from this waypoint on; 0 stops. Empty = keep the previous setting."
        >
          <NumberInput
            value={common((w) => {
              const a = w.actions.find((a) => a.type === 'photoDistance');
              return a?.type === 'photoDistance' ? a.meters : undefined;
            })}
            placeholder={bulk ? 'Mixed / unchanged' : undefined}
            min={0}
            suffix="m"
            onChange={setInterval}
          />
        </Field>
      </div>
      <div className="chips">
        <label>
          <input
            type="checkbox"
            checked={has('startRecording')}
            ref={(el) => {
              if (el) el.indeterminate = mixed('startRecording');
            }}
            onChange={() => toggle('startRecording')}
          />{' '}
          Start rec
        </label>
        <label>
          <input
            type="checkbox"
            checked={has('stopRecording')}
            ref={(el) => {
              if (el) el.indeterminate = mixed('stopRecording');
            }}
            onChange={() => toggle('stopRecording')}
          />{' '}
          Stop rec
        </label>
        <label>
          <input
            type="checkbox"
            checked={has('photo')}
            ref={(el) => {
              if (el) el.indeterminate = mixed('photo');
            }}
            onChange={() => toggle('photo')}
          />{' '}
          Photo
        </label>
      </div>
    </div>
  );
}

/** Focal length at a waypoint: typed, slid (log scale), a lens preset, or locked to the subject. */
function ZoomEditor({
  wp,
  index,
  up,
}: {
  wp: Waypoint;
  index: number;
  up: (patch: Partial<Waypoint>) => void;
}) {
  const mission = useStore((s) => s.mission);
  const path = usePath();
  const { profile } = useCamera();
  const [fMin, fMax] = focalRange(profile);
  const arrive = path.timings[index]?.arrive;
  const actual = arrive === undefined ? undefined : path.sample(arrive)?.focalMm;
  const focal = wp.zoomLock ? (actual ?? fMin) : (wp.focalMm ?? fMin);
  const lens = lensAt(profile, focal);
  const canLock = index > 0 && mission.pois.length > 0;
  const toT = (mm: number) => Math.log(mm / fMin) / Math.log(fMax / fMin);
  const fromT = (t: number) => Math.round(fMin * (fMax / fMin) ** t);

  return (
    <div className="zoom-editor">
      <div className="grid2">
        <Field
          label="Zoom"
          hint={`35mm-equivalent focal length, ${fMin}-${fMax} mm on this drone. Eases from the previous waypoint.`}
        >
          <NumberInput
            value={Math.round(focal)}
            min={fMin}
            max={fMax}
            suffix="mm"
            onChange={(focalMm) => up({ focalMm, zoomLock: false })}
          />
        </Field>
        <span className="muted small zoom-info">
          {(focal / fMin).toFixed(1)}× ·{' '}
          {lens.digital > 1.01
            ? `${lens.lensMm} mm + ${lens.digital.toFixed(1)}× digital`
            : `${lens.lensMm} mm lens`}
        </span>
      </div>
      {fMax > fMin && (
        <input
          type="range"
          min={0}
          max={1}
          step={0.005}
          value={toT(focal)}
          disabled={wp.zoomLock}
          onChange={(e) => up({ focalMm: fromT(Number(e.target.value)), zoomLock: false })}
          aria-label="Zoom"
        />
      )}
      {(profile.lenses?.length ?? 0) > 1 && (
        <div className="button-row">
          {profile.lenses!.map((mm) => (
            <button
              key={mm}
              className={!wp.zoomLock && Math.round(focal) === mm ? 'active' : ''}
              onClick={() => up({ focalMm: mm, zoomLock: false })}
            >
              {mm} mm
            </button>
          ))}
        </div>
      )}
      {canLock && (
        <label
          className="check"
          title="Zoom on the way here so the POI keeps the size it had at the last waypoint without this: a dolly zoom"
        >
          <input
            type="checkbox"
            checked={!!wp.zoomLock}
            onChange={(e) => up({ zoomLock: e.target.checked })}
          />
          Keep subject size (dolly zoom)
        </label>
      )}
    </div>
  );
}
