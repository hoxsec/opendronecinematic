import { useStore } from '../store';
import { useView } from '../viewStore';
import { locateOnMap } from '../plannerActions';
import { Field, NumberInput, TextInput } from './fields';
import { Icon } from './Icon';

export function PoiPanel() {
  const pois = useStore((s) => s.mission.pois);
  const selectedId = useStore((s) => s.selectedId);
  const mode = useStore((s) => s.mode);
  const { select, setMode } = useStore.getState();
  return (
    <details className="outline-pois" open>
      <summary>
        Points of interest <span className="count-badge">{pois.length}</span>
      </summary>
      <div className="poi-list">
        {pois.map((poi) => (
          <button
            key={poi.id}
            className={poi.id === selectedId ? 'selected' : ''}
            aria-pressed={poi.id === selectedId}
            onClick={() => {
              select(poi.id);
              useView.getState().setInspectorOpen(true);
            }}
            onDoubleClick={() => locateOnMap(poi.id)}
          >
            <Icon name="pin" size={15} />
            <span className="ellipsis">{poi.name}</span>
          </button>
        ))}
      </div>
      <button
        className="quiet poi-add"
        onClick={() => setMode(mode === 'addPoi' ? 'select' : 'addPoi')}
      >
        <Icon name="plus" size={14} />
        {mode === 'addPoi' ? 'Done placing POIs' : 'Add point of interest'}
      </button>
    </details>
  );
}

export function PoiInspector() {
  const mission = useStore((s) => s.mission);
  const selectedId = useStore((s) => s.selectedId);
  const fly = useView((s) => s.fly);
  const poi = mission.pois.find((p) => p.id === selectedId);
  const { updatePoi, removePoi } = useStore.getState();
  if (!poi) return null;
  return (
    <section className="panel poi-inspector">
      <span className="eyebrow">POINT OF INTEREST</span>
      <h3>{poi.name}</h3>
      <div className="button-row">
        <button disabled={fly} onClick={() => locateOnMap(poi.id)}>
          <Icon name="target" size={15} /> Locate on map
        </button>
      </div>
      <Field label="POI name">
        <TextInput key={poi.id} value={poi.name} onChange={(name) => updatePoi(poi.id, { name })} />
      </Field>
      <Field label="Aim height" hint="Height of the aim point above the takeoff ground.">
        <NumberInput
          value={Math.round((poi.height - mission.takeoff.groundHeight) * 10) / 10}
          suffix="m"
          onChange={(v) => updatePoi(poi.id, { height: mission.takeoff.groundHeight + v })}
        />
      </Field>
      <p className="muted small">
        Assign this subject in a waypoint’s camera orientation settings.
      </p>
      <button className="quiet delete-selection" onClick={() => removePoi(poi.id)}>
        <Icon name="trash" size={15} /> Delete point of interest
      </button>
    </section>
  );
}
