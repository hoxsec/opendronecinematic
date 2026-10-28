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
import { Field, NumberInput, Section, Select } from './fields';

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
            className={wp.id === selectedId ? 'selected' : ''}
            onClick={() => select(wp.id)}
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
      {selected && <WaypointEditor wp={selected} index={mission.waypoints.indexOf(selected)} />}
    </Section>
  );
}

function WaypointEditor({ wp, index }: { wp: Waypoint; index: number }) {
  const mission = useStore((s) => s.mission);
  const { updateWaypoint, setTime } = useStore.getState();
  const path = usePath();
  const up = (patch: Partial<Waypoint>) => updateWaypoint(wp.id, patch);
  const hover = wp.actions.find((a) => a.type === 'hover');
  const has = (t: WaypointAction['type']) => wp.actions.some((a) => a.type === t);
  const toggle = (t: 'photo' | 'startRecording' | 'stopRecording') =>
    up({ actions: has(t) ? wp.actions.filter((a) => a.type !== t) : [...wp.actions, { type: t }] });
  const setHover = (seconds: number) =>
    up({
      actions: [
        ...wp.actions.filter((a) => a.type !== 'hover'),
        ...(seconds > 0 ? [{ type: 'hover' as const, seconds }] : []),
      ],
    });
  const interval = wp.actions.find((a) => a.type === 'photoDistance');
  const setInterval = (meters: number) =>
    up({
      actions: [
        ...wp.actions.filter((a) => a.type !== 'photoDistance'),
        { type: 'photoDistance' as const, meters: Math.max(0, meters) },
      ],
    });
  const needsPoi = (wp.heading === 'poi' || wp.gimbal === 'poi') && mission.pois.length === 0;

  return (
    <div className="editor">
      <header>
        <h3>Waypoint {index + 1}</h3>
        <button onClick={() => setTime(path.timings[index]?.arrive ?? 0)}>View camera</button>
      </header>
      <p className="mono muted">
        {wp.lat.toFixed(6)}, {wp.lon.toFixed(6)}
      </p>
      <div className="grid2">
        <Field label={altLabel[mission.altitudeMode]}>
          <NumberInput value={wp.alt} suffix="m" onChange={(alt) => up({ alt })} />
        </Field>
        <Field label="Speed">
          <NumberInput
            value={wp.speed ?? mission.settings.speed}
            step={0.5}
            min={0.5}
            suffix="m/s"
            onChange={(speed) => up({ speed })}
          />
        </Field>
        <Field label="Heading">
          <Select value={wp.heading} options={HEADINGS} onChange={(heading) => up({ heading })} />
        </Field>
        {wp.heading === 'fixed' ? (
          <Field label="Heading °">
            <NumberInput
              value={wp.headingDeg ?? 0}
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
          <Select value={wp.gimbal} options={GIMBALS} onChange={(gimbal) => up({ gimbal })} />
        </Field>
        {wp.gimbal === 'fixed' ? (
          <Field label="Pitch">
            <NumberInput
              value={wp.gimbalPitch ?? mission.settings.gimbalPitch}
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
      {(wp.heading === 'poi' || wp.gimbal === 'poi') && mission.pois.length > 0 && (
        <Field label="POI">
          <Select
            value={wp.poiId ?? mission.pois[0]!.id}
            options={mission.pois.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(poiId) => up({ poiId })}
          />
        </Field>
      )}
      {needsPoi && (
        <p className="note">
          Add a POI for this waypoint to face; until then it behaves as “along path”.
        </p>
      )}
      <ZoomEditor wp={wp} index={index} up={up} />
      <div className="grid2">
        <Field label="Hover">
          <NumberInput
            value={hover?.type === 'hover' ? hover.seconds : 0}
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
            value={interval?.type === 'photoDistance' ? interval.meters : undefined}
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
            onChange={() => toggle('startRecording')}
          />{' '}
          Start rec
        </label>
        <label>
          <input
            type="checkbox"
            checked={has('stopRecording')}
            onChange={() => toggle('stopRecording')}
          />{' '}
          Stop rec
        </label>
        <label>
          <input type="checkbox" checked={has('photo')} onChange={() => toggle('photo')} /> Photo
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
