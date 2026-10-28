import { createMission, parseMission, serializeMission } from '@odc/core';
import {
  IMPORT_EXTENSIONS,
  importHome,
  importMissionFile,
  importedToMission,
} from '@odc/exporters';
import { useEffect, useRef, useState } from 'react';
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
  const layout = useView((s) => s.layout);
  const splitDir = useView((s) => s.splitDir);
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
          title={layout === 'split' ? 'Swap sides (Tab)' : 'Swap main view and mini-screen (Tab)'}
        >
          {layout === 'split' ? '⇄ Swap' : main === 'map' ? '🎥 Camera view' : '🗺 Map view'}
        </button>
        <button
          className={layout === 'split' ? 'active' : ''}
          onClick={() => useView.getState().setLayout(layout === 'split' ? 'pip' : 'split')}
          title="Show map and camera side by side, or as main view + mini-screen (L)"
        >
          {layout === 'split' ? '◫ Split' : '▣ Mini-screen'}
        </button>
        {layout === 'split' && (
          <button
            onClick={() => useView.getState().setSplitDir(splitDir === 'row' ? 'column' : 'row')}
            title={splitDir === 'row' ? 'Stack top and bottom' : 'Place left and right'}
          >
            {splitDir === 'row' ? '⬌' : '⬍'}
          </button>
        )}
      </div>
      <div className="spacer" />
      <div className="group">
        <ZoomMenu />
        <button onClick={focusMission} title="Fly to mission">
          ⌖
        </button>
        <button onClick={onSettings}>Map data</button>
      </div>
    </div>
  );
}

const ZOOM_PRESETS = [
  { label: 'Slow', speed: 0.4 },
  { label: 'Normal', speed: 1 },
  { label: 'Fast', speed: 2.5 },
];
/** The slider is logarithmic so slow and fast get the same travel. */
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 5;

/** Map mouse-wheel zoom speed and inertia. */
function ZoomMenu() {
  const zoom = useView((s) => s.zoom);
  const { setZoom } = useView.getState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const toSlider = (v: number) => Math.log(v / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN);
  const fromSlider = (t: number) => Math.round(ZOOM_MIN * (ZOOM_MAX / ZOOM_MIN) ** t * 100) / 100;
  return (
    <div className="zoom-menu" ref={ref}>
      <button
        className={open ? 'active' : ''}
        onClick={() => setOpen(!open)}
        title="Map wheel zoom speed"
      >
        🔍 {zoom.speed}×{zoom.snappy ? ' ⚡' : ''}
      </button>
      {open && (
        <div className="zoom-pop">
          <div className="group segmented">
            {ZOOM_PRESETS.map((p) => (
              <button
                key={p.label}
                className={zoom.speed === p.speed ? 'active' : ''}
                onClick={() => setZoom({ speed: p.speed })}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={toSlider(zoom.speed)}
            onChange={(e) => setZoom({ speed: fromSlider(Number(e.target.value)) })}
            aria-label="Zoom speed"
          />
          <label title="Stop as soon as the wheel stops instead of coasting">
            <input
              type="checkbox"
              checked={zoom.snappy}
              onChange={(e) => setZoom({ snappy: e.target.checked })}
            />
            Snappy (no coasting)
          </label>
        </div>
      )}
    </div>
  );
}
