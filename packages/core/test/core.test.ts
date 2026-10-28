import { describe, expect, it } from 'vitest';
import {
  EnuFrame,
  buildFlightPath,
  changeAltitudeMode,
  createMission,
  createWaypoint,
  evaluateSafety,
  fovFromEquivalentFocal,
  generateShot,
  getProfile,
  haversine,
  lookAt,
  profileFov,
  waypointHeight,
  wrap180,
  type Mission,
} from '../src';

const takeoff = { lat: 51.5, lon: -0.12, groundHeight: 50 };

/** A mission whose waypoints are given in metres east/north/up of takeoff. */
function missionFromEnu(points: [number, number, number][], patch: Partial<Mission> = {}): Mission {
  const m = { ...createMission(takeoff), ...patch };
  const frame = new EnuFrame({ lat: takeoff.lat, lon: takeoff.lon, height: takeoff.groundHeight });
  m.waypoints = points.map(([e, n, u]) => {
    const g = frame.fromEnu([e, n, u]);
    return createWaypoint({
      lat: g.lat,
      lon: g.lon,
      alt: g.height - takeoff.groundHeight,
      groundHeight: 50,
    });
  });
  return m;
}

describe('geo', () => {
  it('round-trips through ENU', () => {
    const frame = new EnuFrame({ lat: 47, lon: 8, height: 400 });
    const g = frame.fromEnu([120, -340, 55]);
    const back = frame.toEnu(g);
    expect(back[0]).toBeCloseTo(120, 6);
    expect(back[1]).toBeCloseTo(-340, 6);
    expect(back[2]).toBeCloseTo(55, 6);
  });

  it('lookAt points north-east and down', () => {
    const o = lookAt([0, 0, 100], [100, 100, 0]);
    expect(o.yaw).toBeCloseTo(45, 6);
    expect(o.pitch).toBeCloseTo(-35.26, 1);
  });
});

describe('profiles', () => {
  it('derives a plausible FOV from a 24mm-equivalent lens', () => {
    const f = fovFromEquivalentFocal(24, 4 / 3);
    expect(f.diagonal).toBeCloseTo(84.1, 0);
    expect(f.horizontal).toBeCloseTo(71.6, 0);
  });

  it('crops vertical FOV for 16:9 video on a 4:3 sensor', () => {
    const photo = profileFov(getProfile('dji-mini-4-pro'), 'photo');
    const video = profileFov(getProfile('dji-mini-4-pro'), 'video');
    expect(video.horizontal).toBeCloseTo(photo.horizontal, 6);
    expect(video.vertical).toBeLessThan(photo.vertical);
  });
});

