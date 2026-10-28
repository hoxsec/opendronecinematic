import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import { createMission, waypointHeight, type Mission } from '@odc/core';
import {
  MAV_CMD,
  buildMavlinkItems,
  buildWpml,
  exportDjiKmz,
  exportLitchiCsv,
  exportMissionPlannerWaypoints,
  exportQgcPlan,
  importMissionFile,
  importQgcPlan,
  importedToMission,
  type ImportedPlan,
} from '../src';
import { NOW, orbitMission, surveyMission } from './fixtures';

describe('mavlink', () => {
  it('matches the QGC .plan golden file', async () => {
    const { data } = exportQgcPlan(orbitMission('ardupilot-px4-multirotor'), { firmware: 'px4' });
    await expect(data).toMatchFileSnapshot('./__snapshots__/orbit.plan');
  });

  it('matches the Mission Planner golden file', async () => {
    const { data } = exportMissionPlannerWaypoints(orbitMission('ardupilot-px4-multirotor'));
    await expect(data).toMatchFileSnapshot('./__snapshots__/orbit.waypoints');
  });

  it('writes takeoff, ROI, waypoints and camera commands in order', () => {
    const { data: items } = buildMavlinkItems(orbitMission());
    const cmds = items.map((i) => i.command);
    expect(cmds[0]).toBe(MAV_CMD.NAV_TAKEOFF);
    expect(cmds).toContain(MAV_CMD.DO_SET_ROI_LOCATION);
    const firstWp = cmds.indexOf(MAV_CMD.NAV_WAYPOINT);
    expect(cmds[firstWp + 1]).toBe(MAV_CMD.VIDEO_START_CAPTURE);
    expect(items[firstWp]!.params[0]).toBe(2); // hover folded into hold time
    expect(cmds[cmds.length - 1]).toBe(MAV_CMD.VIDEO_STOP_CAPTURE);
    const plan = JSON.parse(exportQgcPlan(orbitMission()).data);
    expect(plan.mission.items[1].params).toEqual([1, 5, -1, 0, 0, 0, 0]);
    const nav = plan.mission.items.find((i: { command: number }) => i.command === 16);
    expect(nav.params[3]).toBe(null);
  });

  it('triggers survey photos by distance and returns home', () => {
    const m = surveyMission();
    const { data: items } = buildMavlinkItems(m);
    const trig = items.filter((i) => i.command === MAV_CMD.DO_SET_CAM_TRIGG_DIST);
    expect(trig.length).toBe(m.waypoints.length);
    expect(trig[0]!.params[0]).toBeGreaterThan(0);
    expect(trig[1]!.params[0]).toBe(0);
    const gimbal = items.find((i) => i.command === MAV_CMD.DO_MOUNT_CONTROL);
    expect(gimbal?.params[0]).toBe(-90);
    expect(items[items.length - 1]!.command).toBe(MAV_CMD.NAV_RETURN_TO_LAUNCH);
  });
});

describe('survey photos in DJI and Litchi', () => {
  it('writes Litchi photo_distinterval on the mapping legs only', () => {
    const rows = exportLitchiCsv(surveyMission())
      .data.trim()
      .split('\n')
      .slice(1)
      .map((r) => r.split(','));
    expect(Number(rows[0]![45])).toBeGreaterThan(0);
    expect(rows[1]![45]).toBe('-1');
    expect(Number(rows[2]![45])).toBeGreaterThan(0);
  });

  it('writes DJI multipleDistance groups per line', () => {
    const m = surveyMission();
    const { templateKml } = buildWpml(m, { now: NOW }).data;
    const groups = templateKml.match(/multipleDistance/g) ?? [];
    expect(groups.length).toBe(m.waypoints.length / 2);
    expect(templateKml).toMatch(
      /<wpml:actionGroupStartIndex>0<\/wpml:actionGroupStartIndex>\s*<wpml:actionGroupEndIndex>1</,
    );
  });
});

/** Rebuild an exported-then-imported mission on the original ground heights. */
function roundTrip(m: Mission, plan: ImportedPlan) {
  return importedToMission(plan, createMission(m.takeoff), {
    home: m.takeoff.groundHeight,
    waypoints: plan.waypoints.map((_, i) => m.waypoints[i]?.groundHeight),
  });
}

