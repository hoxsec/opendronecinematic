import { useEffect } from 'react';
import { create } from 'zustand';
import {
  AIRSPACE_MAX_BYTES,
  parseAirspaceGeoJson,
  type AirspaceData,
  type AirspaceConflict,
  type Mission,
} from '@odc/core';
import { deleteAirspace, loadAirspace, saveAirspace, type StoredAirspace } from './airspaceStorage';
import { useStore } from './store';
import { runAnalysis } from './analysisWorker';

export interface AirspaceLayer extends StoredAirspace {
  data: AirspaceData;
}

interface AirspaceState {
  layer?: AirspaceLayer;
  busy: boolean;
  initialized: boolean;
  error?: string;
  analysis?: {
    mission: Mission;
    data: AirspaceData;
    conflicts: AirspaceConflict[];
    error?: string;
  };
  initialize(): Promise<void>;
  importFile(fileName: string, bytes: Uint8Array): Promise<void>;
  setVisible(visible: boolean): Promise<void>;
  remove(): Promise<void>;
}

export const useAirspace = create<AirspaceState>((set, get) => ({
  busy: false,
  initialized: false,
  async initialize() {
    if (get().initialized || get().busy) return;
    set({ busy: true });
    try {
      const stored = await loadAirspace();
      if (stored) {
        if (
          typeof stored.fileName !== 'string' ||
          typeof stored.json !== 'string' ||
          !Number.isFinite(stored.importedAt) ||
          typeof stored.visible !== 'boolean'
        )
          throw new Error('Invalid stored layer.');
        set({ layer: { ...stored, data: parseAirspaceGeoJson(stored.json) } });
      }
    } catch {
      set({
        error:
          'Saved airspace could not be loaded. Import a current file; no airspace coverage is assumed.',
      });
    } finally {
      set({ busy: false, initialized: true });
    }
  },
  async importFile(fileName, bytes) {
    if (get().busy) return;
    set({ busy: true, error: undefined });
    try {
      if (bytes.byteLength > AIRSPACE_MAX_BYTES)
        throw new Error('Airspace file exceeds the 10 MB limit.');
      const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const data = parseAirspaceGeoJson(json);
      const stored = { fileName, json, importedAt: Date.now(), visible: true };
      try {
        await saveAirspace(stored);
      } catch {
        set({
          error:
            'Airspace is available for this session only: local storage could not be updated. A previous layer may return after restarting.',
        });
      }
      set({ layer: { ...stored, data }, initialized: true });
    } catch (error) {
      set({
        error: `${error instanceof Error ? error.message : String(error)} The previous layer is unchanged.`,
      });
    } finally {
      set({ busy: false });
    }
  },
  async setVisible(visible) {
    const layer = get().layer;
    if (!layer || get().busy) return;
    set({ busy: true });
    const next = { ...layer, visible };
    set({ layer: next });
    try {
      const { data: _data, ...stored } = next;
      await saveAirspace(stored);
    } catch {
      set({ error: 'Airspace visibility could not be saved. Route warnings remain enabled.' });
    } finally {
      set({ busy: false });
    }
  },
  async remove() {
    if (get().busy) return;
    set({ busy: true });
    try {
      await deleteAirspace();
      set({ layer: undefined, error: undefined });
    } catch {
      set({ error: 'Could not remove saved airspace. The current layer is unchanged.' });
    } finally {
      set({ busy: false });
    }
  },
}));

/** One cancellable worker per settled edit, shared by the inspector and export dialog. */
export function useAirspaceAnalysis() {
  const data = useAirspace((s) => s.layer?.data);
  const mission = useStore((s) => s.mission);
  useEffect(() => {
    if (!data) {
      useAirspace.setState({ analysis: undefined });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void runAnalysis({ kind: 'airspace', mission, zones: data.zones }, controller.signal).then(
        (result) => {
          if (!controller.signal.aborted && result.kind === 'airspace')
            useAirspace.setState({ analysis: { mission, data, conflicts: result.conflicts } });
        },
        (error) => {
          if (!controller.signal.aborted)
            useAirspace.setState({
              analysis: {
                mission,
                data,
                conflicts: [],
                error: `Airspace check unavailable: ${String(error)}`,
              },
            });
        },
      );
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [mission, data]);
}

export function useAirspaceConflicts() {
  const data = useAirspace((s) => s.layer?.data);
  const analysis = useAirspace((s) => s.analysis);
  const mission = useStore((s) => s.mission);
  const current = !!data && analysis?.data === data && analysis.mission === mission;
  return {
    conflicts: current ? analysis.conflicts : [],
    pending: !!data && !current,
    error: current ? analysis.error : undefined,
  };
}
