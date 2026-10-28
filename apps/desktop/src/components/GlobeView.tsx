import { useEffect, useRef } from 'react';
import {
  evaluateSafety,
  waypointHeight,
  altFromHeight,
  AIRFIELD_RADIUS,
  type Obstacle,
} from '@odc/core';
import {
  MissionScene,
  effectiveSources,
  fetchObstacles,
  hasRequirement,
  type DataSourceSettings,
  type PickTarget,
} from '@odc/cesium-view';
import { useStore } from '../store';
import { getPath, useCamera, usePath, useSunTime } from '../derived';
import { useView } from '../viewStore';

/** Exposed so other panels (shot templates) can sample ground heights. */
export let activeScene: MissionScene | undefined;

export function GlobeView() {
  const ref = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MissionScene | undefined>(undefined);
  const mission = useStore((s) => s.mission);
  const selectedId = useStore((s) => s.selectedId);
  const settings = useStore((s) => s.settings);
  const dem = useStore((s) => s.dem);
  const time = useStore((s) => s.time);
  const safety = useStore((s) => s.safety);
  const focusToken = useStore((s) => s.focusToken);
  const mode = useStore((s) => s.mode);
  const fly = useView((s) => s.fly);
  const zoom = useView((s) => s.zoom);
  const sunTime = useSunTime().getTime();
  const path = usePath();
  const { fov, profile } = useCamera();

  useEffect(() => {
    const scene = new MissionScene(ref.current!, effectiveSources(settings).ionToken.length > 0);
    sceneRef.current = scene;
    activeScene = scene;
    if (import.meta.env.DEV) Object.assign(window, { odcScene: scene });
    const m = useStore.getState().mission;
    const first = m.waypoints[0] ?? m.takeoff;
    scene.flyTo(first.lat, first.lon, 1500, 0, first.groundHeight);
    return () => {
      activeScene = undefined;
      scene.destroy();
    };
    // The viewer is created once; settings changes are applied below.
  }, []);

  // Data sources.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    let cancelled = false;
    scene.setSources(settings, dem).then(async (errors) => {
      if (cancelled) return;
      // The DEM loads asynchronously on startup and reports its own errors.
      const shown = dem ? errors : errors.filter((e) => !e.includes('GeoTIFF'));
      if (shown.length) useStore.getState().notify(shown.join(' · '), 'error');
      // With an empty plan, pick up the real ground height at the default takeoff.
      const { mission: m, setMission } = useStore.getState();
      if (m.waypoints.length === 0) {
        const [h] = await scene.sampleGround([m.takeoff]);
        if (h !== undefined && !cancelled)
          setMission({ ...m, takeoff: { ...m.takeoff, groundHeight: h } }, { history: false });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [settings, dem]);

  useEffect(() => {
    sceneRef.current?.setZoom(zoom.speed, zoom.snappy);
  }, [zoom]);

  useEffect(() => {
    sceneRef.current?.setSun(new Date(sunTime));
  }, [sunTime]);

  // Mouse interaction, routed by the current tool mode.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const st = useStore.getState;
    let dragStarted = false;
    scene.events = {
      onGroundClick(pos) {
        const { mode: md } = st();
        if (md === 'addWaypoint') st().addWaypointAt(pos);
        else if (md === 'addPoi') st().addPoiAt(pos);
        else if (md === 'setTakeoff') st().setTakeoffAt(pos);
        else if (md === 'drawSurvey') st().addSurveyVertex(pos);
        else st().select(undefined);
      },
      onSelect(t: PickTarget) {
        dragStarted = false;
        if (t.kind === 'waypoint' || t.kind === 'poi') st().select(t.id);
      },
      onDrag(t, pos) {
        const history = !dragStarted;
        dragStarted = true;
        const { mission: m } = st();
        if (t.kind === 'vertex') {
          st().moveSurveyVertex(t.index, pos, { history });
        } else if (t.kind === 'waypoint') {
          const wp = m.waypoints.find((w) => w.id === t.id);
          if (!wp) return;
          // Keep the same height above ground while dragging in relative/AGL modes.
          const agl = waypointHeight(m, wp) - wp.groundHeight;
          const alt =
            m.altitudeMode === 'ellipsoid'
              ? wp.alt
              : altFromHeight(m, pos.height, pos.height + agl);
          st().updateWaypoint(
            t.id,
            {
              lat: pos.lat,
              lon: pos.lon,
              groundHeight: pos.height,
              alt: Math.round(alt * 10) / 10,
            },
            { history },
          );
        } else if (t.kind === 'poi') {
          const poi = m.pois.find((p) => p.id === t.id);
          if (!poi) return;
          st().updatePoi(t.id, { lat: pos.lat, lon: pos.lon, height: pos.height + 2 }, { history });
        } else {
          st().setMission(
            { ...m, takeoff: { lat: pos.lat, lon: pos.lon, groundHeight: pos.height } },
            { history },
          );
        }
      },
      onDragEnd() {
        dragStarted = false;
      },
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.render(mission, path, { selectedId, issues: safety?.issues });
  }, [mission, path, selectedId, safety]);

  useEffect(() => {
    // In fly mode the fly controller drives the drone marker instead of the timeline.
    if (fly) return;
    sceneRef.current?.setDrone(path.sample(time), fov.horizontal, profile.videoAspect);
  }, [fly, path, time, fov.horizontal, profile.videoAspect]);

  useEffect(() => {
    if (focusToken === 0) return;
    const m = useStore.getState().mission;
    const first = m.waypoints[0] ?? m.takeoff;
    sceneRef.current?.flyTo(first.lat, first.lon, undefined, undefined, first.groundHeight);
  }, [focusToken]);

  // Safety: sample the ground under the path after edits settle.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const p = getPath(mission);
      const samples = p.sampleByDistance(Math.max(5, p.length / 400));
      const positions = samples.map((s) => s.position);
      const [ground, obstacles] = await Promise.all([
        scene.sampleGround(positions),
        obstaclesNear(settings, positions),
      ]);
      if (cancelled) return;
      useStore
        .getState()
        .setSafety(evaluateSafety(mission, p, samples, ground, undefined, obstacles.all));
      const bases = await scene.sampleGround(
        obstacles.shown.map((o) => ({ lon: o.coords[0]![0], lat: o.coords[0]![1] })),
      );
      if (!cancelled) scene.setObstacles(obstacles.shown, bases);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mission, settings, dem]);

  return <div ref={ref} className={`globe mode-${mode}`} />;
}

