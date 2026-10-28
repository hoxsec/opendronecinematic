import { describe, expect, it } from 'vitest';
import {
  EnuFrame,
  buildFlightPath,
  createMission,
  createWaypoint,
  focalRange,
  generateShot,
  getProfile,
  lensAt,
  profileFov,
  vec,
  zoomEvents,
  type Mission,
} from '../src';

const takeoff = { lat: 47, lon: 8, groundHeight: 400 };

function straightMission(drone: string, focals: (number | undefined)[]): Mission {
  const m = createMission(takeoff, drone);
  const frame = new EnuFrame({ ...takeoff, height: takeoff.groundHeight });
  m.waypoints = focals.map((focalMm, i) => {
    const g = frame.fromEnu([0, i * 100, 50]);
    return createWaypoint({ lat: g.lat, lon: g.lon, alt: 50, groundHeight: 400, focalMm });
  });
  return m;
}

describe('lenses', () => {
  it('defaults to 2x digital zoom and knows multi-camera drones', () => {
    expect(focalRange(getProfile('dji-mini-3'))).toEqual([24, 48]);
    expect(focalRange(getProfile('dji-mavic-3-pro'))).toEqual([24, 672]);
  });

  it('picks the longest lens not longer than the focal length', () => {
    const p = getProfile('dji-mavic-3-pro');
    expect(lensAt(p, 24)).toEqual({ lensMm: 24, digital: 1 });
    expect(lensAt(p, 70)).toEqual({ lensMm: 70, digital: 1 });
    const l = lensAt(p, 100);
    expect(l.lensMm).toBe(70);
    expect(l.digital).toBeCloseTo(100 / 70, 6);
  });

  it('narrows the field of view as focal length grows', () => {
    const p = getProfile('dji-mavic-3-pro');
    const wide = profileFov(p, 'video').horizontal;
    const tele = profileFov(p, 'video', 48).horizontal;
    const t = (deg: number) => Math.tan((deg * Math.PI) / 360);
    expect(t(tele)).toBeCloseTo(t(wide) / 2, 6);
  });
});

describe('zoom along the path', () => {
  it('eases focal length in log space between waypoints', () => {
    const path = buildFlightPath(straightMission('dji-mavic-3-pro', [24, 96]));
    expect(path.sample(0)!.focalMm).toBeCloseTo(24, 6);
    expect(path.sample(path.duration)!.focalMm).toBeCloseTo(96, 6);
    expect(path.sample(path.duration / 2)!.focalMm).toBeCloseTo(48, 1);
  });

  it('clamps to the drone zoom range', () => {
    const path = buildFlightPath(straightMission('dji-mini-3', [10, 500]));
    expect(path.sample(0)!.focalMm).toBe(24);
    expect(path.sample(path.duration)!.focalMm).toBe(48);
  });

  it('reports lens switches and digital zoom', () => {
    const p = getProfile('dji-mavic-3-pro');
    const events = zoomEvents(buildFlightPath(straightMission(p.id, [24, 200])), p);
    // Between lenses the shorter one zooms digitally until the next takes over.
    expect(events.map((e) => [e.lensMm, e.digital])).toEqual([
      [24, true],
      [70, false],
      [70, true],
      [166, false],
      [166, true],
    ]);
  });
});

describe('dolly zoom', () => {
  const subject = { id: 'poi', name: 'Tower', lat: 47, lon: 8, height: 430 };

  for (const dollyZoom of ['pull-out', 'push-in'] as const) {
    it(`keeps the subject the same size (${dollyZoom})`, () => {
      const m = createMission(takeoff, 'dji-mavic-3-pro');
      const shot = generateShot(m, 'dollyzoom', {
        subject,
        groundHeight: 400,
        radius: 40,
        height: 30,
        startBearing: 90,
        dollyZoom,
        zoomRatio: 3,
      });
      const mission = { ...m, waypoints: shot.waypoints, pois: [shot.poi] };
      const path = buildFlightPath(mission);
      const target = path.frame.toEnu(subject);
      const sizes = path.sampleEvery(0.5).map((s) => s.focalMm / vec.dist(s.enu, target));
      for (const k of sizes) expect(k / sizes[0]!).toBeCloseTo(1, 3);
      const focals = path.sampleEvery(0.5).map((s) => s.focalMm);
      if (dollyZoom === 'pull-out') expect(focals.at(-1)!).toBeGreaterThan(focals[0]! * 2);
      else expect(focals.at(-1)!).toBeLessThan(focals[0]! / 2);
    });
  }
});
