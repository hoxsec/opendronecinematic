import { useEffect, useState } from 'react';
import { useStore } from './store';
import { useView } from './viewStore';
import { Toolbar } from './components/Toolbar';
import { Workspace } from './components/Workspace';
import { Timeline } from './components/Timeline';
import { MissionPanel } from './components/MissionPanel';
import { SunPanel } from './components/SunPanel';
import { WaypointPanel } from './components/WaypointPanel';
import { PoiPanel } from './components/PoiPanel';
import { ShotPanel } from './components/ShotPanel';
import { SurveyPanel } from './components/SurveyPanel';
import { SafetyPanel } from './components/SafetyPanel';
import { ExportDialog } from './components/ExportDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { RenderDialog } from './components/RenderDialog';
import { resetLocalTiles } from '@odc/cesium-view';
import { canDownload, localServerUrl, useLocalData, watchDownloads } from './localData';

export function App() {
  const [dialog, setDialog] = useState<'export' | 'settings' | 'render' | undefined>();
  const toast = useStore((s) => s.toast);
  const needsBuildings = useStore(
    (s) => !s.settings.ionToken.trim() && s.settings.buildings !== 'local',
  );

  useEffect(() => {
    // The desktop tile server falls back to another port if the usual one is taken.
    if (!canDownload()) return;
    localServerUrl()
      .then((serverUrl) => {
        const { settings, setSettings } = useStore.getState();
        if (settings.local.serverUrl !== serverUrl)
          setSettings({ local: { ...settings.local, serverUrl } });
      })
      .catch(() => {});
    watchDownloads((p) => {
      const { settings, notify, setSettings } = useStore.getState();
      useLocalData.getState().refresh(settings.local.serverUrl);
      if (p.stage === 'done') {
        notify(`${p.id}: offline data ready`);
        // Re-apply sources so a region that was just updated is reloaded.
        if (settings.local.region === p.key) {
          resetLocalTiles();
          setSettings({ local: { ...settings.local } });
        }
      } else if (p.stage === 'error') notify(`${p.id}: ${p.message}`, 'error');
    });
  }, []);

  useEffect(() => {
    // Fly mode captures its own keys (capture phase) before this handler sees them.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDialog(undefined);
      const el = e.target as HTMLElement;
      if (el.closest('input, select, textarea, [role="slider"], [contenteditable="true"]')) return;
      const st = useStore.getState();
      const view = useView.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z')
        (e.shiftKey ? st.redo() : st.undo(), e.preventDefault());
      else if (mod && e.key.toLowerCase() === 'y') (st.redo(), e.preventDefault());
      else if (e.key === 'Escape') st.setMode('select');
      else if (e.key === 'Tab') (e.preventDefault(), !view.fly && view.swap());
      else if (e.key === ' ' && !el.closest('button'))
        (st.setPlaying(!st.playing), e.preventDefault());
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        const id = st.selectedId;
        if (!id) return;
        if (st.mission.waypoints.some((w) => w.id === id))
          st.removeWaypoints(st.selectedWaypointIds.length ? st.selectedWaypointIds : [id]);
        else if (st.mission.pois.some((p) => p.id === id)) st.removePoi(id);
      } else if (!mod && e.key.toLowerCase() === 'l') {
        view.setLayout(view.layout === 'split' ? 'pip' : 'split');
      } else if (!mod && e.key.toLowerCase() === 'f') {
        if (!view.render) view.setFly(true);
      } else if (!mod) {
        const modes = {
          v: 'select',
          w: 'addWaypoint',
          p: 'addPoi',
          t: 'setTakeoff',
          g: 'drawSurvey',
        } as const;
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
        {needsBuildings && (
          <div className="banner" onClick={() => setDialog('settings')}>
            Add a free Cesium ion token or download a country for 3D buildings →
          </div>
        )}
        <MissionPanel />
        <SunPanel />
        <WaypointPanel />
        <PoiPanel />
        <ShotPanel />
        <SurveyPanel />
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
