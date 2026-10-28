import {
  buildFlightPath,
  missionShoot,
  missionProfile,
  profileFov,
  type FlightPath,
  type Mission,
} from '@odc/core';
import { useStore } from './store';

// The path is derived from the mission and shared by many components; cache it on identity.
let cachedMission: Mission | undefined;
let cachedPath: FlightPath | undefined;

export function getPath(mission: Mission): FlightPath {
  if (mission !== cachedMission || !cachedPath) {
    cachedMission = mission;
    cachedPath = buildFlightPath(mission);
  }
  return cachedPath;
}

export const usePath = () => getPath(useStore((s) => s.mission));

let cachedShootMission: Mission | undefined;
let cachedShoot: ReturnType<typeof missionShoot> | undefined;

/** The mission's shoot start and UTC offset (a golden-hour default when unset). */
export function getShoot(mission: Mission) {
  if (mission !== cachedShootMission || !cachedShoot) {
    cachedShootMission = mission;
    cachedShoot = missionShoot(mission);
  }
  return cachedShoot;
}

export const useShoot = () => getShoot(useStore((s) => s.mission));

/** Wall-clock time at timeline second `t`: the shoot start plus the mission time. */
export const sunTimeAt = (mission: Mission, t: number) =>
  new Date(getShoot(mission).start.getTime() + t * 1000);

/** Wall-clock time at the timeline cursor, for sun lighting. */
export function useSunTime() {
  const mission = useStore((s) => s.mission);
  const time = useStore((s) => s.time);
  return sunTimeAt(mission, time);
}

export function useCamera() {
  const mission = useStore((s) => s.mission);
  const profile = missionProfile(mission);
  return { profile, fov: profileFov(profile, 'video') };
}
