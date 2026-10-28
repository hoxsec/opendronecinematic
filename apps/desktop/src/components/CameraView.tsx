import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fmtTime,
  horizontalSpeed,
  lensAt,
  profileFov,
  sunInFrame,
  sunPosition,
  sunRelation,
  waypointHeight,
  type SunRelation,
} from '@odc/core';
import { PovView } from '@odc/cesium-view';
import { useStore } from '../store';
import { useView, type Take } from '../viewStore';
import { useCamera, usePath, useSunTime } from '../derived';
import { useFlyController } from '../fly/useFlyController';
import { KEY_HELP, PAD_HELP } from '../fly/input';
import { saveFile } from '../platform';
import { FrameGuides, GuidesMenu } from './FrameGuides';

/** Exposed for the fly controller and anything else that needs the camera's world. */
export let activePov: PovView | undefined;

export function CameraView({ isMain }: { isMain: boolean }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const povRef = useRef<PovView | undefined>(undefined);
  const settings = useStore((s) => s.settings);
  const dem = useStore((s) => s.dem);
  const time = useStore((s) => s.time);
  const fly = useView((s) => s.fly);
  const compare = useView((s) => s.compare);
  const rendering = useView((s) => !!s.render);
  const take = useView((s) => s.takes.find((t) => t.id === s.activeTakeId));
  const shadows = useView((s) => s.shadows);
  const sunTime = useSunTime().getTime();
  const path = usePath();
  const { fov, profile } = useCamera();
  const getPov = useCallback(() => povRef.current, []);

  useEffect(() => {
    const pov = new PovView(canvasRef.current!);
    povRef.current = pov;
    activePov = pov;
    if (import.meta.env.DEV) Object.assign(window, { odcPov: pov });
    return () => {
      activePov = undefined;
      pov.destroy();
    };
  }, []);

  useEffect(() => {
    povRef.current?.setSources(settings, dem);
  }, [settings, dem]);

  useEffect(() => {
    povRef.current?.setSun(new Date(sunTime), shadows);
  }, [sunTime, shadows]);

  useEffect(() => {
    if (fly) return;
    const s = path.sample(time);
    if (s) povRef.current?.setPose(s, profileFov(profile, 'video', s.focalMm).horizontal);
  }, [fly, path, time, profile]);

  useFlyController(surfaceRef, getPov);

  const aspect = String(profile.videoAspect);
  const showTake = take && !compare;
  return (
    <div className={`camera-pane ${compare && take ? 'compare' : ''} ${isMain ? 'main' : 'mini'}`}>
      <div className="frame-cell">
        <div
          className="frame"
          style={{ aspectRatio: aspect, ['--ar' as string]: aspect }}
          ref={surfaceRef}
        >
          <div ref={canvasRef} className="pov-canvas" />
          <div className="pov-thirds" />
          <LiveGuides aspect={profile.videoAspect} />
          {isMain && !rendering && <GuidesMenu />}
          {fly ? <FlyHud /> : <PlanHud />}
          {showTake && <TakePlayer take={take} />}
          <RecOverlay />
        </div>
      </div>
      {compare && take && (
        <div className="frame-cell">
          <div className="frame" style={{ aspectRatio: aspect, ['--ar' as string]: aspect }}>
            <TakePlayer take={take} synced />
          </div>
        </div>
      )}
      {/* The REC overlay owns the top of the frame while rendering. */}
      {isMain && !rendering && <TakesDrawer />}
    </div>
  );
}

const SUN_SHORT: Record<SunRelation, string> = {
  backlit: 'BACKLIT',
  'front-lit': 'FRONT',
  'side-left': 'SIDE L',
  'side-right': 'SIDE R',
};

/** Sun elevation and where it falls on the frame; warns when the sun is in shot. */
function SunHud({
  yaw,
  pitch,
  fov,
}: {
  yaw: number;
  pitch: number;
  fov: { horizontal: number; vertical: number };
}) {
  const mission = useStore((s) => s.mission);
  const sunTime = useSunTime();
  const sun = sunPosition(sunTime, mission.takeoff.lat, mission.takeoff.lon);
  if (sun.elevation < -6) return <span>SUN ☾</span>;
  const inFrame = sunInFrame(yaw, pitch, fov.horizontal, fov.vertical, sun);
  return (
    <span className={inFrame ? 'warn' : ''} title="Sun elevation and lighting on the frame">
      SUN {sun.elevation.toFixed(0)}° {inFrame ? 'IN FRAME' : SUN_SHORT[sunRelation(yaw, sun)]}
    </span>
  );
}