describe('flight path', () => {
  it('times a straight leg at constant speed', () => {
    const m = missionFromEnu(
      [
        [0, 0, 30],
        [0, 100, 30],
      ],
      { settings: { ...createMission(takeoff).settings, pathMode: 'straight', speed: 5 } },
    );
    const path = buildFlightPath(m);
    expect(path.length).toBeCloseTo(100, 1);
    expect(path.duration).toBeCloseTo(20, 1);
    const mid = path.sample(10)!;
    expect(mid.enu[1]).toBeCloseTo(50, 0);
    expect(Math.abs(wrap180(mid.yaw))).toBeLessThan(1e-3);
  });

  it('adds hover time and integrates speed ramps', () => {
    const m = missionFromEnu(
      [
        [0, 0, 30],
        [0, 100, 30],
      ],
      { settings: { ...createMission(takeoff).settings, pathMode: 'straight' } },
    );
    m.waypoints[0]!.speed = 2;
    m.waypoints[1]!.speed = 8;
    m.waypoints[0]!.actions = [{ type: 'hover', seconds: 3 }];
    const path = buildFlightPath(m);
    // integral of ds / (2 + 0.06 s) over 0..100 = ln(4) / 0.06
    expect(path.duration).toBeCloseTo(3 + Math.log(4) / 0.06, 1);
    expect(path.sample(1.5)!.s).toBe(0);
    const end = path.sample(path.duration)!;
    expect(end.enu[1]).toBeCloseTo(100, 1);
  });

  it('passes through every waypoint on a smooth path', () => {
    const m = missionFromEnu([
      [0, 0, 20],
      [80, 40, 30],
      [120, 140, 50],
      [0, 200, 40],
    ]);
    const path = buildFlightPath(m);
    path.timings.forEach((tm, i) => {
      const p = path.sample(tm.arrive)!;
      const target = path.frame.toEnu({
        lat: m.waypoints[i]!.lat,
        lon: m.waypoints[i]!.lon,
        height: waypointHeight(m, m.waypoints[i]!),
      });
      expect(
        Math.hypot(p.enu[0] - target[0], p.enu[1] - target[1], p.enu[2] - target[2]),
      ).toBeLessThan(0.05);
    });
  });

  it('keeps the camera on the POI through an orbit', () => {
    const m = createMission(takeoff);
    const subject = { id: 'poi1', name: 'Tower', lat: 51.501, lon: -0.12, height: 80 };
    const shot = generateShot(m, 'orbit', {
      subject,
      groundHeight: 50,
      radius: 60,
      height: 40,
      startBearing: 0,
    });
    m.waypoints = shot.waypoints;
    m.pois = [shot.poi];
    const path = buildFlightPath(m);
    const poiEnu = path.frame.toEnu(subject);
    for (const s of path.sampleEvery(path.duration / 37)) {
      const want = lookAt(s.enu, poiEnu);
      const dYaw = Math.abs(((s.yaw - want.yaw + 540) % 360) - 180);
      expect(dYaw).toBeLessThan(0.5);
      expect(Math.abs(s.pitch - want.pitch)).toBeLessThan(0.5);
      const r = Math.hypot(s.enu[0] - poiEnu[0], s.enu[1] - poiEnu[1]);
      expect(Math.abs(r - 60)).toBeLessThan(1.5);
    }
  });
});

describe('altitude modes', () => {
  it('re-expresses altitudes without moving waypoints', () => {
    const m = createMission(takeoff);
    m.waypoints = [createWaypoint({ lat: 51.5, lon: -0.12, alt: 40, groundHeight: 70 })];
    const before = waypointHeight(m, m.waypoints[0]!);
    const agl = changeAltitudeMode(m, 'AGL');
    expect(agl.waypoints[0]!.alt).toBeCloseTo(20, 6);
    expect(waypointHeight(agl, agl.waypoints[0]!)).toBeCloseTo(before, 6);
  });
});

describe('safety', () => {
  it('flags low clearance, the AGL ceiling and battery use', () => {
    const m = missionFromEnu(
      [
        [0, 0, 30],
        [0, 300, 30],
        [0, 600, 160],
      ],
      { settings: { ...createMission(takeoff).settings, pathMode: 'straight' } },
    );
    const path = buildFlightPath(m);
    const samples = path.sampleByDistance(10);
    // A 25 m hill at 100..200 m along the path (ground is 50 m at takeoff).
    const ground = samples.map((s) => (s.s > 100 && s.s < 200 ? 75 : 50));
    const report = evaluateSafety(m, path, samples, ground);
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain('clearance');
    expect(codes).toContain('ceiling');
    expect(report.minClearance).toBeCloseTo(5, 0);
    expect(report.totalSeconds).toBeGreaterThan(path.duration);
  });

  it('flags waypoint speeds above the airframe limit', () => {
    const m = missionFromEnu([
      [0, 0, 30],
      [0, 100, 30],
    ]);
    m.waypoints[0]!.speed = 30;
    const path = buildFlightPath(m);
    const report = evaluateSafety(m, path, path.sampleByDistance(20), []);
    expect(report.issues.some((i) => i.code === 'speed')).toBe(true);
  });
});

describe('sanity', () => {
  it('haversine ~111 km per degree of latitude', () => {
    expect(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111195, -2);
  });
});
