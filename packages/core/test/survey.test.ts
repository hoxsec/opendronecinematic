import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SURVEY,
  Dem,
  EnuFrame,
  bestSurveyAngle,
  createMission,
  crsFromEpsg,
  fromUtm,
  getProfile,
  planSurvey,
  polygonArea,
  surveyStats,
  surveyWaypoints,
  toUtm,
  type LatLon,
  type SurveySpec,
} from '../src';

const origin = { lat: 47.3769, lon: 8.5417, height: 0 };
const frame = new EnuFrame(origin);
/** A rectangle `w` metres east by `h` metres north, from the origin. */
const rect = (w: number, h: number): LatLon[] =>
  [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ].map(([e, n]) => {
    const g = frame.fromEnu([e!, n!, 0]);
    return { lat: g.lat, lon: g.lon };
  });

const profile = getProfile('dji-mavic-3e');
const spec = (patch: Partial<SurveySpec> = {}): SurveySpec => ({
  ...DEFAULT_SURVEY,
  polygon: rect(200, 100),
  overshoot: 0,
  ...patch,
});

describe('survey', () => {
  it('computes area, GSD and spacing from the camera', () => {
    const s = surveyStats(profile, spec());
    expect(s.area).toBeCloseTo(20000, -1);
    // Mavic 3E: ~2.7 cm/px at 100 m, so ~1.6 cm/px at 60 m.
    expect(s.gsd).toBeGreaterThan(1.4);
    expect(s.gsd).toBeLessThan(1.8);
    expect(s.lineSpacing).toBeCloseTo(s.footprint.across * 0.35, 6);
    expect(s.triggerDistance).toBeCloseTo(s.footprint.along * 0.25, 6);
  });

  it('flies a serpentine of north-south lines covering the area', () => {
    const plan = planSurvey(profile, spec({ angle: 0 }));
    const { lineSpacing, footprint } = plan.stats;
    expect(plan.lines).toBe(Math.ceil((200 - footprint.across) / lineSpacing) + 1);
    expect(plan.points).toHaveLength(plan.lines * 2);
    const enu = plan.points.map((p) => frame.toEnu({ ...p, height: 0 }));
    // Each line spans the full 100 m height and alternates direction.
    for (let i = 0; i < plan.lines; i++) {
      const a = enu[2 * i]!;
      const b = enu[2 * i + 1]!;
      expect(Math.abs(b[1] - a[1])).toBeCloseTo(100, 0);
      expect(Math.abs(b[0] - a[0])).toBeLessThan(0.5);
      expect(plan.points[2 * i]!.heading).toBe(i % 2 === 0 ? 0 : 180);
    }
    // The outer footprints reach the edges.
    const xs = enu.map((p) => p[0]);
    expect(Math.min(...xs) - footprint.across / 2).toBeLessThanOrEqual(0.5);
    expect(Math.max(...xs) + footprint.across / 2).toBeGreaterThanOrEqual(199.5);
    // Photos start at each line's first point and stop at its last.
    expect(plan.points[0]!.actions[0]).toEqual({
      type: 'photoDistance',
      meters: Math.round(plan.stats.triggerDistance * 10) / 10,
    });
    expect(plan.points[1]!.actions[0]).toEqual({ type: 'photoDistance', meters: 0 });
  });

  it('adds terrain-following points, overshoot and crosshatch', () => {
    const base = planSurvey(profile, spec());
    const follow = planSurvey(profile, spec({ terrainFollowSpacing: 25 }));
    expect(follow.points).toHaveLength(base.lines * 5);
    const over = planSurvey(profile, spec({ overshoot: 10 }));
    const [a, b] = over.points.map((p) => frame.toEnu({ ...p, height: 0 }));
    expect(Math.abs(b![1] - a![1])).toBeCloseTo(120, 0);
    const cross = planSurvey(profile, spec({ crosshatch: true }));
    expect(cross.lines).toBeGreaterThan(base.lines);
  });

  it('handles concave outlines with several segments per line', () => {
    // A U shape open to the north: lines through the arms cross it twice.
    const u = [
      [0, 0],
      [150, 0],
      [150, 100],
      [100, 100],
      [100, 40],
      [50, 40],
      [50, 100],
      [0, 100],
    ].map(([e, n]) => frame.fromEnu([e!, n!, 0]));
    const plan = planSurvey(profile, spec({ polygon: u, angle: 90, height: 30 }));
    const { footprint, lineSpacing } = plan.stats;
    const rows = Math.ceil((100 - footprint.across) / lineSpacing) + 1;
    expect(plan.lines).toBeGreaterThan(rows);
    expect(polygonArea(u)).toBeCloseTo(150 * 100 - 50 * 60, -1);
  });

  it('picks the longest edge as the grid angle', () => {
    expect(bestSurveyAngle(rect(200, 100))).toBe(90);
    expect(bestSurveyAngle(rect(50, 300))).toBe(0);
  });

  it('places waypoints at the survey height above the ground', () => {
    const m = createMission({ ...origin, groundHeight: 400 });
    const s = spec({ height: 80 });
    const plan = planSurvey(profile, s);
    const wps = surveyWaypoints(m, s, plan, [430]);
    expect(wps[0]!.alt).toBe(110);
    expect(wps[1]!.alt).toBe(80);
    expect(wps[0]!.gimbalPitch).toBe(-90);
    expect(wps[0]!.heading).toBe('fixed');
  });
});

