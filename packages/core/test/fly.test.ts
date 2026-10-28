import { describe, expect, it } from 'vitest';
import {
  EnuFrame,
  NO_INPUT,
  createMission,
  flyLimits,
  getProfile,
  simplifyTrack,
  stepDrone,
  waypointsFromTrack,
  type DroneState,
  type TrackPoint,
} from '../src';

const lim = flyLimits(getProfile('dji-mini-4-pro'));
const start: DroneState = {
  lat: 46.6,
  lon: 7.9,
  height: 900,
  yaw: 90,
  pitch: -20,
  vE: 0,
  vN: 0,
  vU: 0,
};

function fly(s: DroneState, input: Partial<typeof NO_INPUT>, seconds: number) {
  let st = s;
  for (let i = 0; i < seconds * 60; i++) st = stepDrone(st, { ...NO_INPUT, ...input }, 1 / 60, lim);
  return st;
}

describe('flight sim', () => {
  it('accelerates to cruise speed along the heading, then brakes to a hover', () => {
    const frame = new EnuFrame(start);
    const moving = fly(start, { forward: 1 }, 5);
    expect(moving.vE).toBeCloseTo(lim.cruiseSpeed, 1);
    expect(Math.abs(moving.vN)).toBeLessThan(1e-6);
    const stopped = fly(moving, {}, 5);
    expect(Math.hypot(stopped.vE, stopped.vN)).toBeLessThan(1e-6);
    const [e, n] = frame.toEnu(stopped);
    expect(e).toBeGreaterThan(20);
    expect(Math.abs(n)).toBeLessThan(0.01);
  });

  it('respects climb rate, gimbal limits and ground clearance', () => {
    const climbed = fly(start, { up: 1 }, 10);
    expect(climbed.vU).toBeCloseTo(lim.maxAscent, 6);
    const tilted = fly(start, { gimbal: -1 }, 10);
    expect(tilted.pitch).toBe(lim.gimbalMin);
    const landed = fly({ ...start, groundHeight: 895 }, { up: -1 }, 10);
    expect(landed.height).toBeCloseTo(895 + lim.minClearance, 6);
  });

  it('ignores zero or negative time steps instead of producing NaN', () => {
    for (const dt of [0, -0.004]) {
      const s = stepDrone(start, NO_INPUT, dt, lim);
      expect(s).toEqual(start);
    }
  });

  it('caps diagonal speed at the same top speed', () => {
    const s = fly(start, { forward: 1, right: 1, boost: true }, 10);
    expect(Math.hypot(s.vE, s.vN)).toBeCloseTo(lim.maxSpeed, 3);
  });
});

describe('track simplification', () => {
  // A 100 m straight leg then a 90° turn, sampled at 10 Hz with the camera panning once.
  const frame = new EnuFrame({ lat: 46.6, lon: 7.9, height: 900 });
  const track: TrackPoint[] = [];
  for (let i = 0; i <= 200; i++) {
    const t = i / 10;
    const enu: [number, number, number] = i <= 100 ? [0, i, 40] : [i - 100, 100, 40];
    const g = frame.fromEnu(enu);
    track.push({ t, ...g, yaw: i <= 150 ? 0 : 90, pitch: -20, groundHeight: 860 });
  }

  it('keeps the corner and the camera pan, drops the straight bits', () => {
    const kept = simplifyTrack(track);
    expect(kept[0]).toBe(0);
    expect(kept[kept.length - 1]).toBe(200);
    expect(kept).toContain(100);
    expect(kept.some((i) => i >= 149 && i <= 152)).toBe(true);
    expect(kept.length).toBeLessThan(10);
  });

  it('converts to fixed-camera waypoints with flown speeds', () => {
    const m = createMission({ lat: 46.6, lon: 7.9, groundHeight: 860 });
    const wps = waypointsFromTrack(m, track);
    expect(wps[0]!.heading).toBe('fixed');
    expect(wps[0]!.alt).toBeCloseTo(80, 0);
    expect(wps[0]!.speed).toBeCloseTo(10, 0);
  });
});
