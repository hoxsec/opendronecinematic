import { Color, Entity, JulianDate, PolygonHierarchy } from 'cesium';
import { describe, expect, it } from 'vitest';
import { airspaceEntities, AIRSPACE_COLORS } from '../src/airspace';
import { parseAirspaceGeoJson } from '@odc/core';

describe('airspace map footprints', () => {
  it('preserves polygon holes and categories without inventing altitude volumes', () => {
    const zones = parseAirspaceGeoJson(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 'ctr',
            properties: {
              name: '<img src=x>',
              category: 'controlled',
              lower: 'SFC',
              upper: '1000 ft AMSL',
            },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 1],
                  [0, 0],
                ],
                [
                  [0.2, 0.2],
                  [0.4, 0.2],
                  [0.4, 0.4],
                  [0.2, 0.4],
                  [0.2, 0.2],
                ],
              ],
            },
          },
        ],
      }),
    ).zones;
    const options = airspaceEntities(zones);
    const entity = new Entity(options[0]);
    const time = JulianDate.now();
    const hierarchy = entity.polygon!.hierarchy!.getValue(time) as PolygonHierarchy;
    expect(hierarchy.positions).toHaveLength(4);
    expect(hierarchy.holes).toHaveLength(1);
    expect(entity.polygon!.extrudedHeight).toBeUndefined();
    expect(entity.polygon!.material!.getValue(time).color).toEqual(
      Color.fromCssColorString(AIRSPACE_COLORS.controlled).withAlpha(0.22),
    );
    expect(entity.description).toBeUndefined();
    expect(entity.name).toBe('<img src=x>');
    expect(options[0]!.id).toBe('airspace:ctr:0');
  });
});
