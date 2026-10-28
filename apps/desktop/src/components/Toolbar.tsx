import { createMission, parseMission, serializeMission } from '@odc/core';
import {
  IMPORT_EXTENSIONS,
  importHome,
  importMissionFile,
  importedToMission,
} from '@odc/exporters';
import { useStore, type Mode } from '../store';
import { openBinaryFile, saveFile } from '../platform';
import { activeScene } from './GlobeView';
import { useView } from '../viewStore';

const MODES: { value: Mode; label: string; key: string }[] = [
  { value: 'select', label: 'Select', key: 'V' },
  { value: 'addWaypoint', label: 'Waypoint', key: 'W' },
  { value: 'addPoi', label: 'POI', key: 'P' },
  { value: 'setTakeoff', label: 'Takeoff', key: 'T' },
];

const FILTERS = [{ name: 'OpenDroneCinematic mission', extensions: ['json'] }];
const OPEN_FILTERS = [
  { name: 'Missions', extensions: ['json', ...IMPORT_EXTENSIONS] },
  ...FILTERS,
  { name: 'Litchi CSV', extensions: ['csv'] },
  { name: 'DJI KMZ / WPML', extensions: ['kmz', 'kml', 'wpml'] },
  { name: 'QGroundControl plan', extensions: ['plan'] },
  { name: 'Mission Planner waypoints', extensions: ['waypoints', 'txt'] },
];

/** Read another app's mission file, sampling the ground so heights land where they should. */
async function importMission(name: string, data: Uint8Array) {
  const plan = importMissionFile(name, data);
  const home = importHome(plan);
  const ground = (await activeScene?.sampleGround([home, ...plan.waypoints])) ?? [];
  const st = useStore.getState();
  const mission = importedToMission(plan, st.mission, {
    home: ground[0] ?? 0,
    waypoints: ground.slice(1),
  });
  mission.name = name.replace(/\.[^.]+$/, '');
  return { mission, plan };
}

export function Toolbar({
  onExport,
  onSettings,
}: {
  onExport: () => void;
  onSettings: () => void;
}) {
  const mode = useStore((s) => s.mode);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const { setMode, undo, redo, setMission, notify, focusMission } = useStore.getState();
  const fly = useView((s) => s.fly);
  const main = useView((s) => s.main);
  const rendering = useView((s) => !!s.render);

  const newMission = () => {
    const m = useStore.getState().mission;
    if (
      m.waypoints.length &&
      !confirm('Start a new mission? The current plan stays in undo history.')
    )
      return;
    setMission(createMission(m.takeoff, m.droneProfileId));
    useStore.getState().setTime(0);
  };

  const open = async () => {
    try {
      const file = await openBinaryFile(OPEN_FILTERS);
      if (!file) return;
      if (file.name.toLowerCase().endsWith('.json')) {
        setMission(parseMission(new TextDecoder().decode(file.data)));
      } else {
        const { mission, plan } = await importMission(file.name, file.data);
        setMission(mission);
        const extra = plan.warnings.length ? ` ${plan.warnings.join(' ')}` : '';
        notify(`Imported ${plan.waypoints.length} waypoints from ${plan.format}.${extra}`);
      }
      useStore.getState().setTime(0);
      focusMission();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const save = async () => {
    const m = useStore.getState().mission;
    const name = `${m.name.replace(/[^\w-]+/g, '_') || 'mission'}.odc.json`;
    if (await saveFile(name, serializeMission(m), FILTERS)) notify('Mission saved.');
  };

  return (
    <div className="toolbar">
      <div className="brand">
        <img src="/icon.svg" alt="" />
        OpenDroneCinematic
      </div>
      <div className="group">
        <button onClick={newMission}>New</button>
        <button
          onClick={open}
          title="Open a mission, or import Litchi CSV, DJI KMZ, QGC .plan or Mission Planner files"
        >
          Open…
        </button>
        <button onClick={save}>Save…</button>
        <button className="primary" onClick={onExport}>
          Export…
        </button>
      </div>
      <div className="group">
        <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">
          ↷
        </button>
      </div>
      <div className="group segmented">
        {MODES.map((m) => (
          <button
            key={m.value}
            className={mode === m.value ? 'active' : ''}
            onClick={() => setMode(m.value)}
            title={`${m.label} (${m.key})`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="group">
        <button
          className={fly ? 'active' : ''}
          disabled={rendering}
          onClick={() => useView.getState().setFly(!fly)}
          title="Fly the drone to scout and capture waypoints (F, Esc to exit)"
        >
          ✈ {fly ? 'Flying' : 'Fly'}
        </button>
        <button
          disabled={fly}
          onClick={() => useView.getState().swap()}
          title="Swap main view and mini-screen (Tab)"
        >
          {main === 'map' ? '🎥 Camera view' : '🗺 Map view'}
        </button>
      </div>
      <div className="spacer" />
      <div className="group">
        <button onClick={focusMission} title="Fly to mission">
          ⌖
        </button>
        <button onClick={onSettings}>Map data</button>
      </div>
    </div>
  );
}