/** Framing guides for the current pose: the timeline's in plan mode, the drone's in fly mode. */
function LiveGuides({ aspect }: { aspect: number }) {
  const fly = useView((s) => s.fly);
  const hud = useView((s) => s.flyHud);
  const time = useStore((s) => s.time);
  const path = usePath();
  const { profile } = useCamera();
  if (fly) {
    if (!hud) return null;
    const v = profileFov(profile, 'video').vertical;
    return (
      <FrameGuides aspect={aspect} pitch={hud.state.pitch} height={hud.state.height} vFovDeg={v} />
    );
  }
  const s = path.sample(time);
  const v = profileFov(profile, 'video', s?.focalMm).vertical;
  return (
    <FrameGuides
      aspect={aspect}
      pitch={s?.pitch ?? 0}
      height={s?.position.height ?? 0}
      vFovDeg={v}
    />
  );
}

function PlanHud() {
  const time = useStore((s) => s.time);
  const mission = useStore((s) => s.mission);
  const path = usePath();
  const { profile } = useCamera();
  const s = path.sample(time);
  if (!s)
    return <div className="hud top">Add waypoints, or press ✈ Fly to scout with the drone</div>;
  const rel = s.position.height - mission.takeoff.groundHeight;
  const home = Math.hypot(s.enu[0], s.enu[1]);
  // Approximate AGL by interpolating ground heights between the current leg's waypoints.
  const a = mission.waypoints[s.segment];
  const b = mission.waypoints[s.segment + 1] ?? a;
  const ground = a && b ? a.groundHeight + (b.groundHeight - a.groundHeight) * s.u : undefined;
  const fov = profileFov(profile, 'video', s.focalMm);
  const lens = lensAt(profile, s.focalMm);
  return (
    <div className="hud top">
      <span className="badge">PLAN</span>
      <span>HDG {s.yaw.toFixed(0)}°</span>
      <span>GMB {s.pitch.toFixed(0)}°</span>
      <span>SPD {s.speed.toFixed(1)} m/s</span>
      <span>ALT {rel.toFixed(0)} m</span>
      {ground !== undefined && <span>AGL {(s.position.height - ground).toFixed(0)} m</span>}
      <span>D {home.toFixed(0)} m</span>
      <span title={`${fov.horizontal.toFixed(0)}° horizontal field of view`}>
        {s.focalMm.toFixed(0)} mm
      </span>
      {lens.digital > 1.01 && (
        <span className="warn" title={`Digital zoom on the ${lens.lensMm} mm camera`}>
          DIGITAL {lens.digital.toFixed(1)}×
        </span>
      )}
      <SunHud yaw={s.yaw} pitch={s.pitch} fov={fov} />
      <span className="right">
        {fmtTime(time)} / {fmtTime(path.duration)}
      </span>
    </div>
  );
}