/** Obstacles shown on the map: those within this distance of the path (airfields: their radius). */
const SHOW_MARGIN = 1000;
let obstacleCache: { key: string; list: Obstacle[] } | undefined;
let obstacleErrorShown = false;

/**
 * Mapped obstacles around the path from the downloaded region: all of them for the safety check
 * (airfields within their warning radius), and the ones close enough to draw.
 */
async function obstaclesNear(
  settings: DataSourceSettings,
  positions: { lat: number; lon: number }[],
): Promise<{ all: Obstacle[]; shown: Obstacle[] }> {
  const none = { all: [], shown: [] };
  if (!settings.local.obstacles || !hasRequirement(settings, 'local') || !positions.length)
    return none;
  const box = (margin: number): [number, number, number, number] => {
    const lats = positions.map((p) => p.lat);
    const lons = positions.map((p) => p.lon);
    const dLat = margin / 111_320;
    const dLon = dLat / Math.max(0.1, Math.cos((lats[0]! * Math.PI) / 180));
    return [
      Math.min(...lons) - dLon,
      Math.min(...lats) - dLat,
      Math.max(...lons) + dLon,
      Math.max(...lats) + dLat,
    ];
  };
  const outer = box(AIRFIELD_RADIUS.aerodrome + 500);
  // Round the query box so small edits reuse the last answer.
  const q = outer.map(
    (v, i) => (i < 2 ? Math.floor(v * 50) : Math.ceil(v * 50)) / 50,
  ) as typeof outer;
  const key = `${settings.local.serverUrl}|${settings.local.region}|${q.join(',')}`;
  let list = obstacleCache?.key === key ? obstacleCache.list : undefined;
  if (!list) {
    try {
      list = await fetchObstacles(settings.local, q);
      obstacleCache = { key, list };
      obstacleErrorShown = false;
    } catch (e) {
      if (!obstacleErrorShown)
        useStore.getState().notify(`Offline obstacles unavailable: ${String(e)}`, 'error');
      obstacleErrorShown = true;
      return none;
    }
  }
  const [w, s, e, n] = box(SHOW_MARGIN);
  const near = (o: Obstacle) =>
    o.coords.some(([lon, lat]) => lon >= w && lon <= e && lat >= s && lat <= n);
  return {
    all: list,
    shown: list.filter((o) => o.kind === 'aerodrome' || o.kind === 'heliport' || near(o)),
  };
}
