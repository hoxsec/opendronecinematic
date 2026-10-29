import { useEffect, useState } from 'react';
import { useStore } from './store';
import { useView } from './viewStore';
import { Toolbar } from './components/Toolbar';
import { Workspace } from './components/Workspace';
import { Timeline } from './components/Timeline';
import { PlannerSidebar } from './components/PlannerSidebar';
import { ProjectHome } from './components/ProjectHome';
import { UnsavedDialog } from './components/UnsavedDialog';
import { ExportDialog } from './components/ExportDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { RenderDialog } from './components/RenderDialog';
import { resetLocalTiles } from '@odc/cesium-view';
import { canDownload, localServerUrl, useLocalData, watchDownloads } from './localData';
import { useProject } from './projectStore';
import { useProjectLifecycle } from './useProjectLifecycle';

export function App() {
  const [dialog, setDialog] = useState<'export' | 'settings' | 'render' | undefined>();
  const toast = useStore((s) => s.toast);
  const screen = useProject((s) => s.screen);
  const pendingAction = useProject((s) => s.pendingAction);
  const busy = useProject((s) => s.busy);
  useProjectLifecycle();

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
      const project = useProject.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && ['s', 'o', 'n'].includes(key)) {
        e.preventDefault();
        if (dialog || project.pendingAction || project.busy || useView.getState().render) return;
        if (key === 's') void project.save(e.shiftKey);
        else void project.request({ kind: key === 'o' ? 'open' : 'new' });
        return;
      }
      if (e.key === 'Escape' && dialog) {
        setDialog(undefined);
        return;
      }
      if (dialog || project.pendingAction || project.busy || project.screen !== 'editor') return;
      const el = e.target as HTMLElement;
      if (el.closest('input, select, textarea, [role="slider"], [contenteditable="true"]')) return;
      const st = useStore.getState();
      const view = useView.getState();
      if (mod && e.key.toLowerCase() === 'z')
        (e.shiftKey ? st.redo() : st.undo(), e.preventDefault());
      else if (mod && e.key.toLowerCase() === 'y') (st.redo(), e.preventDefault());
      else if (e.key === 'Escape') st.setMode('select');
      else if (e.key === 'Tab' && !e.shiftKey && el.tagName === 'CANVAS')
        (e.preventDefault(), !view.fly && view.swap());
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
  }, [dialog]);

  return (
    <div className="app-shell">
      <div className="app-content" inert={!!dialog || !!pendingAction || busy === 'opening'}>
        {screen === 'home' ? (
          <ProjectHome onSettings={() => setDialog('settings')} />
        ) : (
          <div className="app">
            <Toolbar
              onExport={() => setDialog('export')}
              onSettings={() => setDialog('settings')}
            />
            <PlannerSidebar onSettings={() => setDialog('settings')} />
            <Workspace />
            <Timeline onRender={() => setDialog('render')} />
          </div>
        )}
      </div>
      {toast && (
        <div className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
          {toast.text}
        </div>
      )}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(undefined)} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(undefined)} />}
      {dialog === 'render' && <RenderDialog onClose={() => setDialog(undefined)} />}
      {pendingAction && <UnsavedDialog />}
      {busy === 'opening' && (
        <div className="project-busy" role="status">
          <span className="loading-spinner" />
          Opening project…
        </div>
      )}
    </div>
  );
}
