import { create } from 'zustand';
import type { DroneState } from '@odc/core';

export type MainView = 'map' | 'camera';
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

const LAYOUT_KEY = 'odc.layout.v1';

function loadLayout(): { main: MainView; mini: MiniRect } {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { main: 'map', mini: { right: 12, bottom: 12, width: 480 } };
}

interface ViewState {
  main: MainView;
  mini: MiniRect;
  fly: boolean;
  flyHud?: FlyHud;
  render?: RenderProgress;
  takes: Take[];
  activeTakeId?: string;
  compare: boolean;

  swap(): void;
  setMain(main: MainView): void;
  setMini(mini: MiniRect): void;
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

useView.subscribe((s, prev) => {
  if (s.main === prev.main && s.mini === prev.mini) return;
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ main: s.main, mini: s.mini }));
  } catch {
    /* ignore */
  }
});
