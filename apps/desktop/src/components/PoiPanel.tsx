import { useStore } from '../store';
import { Field, NumberInput, Section } from './fields';

export function PoiPanel() {
  const mission = useStore((s) => s.mission);
  const selectedId = useStore((s) => s.selectedId);
  const mode = useStore((s) => s.mode);
  const { select, removePoi, updatePoi, setMode } = useStore.getState();
  const ground = mission.takeoff.groundHeight;

  return (
    <Section
      title={`Points of interest (${mission.pois.length})`}
      actions={
        <button
          className={mode === 'addPoi' ? 'active' : ''}
          onClick={() => setMode(mode === 'addPoi' ? 'select' : 'addPoi')}
        >
          {mode === 'addPoi' ? 'Cancel' : '+ Add'}
        </button>
      }
    >
      {mission.pois.length === 0 && (
        <p className="muted">
          A POI is what the camera locks onto: a building, a person, a summit.
        </p>
      )}
      <ul className="list">
        {mission.pois.map((poi) => (
          <li
            key={poi.id}
            className={poi.id === selectedId ? 'selected' : ''}
            onClick={() => select(poi.id)}
          >
            <b className="poi-dot">◆</b>
            <span>{poi.name}</span>
            <span className="row-actions">
              <button title="Delete" onClick={(e) => (e.stopPropagation(), removePoi(poi.id))}>
                ✕
              </button>
            </span>
          </li>
        ))}
      </ul>
      {mission.pois
        .filter((p) => p.id === selectedId)
        .map((poi) => (
          <div className="editor" key={poi.id}>
            <div className="grid2">
              <Field label="Name">
                <input
                  value={poi.name}
                  onChange={(e) => updatePoi(poi.id, { name: e.target.value }, { history: false })}
                />
              </Field>
              <Field label="Aim height" hint="Height of the aim point above the takeoff ground.">
                <NumberInput
                  value={Math.round((poi.height - ground) * 10) / 10}
                  suffix="m"
                  onChange={(v) => updatePoi(poi.id, { height: ground + v })}
                />
              </Field>
            </div>
          </div>
        ))}
    </Section>
  );
}