function expectSamePositions(a: Mission, b: Mission, tol = 0.15) {
  expect(b.waypoints).toHaveLength(a.waypoints.length);
  a.waypoints.forEach((w, i) => {
    const v = b.waypoints[i]!;
    expect(v.lat).toBeCloseTo(w.lat, 6);
    expect(v.lon).toBeCloseTo(w.lon, 6);
    expect(Math.abs(waypointHeight(b, v) - waypointHeight(a, w))).toBeLessThan(tol);
  });
}

describe('import', () => {
  it('round-trips Litchi CSV including the POI and actions', () => {
    const m = orbitMission('dji-mini-4-pro');
    const plan = importMissionFile('orbit.csv', strToU8(exportLitchiCsv(m).data));
    expect(plan.warnings).toEqual([]);
    const back = roundTrip(m, plan);
    expectSamePositions(m, back);
    expect(back.pois).toHaveLength(1);
    expect(back.pois[0]!.height).toBeCloseTo(480, 1);
    expect(back.waypoints[0]!.gimbal).toBe('poi');
    expect(back.waypoints[0]!.actions).toEqual(m.waypoints[0]!.actions);
    expect(back.settings.pathMode).toBe('smooth');
  });

  it('round-trips a DJI KMZ and recognises the drone', () => {
    const m = orbitMission();
    const plan = importMissionFile('orbit.kmz', exportDjiKmz(m, { now: NOW }).data);
    expect(plan.warnings).toEqual([]);
    expect(plan.droneProfileId).toBe('dji-mavic-3e');
    const back = roundTrip(m, plan);
    expectSamePositions(m, back);
    expect(back.waypoints.every((w) => w.heading === 'poi')).toBe(true);
    expect(back.waypoints[back.waypoints.length - 1]!.actions).toEqual([{ type: 'stopRecording' }]);
  });

  it('round-trips survey photo intervals through every format', () => {
    const m = surveyMission();
    const files: [string, Uint8Array][] = [
      ['s.csv', strToU8(exportLitchiCsv(m).data)],
      ['s.kmz', exportDjiKmz(m, { now: NOW }).data],
      ['s.plan', strToU8(exportQgcPlan(m).data)],
      ['s.waypoints', strToU8(exportMissionPlannerWaypoints(m).data)],
    ];
    const intervals = (x: Mission) =>
      x.waypoints.map((w) => w.actions.find((a) => a.type === 'photoDistance'));
    for (const [name, bytes] of files) {
      const back = roundTrip(m, importMissionFile(name, bytes));
      expectSamePositions(m, back);
      expect(intervals(back), name).toEqual(intervals(m));
      expect(back.waypoints[0]!.gimbalPitch, name).toBe(-90);
    }
  });

  it('round-trips QGC plans with ROI, speeds and finish action', () => {
    const m = orbitMission();
    m.settings.finishAction = 'land';
    const plan = importQgcPlan(exportQgcPlan(m).data);
    expect(plan.settings.finishAction).toBe('land');
    const back = roundTrip(m, plan);
    expectSamePositions(m, back);
    expect(back.pois).toHaveLength(1);
    expect(back.waypoints[0]!.heading).toBe('poi');
    expect(back.waypoints[0]!.speed).toBe(5);
    expect(back.waypoints[0]!.actions).toEqual([
      { type: 'hover', seconds: 2 },
      { type: 'startRecording' },
    ]);
  });

  it('reads the generated items of QGC survey complex items', () => {
    const wp = (lat: number) => ({
      type: 'SimpleItem',
      command: 16,
      frame: 3,
      params: [0, 0, 0, null, lat, 8.5, 50],
    });
    const plan = importQgcPlan(
      JSON.stringify({
        fileType: 'Plan',
        mission: {
          plannedHomePosition: [47, 8.5, 400],
          items: [
            wp(47.001),
            {
              type: 'ComplexItem',
              complexItemType: 'survey',
              TransectStyleComplexItem: { Items: [wp(47.002), wp(47.003)] },
            },
            { type: 'ComplexItem', complexItemType: 'vtolLandingPattern' },
          ],
        },
      }),
    );
    expect(plan.waypoints.map((w) => w.lat)).toEqual([47.001, 47.002, 47.003]);
    expect(plan.home).toEqual({ lat: 47, lon: 8.5 });
    expect(plan.warnings[0]).toMatch(/vtolLandingPattern/);
  });

  it('rejects unknown files', () => {
    expect(() => importMissionFile('x.txt', strToU8('hello'))).toThrow(/Unrecognised/);
    expect(() => importMissionFile('x.plan', strToU8('{"a":1}'))).toThrow(/QGroundControl/);
  });
});
