import { createMission, parseMission, serializeMission } from '@odc/core';
import { useStore, type Mode } from '../store';
import { openTextFile, saveFile } from '../platform';

const MODES: { value: Mode; label: string; key: string }[] = [
  { value: 'select', label: 'Select', key: 'V' },
  { value: 'addWaypoint', label: 'Waypoint', key: 'W' },
  { value: 'addPoi', label: 'POI', key: 'P' },
  { value: 'setTakeoff', label: 'Takeoff', key: 'T' },
];

const FILTERS = [{ name: 'OpenDroneCinematic mission', extensions: ['json'] }];

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
      const text = await openTextFile(FILTERS);
      if (!text) return;
      setMission(parseMission(text));
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
        <button onClick={open}>Open…</button>
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
