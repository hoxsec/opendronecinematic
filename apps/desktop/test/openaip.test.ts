import { describe, expect, it } from 'vitest';
import { parseAirspaceGeoJson } from '@odc/core';
import { convertOpenAip, openAipCountry } from '../src/openaip';

export const openAipExport = (type = 4, icaoClass = 3) =>
  JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 1,
        properties: {
          _id: 'openaip-id',
          name: 'CTR Test',
          country: 'AT',
          type,
          icaoClass,
          lowerLimit: { value: 0, unit: 1, referenceDatum: 0 },
          upperLimit: { value: 100, unit: 6, referenceDatum: 2 },
          byNotam: true,
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
          ],
        },
      },
    ],
  });

describe('OpenAIP export adapter', () => {
  it('normalizes country codes without accepting URLs or paths', () => {
    expect(openAipCountry(' AT ')).toBe('at');
    for (const value of ['', '../', 'AUT', '12', 'https://example.com'])
      expect(() => openAipCountry(value)).toThrow();
  });
  it('preserves geometry, identity, limits, attribution and activation warnings', () => {
    const data = parseAirspaceGeoJson(convertOpenAip(openAipExport(), 'at'));
    expect(data.source).toContain('CC BY-NC 4.0');
    expect(data.source).toContain('AT');
    expect(data.validUntil).toBeUndefined();
    expect(data.zones[0]).toMatchObject({
      id: 'openaip-id',
      name: 'CTR Test',
      category: 'controlled',
      lower: '0 ft GND',
      upper: 'FL 100 (STD)',
    });
    expect(data.zones[0]!.description).toContain('byNotam');
    expect(data.zones[0]!.polygons[0]![0]).toHaveLength(5);
  });
  it.each([1, 2, 3, 8, 9, 19, 29])('maps restricted/danger type %s conservatively', (type) => {
    expect(parseAirspaceGeoJson(convertOpenAip(openAipExport(type))).zones[0]!.category).toBe(
      'restricted',
    );
  });
  it('uses advisory for unknown types, retaining the original code', () => {
    const zone = parseAirspaceGeoJson(convertOpenAip(openAipExport(999, 8))).zones[0]!;
    expect(zone.category).toBe('advisory');
    expect(zone.description).toContain('999');
  });
  it('rejects wrong countries, malformed geometry and unsupported limits', () => {
    expect(() => convertOpenAip(openAipExport(), 'de')).toThrow('country');
    const data = JSON.parse(openAipExport());
    data.features[0].geometry.coordinates[0][0] = [999, 0];
    expect(() => convertOpenAip(JSON.stringify(data))).toThrow('WGS84');
    data.features[0].properties.upperLimit.unit = 999;
    expect(() => convertOpenAip(JSON.stringify(data))).toThrow('vertical limit');
  });
  it('rejects empty exports and duplicate IDs rather than silently dropping data', () => {
    expect(() => convertOpenAip('{"type":"FeatureCollection","features":[]}')).toThrow();
    const data = JSON.parse(openAipExport());
    data.features.push(data.features[0]);
    expect(() => convertOpenAip(JSON.stringify(data))).toThrow('unique');
  });
});
