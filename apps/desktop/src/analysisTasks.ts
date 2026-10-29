import {
  buildFlightPath,
  evaluateSafety,
  missionProfile,
  zoomEvents,
  type Mission,
  type Obstacle,
} from '@odc/core';

export type AnalysisRequest =
  | { kind: 'zoom'; mission: Mission }
  | { kind: 'safety'; mission: Mission; ground: (number | undefined)[]; obstacles: Obstacle[] };

/** CPU-heavy derived data runs in a worker, never in a React render or a mouse handler. */
export function analyzeMission(request: AnalysisRequest) {
  const path = buildFlightPath(request.mission);
  if (request.kind === 'zoom')
    return { kind: 'zoom' as const, events: zoomEvents(path, missionProfile(request.mission)) };
  const samples = path.sampleByDistance(Math.max(5, path.length / 400));
  return {
    kind: 'safety' as const,
    report: evaluateSafety(
      request.mission,
      path,
      samples,
      request.ground,
      undefined,
      request.obstacles,
    ),
  };
}

export type AnalysisResult = ReturnType<typeof analyzeMission>;
