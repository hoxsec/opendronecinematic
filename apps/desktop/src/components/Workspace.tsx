import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../store';
import { useView, type MainView } from '../viewStore';
import { useCamera } from '../derived';
import { GlobeView } from './GlobeView';
import { CameraView } from './CameraView';

const MODE_HINT = {
  select: '',
  addWaypoint: 'Click the globe to add waypoints · Esc to finish',
  addPoi: 'Click what the camera should look at',
  setTakeoff: 'Click the takeoff / home point',
} as const;

const MAP_MINI_ASPECT = 16 / 10;
const MIN_WIDTH = 220;

/**
 * Hosts the map and the camera view. One fills the main area and the other floats as a
 * draggable, resizable mini-screen; clicking the mini-screen (or pressing Tab) swaps them.
 * Both stay mounted so their WebGL globes and loaded tiles survive the swap.
 */
export function Workspace() {
  const areaRef = useRef<HTMLDivElement>(null);
  const main = useView((s) => s.main);
  const mini = useView((s) => s.mini);
  const fly = useView((s) => s.fly);
  const mode = useStore((s) => s.mode);
  const { profile } = useCamera();

  const miniKind: MainView = main === 'map' ? 'camera' : 'map';
  const aspect = miniKind === 'camera' ? profile.videoAspect : MAP_MINI_ASPECT;
  const miniStyle: CSSProperties = {
    right: mini.right,
    bottom: mini.bottom,
    width: mini.width,
    height: mini.width / aspect,
  };

  /** Shared pointer-drag helper that clamps the mini-screen inside the main area. */
  const drag = (e: ReactPointerEvent, kind: 'move' | 'resize') => {
    e.preventDefault();
    e.stopPropagation();
    const area = areaRef.current!.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, ...useView.getState().mini };
    const move = (m: PointerEvent) => {
      const dx = m.clientX - start.x;
      const dy = m.clientY - start.y;
      let { right, bottom, width } = start;
      if (kind === 'move') {
        right = start.right - dx;
        bottom = start.bottom - dy;
      } else {
        // The handle sits top-left, so dragging left/up grows the window.
        width = Math.max(MIN_WIDTH, Math.min(area.width * 0.75, start.width - dx));
      }
      const height = width / aspect;
      right = Math.max(0, Math.min(area.width - width, right));
      bottom = Math.max(0, Math.min(area.height - height, bottom));
      useView.getState().setMini({ right, bottom, width });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const paneClass = (kind: MainView) =>
    `pane pane-${kind} ${kind === main ? 'is-main' : 'is-mini'}`;
  const paneStyle = (kind: MainView) => (kind === main ? undefined : miniStyle);

  return (
    <main className="main" ref={areaRef}>
      <div className={paneClass('map')} style={paneStyle('map')}>
        <GlobeView />
        {main === 'map' && MODE_HINT[mode] && <div className="mode-hint">{MODE_HINT[mode]}</div>}
      </div>
      <div className={paneClass('camera')} style={paneStyle('camera')}>
        <CameraView isMain={main === 'camera'} />
      </div>
      {/* Chrome layered over whichever pane is mini. */}
      <div className="mini-chrome" style={miniStyle}>
        <div
          className="mini-swap"
          title={fly ? 'Map (fly mode keeps the camera main)' : 'Click or press Tab to swap'}
          onClick={() => !fly && useView.getState().swap()}
        />
        <div className="mini-bar" onPointerDown={(e) => drag(e, 'move')}>
          <span>{miniKind === 'map' ? 'Map' : 'Camera'}</span>
          {!fly && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => useView.getState().swap()}
              title="Swap (Tab)"
            >
              ⇄
            </button>
          )}
        </div>
        <div className="mini-resize" onPointerDown={(e) => drag(e, 'resize')} title="Resize" />
      </div>
    </main>
  );
}