describe('dem', () => {
  it('round-trips UTM coordinates', () => {
    // Reference values: the equator on zone 31's central meridian and at its western edge.
    expect(toUtm({ lat: 0, lon: 3 }, 31, false)).toEqual([500000, 0]);
    const [e0] = toUtm({ lat: 0, lon: 0 }, 31, false);
    expect(e0).toBeCloseTo(166021.44, 1);
    const [e, n] = toUtm({ lat: 47.3769, lon: 8.5417 }, 32, false);
    const back = fromUtm(e, n, 32, false);
    expect(back.lat).toBeCloseTo(47.3769, 7);
    expect(back.lon).toBeCloseTo(8.5417, 7);
    const s = fromUtm(...toUtm({ lat: -33.86, lon: 151.21 }, 56, true), 56, true);
    expect(s.lat).toBeCloseTo(-33.86, 7);
    expect(s.lon).toBeCloseTo(151.21, 7);
  });

  it('maps EPSG codes', () => {
    expect(crsFromEpsg(4326)).toEqual({ kind: 'geographic' });
    expect(crsFromEpsg(32632)).toEqual({ kind: 'utm', zone: 32, south: false });
    expect(crsFromEpsg(32756)).toEqual({ kind: 'utm', zone: 56, south: true });
    expect(crsFromEpsg(25832)).toEqual({ kind: 'utm', zone: 32, south: false });
    expect(crsFromEpsg(2056)).toBeUndefined();
  });

  it('interpolates heights bilinearly with an offset', () => {
    // 3x2 geographic grid, 0.01° pixels, heights increase eastward.
    const dem = new Dem(
      {
        width: 3,
        height: 2,
        data: [100, 110, 120, 100, 110, -9999],
        originX: 8,
        originY: 47,
        resX: 0.01,
        resY: -0.01,
        noData: -9999,
        crs: { kind: 'geographic' },
      },
      50,
    );
    // Pixel centres sit at lon 8.005, 8.015, 8.025.
    expect(dem.heightAt(46.995, 8.005)).toBeCloseTo(150);
    expect(dem.heightAt(46.995, 8.01)).toBeCloseTo(155);
    // Next to the no-data pixel only valid neighbours count.
    expect(dem.heightAt(46.99, 8.025)).toBeCloseTo(170);
    expect(dem.heightAt(46.985, 8.025)).toBeUndefined();
    expect(dem.heightAt(47.5, 8.01)).toBeUndefined();
    expect(dem.bounds.west).toBeCloseTo(8);
    expect(dem.bounds.north).toBeCloseTo(47);
  });

  it('samples projected (UTM) rasters', () => {
    const [e, n] = toUtm({ lat: 47.3769, lon: 8.5417 }, 32, false);
    const dem = new Dem({
      width: 2,
      height: 1,
      data: [400, 500],
      originX: e - 10,
      originY: n + 5,
      resX: 10,
      resY: -10,
      crs: { kind: 'utm', zone: 32, south: false },
    });
    expect(dem.heightAt(47.3769, 8.5417)).toBeCloseTo(450, 0);
  });
});
