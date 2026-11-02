import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useProject } from '../projectStore';
import { useStore } from '../store';
import { useUpdates } from '../updateStore';

/** Desktop-only chrome. Native close events retain the project lifecycle's save guard. */
export function TitleBar() {
  const name = useStore((s) => s.mission.name);
  const screen = useProject((s) => s.screen);
  const dirty = useProject((s) => s.dirty);
  const installing = useUpdates((s) => s.phase === 'installing');
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);
  const mac = /Mac/.test(navigator.platform);
  const title = screen === 'editor' ? name || 'Untitled mission' : 'Projects';

  useEffect(() => {
    const native = getCurrentWindow();
    let disposed = false;
    const stops: (() => void)[] = [];
    const keep = (stop: () => void) => (disposed ? stop() : stops.push(stop));
    const report = (error: unknown) => {
      if (!disposed) useStore.getState().notify(`Window controls: ${error}`, 'error');
    };
    const sync = async () => {
      const value = await native.isMaximized();
      if (!disposed) setMaximized(value);
    };
    void sync().catch(report);
    void native
      .isFocused()
      .then((value) => {
        if (!disposed) setFocused(value);
      })
      .catch(report);
    void native
      .onResized(() => void sync().catch(report))
      .then(keep)
      .catch(report);
    void native
      .onFocusChanged(({ payload }) => setFocused(payload))
      .then(keep)
      .catch(report);
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
    };
  }, []);

  const control = (action: 'minimize' | 'toggleMaximize' | 'close') => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    void getCurrentWindow()
      [action]()
      .catch((error) => useStore.getState().notify(`Window control failed: ${error}`, 'error'));
  };
  const maximizeLabel = maximized ? 'Restore window' : 'Maximize window';

  return (
    <header
      className={`titlebar${mac ? ' titlebar-mac' : ''}${focused ? '' : ' titlebar-inactive'}`}
    >
      <div className="titlebar-drag" data-tauri-drag-region>
        <div className="titlebar-brand">
          <img src="/icon.svg" alt="" draggable={false} />
          <span>
            OpenDrone<span className="titlebar-accent">Cinematic</span>
          </span>
        </div>
        <span className="titlebar-project" title={`${title}${dirty ? ' — Unsaved changes' : ''}`}>
          {dirty && screen === 'editor' && (
            <span className="titlebar-dirty" aria-label="Unsaved changes">
              ●
            </span>
          )}
          {title}
        </span>
      </div>
      <div className="titlebar-controls" aria-label="Window controls">
        <button
          className="window-minimize"
          aria-label="Minimize window"
          title="Minimize window"
          onClick={() => control('minimize')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M1 6.5h10" />
          </svg>
        </button>
        <button
          className="window-maximize"
          aria-label={maximizeLabel}
          title={maximizeLabel}
          onClick={() => control('toggleMaximize')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            {maximized ? (
              <path d="M3.5 3.5v-2h7v7h-2m-7-5h7v7h-7Z" />
            ) : (
              <path d="M1.5 1.5h9v9h-9Z" />
            )}
          </svg>
        </button>
        <button
          className="window-close"
          aria-label="Close window"
          title="Close window"
          disabled={installing}
          onClick={() => control('close')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="m2 2 8 8m0-8-8 8" />
          </svg>
        </button>
      </div>
    </header>
  );
}
