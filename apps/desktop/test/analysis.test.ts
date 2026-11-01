import { describe, expect, it } from 'vitest';
import {
  buildFlightPath,
  createMission,
  createWaypoint,
  evaluateSafety,
  missionProfile,
  zoomEvents,
  checkAirspace,
  parseAirspaceGeoJson,
} from '@odc/core';
import { analyzeMission } from '../src/analysisTasks';

const mission = {
  ...createMission({ lat: 46, lon: 7, groundHeight: 0 }),
  waypoints: [
    createWaypoint({ lat: 46, lon: 7, groundHeight: 0, alt: 5 }),
    createWaypoint({ lat: 46.005, lon: 7, groundHeight: 0, alt: 5 }),
  ],
};

describe('background analysis', () => {
  it('preserves the exact safety checks and sample spacing used by terrain sampling', () => {
    const path = buildFlightPath(mission);
    const samples = path.sampleByDistance(Math.max(5, path.length / 400));
    const ground = samples.map(() => 0);
    const result = analyzeMission({ kind: 'safety', mission, ground, obstacles: [] });
    expect(result.kind).toBe('safety');
    if (result.kind !== 'safety') throw new Error('Expected safety result');
    expect(result.report).toEqual(evaluateSafety(mission, path, samples, ground));
    expect(result.report.issues.some((i) => i.code === 'clearance')).toBe(true);
  });

  it('keeps timeline lens and digital-zoom events equivalent to the original analysis', () => {
    expect(analyzeMission({ kind: 'zoom', mission })).toEqual({
      kind: 'zoom',
      events: zoomEvents(buildFlightPath(mission), missionProfile(mission)),
    });
  });

  it('checks airspace off the UI thread with the same preview path', () => {
    const zones = parseAirspaceGeoJson(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [6.99, 45.99],
                  [7.01, 45.99],
                  [7.01, 46.01],
                  [6.99, 46.01],
                  [6.99, 45.99],
                ],
              ],
            },
          },
        ],
      }),
    ).zones;
    const result = analyzeMission({ kind: 'airspace', mission, zones });
    expect(result).toEqual({
      kind: 'airspace',
      conflicts: checkAirspace(buildFlightPath(mission), zones),
    });
    if (result.kind === 'airspace') expect(result.conflicts).toHaveLength(1);
  });
});
