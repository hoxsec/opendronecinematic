import { describe, expect, it } from 'vitest';
import {
  AIRSPACE_MAX_BYTES,
  buildFlightPath,
  checkAirspace,
  createMission,
  createWaypoint,
  parseAirspaceGeoJson,
} from '../src';

const square = (w = 0, s = 0, e = 0.01, n = 0.01) => [
  [w, s],
  [e, s],
  [e, n],
  [w, n],
  [w, s],
];
const feature = (coordinates: unknown = [square()], properties = {}) => ({
  type: 'Feature',
  properties,
  geometry: { type: 'Polygon', coordinates },
});
const parse = (features: unknown[] = [feature()], extra = {}) =>
  parseAirspaceGeoJson(JSON.stringify({ type: 'FeatureCollection', features, ...extra }));
const path = (points: number[][]) => {
  const mission = createMission({
    lon: points[0]?.[0] ?? 0,
    lat: points[0]?.[1] ?? 0,
    groundHeight: 0,
  });
  mission.settings.pathMode = 'straight';
  mission.waypoints = points.map(([lon, lat]) =>
    createWaypoint({ lon: lon!, lat: lat!, alt: 50, groundHeight: 0 }),
  );
  return buildFlightPath(mission);
};

describe('airspace import', () => {
  it('reads polygons, holes, multipolygons and informational metadata', () => {
    const f = feature([square(), square(0.002, 0.002, 0.004, 0.004)], {
      name: 'CTR',
      category: 'controlled',
      lower: '1500 ft AMSL',
    });
    const multi = {
      ...feature(),
      geometry: { type: 'MultiPolygon', coordinates: [[square(1, 1, 2, 2)]] },
    };
    const result = parse([f, multi], {
      source: 'Authority export',
      validUntil: '2026-12-01T00:00:00Z',
    });
    expect(result.source).toBe('Authority export');
    expect(result.zones[0]).toMatchObject({
      name: 'CTR',
      category: 'controlled',
      lower: '1500 ft AMSL',
    });
    expect(result.zones[0]!.polygons[0]).toHaveLength(2);
    expect(result.zones[1]!.category).toBe('advisory');
  });

  it('rejects malformed data instead of silently dropping coverage', () => {
    for (const bad of [
      [],
      [
        feature([
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        ]),
      ],
      [feature([square(200, 0, 201, 1)])],
      [feature([square()], { category: 'no-fly' })],
      [feature([square()], { category: ['restricted'] })],
      [{ ...feature(), geometry: { type: 'Point', coordinates: [0, 0] } }],
      [
        { ...feature(), id: 'x' },
        { ...feature(), id: 'x' },
      ],
    ])
      expect(() => parse(bad)).toThrow();
    expect(() => parse(undefined, { validUntil: 'yesterday' })).toThrow(/timestamp/);
    expect(() => parse(undefined, { crs: {} })).toThrow(/WGS84/);
  });

  it('enforces the file limit in UTF-8 bytes, not just JavaScript character count', () => {
    const multibyte = `"${'é'.repeat(AIRSPACE_MAX_BYTES / 2)}"`;
    expect(() => parseAirspaceGeoJson(multibyte)).toThrow(/10 MB/);
  });
});

describe('airspace footprint intersections', () => {
  const zones = parse().zones;
  it('reports initial contact at arrival rather than after a starting hover', () => {
    const mission = createMission({ lon: 0.005, lat: 0.005, groundHeight: 0 });
    mission.waypoints = [
      createWaypoint({
        lon: 0.005,
        lat: 0.005,
        groundHeight: 0,
        alt: 50,
        actions: [{ type: 'hover', seconds: 30 }],
      }),
    ];
    const conflict = checkAirspace(buildFlightPath(mission), zones)[0]!;
    expect(conflict.time).toBe(0);
    expect(conflict.zone).not.toHaveProperty('polygons');
  });
  it('finds starts inside, boundary contact and crossings with both endpoints outside', () => {
    expect(checkAirspace(path([[0.005, 0.005]]), zones)[0]!.distance).toBe(0);
    expect(
      checkAirspace(
        path([
          [-0.01, 0.005],
          [0.02, 0.005],
        ]),
        zones,
      ),
    ).toHaveLength(1);
    expect(
      checkAirspace(
        path([
          [-0.01, 0],
          [0.02, 0],
        ]),
        zones,
      ),
    ).toHaveLength(1);
    expect(
      checkAirspace(
        path([
          [0.005, 0.02],
          [0.02, 0.02],
        ]),
        zones,
      ),
    ).toEqual([]);
    expect(checkAirspace(path([]), zones)).toEqual([]);
  });
  it('does not miss a strip narrower than the sample spacing', () => {
    const thin = parse([feature([square(0.00501, 0, 0.00502, 0.01)])]).zones;
    const result = checkAirspace(
      path([
        [0, 0.005],
        [0.01, 0.005],
      ]),
      thin,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.position.lon).toBeCloseTo(0.00501, 6);
    expect(result[0]!.time).toBeGreaterThan(0);
  });
  it('respects holes but includes their boundaries', () => {
    const hole = parse([feature([square(), square(0.002, 0.002, 0.008, 0.008)])]).zones;
    expect(
      checkAirspace(
        path([
          [0.003, 0.005],
          [0.007, 0.005],
        ]),
        hole,
      ),
    ).toEqual([]);
    expect(
      checkAirspace(
        path([
          [0.003, 0.005],
          [0.009, 0.005],
        ]),
        hole,
      ),
    ).toHaveLength(1);
  });
  it('handles the antimeridian without claiming the rest of the world', () => {
    const dateline = parse([feature([square(179.99, -0.01, -179.99, 0.01)])]).zones;
    expect(
      checkAirspace(
        path([
          [179.98, 0],
          [-179.98, 0],
        ]),
        dateline,
      ),
    ).toHaveLength(1);
    expect(
      checkAirspace(
        path([
          [-0.01, 0],
          [0.01, 0],
        ]),
        dateline,
      ),
    ).toEqual([]);
  });
  it('checks every polygon and sorts the earliest contacts', () => {
    const multi = {
      ...feature(),
      geometry: { type: 'MultiPolygon', coordinates: [[square(1, 1, 2, 2)], [square()]] },
    };
    expect(
      checkAirspace(
        path([
          [-0.01, 0.005],
          [0.02, 0.005],
        ]),
        parse([multi]).zones,
      ),
    ).toHaveLength(1);
    const list = parse([feature([square(0.02, 0, 0.03, 0.01)]), feature()]).zones;
    expect(
      checkAirspace(
        path([
          [-0.01, 0.005],
          [0.04, 0.005],
        ]),
        list,
      ).map((c) => c.zone.id),
    ).toEqual(['zone-2', 'zone-1']);
  });
});
