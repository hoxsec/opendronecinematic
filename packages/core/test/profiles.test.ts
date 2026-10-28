import { describe, expect, it } from 'vitest';
import {
  DRONE_FAMILIES,
  DRONE_PROFILES,
  getProfile,
  groundSampleDistance,
  profileFov,
  profileForWpml,
} from '../src';

describe('drone profiles', () => {
  it('have unique ids, a known family, and keep custom last', () => {
    const ids = DRONE_PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const families = new Set(DRONE_FAMILIES.map((f) => f.id));
    for (const p of DRONE_PROFILES) expect(families.has(p.family), p.id).toBe(true);
    expect(getProfile('no-such-drone').id).toBe('custom');
  });

  it('keep ids that saved missions refer to', () => {
    for (const id of [
      'dji-mini-4-pro',
      'dji-air-3',
      'dji-mavic-3',
      'dji-mavic-3e',
      'dji-m30',
      'dji-m350-h20',
      'ardupilot-px4-multirotor',
      'custom',
    ]) {
      expect(getProfile(id).id).toBe(id);
    }
  });

  it('have plausible camera and flight numbers', () => {
    for (const p of DRONE_PROFILES) {
      const fov = profileFov(p, 'photo');
      expect(fov.horizontal, p.id).toBeGreaterThan(40);
      expect(fov.horizontal, p.id).toBeLessThan(140);
      // Every camera here resolves between ~0.5 and ~8 cm/px at 100 m (the Neo is ultra-wide).
      const gsd = groundSampleDistance(p, 100);
      expect(gsd, p.id).toBeGreaterThan(0.5);
      expect(gsd, p.id).toBeLessThan(8);
      expect(p.maxSpeed, p.id).toBeGreaterThan(5);
      expect(p.batteryMinutes, p.id).toBeGreaterThan(10);
      expect(p.gimbalPitchMin, p.id).toBeLessThan(p.gimbalPitchMax);
    }
  });

  it('give each DJI WPML enum combination to one profile', () => {
    const keys = DRONE_PROFILES.filter((p) => p.wpml).map(
      (p) => `${p.wpml!.droneEnumValue}/${p.wpml!.droneSubEnumValue}/${p.wpml!.payloadEnumValue}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('match KMZ enums on drone, sub-type and payload', () => {
    expect(profileForWpml(77, 1, 67)?.id).toBe('dji-mavic-3t');
    expect(profileForWpml(77, 2, 68)?.id).toBe('dji-mavic-3m');
    expect(profileForWpml(89, 0, 50)?.id).toBe('dji-m350-p1');
    expect(profileForWpml(60, 0, 42)?.id).toBe('dji-m300-h20');
    // Unknown payload still finds the right airframe.
    expect(profileForWpml(91, 1, 12345)?.id).toBe('dji-m3td');
    expect(profileForWpml(4242, 0, 0)).toBeUndefined();
  });
});
