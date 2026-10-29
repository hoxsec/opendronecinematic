import { createMission, generateShot, newId } from '@odc/core';

/** A fictional practice shot, not a fly-ready mission or a claim of airspace clearance. */
export function createSampleProject() {
  const mission = createMission({ lat: 46.5935, lon: 7.9091, groundHeight: 800 });
  mission.name = 'Valley orbit · practice project';
  const shot = generateShot(mission, 'helix', {
    subject: { id: newId('poi'), name: 'Practice subject', lat: 46.594, lon: 7.9095, height: 815 },
    groundHeight: 800,
    radius: 70,
    height: 45,
    climb: 25,
    startBearing: 200,
    sweep: 300,
    speed: 4,
  });
  mission.waypoints = shot.waypoints;
  mission.pois = [shot.poi];
  return mission;
}
