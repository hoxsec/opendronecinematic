import { create } from 'zustand';
import { findUpdate, restartForUpdate, updaterInfo, type UpdateHandle } from './updatePlatform';
import { flushProjectRecovery, useProject } from './projectStore';
import { useStore } from './store';
import { useView } from './viewStore';

type Phase =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'installed'
  | 'error';
interface UpdateState {
  phase: Phase;
  currentVersion?: string;
  version?: string;
  notes?: string;
  downloaded: boolean;
  bytes: number;
  total?: number;
  error?: string;
  check(automatic?: boolean): Promise<void>;
  install(): Promise<void>;
  restart(): Promise<void>;
}

let update: UpdateHandle | undefined;

/** Windows installers exit the process: a local recovery draft is NOT sufficient protection. */
export function updateBlockReason(): string | undefined {
  const project = useProject.getState();
  const view = useView.getState();
  if (project.busy || project.pendingAction)
    return 'Finish the current project action before updating.';
  if (project.active && project.dirty) return 'Save your project file before installing an update.';
  if (view.render) return 'Finish or cancel the video render before updating.';
  if (view.fly) return 'Exit fly mode before updating.';
}

export const useUpdates = create<UpdateState>((set, get) => ({
  phase: 'idle',
  downloaded: false,
  bytes: 0,
  async check(automatic = false) {
    if (['checking', 'downloading', 'installing', 'installed'].includes(get().phase)) return;
    set({
      phase: 'checking',
      error: undefined,
      version: undefined,
      notes: undefined,
      downloaded: false,
      bytes: 0,
      total: undefined,
    });
    try {
      await update?.close().catch(() => {});
      update = undefined;
      const info = await updaterInfo();
      set({ currentVersion: info.version });
      if (!info.enabled) {
        set({ phase: 'disabled' });
        return;
      }
      update = (await findUpdate()) ?? undefined;
      if (update) {
        set({ phase: 'available', version: update.version, notes: update.body });
        if (automatic)
          useStore
            .getState()
            .notify(`Update ${update.version} is available in Map data → Updates.`);
      } else set({ phase: 'current' });
    } catch (error) {
      set({ phase: 'error', error: `Could not check for updates: ${String(error)}` });
    }
  },
  async install() {
    if (!update || get().phase !== 'available') return;
    const blocked = updateBlockReason();
    if (blocked) {
      set({ error: blocked });
      return;
    }
    set({ error: undefined });
    try {
      if (!get().downloaded) {
        set({ phase: 'downloading', bytes: 0, total: undefined });
        // Tauri verifies the signature before the download completes. There is no unsigned path.
        await update.download((event) => {
          if (event.event === 'Started') set({ total: event.data.contentLength });
          else if (event.event === 'Progress')
            set((s) => ({ bytes: s.bytes + event.data.chunkLength }));
        });
        set({ downloaded: true });
      }
      // The user may have edited or started a render while the network request was running.
      const changed = updateBlockReason();
      if (changed) {
        set({ phase: 'available', error: changed });
        return;
      }
      flushProjectRecovery();
      useStore.getState().setPlaying(false);
      set({ phase: 'installing' });
      await update.install();
      set({ phase: 'installed' });
      await get().restart();
    } catch (error) {
      // An install attempt may consume the native byte resource even on failure. Download anew.
      set({
        phase: 'available',
        downloaded: false,
        error: `Update was not installed: ${String(error)}. You can retry or use the release installer.`,
      });
    }
  },
  async restart() {
    if (get().phase !== 'installed') return;
    const blocked = updateBlockReason();
    if (blocked) {
      set({ error: blocked });
      return;
    }
    try {
      await restartForUpdate();
    } catch (error) {
      set({
        error: `Update installed, but automatic restart failed: ${String(error)}. Restart the app manually.`,
      });
    }
  },
}));
