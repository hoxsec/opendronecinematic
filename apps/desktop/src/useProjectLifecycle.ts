import { useEffect } from 'react';
import { isTauri } from './platform';
import { flushProjectRecovery, useProject } from './projectStore';
import { useStore } from './store';

export function useProjectLifecycle() {
  const active = useProject((s) => s.active);
  const dirty = useProject((s) => s.dirty);
  const screen = useProject((s) => s.screen);
  const name = useStore((s) => s.mission.name);

  useEffect(() => {
    const title =
      active && screen === 'editor'
        ? `${dirty ? '• ' : ''}${name || 'Untitled mission'} — OpenDroneCinematic`
        : 'Projects — OpenDroneCinematic';
    document.title = title;
    if (isTauri()) {
      void import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
        .catch(() => {});
    }
  }, [active, dirty, screen, name]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const state = useProject.getState();
      if (!state.active || !state.dirty || state.closeApproved) return;
      flushProjectRecovery();
      // Native close uses our Save / Discard / Cancel dialog instead of a browser prompt.
      if (!isTauri()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const pageHide = () => {
      if (useProject.getState().active) flushProjectRecovery();
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') pageHide();
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', pageHide);
    document.addEventListener('visibilitychange', visibility);

    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void import('@tauri-apps/api/window')
        .then(async ({ getCurrentWindow }) => {
          const stop = await getCurrentWindow().onCloseRequested((event) => {
            if (useProject.getState().closeApproved) return;
            event.preventDefault();
            void useProject.getState().request({ kind: 'close' });
          });
          if (disposed) stop();
          else unlisten = stop;
        })
        .catch((error) =>
          useStore.getState().notify(`Window close protection could not start: ${error}`, 'error'),
        );
    }
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pagehide', pageHide);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
}
