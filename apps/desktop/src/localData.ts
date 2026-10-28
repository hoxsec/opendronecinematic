// Offline country data. Downloading needs the desktop app (Rust backend); reading what has been
// downloaded works from any build that can reach the local tile server over HTTP.

import { create } from 'zustand';
import { isTauri } from './platform';

/** A region from Geofabrik's index (continent, country, state, ...). */
export interface GeofabrikRegion {
  id: string;
  parent?: string;
  name: string;
  pbfUrl: string;
  bbox: [number, number, number, number];
}

/** A downloaded region, as reported by the local server. */
export interface LocalRegion {
  id: string;
  key: string;
  name: string;
  bbox: [number, number, number, number];
  basemap?: { build: string; maxZoom: number; bytes: number } | null;
  obstacles?: { count: number; bytes: number } | null;
  updated: number;
}

export interface DownloadProgress {
  id: string;
  key: string;
  stage: 'preparing' | 'basemap' | 'pbf' | 'obstacles' | 'done' | 'error' | 'cancelled';
  fraction?: number | null;
  message: string;
}

export interface DownloadRequest {
  id: string;
  basemap: boolean;
  obstacles: boolean;
  maxZoom: number;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export const canDownload = isTauri;

/** The desktop app's own tile server URL (its port can change if the default one is taken). */
export const localServerUrl = () => invoke<string>('local_server_url');
export const geofabrikRegions = () => invoke<GeofabrikRegion[]>('geofabrik_regions');
export const regionPbfSize = (id: string) => invoke<number | null>('region_pbf_size', { id });
export const downloadRegion = (request: DownloadRequest) =>
  invoke<void>('download_region', { request });
export const cancelRegionDownload = (key: string) =>
  invoke<void>('cancel_region_download', { key });
export const deleteRegion = (key: string) => invoke<void>('delete_region', { key });

export async function onDownloadProgress(cb: (p: DownloadProgress) => void) {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<DownloadProgress>('local-data-progress', (e) => cb(e.payload));
}

/** Regions the server at `serverUrl` has downloaded. */
export async function listLocalRegions(serverUrl: string): Promise<LocalRegion[]> {
  const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/regions`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** "us/california" -> "us__california", matching the backend's region keys. */
export const regionKey = (id: string) => id.replaceAll('/', '__');

export function formatBytes(n: number) {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GB`;
  if (n >= 1 << 20) return `${Math.round(n / (1 << 20))} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

interface LocalDataState {
  /** Latest progress per region key while downloading. */
  progress: Record<string, DownloadProgress>;
  regions: LocalRegion[];
  /** Why the region list couldn't be read (server not running, ...). */
  error?: string;
  refresh(serverUrl: string): Promise<void>;
}

export const useLocalData = create<LocalDataState>((set) => ({
  progress: {},
  regions: [],
  async refresh(serverUrl) {
    try {
      set({ regions: await listLocalRegions(serverUrl), error: undefined });
    } catch (e) {
      set({ regions: [], error: String(e) });
    }
  },
}));

/** Listen for download progress for the app's lifetime (desktop only). */
export async function watchDownloads(onFinished: (p: DownloadProgress) => void) {
  if (!canDownload()) return;
  await onDownloadProgress((p) => {
    const finished = p.stage === 'done' || p.stage === 'error' || p.stage === 'cancelled';
    useLocalData.setState((s) => {
      const progress = { ...s.progress };
      if (finished) delete progress[p.key];
      else progress[p.key] = p;
      return { progress };
    });
    if (finished) onFinished(p);
  });
}
