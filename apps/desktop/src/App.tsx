import { useEffect, useState } from 'react';
import { useStore } from './store';
import { Toolbar } from './components/Toolbar';
import { GlobeView } from './components/GlobeView';
import { PovPanel } from './components/PovPanel';
import { Timeline } from './components/Timeline';
import { MissionPanel } from './components/MissionPanel';
import { WaypointPanel } from './components/WaypointPanel';
import { PoiPanel } from './components/PoiPanel';
import { ShotPanel } from './components/ShotPanel';
import { SafetyPanel } from './components/SafetyPanel';
import { ExportDialog } from './components/ExportDialog';
import { SettingsDialog } from './components/SettingsDialog';

const MODE_HINT = {
  select: '',
  addWaypoint: 'Click the globe to add waypoints · Esc to finish',
  addPoi: 'Click what the camera should look at',
  setTakeoff: 'Click the takeoff / home point',
} as const;

export function App() {
  const [dialog, setDialog] = useState<'export' | 'settings' | undefined>();
  const mode = useStore((s) => s.mode);
  const toast = useStore((s) => s.toast);
  const hasToken = useStore((s) => s.settings.ionToken.trim().length > 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDialog(undefined);
      const el = e.target as HTMLElement;
      if (el.closest('input, select, textarea')) return;
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z')
        (e.shiftKey ? st.redo() : st.undo(), e.preventDefault());
      else if (mod && e.key.toLowerCase() === 'y') (st.redo(), e.preventDefault());
      else if (e.key === 'Escape') st.setMode('select');
      else if (e.key === ' ') (st.setPlaying(!st.playing), e.preventDefault());
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        const id = st.selectedId;
        if (!id) return;
        if (st.mission.waypoints.some((w) => w.id === id)) st.removeWaypoint(id);
        else if (st.mission.pois.some((p) => p.id === id)) st.removePoi(id);
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
      <main className="main">
        <GlobeView />
        {MODE_HINT[mode] && <div className="mode-hint">{MODE_HINT[mode]}</div>}
        <PovPanel />
      </main>
      <Timeline />
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(undefined)} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(undefined)} />}
    </div>
  );
}
