import { create } from 'zustand';
import {
  DEFAULT_SURVEY,
  Dem,
  altFromHeight,
  changeAltitudeMode,
  createMission,
  createWaypoint,
  haversine,
  newId,
  waypointHeight,
  type AltitudeMode,
  type Geodetic,
  type Mission,
  type PointOfInterest,
  type SafetyReport,
  type SurveySpec,
  type Waypoint,
} from '@odc/core';
import {
  DEFAULT_DATA_SOURCES,
  readGeoTiffDem,
  withDefaults,
  type DataSourceSettings,
} from '@odc/cesium-view';
import { loadDemFile } from './demStore';

export type Mode = 'select' | 'addWaypoint' | 'addPoi' | 'setTakeoff' | 'drawSurvey';

const SETTINGS_KEY = 'odc.settings.v1';
const AUTOSAVE_KEY = 'odc.autosave.v1';
const HISTORY_LIMIT = 100;

/** Start somewhere scenic until the user picks a location (Lauterbrunnen valley). */
const DEFAULT_TAKEOFF = { lat: 46.5935, lon: 7.9091, groundHeight: 0 };

function loadSettings(): DataSourceSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return withDefaults(JSON.parse(raw));
  } catch {
    /* ignore corrupt settings */
  }
  return withDefaults(DEFAULT_DATA_SOURCES);
}

function loadAutosave(): Mission {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) return JSON.parse(raw) as Mission;
  } catch {
    /* fall through */
  }
  return createMission(DEFAULT_TAKEOFF);
}

interface State {
  mission: Mission;
  past: Mission[];
  future: Mission[];
  selectedId?: string;
  mode: Mode;
  time: number;
  playing: boolean;
  safety?: SafetyReport;
  settings: DataSourceSettings;
  /** The decoded GeoTIFF terrain, when one is loaded. */
  dem?: Dem;
  /** Bumped when the user explicitly asks to fly the camera to the mission. */
  focusToken: number;
  toast?: { text: string; kind: 'info' | 'error' };

  /** Replace the mission. Pass history: false for continuous edits (drags) after the first step. */
  setMission(next: Mission | ((m: Mission) => Mission), opts?: { history?: boolean }): void;
  undo(): void;
  redo(): void;
  select(id?: string): void;
  setMode(mode: Mode): void;
  setTime(t: number): void;
  setPlaying(p: boolean): void;
  setSafety(s?: SafetyReport): void;
  setSettings(s: Partial<DataSourceSettings>): void;
  setDem(dem?: Dem): void;
  focusMission(): void;
  notify(text: string, kind?: 'info' | 'error'): void;

  addWaypointAt(pos: Geodetic): void;
  /** Append ready-made waypoints (fly-mode captures). */
  appendWaypoints(wps: Waypoint[]): void;
  updateWaypoint(id: string, patch: Partial<Waypoint>, opts?: { history?: boolean }): void;
  removeWaypoint(id: string): void;
  moveWaypoint(id: string, delta: -1 | 1): void;
  addPoiAt(pos: Geodetic): void;
  updatePoi(id: string, patch: Partial<PointOfInterest>, opts?: { history?: boolean }): void;
  removePoi(id: string): void;
  setTakeoffAt(pos: Geodetic): void;
  setAltitudeMode(mode: AltitudeMode): void;
  /** Change survey parameters (creating the survey if needed) or remove it with undefined. */
  updateSurvey(patch: Partial<SurveySpec> | undefined, opts?: { history?: boolean }): void;
  addSurveyVertex(pos: Geodetic): void;
  moveSurveyVertex(index: number, pos: Geodetic, opts?: { history?: boolean }): void;
}