function FlyHud() {
  const hud = useView((s) => s.flyHud);
  const mission = useStore((s) => s.mission);
  const [help, setHelp] = useState(true);
  const { profile } = useCamera();
  if (!hud) return null;
  const s = hud.state;
  const rel = s.height - mission.takeoff.groundHeight;
  const agl = s.groundHeight !== undefined ? s.height - s.groundHeight : undefined;
  const last = mission.waypoints[mission.waypoints.length - 1];
  const lastRel = last ? waypointHeight(mission, last) - mission.takeoff.groundHeight : undefined;
  const pad = navigator.getGamepads?.().find((g) => g?.connected);
  return (
    <>
      <div className="hud top">
        <span className="badge fly">FLY</span>
        <span>HDG {s.yaw.toFixed(0)}°</span>
        <span>GMB {s.pitch.toFixed(0)}°</span>
        <span>SPD {horizontalSpeed(s).toFixed(1)} m/s</span>
        <span>V/S {s.vU.toFixed(1)}</span>
        <span>ALT {rel.toFixed(0)} m</span>
        {agl !== undefined && (
          <span className={agl > 120 ? 'warn' : ''}>AGL {agl.toFixed(0)} m</span>
        )}
        <SunHud yaw={s.yaw} pitch={s.pitch} fov={profileFov(profile, 'video')} />
        {hud.recordingPath && <span className="rec">● PATH {fmtTime(hud.pathSeconds)}</span>}
        <span className="right">
          {mission.waypoints.length} WP · {mission.pois.length} POI
          {lastRel !== undefined && ` · last WP ${lastRel.toFixed(0)} m`}
        </span>
      </div>
      <div className="crosshair" />
      <div className="fly-help">
        <button onClick={() => setHelp(!help)}>{help ? 'Hide keys' : 'Keys'}</button>
        {help && (
          <dl>
            {(pad ? PAD_HELP : KEY_HELP).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
            {pad && <p className="muted small">{pad.id}</p>}
          </dl>
        )}
      </div>
    </>
  );
}

function RecOverlay() {
  const r = useView((s) => s.render);
  if (!r) return null;
  const elapsed = (Date.now() - r.startedAt) / 1000;
  const eta = r.frame > 0 ? (elapsed / r.frame) * (r.total - r.frame) : undefined;
  return (
    <div className="rec-overlay">
      <span className="rec">● REC</span>
      <span>
        {r.format.toUpperCase()} {r.width}×{r.height} @ {r.fps} fps
      </span>
      <span>
        frame {r.frame}/{r.total} · {fmtTime(r.frame / r.fps)}
      </span>
      <span>{(r.bytes / 1e6).toFixed(1)} MB</span>
      {eta !== undefined && <span>ETA {fmtTime(eta)}</span>}
      {r.slowFrames > 0 && <span className="warn">{r.slowFrames} slow</span>}
      <div className="bar">
        <div style={{ width: `${(r.frame / r.total) * 100}%` }} />
      </div>
      <button onClick={r.cancel}>Cancel</button>
    </div>
  );
}

/** Plays a take. In compare mode it follows the timeline so both sides show the same moment. */
function TakePlayer({ take, synced }: { take: Take; synced?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const { playTake } = useView.getState();

  useEffect(() => {
    const v = ref.current;
    if (!synced || !v) return;
    if (playing) {
      if (Math.abs(v.currentTime - time) > 0.25) v.currentTime = time;
      if (v.paused) v.play().catch(() => {});
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - time) > 0.02) v.currentTime = time;
    }
  }, [synced, time, playing]);

  return (
    <div className="take-player">
      {take.format === 'gif' ? (
        <img src={take.url} alt={take.name} />
      ) : (
        <video ref={ref} src={take.url} controls={!synced} autoPlay={!synced} muted playsInline />
      )}
      {!synced && (
        <button className="close" onClick={() => playTake(undefined)} title="Back to live view">
          ✕ Live
        </button>
      )}
    </div>
  );
}

function TakesDrawer() {
  const takes = useView((s) => s.takes);
  const activeId = useView((s) => s.activeTakeId);
  const compare = useView((s) => s.compare);
  const { playTake, removeTake, setCompare } = useView.getState();
  const [open, setOpen] = useState(false);
  if (!takes.length) return null;
  const save = (t: Take) =>
    saveFile(`${t.name.replace(/[^\w-]+/g, '_')}.${t.format}`, t.blob, [
      { name: t.format.toUpperCase(), extensions: [t.format] },
    ]);
  return (
    <div className={`takes ${open ? 'open' : ''}`}>
      <button onClick={() => setOpen(!open)}>🎞 Takes ({takes.length})</button>
      {open && (
        <ul>
          {takes.map((t) => (
            <li key={t.id} className={t.id === activeId ? 'selected' : ''}>
              <div>
                <b>{t.name}</b>
                <span className="muted small">
                  {t.format.toUpperCase()} · {t.width}×{t.height} · {Math.round(t.fps)} fps ·{' '}
                  {fmtTime(t.duration)} · {(t.blob.size / 1e6).toFixed(1)} MB
                </span>
              </div>
              <div className="button-row">
                <button onClick={() => playTake(t.id)}>▶ Play</button>
                {t.format !== 'gif' && (
                  <button
                    className={t.id === activeId && compare ? 'active' : ''}
                    onClick={() => {
                      playTake(t.id);
                      setCompare(!(t.id === activeId && compare));
                    }}
                  >
                    ⇆ Compare
                  </button>
                )}
                <button onClick={() => save(t)}>Save…</button>
                <button onClick={() => removeTake(t.id)}>✕</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
