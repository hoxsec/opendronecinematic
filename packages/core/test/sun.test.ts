import { describe, expect, it } from 'vitest';
import {
  createMission,
  dayPhases,
  defaultShootTime,
  localMidnight,
  meanHeading,
  missionShoot,
  sunInFrame,
  sunPosition,
  sunRelation,
} from '../src';

const LONDON = { lat: 51.5, lon: -0.12 };

describe('sun position', () => {
  it('peaks due south at the expected height on the June solstice', () => {
    const s = sunPosition(new Date('2024-06-21T12:02:00Z'), LONDON.lat, LONDON.lon);
    expect(s.elevation).toBeCloseTo(90 - 51.5 + 23.44, 0);
    expect(s.azimuth).toBeCloseTo(180, -1);
  });

  it('rises in the north-east at the published sunrise time', () => {
    // Sunrise in London on 21 June 2024 is 04:43 BST; sunrise is at -0.833° geometric.
    const s = sunPosition(new Date('2024-06-21T03:43:00Z'), LONDON.lat, LONDON.lon);
    expect(Math.abs(s.elevation + 0.833)).toBeLessThan(0.4);
    expect(s.azimuth).toBeGreaterThan(45);
    expect(s.azimuth).toBeLessThan(53);
  });

  it('is overhead at the equator on the equinox around solar noon', () => {
    const s = sunPosition(new Date('2024-03-20T12:07:00Z'), 0, 0);
    expect(s.elevation).toBeGreaterThan(89);
  });
});

describe('light phases', () => {
  it('finds morning and evening golden and blue hours in order', () => {
    const spans = dayPhases(new Date('2024-06-21T12:00:00Z'), LONDON.lat, LONDON.lon, 60);
    const phases = spans.map((s) => s.phase);
    expect(phases).toEqual(['night', 'blue', 'golden', 'day', 'golden', 'blue', 'night']);
    for (let i = 1; i < spans.length; i++)
      expect(spans[i]!.start.getTime()).toBeGreaterThanOrEqual(spans[i - 1]!.end.getTime());
  });

  it('defaults to the start of the evening golden hour', () => {
    const t = defaultShootTime(new Date('2024-06-21T09:00:00Z'), LONDON.lat, LONDON.lon, 60);
    // Golden hour begins around 19:20 UTC (20:20 BST).
    expect(t.getUTCHours()).toBe(19);
    expect(sunPosition(t, LONDON.lat, LONDON.lon).elevation).toBeCloseTo(6, 0);
  });

  it('computes local midnight for a UTC offset', () => {
    const m = localMidnight(new Date('2024-06-21T23:30:00Z'), 120);
    expect(m.toISOString()).toBe('2024-06-21T22:00:00.000Z');
  });
});

describe('sun and camera', () => {
  const sun = { azimuth: 270, elevation: 5 };
  it('classifies the light by where the camera looks', () => {
    expect(sunRelation(260, sun)).toBe('backlit');
    expect(sunRelation(90, sun)).toBe('front-lit');
    expect(sunRelation(0, sun)).toBe('side-left');
    expect(sunRelation(180, sun)).toBe('side-right');
  });

  it('detects the sun in frame', () => {
    expect(sunInFrame(280, 0, 72, 44, sun)).toBe(true);
    expect(sunInFrame(280, -45, 72, 44, sun)).toBe(false);
    expect(sunInFrame(0, 0, 72, 44, sun)).toBe(false);
  });

  it('averages headings across north', () => {
    expect(meanHeading([350, 10])).toBeCloseTo(0, 6);
    expect(meanHeading([])).toBeUndefined();
  });

  it('uses the saved shoot time, or a golden-hour default', () => {
    const m = createMission({ ...LONDON, groundHeight: 10 });
    const def = missionShoot(m, new Date('2024-06-21T09:00:00Z'));
    expect(sunPosition(def.start, LONDON.lat, LONDON.lon).elevation).toBeCloseTo(6, 0);
    m.shoot = { start: '2024-06-21T05:00:00.000Z', utcOffset: 60 };
    expect(missionShoot(m).start.toISOString()).toBe('2024-06-21T05:00:00.000Z');
    expect(missionShoot(m).utcOffset).toBe(60);
  });
});