export const useStore = create<State>((set, get) => ({
  mission: loadAutosave(),
  past: [],
  future: [],
  mode: 'select',
  time: 0,
  playing: false,
  settings: loadSettings(),
  focusToken: 0,

  setMission(next, opts = {}) {
    const prev = get().mission;
    const mission = typeof next === 'function' ? next(prev) : next;
    if (mission === prev) return;
    set((s) => ({
      mission,
      past: opts.history === false ? s.past : [...s.past.slice(-HISTORY_LIMIT + 1), prev],
      future: opts.history === false ? s.future : [],
    }));
  },
  undo() {
    const { past, mission, future } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({ mission: prev, past: past.slice(0, -1), future: [mission, ...future] });
  },
  redo() {
    const { past, mission, future } = get();
    const next = future[0];
    if (!next) return;
    set({ mission: next, past: [...past, mission], future: future.slice(1) });
  },
  select: (selectedId) => set({ selectedId }),
  setMode: (mode) => set({ mode }),
  setTime: (time) => set({ time }),
  setPlaying: (playing) => set({ playing }),
  setSafety: (safety) => set({ safety }),
  setSettings(patch) {
    const settings = { ...get().settings, ...patch };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* storage may be unavailable */
    }
    set({ settings });
  },
  setDem(dem) {
    set({ dem });
  },
  focusMission: () => set((s) => ({ focusToken: s.focusToken + 1 })),
  notify(text, kind = 'info') {
    set({ toast: { text, kind } });
    setTimeout(() => {
      if (get().toast?.text === text) set({ toast: undefined });
    }, 4000);
  },

  addWaypointAt(pos) {
    get().setMission((m) => {
      let mission = m;
      // The first waypoint far from takeoff almost certainly means "plan here": move takeoff too.
      if (m.waypoints.length === 0 && haversine(m.takeoff, pos) > 2000) {
        mission = { ...m, takeoff: { lat: pos.lat, lon: pos.lon, groundHeight: pos.height } };
      }
      const last = mission.waypoints[mission.waypoints.length - 1];
      const height = last
        ? waypointHeight(mission, last) - last.groundHeight + pos.height
        : pos.height + 40;
      const wp = createWaypoint({
        lat: pos.lat,
        lon: pos.lon,
        groundHeight: pos.height,
        alt: round1(altFromHeight(mission, pos.height, height)),
        heading: last?.heading ?? 'auto',
        gimbal: last?.gimbal ?? 'fixed',
        gimbalPitch: last?.gimbalPitch,
        poiId: last?.poiId,
      });
      set({ selectedId: wp.id });
      return { ...mission, waypoints: [...mission.waypoints, wp] };
    });
  },
  appendWaypoints(wps) {
    if (!wps.length) return;
    get().setMission((m) => ({ ...m, waypoints: [...m.waypoints, ...wps] }));
    set({ selectedId: wps[wps.length - 1]!.id });
  },
  updateWaypoint(id, patch, opts) {
    get().setMission(
      (m) => ({ ...m, waypoints: m.waypoints.map((w) => (w.id === id ? { ...w, ...patch } : w)) }),
      opts,
    );
  },
  removeWaypoint(id) {
    get().setMission((m) => ({ ...m, waypoints: m.waypoints.filter((w) => w.id !== id) }));
    if (get().selectedId === id) set({ selectedId: undefined });
  },
  moveWaypoint(id, delta) {
    get().setMission((m) => {
      const i = m.waypoints.findIndex((w) => w.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= m.waypoints.length) return m;
      const wps = [...m.waypoints];
      [wps[i], wps[j]] = [wps[j]!, wps[i]!];
      return { ...m, waypoints: wps };
    });
  },
  addPoiAt(pos) {
    const poi: PointOfInterest = {
      id: newId('poi'),
      name: `POI ${get().mission.pois.length + 1}`,
      lat: pos.lat,
      lon: pos.lon,
      height: pos.height + 2,
    };
    get().setMission((m) => ({ ...m, pois: [...m.pois, poi] }));
    set({ selectedId: poi.id, mode: 'select' });
  },
  updatePoi(id, patch, opts) {
    get().setMission(
      (m) => ({ ...m, pois: m.pois.map((p) => (p.id === id ? { ...p, ...patch } : p)) }),
      opts,
    );
  },
  removePoi(id) {
    get().setMission((m) => ({
      ...m,
      pois: m.pois.filter((p) => p.id !== id),
      waypoints: m.waypoints.map((w) => (w.poiId === id ? { ...w, poiId: undefined } : w)),
    }));
  },
  setTakeoffAt(pos) {
    get().setMission((m) => ({
      ...m,
      takeoff: { lat: pos.lat, lon: pos.lon, groundHeight: pos.height },
    }));
    set({ mode: 'select' });
  },
  setAltitudeMode(mode) {
    get().setMission((m) => changeAltitudeMode(m, mode));
  },
  updateSurvey(patch, opts) {
    get().setMission(
      (m) => ({
        ...m,
        survey: patch && { ...DEFAULT_SURVEY, polygon: [], ...m.survey, ...patch },
      }),
      opts,
    );
  },
  addSurveyVertex(pos) {
    const polygon = get().mission.survey?.polygon ?? [];
    get().updateSurvey({ polygon: [...polygon, { lat: pos.lat, lon: pos.lon }] });
  },
  moveSurveyVertex(index, pos, opts) {
    const polygon = [...(get().mission.survey?.polygon ?? [])];
    if (!polygon[index]) return;
    polygon[index] = { lat: pos.lat, lon: pos.lon };
    get().updateSurvey({ polygon }, opts);
  },
}));

/** Decode the stored GeoTIFF and apply the configured offset. */
export async function loadDem(offset = useStore.getState().settings.demOffset) {
  const data = await loadDemFile();
  if (!data) return undefined;
  return new Dem(await readGeoTiffDem(data), offset);
}

// Restore the GeoTIFF terrain from the last session.
if (useStore.getState().settings.terrain === 'geotiff') {
  loadDem()
    .then((dem) => {
      if (dem) useStore.getState().setDem(dem);
      else throw new Error('the DEM file is missing; load it again in Map data.');
    })
    .catch((e) => useStore.getState().notify(`GeoTIFF terrain: ${e.message ?? e}`, 'error'));
}

// Autosave so a crash or reload never loses a plan.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (s.mission === prev.mission) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(s.mission));
    } catch {
      /* ignore */
    }
  }, 500);
});

const round1 = (v: number) => Math.round(v * 10) / 10;
