import type { DownloadEvent } from '@tauri-apps/plugin-updater';
import { version } from '../package.json';
import { isTauri } from './platform';

export type { DownloadEvent };
export interface UpdateHandle {
  version: string;
  body?: string;
  download(onEvent: (event: DownloadEvent) => void): Promise<void>;
  install(): Promise<void>;
  close(): Promise<void>;
}

export async function updaterInfo(): Promise<{ enabled: boolean; version: string }> {
  if (!isTauri()) return { enabled: false, version };
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('updater_info');
}

export async function findUpdate(): Promise<UpdateHandle | null> {
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check({ timeout: 30_000 });
  return update
    ? {
        version: update.version,
        body: update.body,
        download: (onEvent) => update.download(onEvent, { timeout: 120_000 }),
        install: () => update.install(),
        close: () => update.close(),
      }
    : null;
}

export async function restartForUpdate() {
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
