import {
  buildFlightPath,
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

export function useCamera() {
  const mission = useStore((s) => s.mission);
  const profile = missionProfile(mission);
  return { profile, fov: profileFov(profile, 'video') };
}
