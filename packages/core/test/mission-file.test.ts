import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DEFAULT_SURVEY,
  createMission,
  createWaypoint,
  parseMission,
  serializeMission,
} from '../src';

const makeMission = () => ({
  ...createMission({ lat: 46, lon: 7, groundHeight: 500 }),
  waypoints: [createWaypoint({ lat: 46.001, lon: 7, groundHeight: 500, alt: 50 })],
});

describe('project file validation', () => {
  it('round-trips version 1 without changing the file format', () => {
    const mission = { ...makeMission(), survey: { ...DEFAULT_SURVEY, polygon: [] } };
    expect(parseMission(serializeMission(mission))).toEqual(mission);
  });

  it('keeps backwards-compatible defaults for absent POIs and settings', () => {
    const { pois: _pois, settings: _settings, ...mission } = makeMission();
    expect(parseMission(JSON.stringify(mission))).toEqual({
      ...mission,
      pois: [],
      settings: DEFAULT_SETTINGS,
    });
  });

  it.each([
    ['null mission', () => null],
    [
      'invalid takeoff',
      () => ({ ...makeMission(), takeoff: { lat: 100, lon: 7, groundHeight: 0 } }),
    ],
    ['null waypoint', () => ({ ...makeMission(), waypoints: [null] })],
    [
      'invalid altitude',
      () => {
        const m = makeMission();
        return { ...m, waypoints: [{ ...m.waypoints[0], alt: null }] };
      },
    ],
    [
      'duplicate IDs',
      () => {
        const m = makeMission();
        return { ...m, waypoints: [m.waypoints[0], m.waypoints[0]] };
      },
    ],
    [
      'invalid camera mode',
      () => {
        const m = makeMission();
        return { ...m, waypoints: [{ ...m.waypoints[0], heading: 'bad' }] };
      },
    ],
    [
      'invalid action',
      () => {
        const m = makeMission();
        return { ...m, waypoints: [{ ...m.waypoints[0], actions: [null] }] };
      },
    ],
    [
      'invalid hover',
      () => {
        const m = makeMission();
        return {
          ...m,
          waypoints: [{ ...m.waypoints[0], actions: [{ type: 'hover', seconds: 'invalid' }] }],
        };
      },
    ],
    ['invalid POIs', () => ({ ...makeMission(), pois: {} })],
    [
      'invalid settings',
      () => ({ ...makeMission(), settings: { ...DEFAULT_SETTINGS, speed: null } }),
    ],
    ['invalid survey', () => ({ ...makeMission(), survey: { polygon: [null] } })],
    ['invalid date', () => ({ ...makeMission(), shoot: { start: 'not a date', utcOffset: 0 } })],
  ])('rejects %s before it can replace a project', (_label, value) => {
    expect(() => parseMission(JSON.stringify(value()))).toThrow();
  });

  it('preserves finite out-of-range editable values instead of making existing files unreadable', () => {
    const mission = {
      ...makeMission(),
      settings: { ...DEFAULT_SETTINGS, speed: 0 },
      customProfile: { maxSpeed: 0 },
    };
    expect(parseMission(serializeMission(mission))).toEqual(mission);
  });
});
