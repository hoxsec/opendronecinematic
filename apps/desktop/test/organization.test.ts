import { beforeEach, describe, expect, it } from 'vitest';
import { createMission, createWaypoint, parseMission, serializeMission } from '@odc/core';
import { useStore } from '../src/store';
import {
  flightOutline,
  outlineWindow,
  OUTLINE_ROW_HEIGHT,
  reorderWaypoints,
} from '../src/waypointOrganization';

const makeMission = (count = 6) => ({
  ...createMission({ lat: 46, lon: 7, groundHeight: 500 }),
  waypoints: Array.from({ length: count }, (_, i) =>
    createWaypoint({
      id: `w${i}`,
      lat: 46 + i * 0.00001,
      lon: 7,
      groundHeight: 500,
      alt: 40 + i,
      actions: i === 2 ? [{ type: 'hover', seconds: 3 }] : [],
    }),
  ),
});
const order = () => useStore.getState().mission.waypoints.map((w) => w.id);
beforeEach(() => useStore.getState().loadMission(makeMission()));

describe('flight organization transactions', () => {
  it('names and groups nonadjacent waypoints without changing the flight, and persists/undoes metadata', () => {
    const st = useStore.getState();
    const before = st.mission;
    st.groupWaypoints(['w1', 'w3'], '  Orbit  ');
    const grouped = useStore.getState().mission;
    expect(order()).toEqual(before.waypoints.map((w) => w.id));
    expect(grouped.waypointGroups?.[0]?.name).toBe('Orbit');
    expect(grouped.waypoints[1]?.groupId).toBe(grouped.waypoints[3]?.groupId);
    expect(grouped.waypoints[2]).toBe(before.waypoints[2]);
    expect(useStore.getState().past).toHaveLength(1);
    st.undo();
    expect(useStore.getState().mission).toBe(before);
    st.redo();
    expect(useStore.getState().mission).toBe(grouped);
    st.updateWaypoint('w1', { name: 'Opening frame' });
    const saved = parseMission(serializeMission(useStore.getState().mission));
    expect(saved.waypoints[1]?.name).toBe('Opening frame');
    expect(saved.waypointGroups).toEqual(grouped.waypointGroups);
  });

  it('moves a selected block in route order, with one undo and no changes to altitude/actions', () => {
    const st = useStore.getState();
    const before = st.mission;
    st.selectWaypoints(['w3', 'w1', 'w2']);
    st.reorderWaypoints(['w3', 'w1', 'w2'], 'w5');
    expect(order()).toEqual(['w0', 'w4', 'w1', 'w2', 'w3', 'w5']);
    expect(useStore.getState().mission.waypoints[3]).toBe(before.waypoints[2]);
    expect(useStore.getState().selectedWaypointIds).toEqual(['w1', 'w2', 'w3']);
    expect(useStore.getState().past).toHaveLength(1);
    st.undo();
    expect(useStore.getState().mission).toBe(before);
    st.redo();
    expect(order()[1]).toBe('w4');
  });

  it('joins the destination group for waypoint drops and keeps membership for whole-group moves', () => {
    const st = useStore.getState();
    st.groupWaypoints(['w1', 'w2'], 'Orbit');
    const id = useStore.getState().mission.waypointGroups![0]!.id;
    st.reorderWaypoints(['w4'], 'w2', { groupId: id });
    expect(order()).toEqual(['w0', 'w1', 'w4', 'w2', 'w3', 'w5']);
    expect(useStore.getState().mission.waypoints[2]?.groupId).toBe(id);
    st.reorderWaypoints(['w1', 'w4', 'w2']);
    expect(order()).toEqual(['w0', 'w3', 'w5', 'w1', 'w4', 'w2']);
    expect(
      useStore
        .getState()
        .mission.waypoints.slice(3)
        .every((w) => w.groupId === id),
    ).toBe(true);
    st.undo();
    expect(order()).toEqual(['w0', 'w1', 'w4', 'w2', 'w3', 'w5']);
  });

  it('ignores invalid destinations and self-drops without adding undo history', () => {
    const m = makeMission();
    expect(reorderWaypoints(m, ['w1', 'w2'], 'w2')).toBe(m);
    expect(reorderWaypoints(m, ['w1'], 'missing')).toBe(m);
    expect(reorderWaypoints(m, ['missing'])).toBe(m);
    expect(reorderWaypoints(m, ['w1'], 'w2', { groupId: 'missing' })).toBe(m);
    expect(reorderWaypoints(m, ['w1'], 'w2')).toBe(m);
  });

  it('provides keyboard reordering for multiple runs and preserves selection at boundaries', () => {
    const st = useStore.getState();
    st.nudgeWaypoints(['w1', 'w2', 'w4'], -1);
    expect(order()).toEqual(['w1', 'w2', 'w0', 'w4', 'w3', 'w5']);
    st.nudgeWaypoints(['w1', 'w2', 'w4'], 1);
    expect(order()).toEqual(['w0', 'w1', 'w2', 'w3', 'w4', 'w5']);
    const before = useStore.getState().mission;
    st.nudgeWaypoints(['w0'], -1);
    expect(useStore.getState().mission).toBe(before);
  });

  it('duplicates with new IDs, independent actions, correct placement and a valid selection after undo', () => {
    const st = useStore.getState();
    st.duplicateWaypoints(['w2', 'w4']);
    const after = useStore.getState();
    const copies = after.mission.waypoints.slice(5, 7);
    expect(after.mission.waypoints).toHaveLength(8);
    expect(new Set(after.mission.waypoints.map((w) => w.id)).size).toBe(8);
    expect(copies[0]?.actions).toEqual([{ type: 'hover', seconds: 3 }]);
    expect(copies[0]?.actions[0]).not.toBe(after.mission.waypoints[2]?.actions[0]);
    expect(copies.map((w) => w.alt)).toEqual([42, 44]);
    expect(after.selectedWaypointIds).toEqual(copies.map((w) => w.id));
    st.undo();
    expect(order()).toHaveLength(6);
    expect(useStore.getState().selectedWaypointIds).toEqual([]);
  });

  it('cleans empty groups after ungroup/delete and restores them with undo', () => {
    const st = useStore.getState();
    st.groupWaypoints(['w1', 'w2'], 'Survey A');
    st.assignWaypointGroup(['w1']);
    expect(useStore.getState().mission.waypointGroups).toHaveLength(1);
    st.removeWaypoints(['w2']);
    expect(useStore.getState().mission.waypointGroups).toHaveLength(0);
    st.undo();
    expect(useStore.getState().mission.waypointGroups).toHaveLength(1);
    expect(
      parseMission(serializeMission(useStore.getState().mission)).waypoints[2]?.groupId,
    ).toBeTruthy();
  });

  it('bulk edits and reorders a 2,000-waypoint survey with a bounded undo transaction', () => {
    const st = useStore.getState();
    st.loadMission(makeMission(2000));
    const ids = useStore
      .getState()
      .mission.waypoints.slice(500, 1500)
      .map((w) => w.id);
    st.selectWaypoints(ids);
    st.groupWaypoints(ids, 'Survey block');
    st.updateWaypoints(ids, { speed: 7 });
    st.reorderWaypoints(ids, 'w0');
    expect(order().slice(0, 1000)).toEqual(ids);
    expect(
      useStore
        .getState()
        .mission.waypoints.slice(0, 1000)
        .every((w) => w.speed === 7),
    ).toBe(true);
    expect(useStore.getState().selectedWaypointIds).toHaveLength(1000);
    expect(useStore.getState().past).toHaveLength(3);
    st.undo();
    expect(order()[0]).toBe('w0');
  });
});

