import { create } from 'zustand';
import type { DroneState } from '@odc/core';

export type MainView = 'map' | 'camera';
/** 'pip': the other view floats as a mini-screen. 'split': both share the area side by side. */
export type Layout = 'pip' | 'split';
/** 'row' puts the views left and right, 'column' stacks them. */
export type SplitDir = 'row' | 'column';
export type VideoFormat = 'mp4' | 'webm' | 'gif';

/** Mini-screen placement, anchored to the bottom-right of the main area (CSS px). */
export interface MiniRect {
  right: number;
  bottom: number;
  width: number;
}

export interface Take {
  id: string;
  name: string;
  format: VideoFormat;
  url: string;
  blob: Blob;
  width: number;
  height: number;
  fps: number;
  /** Mission seconds covered; video time t corresponds to mission time t. */
  duration: number;
  createdAt: number;
}

export interface RenderProgress {
  format: VideoFormat;
  width: number;
  height: number;
  fps: number;
  frame: number;
  total: number;
  bytes: number;
  startedAt: number;
  /** Frames that hit the tile timeout and may show blurry tiles. */
  slowFrames: number;
  cancel: () => void;
}

export interface FlyHud {
  state: DroneState;
  recordingPath: boolean;
  pathSeconds: number;
  captured: { waypoints: number; pois: number };
}

/** Map mouse-wheel zoom. */
export interface ZoomPrefs {
  /** Multiplier on Cesium's default zoom step; 1 is the default. */
  speed: number;
  /** Stop as soon as the wheel stops instead of coasting. */
  snappy: boolean;
}

/** Overlays on the camera frame. They are never drawn into renders. */
export interface FrameGuides {
  /** Letterbox mask for a wider delivery aspect. */
  cinema: 'none' | '2.39' | '1.85';
  /** Outline of a narrower crop for reframing the same shot. */
  social: 'none' | '9:16' | '4:5';
  /** Action-safe and title-safe frames with a centre cross. */
  safe: boolean;
  /** Where the true horizon sits in frame. */
  horizon: boolean;
}

interface LayoutPrefs {
  main: MainView;
  mini: MiniRect;
  layout: Layout;
  splitDir: SplitDir;
  /** Share of the area taken by the first (main) view in split layout, 0..1. */
  split: number;
  zoom: ZoomPrefs;
  /** Sun shadows in the camera view and renders. */
  shadows: boolean;
  guides: FrameGuides;
}

const LAYOUT_KEY = 'odc.layout.v1';
const DEFAULT_LAYOUT: LayoutPrefs = {
  main: 'map',
  mini: { right: 12, bottom: 12, width: 480 },
  layout: 'pip',
  splitDir: 'row',
  split: 0.5,
  zoom: { speed: 1, snappy: false },
  shadows: true,
  guides: { cinema: 'none', social: 'none', safe: false, horizon: false },
};

function loadLayout(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    // Older saves only have main and mini.
    if (raw) return { ...DEFAULT_LAYOUT, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_LAYOUT;
}

interface ViewState extends LayoutPrefs {
  fly: boolean;
  flyHud?: FlyHud;
  render?: RenderProgress;
  takes: Take[];
  activeTakeId?: string;
  compare: boolean;

  swap(): void;
  setMain(main: MainView): void;
  setMini(mini: MiniRect): void;
  setLayout(layout: Layout): void;
  setSplitDir(splitDir: SplitDir): void;
  setSplit(split: number): void;
  setZoom(zoom: Partial<ZoomPrefs>): void;
  setShadows(shadows: boolean): void;
  setGuides(guides: Partial<FrameGuides>): void;
  setFly(fly: boolean): void;
  setFlyHud(hud?: FlyHud): void;
  setRender(render?: RenderProgress): void;
  addTake(take: Take): void;
  removeTake(id: string): void;
  playTake(id?: string): void;
  setCompare(compare: boolean): void;
}

export const useView = create<ViewState>((set, get) => ({
  ...loadLayout(),
  fly: false,
  takes: [],
  compare: false,

  swap: () => get().setMain(get().main === 'map' ? 'camera' : 'map'),
  setMain: (main) => set({ main }),
  setMini: (mini) => set({ mini }),
  setLayout: (layout) => set({ layout }),
  setSplitDir: (splitDir) => set({ splitDir }),
  setSplit: (split) => set({ split: Math.max(0.2, Math.min(0.8, split)) }),
  setZoom: (zoom) => set((s) => ({ zoom: { ...s.zoom, ...zoom } })),
  setShadows: (shadows) => set({ shadows }),
  setGuides: (guides) => set((s) => ({ guides: { ...s.guides, ...guides } })),
  setFly(fly) {
    // Flying happens through the camera, so it always takes the main screen.
    set(fly ? { fly, main: 'camera', activeTakeId: undefined } : { fly, flyHud: undefined });
  },
  setFlyHud: (flyHud) => set({ flyHud }),
  setRender: (render) => set({ render }),
  addTake: (take) => set((s) => ({ takes: [take, ...s.takes], activeTakeId: take.id })),
  removeTake(id) {
    const take = get().takes.find((t) => t.id === id);
    if (take) URL.revokeObjectURL(take.url);
    set((s) => ({
      takes: s.takes.filter((t) => t.id !== id),
      activeTakeId: s.activeTakeId === id ? undefined : s.activeTakeId,
    }));
  },
  playTake: (activeTakeId) => set({ activeTakeId, compare: false }),
  setCompare: (compare) => set({ compare }),
}));

const PREF_KEYS = Object.keys(DEFAULT_LAYOUT) as (keyof LayoutPrefs)[];

useView.subscribe((s, prev) => {
  if (PREF_KEYS.every((k) => s[k] === prev[k])) return;
  try {
    const prefs = Object.fromEntries(PREF_KEYS.map((k) => [k, s[k]]));
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
});
