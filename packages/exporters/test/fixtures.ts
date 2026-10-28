import {
  DEFAULT_SURVEY,
  createMission,
  generateShot,
  missionProfile,
  planSurvey,
  surveyWaypoints,
  type Mission,
  type SurveySpec,
} from '@odc/core';

export const NOW = Date.UTC(2026, 0, 1);

export function orbitMission(profile = 'dji-mavic-3e'): Mission {
  const m = createMission({ lat: 47.3769, lon: 8.5417, groundHeight: 450 }, profile);
  const shot = generateShot(m, 'orbit', {
    subject: { id: 'poi_tower', name: 'Tower', lat: 47.3772, lon: 8.5421, height: 480 },
    groundHeight: 450,
    radius: 50,
    height: 40,
    startBearing: 180,
    sweep: 180,
  });
  m.waypoints = shot.waypoints;
  m.waypoints[0]!.actions = [{ type: 'startRecording' }, { type: 'hover', seconds: 2 }];
  m.waypoints[m.waypoints.length - 1]!.actions = [{ type: 'stopRecording' }];
  m.pois = [shot.poi];
  return m;
}

/** A small nadir mapping grid that returns home. */
export function surveyMission(profile = 'custom'): Mission {
  const m = createMission({ lat: 47.3769, lon: 8.5417, groundHeight: 450 }, profile);
  const spec: SurveySpec = {
    ...DEFAULT_SURVEY,
    polygon: [
      { lat: 47.377, lon: 8.542 },
      { lat: 47.377, lon: 8.544 },
      { lat: 47.378, lon: 8.544 },
      { lat: 47.378, lon: 8.542 },
    ],
  };
  const plan = planSurvey(missionProfile(m), spec);
  return {
    ...m,
    survey: spec,
    settings: { ...m.settings, pathMode: 'straight', finishAction: 'returnHome' },
    waypoints: surveyWaypoints(m, spec, plan),
  };
}
