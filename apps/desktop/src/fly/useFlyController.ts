import { useEffect, type RefObject } from 'react';
import {
  altFromHeight,
  clamp,
  createWaypoint,
  flyLimits,
  missionProfile,
  profileFov,
  stepDrone,
  waypointsFromTrack,
  type DroneState,
  type TrackPoint,
} from '@odc/core';
import type { PovView } from '@odc/cesium-view';
import { useStore } from '../store';
import { useView } from '../viewStore';
import { getPath } from '../derived';
import { activeScene } from '../components/GlobeView';
import { FlyInputSource, type FlyAction } from './input';

const GROUND_INTERVAL = 0.15;
const TRACK_INTERVAL = 0.1;
const HUD_INTERVAL = 1 / 15;
const FOLLOW_INTERVAL = 0.2;

/** Where fly mode starts: the timeline cursor if there is a plan, else 30 m above takeoff. */
function initialState(): DroneState {
  const { mission, time } = useStore.getState();
  const s = getPath(mission).sample(time);
  if (s) return { ...s.position, yaw: s.yaw, pitch: s.pitch, vE: 0, vN: 0, vU: 0 };
  const { takeoff } = mission;
  return {
    lat: takeoff.lat,
    lon: takeoff.lon,
    height: takeoff.groundHeight + 30,
    yaw: 0,
    pitch: -15,
    vE: 0,
    vN: 0,
    vU: 0,
  };
}

/** Runs the interactive drone while fly mode is on. */
export function useFlyController(
  surface: RefObject<HTMLElement | null>,
  getPov: () => PovView | undefined,
) {
  const fly = useView((s) => s.fly);

  useEffect(() => {
    if (!fly || !surface.current) return;
    const input = new FlyInputSource(surface.current);
    const st = useStore.getState;
    let state = initialState();
    let raf = 0;
    let last = performance.now();
    let groundT = 0;
    let trackT = 0;
    let hudT = 0;
    let followT = 0;
    let elapsed = 0;
    let track: TrackPoint[] | undefined;
    let pathStart = 0;
    const captured = { waypoints: 0, pois: 0 };

    const groundHere = () => state.groundHeight ?? st().mission.takeoff.groundHeight;

    const act = (a: FlyAction) => {
      const { mission, notify } = st();
      if (a === 'exit') {
        useView.getState().setFly(false);
      } else if (a === 'waypoint') {
        const ground = groundHere();
        const wp = createWaypoint({
          lat: state.lat,
          lon: state.lon,
          groundHeight: ground,
          alt: Math.round(altFromHeight(mission, ground, state.height) * 10) / 10,
          heading: 'fixed',
          headingDeg: Math.round(state.yaw * 10) / 10,
          gimbal: 'fixed',
          gimbalPitch: Math.round(state.pitch * 10) / 10,
        });
        st().appendWaypoints([wp]);
        captured.waypoints++;
        notify(`Waypoint ${st().mission.waypoints.length} captured`);
      } else if (a === 'poi') {
        const hit = getPov()?.pickCenter();
        if (!hit) return notify('Nothing under the crosshair to mark.', 'error');
        st().addPoiAt(hit);
        captured.pois++;
        notify(`POI ${st().mission.pois.length} marked`);
      } else if (a === 'togglePath') {
        if (!track) {
          track = [];
          pathStart = elapsed;
          notify('Recording flight path. Press L again to convert it to waypoints.');
        } else {
          const points = track;
          track = undefined;
          if (points.length < 2) return notify('Path too short to convert.', 'error');
          const wps = waypointsFromTrack(mission, points);
          st().appendWaypoints(wps);
          captured.waypoints += wps.length;
          notify(`Recorded path → ${wps.length} waypoints`);
        }
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      elapsed += dt;
      const { mission } = st();
      const profile = missionProfile(mission);
      const lim = flyLimits(profile);
      const pov = getPov();

      const { input: stick, actions, wheelDeg } = input.poll();
      const look = input.takeLook();
      state = {
        ...state,
        yaw: (state.yaw + look.yaw + 360) % 360,
        pitch: clamp(state.pitch + look.pitch + wheelDeg, lim.gimbalMin, lim.gimbalMax),
      };
      state = stepDrone(state, stick, dt, lim);

      groundT += dt;
      if (pov && groundT >= GROUND_INTERVAL) {
        groundT = 0;
        const g = pov.groundHeightAt(state.lat, state.lon);
        if (g !== undefined) state = { ...state, groundHeight: g };
      }

      const pose = {
        position: { lat: state.lat, lon: state.lon, height: state.height },
        yaw: state.yaw,
        pitch: state.pitch,
      };
      const fov = profileFov(profile, 'video');
      pov?.setPose(pose, fov.horizontal);
      activeScene?.setDrone(pose, fov.horizontal, profile.videoAspect);
      followT += dt;
      if (followT >= FOLLOW_INTERVAL && useView.getState().main === 'camera') {
        followT = 0;
        activeScene?.followDrone(pose);
      }

      if (track) {
        trackT += dt;
        if (trackT >= TRACK_INTERVAL) {
          trackT = 0;
          track.push({
            t: elapsed,
            ...pose.position,
            yaw: state.yaw,
            pitch: state.pitch,
            groundHeight: groundHere(),
          });
        }
      }

      for (const a of actions) act(a);

      hudT += dt;
      if (hudT >= HUD_INTERVAL) {
        hudT = 0;
        useView.getState().setFlyHud({
          state,
          recordingPath: !!track,
          pathSeconds: track ? elapsed - pathStart : 0,
          captured: { ...captured },
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    st().setPlaying(false);

    return () => {
      cancelAnimationFrame(raf);
      input.dispose();
      useView.getState().setFlyHud(undefined);
    };
  }, [fly, surface, getPov]);
}