describe('large flight outline', () => {
  it('retains real flight order for interrupted groups, including filtered/collapsed views', () => {
    const st = useStore.getState();
    st.groupWaypoints(['w0', 'w1', 'w4', 'w5'], 'Orbit');
    const m = useStore.getState().mission;
    const id = m.waypointGroups![0]!.id;
    const all = flightOutline(m, '', 'all', new Set());
    expect(all.rows.filter((r) => r.kind === 'waypoint').map((r) => r.wp.id)).toEqual(order());
    const collapsed = flightOutline(m, '', 'all', new Set([id]));
    expect(collapsed.rows.filter((r) => r.kind === 'waypoint').map((r) => r.wp.id)).toEqual([
      'w2',
      'w3',
    ]);
    expect(collapsed.matchingIds).toHaveLength(6);
    const searched = flightOutline(m, 'orbit', 'all', new Set([id]));
    expect(searched.matchingIds).toEqual(['w0', 'w1', 'w4', 'w5']);
    expect(searched.rows.filter((r) => r.kind === 'group').map((r) => r.continued)).toEqual([
      false,
      true,
    ]);
    expect(flightOutline(m, 'hover', 'actions', new Set()).matchingIds).toEqual(['w2']);
    expect(flightOutline(m, '', `group:${id}`, new Set([id])).matchingIds).toEqual([
      'w0',
      'w1',
      'w4',
      'w5',
    ]);
  });

  it('searches names and tracked subjects, and does not match unassigned subjects', () => {
    const m = makeMission();
    m.pois = [{ id: 'p', name: 'Clock tower', lat: 46, lon: 7, height: 520 }];
    m.waypoints[2] = { ...m.waypoints[2]!, name: 'Opening reveal', heading: 'poi' };
    expect(flightOutline(m, 'opening TOWER', 'poi', new Set()).matchingIds).toEqual(['w2']);
    expect(flightOutline(m, 'tower', 'all', new Set()).matchingIds).toEqual(['w2']);
  });

  it('renders a bounded window at the start, middle and end, and recovers after filtering at the end', () => {
    for (const top of [0, 1000 * OUTLINE_ROW_HEIGHT, 2000 * OUTLINE_ROW_HEIGHT]) {
      const { start, end } = outlineWindow(2000, top, 520);
      expect(end - start).toBeLessThanOrEqual(18);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(2000);
    }
    expect(outlineWindow(2, 100000, 520)).toEqual({ start: 0, end: 2 });
    expect(outlineWindow(0, 100000, 520)).toEqual({ start: 0, end: 0 });
  });
});
