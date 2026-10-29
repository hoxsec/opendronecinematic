import { useEffect, useRef, useState } from 'react';
import { useStore, type Mode } from '../store';
import { useView } from '../viewStore';
import { useProject } from '../projectStore';
import { Icon } from './Icon';

const MODES: { value: Mode; label: string; key: string }[] = [
  { value: 'select', label: 'Select', key: 'V' },
  { value: 'addWaypoint', label: 'Waypoint', key: 'W' },
  { value: 'addPoi', label: 'POI', key: 'P' },
  { value: 'setTakeoff', label: 'Takeoff', key: 'T' },
];

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
  const { setMode, undo, redo, focusMission } = useStore.getState();
  const name = useStore((s) => s.mission.name);
  const { dirty, savedAt, path, fileName, recoveryState, recoveryAt, busy, request, save } =
    useProject();
  const fly = useView((s) => s.fly);
  const main = useView((s) => s.main);
  const layout = useView((s) => s.layout);
  const splitDir = useView((s) => s.splitDir);
  const rendering = useView((s) => !!s.render);

  const status =
    busy === 'saving'
      ? 'Saving…'
      : dirty
        ? 'Unsaved changes'
        : savedAt || fileName
          ? path
            ? 'Saved to file'
            : 'Browser snapshot'
          : 'Not saved yet';
  const recovery = dirty
    ? recoveryState === 'error'
      ? 'Recovery unavailable'
      : recoveryState === 'pending'
        ? 'Updating recovery…'
        : recoveryState === 'saved'
          ? 'Recovery saved locally'
          : 'No recovery copy yet'
    : 'Portable .odc.json project';
  return (
    <header className="toolbar">
      <div className="project-bar">
        <button
          className="project-home-button quiet"
          onClick={() => void request({ kind: 'home' })}
          disabled={rendering || !!busy}
          title="Project home"
          aria-label="Project home"
        >
          <img src="/icon.svg" alt="" />
          <Icon name="home" size={16} />
          <span>Projects</span>
        </button>
        <div className="project-identity">
          <strong className="ellipsis" title={path ?? name}>
            {name || 'Untitled mission'}
          </strong>
          <span className="muted small ellipsis" title={path}>
            {path ?? fileName ?? 'Choose a file location when you save'}
          </span>
        </div>
        <div
          className="project-save-status"
          role="status"
          title={
            recoveryAt ? `Recovery updated ${new Date(recoveryAt).toLocaleTimeString()}` : undefined
          }
        >
          <span className={dirty ? 'unsaved' : 'clean'}>
            <i />
            {status}
          </span>
          <small>{recovery}</small>
        </div>
        <div className="group project-file-actions">
          <button
            onClick={() => void request({ kind: 'new' })}
            disabled={rendering || !!busy}
            title="New project (Ctrl+N)"
          >
            <Icon name="plus" size={16} />
            New
          </button>
          <button
            onClick={() => void request({ kind: 'open' })}
            disabled={rendering || !!busy}
            title="Open project or import mission (Ctrl+O)"
          >
            <Icon name="folder" size={16} />
            Open
          </button>
          <button onClick={() => void save()} disabled={!!busy} title="Save project (Ctrl+S)">
            <Icon name="save" size={16} />
            Save
          </button>
          <button
            className="quiet"
            onClick={() => void save(true)}
            disabled={!!busy}
            title="Save a new copy (Ctrl+Shift+S)"
          >
            Save as…
          </button>
          <button className="primary" onClick={onExport} disabled={rendering || !!busy}>
            <Icon name="export" size={16} />
            Export mission
          </button>
        </div>
      </div>
      <div className="tool-bar" aria-label="Planner tools">
        <div className="group tool-history">
          <button
            className="icon-button quiet"
            onClick={undo}
            disabled={!canUndo || rendering}
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
          >
            <Icon name="undo" size={17} />
          </button>
          <button
            className="icon-button quiet"
            onClick={redo}
            disabled={!canRedo || rendering}
            aria-label="Redo"
            title="Redo (Ctrl+Y)"
          >
            <Icon name="redo" size={17} />
          </button>
        </div>
        <span className="toolbar-divider" />
        <div className="group segmented">
          {MODES.map((m) => (
            <button
              key={m.value}
              className={mode === m.value ? 'active' : ''}
              disabled={fly || rendering}
              aria-pressed={mode === m.value}
              onClick={() => setMode(m.value)}
              title={`${m.label} (${m.key})`}
            >
              <Icon
                name={
                  m.value === 'select'
                    ? 'cursor'
                    : m.value === 'addWaypoint'
                      ? 'route'
                      : m.value === 'addPoi'
                        ? 'pin'
                        : 'home'
                }
                size={15}
              />
              {m.label}
            </button>
          ))}
        </div>
        <span className="toolbar-divider" />
        <div className="group">
          <button
            className={fly ? 'active' : ''}
            disabled={rendering}
            onClick={() => useView.getState().setFly(!fly)}
            title="Fly the drone to scout and capture waypoints (F, Esc to exit)"
          >
            <Icon name="fly" size={16} />
            {fly ? 'Flying' : 'Fly'}
          </button>
          <button
            disabled={fly}
            onClick={() => useView.getState().swap()}
            title={layout === 'split' ? 'Swap sides (Tab)' : 'Swap main view and mini-screen (Tab)'}
          >
            <Icon name={main === 'map' ? 'camera' : 'map'} size={16} />
            {layout === 'split' ? 'Swap views' : main === 'map' ? 'Camera view' : 'Map view'}
          </button>
          <button
            className={layout === 'split' ? 'active' : ''}
            onClick={() => useView.getState().setLayout(layout === 'split' ? 'pip' : 'split')}
            title="Show map and camera side by side, or as main view + mini-screen (L)"
          >
            <Icon name="layout" size={16} />
            {layout === 'split' ? 'Split' : 'Mini-screen'}
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
          <button
            className="icon-button"
            onClick={focusMission}
            title="Fly to mission"
            aria-label="Fly to mission"
          >
            <Icon name="target" size={18} />
          </button>
          <button onClick={onSettings} disabled={rendering}>
            <Icon name="settings" size={16} />
            Map data
          </button>
        </div>
      </div>
    </header>
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
        <Icon name="target" size={15} />
        {zoom.speed}×{zoom.snappy ? ' · Snappy' : ''}
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
