import { waypointHeight } from '@odc/core';
import { getPath } from './derived';
import { activeScene } from './sceneAccess';
import { useStore } from './store';
import { useView } from './viewStore';

export function locateOnMap(id: string) {
  const { mission } = useStore.getState();
  const wp = mission.waypoints.find((w) => w.id === id);
  const poi = mission.pois.find((p) => p.id === id);
  const point = wp ?? poi;
  if (!point || useView.getState().fly) return;
  useView.getState().setMain('map');
  activeScene?.flyTo(
    point.lat,
    point.lon,
    450,
    0.7,
    wp ? waypointHeight(mission, wp) : poi!.height,
  );
}

export function previewWaypoint(id: string) {
  const st = useStore.getState();
  if (useView.getState().fly) return;
  const index = st.mission.waypoints.findIndex((w) => w.id === id);
  if (index < 0) return;
  st.setPlaying(false);
  st.setTime(getPath(st.mission).timings[index]?.arrive ?? 0);
  useView.getState().setMain('camera');
}
