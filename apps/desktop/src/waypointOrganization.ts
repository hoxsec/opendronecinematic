import type { Mission, Waypoint } from '@odc/core';

export type WaypointFilter = 'all' | 'actions' | 'poi' | 'ungrouped' | `group:${string}`;
export type OutlineRow =
  | { kind: 'group'; key: string; groupId: string; name: string; continued: boolean; count: number }
  | { kind: 'waypoint'; key: string; wp: Waypoint; index: number };

/** Keep route order even when a named group spans more than one continuous section. */
export function flightOutline(
  mission: Mission,
  query: string,
  filter: WaypointFilter,
  collapsed: ReadonlySet<string>,
) {
  const groups = new Map(mission.waypointGroups?.map((g) => [g.id, g.name]));
  const pois = new Map(mission.pois.map((p) => [p.id, p.name]));
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches: { wp: Waypoint; index: number; section: number }[] = [];
  const counts = new Map<string, number>();
  let section = 0;
  mission.waypoints.forEach((wp, index) => {
    if (index === 0 || wp.groupId !== mission.waypoints[index - 1]?.groupId) section++;
    if (filter === 'actions' && !wp.actions.length) return;
    if (filter === 'poi' && wp.heading !== 'poi' && wp.gimbal !== 'poi') return;
    if (filter === 'ungrouped' && wp.groupId) return;
    if (filter.startsWith('group:') && wp.groupId !== filter.slice(6)) return;
    const text = [
      `waypoint ${index + 1}`,
      wp.name,
      groups.get(wp.groupId ?? ''),
      wp.heading === 'poi' || wp.gimbal === 'poi'
        ? pois.get(wp.poiId ?? mission.pois[0]?.id ?? '')
        : '',
      ...wp.actions.map((a) => a.type.replace(/([A-Z])/g, ' $1')),
    ]
      .join(' ')
      .toLocaleLowerCase();
    if (!words.every((word) => text.includes(word))) return;
    matches.push({ wp, index, section });
    if (wp.groupId) counts.set(wp.groupId, (counts.get(wp.groupId) ?? 0) + 1);
  });
  const rows: OutlineRow[] = [];
  const seen = new Set<string>();
  let previous = -1;
  // Filtering can hide a section: use original indices to retain real section boundaries.
  for (const { wp, index, section } of matches) {
    const group = wp.groupId;
    if (group && section !== previous) {
      rows.push({
        kind: 'group',
        key: `group:${wp.id}`,
        groupId: group,
        name: groups.get(group) ?? 'Group',
        continued: seen.has(group),
        count: counts.get(group)!,
      });
      seen.add(group);
    }
    if (!group || !collapsed.has(group) || words.length || filter !== 'all')
      rows.push({ kind: 'waypoint', key: wp.id, wp, index });
    previous = section;
  }
  return { rows, matchingIds: matches.map(({ wp }) => wp.id) };
}

/** Stable block move. A waypoint drop joins its destination group; a group drop retains labels. */
export function reorderWaypoints(
  mission: Mission,
  ids: readonly string[],
  beforeId?: string,
  membership?: { groupId?: string },
): Mission {
  const selected = new Set(ids);
  if (beforeId && selected.has(beforeId)) return mission;
  if (beforeId && !mission.waypoints.some((w) => w.id === beforeId)) return mission;
  if (membership?.groupId && !mission.waypointGroups?.some((g) => g.id === membership.groupId))
    return mission;
  const moving = mission.waypoints.filter((w) => selected.has(w.id));
  if (!moving.length) return mission;
  const rest = mission.waypoints.filter((w) => !selected.has(w.id));
  const index = beforeId ? rest.findIndex((w) => w.id === beforeId) : rest.length;
  const waypoints = [
    ...rest.slice(0, index),
    ...moving.map((w) =>
      membership && w.groupId !== membership.groupId ? { ...w, groupId: membership.groupId } : w,
    ),
    ...rest.slice(index),
  ];
  return waypoints.every((w, i) => w === mission.waypoints[i])
    ? mission
    : { ...mission, waypoints };
}

export function cleanWaypointGroups(mission: Mission): Mission {
  if (!mission.waypointGroups?.length) return mission;
  const used = new Set(mission.waypoints.map((w) => w.groupId));
  const groups = mission.waypointGroups.filter((g) => used.has(g.id));
  return groups.length === mission.waypointGroups.length
    ? mission
    : { ...mission, waypointGroups: groups };
}

export const OUTLINE_ROW_HEIGHT = 52;
/** Fixed-height window with overscan; clamps after filtering/deleting while scrolled to the end. */
export function outlineWindow(count: number, scrollTop: number, height: number) {
  const top = Math.max(0, Math.min(scrollTop, count * OUTLINE_ROW_HEIGHT - height));
  const start = Math.max(0, Math.floor(top / OUTLINE_ROW_HEIGHT) - 4);
  const end = Math.min(count, Math.ceil((top + height) / OUTLINE_ROW_HEIGHT) + 4);
  return { start, end };
}
