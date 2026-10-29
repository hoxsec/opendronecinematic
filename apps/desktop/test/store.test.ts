import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMission, createWaypoint } from '@odc/core';
import { PLAYBACK_RATES, useStore } from '../src/store';

const makeMission = () => ({
  ...createMission({ lat: 46, lon: 7, groundHeight: 500 }),
  waypoints: Array.from({ length: 5 }, (_, i) =>
    createWaypoint({ id: `w${i}`, lat: 46 + i * 0.001, lon: 7, groundHeight: 500, alt: 40 + i }),
  ),
});

beforeEach(() => {
  vi.useFakeTimers();
  useStore.setState({
    mission: makeMission(),
    past: [],
    future: [],
    selectedId: undefined,
    selectedWaypointIds: [],
    selectionAnchor: undefined,
    playbackRate: 1,
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('waypoint multi-selection', () => {
  it('supports individual toggles, ranges, and additive ranges with a stable anchor', () => {
    const { select } = useStore.getState();
    select('w1');
    select('w3', { range: true });
    expect(useStore.getState().selectedWaypointIds).toEqual(['w1', 'w2', 'w3']);
    select('w2', { range: true });
    expect(useStore.getState().selectedWaypointIds).toEqual(['w1', 'w2']);
    select('w4', { toggle: true });
    select('w3', { toggle: true, range: true });
    expect(new Set(useStore.getState().selectedWaypointIds)).toEqual(
      new Set(['w1', 'w2', 'w3', 'w4']),
    );
    select('w3', { toggle: true });
    expect(useStore.getState().selectedWaypointIds).not.toContain('w3');
    expect(useStore.getState().selectedId).toBe('w4');
    select('w0');
    expect(useStore.getState().selectedWaypointIds).toEqual(['w0']);
    select(undefined);
    expect(useStore.getState().selectedWaypointIds).toEqual([]);
  });

  it('bulk edits only selected fields, preserves per-waypoint actions and undoes in one step', () => {
    const st = useStore.getState();
    const before = st.mission;
    st.updateWaypoints(['w1', 'w3'], { speed: 8, gimbalPitch: -35 });
    expect(useStore.getState().past).toHaveLength(1);
    const after = useStore.getState().mission;
    expect(after.waypoints[0]).toBe(before.waypoints[0]);
    for (const i of [1, 3]) {
      expect(after.waypoints[i]).toMatchObject({ speed: 8, gimbalPitch: -35, alt: 40 + i });
    }
    st.undo();
    expect(useStore.getState().mission).toBe(before);
    st.redo();
    expect(useStore.getState().mission).toBe(after);
    st.updateWaypoints(['w1', 'w3'], (w) => ({
      actions: [...w.actions, { type: 'hover', seconds: w.alt }],
    }));
    expect(useStore.getState().mission.waypoints[1]!.actions).toContainEqual({
      type: 'hover',
      seconds: 41,
    });
    expect(useStore.getState().mission.waypoints[3]!.actions).toContainEqual({
      type: 'hover',
      seconds: 43,
    });
  });

  it('prunes deleted or replaced waypoints without changing selection identity on ordinary edits', () => {
    const st = useStore.getState();
    st.select('w1');
    st.select('w3', { toggle: true });
    const selection = useStore.getState().selectedWaypointIds;
    st.updateWaypoint('w1', { alt: 90 });
    expect(useStore.getState().selectedWaypointIds).toBe(selection);
    st.removeWaypoint('w3');
    expect(useStore.getState().selectedId).toBe('w1');
    expect(useStore.getState().selectedWaypointIds).toEqual(['w1']);
    st.setMission(createMission({ lat: 0, lon: 0, groundHeight: 0 }));
    expect(useStore.getState().selectedWaypointIds).toEqual([]);
    expect(useStore.getState().selectedId).toBeUndefined();
  });

  it('selects new waypoints for editing and clears waypoint selection for POIs', () => {
    const st = useStore.getState();
    st.addWaypointAt({ lat: 46, lon: 7, height: 500 });
    expect(useStore.getState().selectedWaypointIds).toEqual([
      useStore.getState().mission.waypoints.at(-1)!.id,
    ]);
    st.addPoiAt({ lat: 46, lon: 7, height: 500 });
    expect(useStore.getState().selectedWaypointIds).toEqual([]);
  });
});

describe('preview playback rates', () => {
  it('accepts all six rates without modifying mission flight speed or history', () => {
    const { mission, setPlaybackRate } = useStore.getState();
    for (const rate of PLAYBACK_RATES) {
      setPlaybackRate(rate);
      expect(useStore.getState().playbackRate).toBe(rate);
      expect(useStore.getState().mission).toBe(mission);
    }
    setPlaybackRate(-1);
    expect(useStore.getState().playbackRate).toBe(3);
    expect(useStore.getState().past).toHaveLength(0);
  });
});
