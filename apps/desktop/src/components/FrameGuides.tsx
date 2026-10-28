import { useEffect, useRef, useState } from 'react';
import { useView, type FrameGuides as Guides } from '../viewStore';

const EARTH_RADIUS = 6_371_000;
const CINEMA = { '2.39': 2.39, '1.85': 1.85 } as const;
const SOCIAL = { '9:16': 9 / 16, '4:5': 4 / 5 } as const;

/**
 * Overlays on the camera frame: letterbox masks, social crop outlines, safe areas and the true
 * horizon. HTML over the canvas, so renders never include them.
 */
export function FrameGuides({
  aspect,
  pitch,
  height,
  vFovDeg,
}: {
  /** The video frame's aspect (width / height). */
  aspect: number;
  /** Gimbal pitch in degrees, 0 = level. */
  pitch: number;
  /** Camera height above the ellipsoid in metres, for the horizon dip. */
  height: number;
  vFovDeg: number;
}) {
  const g = useView((s) => s.guides);
  const pct = (f: number) => `${f * 100}%`;

  // The horizon sits below level by the dip angle, more the higher the camera flies.
  const dip = (Math.acos(EARTH_RADIUS / (EARTH_RADIUS + Math.max(0, height))) * 180) / Math.PI;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const horizonY = 0.5 - (Math.tan(toRad(-dip - pitch)) / Math.tan(toRad(vFovDeg / 2))) * 0.5;

  const bar = g.cinema !== 'none' ? Math.max(0, (1 - aspect / CINEMA[g.cinema]) / 2) : 0;
  const cropW = g.social !== 'none' ? Math.min(1, SOCIAL[g.social] / aspect) : 1;

  return (
    <div className="frame-guides">
      {bar > 0 && (
        <>
          <div className="letterbox" style={{ top: 0, height: pct(bar) }} />
          <div className="letterbox" style={{ bottom: 0, height: pct(bar) }} />
        </>
      )}
      {cropW < 1 && (
        <>
          <div className="crop-dim" style={{ left: 0, width: pct((1 - cropW) / 2) }} />
          <div className="crop-dim" style={{ right: 0, width: pct((1 - cropW) / 2) }} />
          <div
            className="crop-outline"
            style={{ left: pct((1 - cropW) / 2), width: pct(cropW) }}
            data-label={g.social}
          />
        </>
      )}
      {g.safe && (
        <>
          <div className="safe action" />
          <div className="safe title" />
          <div className="centre-cross" />
        </>
      )}
      {g.horizon && horizonY > 0 && horizonY < 1 && (
        <div className="horizon" style={{ top: pct(horizonY) }} title="True horizon" />
      )}
    </div>
  );
}

/** Toggles for the framing guides, shown in the corner of the main camera view. */
export function GuidesMenu() {
  const g = useView((s) => s.guides);
  const set = useView.getState().setGuides;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const any = g.cinema !== 'none' || g.social !== 'none' || g.safe || g.horizon;
  const pick = <K extends 'cinema' | 'social'>(key: K, value: Guides[K]) =>
    set({ [key]: g[key] === value ? 'none' : value } as Partial<Guides>);

  return (
    <div className="guides-menu" ref={ref}>
      <button
        className={any ? 'active' : ''}
        onClick={() => setOpen(!open)}
        title="Framing guides (not drawn into renders)"
      >
        ▦ Guides
      </button>
      {open && (
        <div className="guides-pop">
          <span className="muted small">Cinema</span>
          <div className="group segmented">
            {(['2.39', '1.85'] as const).map((v) => (
              <button
                key={v}
                className={g.cinema === v ? 'active' : ''}
                onClick={() => pick('cinema', v)}
              >
                {v}:1
              </button>
            ))}
          </div>
          <span className="muted small">Social crop</span>
          <div className="group segmented">
            {(['9:16', '4:5'] as const).map((v) => (
              <button
                key={v}
                className={g.social === v ? 'active' : ''}
                onClick={() => pick('social', v)}
              >
                {v}
              </button>
            ))}
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={g.safe}
              onChange={(e) => set({ safe: e.target.checked })}
            />
            Safe areas
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={g.horizon}
              onChange={(e) => set({ horizon: e.target.checked })}
            />
            Horizon
          </label>
        </div>
      )}
    </div>
  );
}
