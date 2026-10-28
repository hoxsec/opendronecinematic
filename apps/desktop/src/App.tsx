import { useEffect, useState } from 'react';
import { useStore } from './store';
import { useView } from './viewStore';
import { Toolbar } from './components/Toolbar';
import { Workspace } from './components/Workspace';
import { Timeline } from './components/Timeline';
import { MissionPanel } from './components/MissionPanel';
import { WaypointPanel } from './components/WaypointPanel';
import { PoiPanel } from './components/PoiPanel';
import { ShotPanel } from './components/ShotPanel';
import { SafetyPanel } from './components/SafetyPanel';
import { ExportDialog } from './components/ExportDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { RenderDialog } from './components/RenderDialog';

export function App() {
  const [dialog, setDialog] = useState<'export' | 'settings' | 'render' | undefined>();
  const toast = useStore((s) => s.toast);
  const hasToken = useStore((s) => s.settings.ionToken.trim().length > 0);

  useEffect(() => {
    // Fly mode captures its own keys (capture phase) before this handler sees them.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDialog(undefined);
      const el = e.target as HTMLElement;
      if (el.closest('input, select, textarea')) return;
      const st = useStore.getState();
      const view = useView.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z')
        (e.shiftKey ? st.redo() : st.undo(), e.preventDefault());
      else if (mod && e.key.toLowerCase() === 'y') (st.redo(), e.preventDefault());
      else if (e.key === 'Escape') st.setMode('select');
      else if (e.key === 'Tab') (e.preventDefault(), !view.fly && view.swap());
      else if (e.key === ' ') (st.setPlaying(!st.playing), e.preventDefault());
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        const id = st.selectedId;
        if (!id) return;
        if (st.mission.waypoints.some((w) => w.id === id)) st.removeWaypoint(id);
        else if (st.mission.pois.some((p) => p.id === id)) st.removePoi(id);
      } else if (!mod && e.key.toLowerCase() === 'f') {
        if (!view.render) view.setFly(true);
      } else if (!mod) {
        const modes = { v: 'select', w: 'addWaypoint', p: 'addPoi', t: 'setTakeoff' } as const;
        const m = modes[e.key.toLowerCase() as keyof typeof modes];
        if (m) st.setMode(m);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Toolbar onExport={() => setDialog('export')} onSettings={() => setDialog('settings')} />
      <aside className="sidebar">
        {!hasToken && (
          <div className="banner" onClick={() => setDialog('settings')}>
            Add a free Cesium ion token for 3D terrain and buildings →
          </div>
        )}
        <MissionPanel />
        <WaypointPanel />
        <PoiPanel />
        <ShotPanel />
        <SafetyPanel />
      </aside>
      <Workspace />
      <Timeline onRender={() => setDialog('render')} />
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(undefined)} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(undefined)} />}
      {dialog === 'render' && <RenderDialog onClose={() => setDialog(undefined)} />}
    </div>
  );
}
