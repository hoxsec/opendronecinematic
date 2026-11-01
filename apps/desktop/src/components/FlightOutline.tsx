import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { fmtTime } from '@odc/core';
import { useStore } from '../store';
import { useView } from '../viewStore';
import { usePath } from '../derived';
import { locateOnMap } from '../plannerActions';
import {
  flightOutline,
  outlineWindow,
  OUTLINE_ROW_HEIGHT as ROW,
  type OutlineRow,
  type WaypointFilter,
} from '../waypointOrganization';
import { Icon } from './Icon';

type Drop = { key: string; after: boolean; beforeId?: string; membership?: { groupId?: string } };

export function FlightOutline() {
  const mission = useStore((s) => s.mission);
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedWaypointIds);
  const mode = useStore((s) => s.mode);
  const st = useStore.getState();
  const path = usePath();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<WaypointFilter>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(400);
  const [dragging, setDragging] = useState(false);
  const [drop, setDrop] = useState<Drop>();
  const drag = useRef<{ ids: string[]; group: boolean } | undefined>(undefined);
  const pointer = useRef<number | undefined>(undefined);
  const list = useRef<HTMLDivElement>(null);
  const skipReveal = useRef(false);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const { rows, matchingIds } = useMemo(
    () => flightOutline(mission, query, filter, collapsed),
    [mission, query, filter, collapsed],
  );
  const matching = useMemo(() => new Set(matchingIds), [matchingIds]);
  const groups = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const w of mission.waypoints)
      if (w.groupId) {
        if (!result.has(w.groupId)) result.set(w.groupId, []);
        result.get(w.groupId)!.push(w.id);
      }
    return result;
  }, [mission.waypoints]);
  const hiddenCount = selectedIds.filter((id) => !matching.has(id)).length;
  const filtered = !!query.trim() || filter !== 'all';
  const allSelected = matchingIds.length > 0 && matchingIds.every((id) => selected.has(id));
  const { start, end } = outlineWindow(rows.length, scroll, height);
  const dropIndex = drop?.beforeId
    ? mission.waypoints.findIndex((w) => w.id === drop.beforeId)
    : -1;

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height);
    });
    if (list.current) observer.observe(list.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (list.current) list.current.scrollTop = 0;
    setScroll(0);
  }, [query, filter]);
  useEffect(() => {
    if (
      filter.startsWith('group:') &&
      !mission.waypointGroups?.some((g) => `group:${g.id}` === filter)
    )
      setFilter('all');
  }, [filter, mission.waypointGroups]);
  useEffect(() => {
    if (skipReveal.current) return;
    const groupId = mission.waypoints.find((w) => w.id === selectedId)?.groupId;
    if (groupId)
      setCollapsed((prev) => {
        if (!prev.has(groupId)) return prev;
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
  }, [selectedId, mission.waypoints]);
  useEffect(() => {
    if (skipReveal.current) {
      skipReveal.current = false;
      return;
    }
    const index = rows.findIndex((r) => r.kind === 'waypoint' && r.wp.id === selectedId);
    const el = list.current;
    if (!el || index < 0) return;
    const top = index * ROW;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight;
  }, [selectedId, rows]);
  useEffect(() => {
    if (!dragging) return;
    let frame: number;
    const tick = () => {
      const el = list.current;
      if (el && pointer.current !== undefined) {
        const rect = el.getBoundingClientRect();
        const y = pointer.current;
        if (y > rect.top && y < rect.bottom) {
          if (y < rect.top + 40) el.scrollTop -= 10;
          else if (y > rect.bottom - 40) el.scrollTop += 10;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);

  const selectRow = (id: string, toggle = false, range = false) => {
    if (range && filtered) {
      const anchor = matchingIds.indexOf(useStore.getState().selectionAnchor ?? '');
      const target = matchingIds.indexOf(id);
      if (anchor >= 0 && target >= 0) {
        const rangeIds = matchingIds.slice(Math.min(anchor, target), Math.max(anchor, target) + 1);
        st.selectWaypoints(toggle ? [...selectedIds, ...rangeIds] : rangeIds);
        // Keep the anchor and active endpoint stable for consecutive Shift selections.
        useStore.setState({ selectedId: id, selectionAnchor: matchingIds[anchor] });
      } else st.select(id, { toggle });
    } else st.select(id, { toggle, range });
    useView.getState().setInspectorOpen(true);
  };
  const selectAll = () => {
    skipReveal.current = true;
    st.selectWaypoints(
      allSelected
        ? selectedIds.filter((id) => !matching.has(id))
        : [...selectedIds, ...matchingIds],
    );
    if (!allSelected) useView.getState().setInspectorOpen(true);
  };
  const beginDrag = (e: DragEvent, ids: string[], group = false) => {
    drag.current = { ids, group };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `${ids.length} waypoints`);
    setDragging(true);
  };
  const finishDrag = () => {
    drag.current = undefined;
    pointer.current = undefined;
    setDragging(false);
    setDrop(undefined);
  };
  const dragOver = (e: DragEvent, row?: OutlineRow) => {
    if (!drag.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    pointer.current = e.clientY;
    const after = !!row && e.clientY > e.currentTarget.getBoundingClientRect().top + ROW / 2;
    let beforeId: string | undefined;
    let groupId: string | undefined;
    if (row?.kind === 'group') {
      const members = groups.get(row.groupId)!;
      beforeId = members[0];
      groupId = row.groupId;
    } else if (row) {
      groupId = row.wp.groupId;
      beforeId = mission.waypoints[row.index + (after ? 1 : 0)]?.id;
      // Whole groups land at section boundaries instead of being merged into another group.
      if (drag.current.group && groupId) {
        const members = groups.get(groupId)!;
        beforeId = after
          ? mission.waypoints[mission.waypoints.findIndex((w) => w.id === members.at(-1)) + 1]?.id
          : members[0];
      }
    }
    let key = row?.key ?? 'end';
    let indicatorAfter = row?.kind === 'group' ? false : after;
    if (drag.current.group) {
      const targetIndex = rows.findIndex((r) => r.kind === 'waypoint' && r.wp.id === beforeId);
      const preceding = rows[targetIndex - 1];
      key = preceding?.kind === 'group' ? preceding.key : (beforeId ?? 'end');
      indicatorAfter = false;
    }
    setDrop({
      key,
      after: indicatorAfter,
      beforeId,
      membership: drag.current.group ? undefined : { groupId },
    });
  };
  const commitDrop = (e: DragEvent) => {
    if (!drag.current || !drop) return;
    e.preventDefault();
    const before = useStore.getState().mission;
    st.reorderWaypoints(drag.current.ids, drop.beforeId, drop.membership);
    if (useStore.getState().mission !== before)
      st.notify(
        `Moved ${drag.current.ids.length} waypoint${drag.current.ids.length === 1 ? '' : 's'}. Undo is available.`,
      );
    finishDrag();
  };
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input:not([type="checkbox"]), select')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      e.stopPropagation();
      if (!allSelected) selectAll();
    } else if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      e.stopPropagation();
      st.duplicateWaypoints(selectedIds);
    } else if (e.altKey && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      st.nudgeWaypoints(selectedIds, e.key === 'ArrowUp' ? -1 : 1);
    } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      const visible = rows.filter((r) => r.kind === 'waypoint');
      const current = visible.findIndex((r) => r.wp.id === selectedId);
      const index =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? visible.length - 1
            : Math.max(0, Math.min(visible.length - 1, current + (e.key === 'ArrowUp' ? -1 : 1)));
      const row = visible[index];
      if (row) {
        list.current?.focus();
        selectRow(row.wp.id, mod, e.shiftKey);
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      st.removeWaypoints(selectedIds);
    } else if (e.key === 'Escape') {
      st.select();
      finishDrag();
    }
  };

  return (
    <section className="flight-outline" aria-labelledby="outline-heading">
      <header className="workspace-panel-header">
        <div>
          <h2 id="outline-heading">Flight outline</h2>
          <span>One flight · {mission.waypoints.length.toLocaleString()} waypoints</span>
        </div>
        <button
          className="quiet icon-button"
          title="Collapse flight outline"
          aria-label="Collapse flight outline"
          onClick={() => useView.getState().setOutlineOpen(false)}
        >
          <Icon name="panelLeft" size={17} />
        </button>
      </header>
      <div className="outline-summary">
        <Icon name="route" size={15} />
        <span>{Math.round(path.length).toLocaleString()} m</span>
        <span className="summary-dot">·</span>
        <Icon name="clock" size={14} />
        <span>{fmtTime(path.duration)}</span>
        <button
          className={mode === 'addWaypoint' ? 'active' : 'quiet'}
          onClick={() => st.setMode(mode === 'addWaypoint' ? 'select' : 'addWaypoint')}
        >
          <Icon name={mode === 'addWaypoint' ? 'close' : 'plus'} size={14} />
          {mode === 'addWaypoint' ? 'Done' : 'Add'}
        </button>
      </div>
      <div className="outline-search">
        <Icon name="search" size={16} />
        <input
          aria-label="Search waypoints"
          placeholder="Search names, groups, subjects…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            className="quiet icon-button"
            aria-label="Clear search"
            onClick={() => setQuery('')}
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
      <div className="outline-filter">
        <label title="Select all matching waypoints">
          <input
            type="checkbox"
            aria-label="Select all matching waypoints"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = !allSelected && matchingIds.some((id) => selected.has(id));
            }}
            onChange={selectAll}
          />
        </label>
        <select
          aria-label="Filter waypoints"
          value={filter}
          onChange={(e) => setFilter(e.target.value as WaypointFilter)}
        >
          <option value="all">All waypoints</option>
          <option value="actions">With actions</option>
          <option value="poi">Tracking a POI</option>
          <option value="ungrouped">Ungrouped</option>
          {!!mission.waypointGroups?.length && (
            <optgroup label="Groups">
              {mission.waypointGroups.map((g) => (
                <option key={g.id} value={`group:${g.id}`}>
                  {g.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <span>{matchingIds.length.toLocaleString()}</span>
      </div>
      {selectedId &&
        mission.waypoints.some((w) => w.id === selectedId) &&
        !matching.has(selectedId) && (
          <div className="outline-reveal">
            Selection is outside this filter.{' '}
            <button
              className="text-button"
              onClick={() => {
                setQuery('');
                setFilter('all');
              }}
            >
              Reveal
            </button>
          </div>
        )}
      <div
        className="outline-scroll"
        ref={list}
        tabIndex={0}
        role="region"
        aria-label="Ordered waypoints"
        aria-describedby="outline-help"
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
        onKeyDown={onKey}
        onDrop={commitDrop}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) pointer.current = undefined;
        }}
      >
        {!rows.length ? (
          <div className="outline-empty">
            <Icon name={filtered ? 'search' : 'route'} size={28} />
            <strong>{filtered ? 'No matching waypoints' : 'Build your flight'}</strong>
            <p>
              {filtered
                ? 'Try another name, group, subject, or action.'
                : 'Add waypoints on the map, or generate a shot or survey from the Create tab.'}
            </p>
            {filtered ? (
              <button
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                Clear filters
              </button>
            ) : (
              <button className="primary" onClick={() => st.setMode('addWaypoint')}>
                <Icon name="plus" size={15} /> Add waypoints
              </button>
            )}
          </div>
        ) : (
          <div
            role="list"
            aria-label="Flight sequence"
            style={{ height: rows.length * ROW, position: 'relative' }}
          >
            {rows.slice(start, end).map((row, offset) => {
              const group = row.kind === 'group';
              const ids = group ? groups.get(row.groupId)! : [row.wp.id];
              const groupMatches = group ? ids.filter((id) => matching.has(id)) : ids;
              const checked = group
                ? groupMatches.every((id) => selected.has(id))
                : selected.has(row.wp.id);
              const dropClass =
                drop?.key === row.key ? (drop.after ? ' drop-after' : ' drop-before') : '';
              return (
                <div
                  role="listitem"
                  aria-setsize={rows.length}
                  aria-posinset={start + offset + 1}
                  key={row.key}
                  className={`outline-row ${group ? 'outline-group' : 'outline-waypoint'}${checked ? ' selected' : ''}${dropClass}`}
                  style={{ position: 'absolute', top: (start + offset) * ROW, height: ROW }}
                  onDragOver={(e) => dragOver(e, row)}
                >
                  <span
                    className="drag-handle"
                    draggable
                    onDragStart={(e) => beginDrag(e, group || !checked ? ids : selectedIds, group)}
                    onDragEnd={finishDrag}
                    title={
                      group
                        ? 'Drag the whole group to reorder'
                        : 'Drag to reorder; use Move up/down for keyboard access'
                    }
                  >
                    <Icon name="grip" size={14} />
                  </span>
                  <input
                    type="checkbox"
                    checked={checked}
                    aria-label={
                      group ? `Select group ${row.name}` : `Select waypoint ${row.index + 1}`
                    }
                    ref={(el) => {
                      if (el)
                        el.indeterminate =
                          group && !checked && groupMatches.some((id) => selected.has(id));
                    }}
                    onChange={() => {
                      if (group) {
                        skipReveal.current = true;
                        st.selectWaypoints(
                          checked
                            ? selectedIds.filter((id) => !groupMatches.includes(id))
                            : [...selectedIds, ...groupMatches],
                        );
                        if (!checked) useView.getState().setInspectorOpen(true);
                      } else selectRow(row.wp.id, true);
                    }}
                  />
                  {group ? (
                    <button
                      className="outline-row-main group-toggle"
                      aria-expanded={!collapsed.has(row.groupId) || filtered}
                      disabled={filtered}
                      title={
                        filtered
                          ? 'Groups stay expanded while filtering'
                          : 'Expand or collapse group'
                      }
                      onClick={() =>
                        setCollapsed((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.groupId)) next.delete(row.groupId);
                          else next.add(row.groupId);
                          return next;
                        })
                      }
                    >
                      <span
                        className={`group-chevron ${!collapsed.has(row.groupId) || filtered ? 'expanded' : ''}`}
                      >
                        <Icon name="chevron" size={12} />
                      </span>
                      <Icon name="folder" size={15} />
                      <span className="outline-row-text">
                        <strong>{row.name}</strong>
                        <small>
                          {row.continued ? 'Continued · ' : ''}
                          {row.count} waypoints
                        </small>
                      </span>
                    </button>
                  ) : (
                    <button
                      className="outline-row-main"
                      aria-pressed={checked}
                      title={`${row.wp.name || `Waypoint ${row.index + 1}`} · Double-click to locate on map`}
                      onClick={(e) => selectRow(row.wp.id, e.ctrlKey || e.metaKey, e.shiftKey)}
                      onDoubleClick={() => locateOnMap(row.wp.id)}
                    >
                      <span className="waypoint-number">{row.index + 1}</span>
                      <span className="outline-row-text">
                        <strong>{row.wp.name || `Waypoint ${row.index + 1}`}</strong>
                        <small>
                          {row.wp.alt.toFixed(0)} m ·{' '}
                          {(row.wp.speed ?? mission.settings.speed).toFixed(1)} m/s
                          {row.wp.actions.length ? ` · ${row.wp.actions.length} actions` : ''}
                        </small>
                      </span>
                      {(row.wp.heading === 'poi' || row.wp.gimbal === 'poi') && (
                        <Icon name="pin" size={13} />
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {dragging && (
          <div
            className={`outline-drop-end${drop?.key === 'end' ? ' active' : ''}`}
            onDragOver={(e) => dragOver(e)}
          >
            Move to end of flight
          </div>
        )}
      </div>
      <div className="outline-selection" aria-live="polite">
        <strong>
          {selectedIds.length
            ? `${selectedIds.length.toLocaleString()} selected`
            : 'Select waypoints to organize'}
        </strong>
        {!!selectedIds.length && (
          <button className="text-button" onClick={() => st.select()}>
            Clear
          </button>
        )}
        {!!hiddenCount && <span>{hiddenCount} selected outside this filter</span>}
      </div>
      <div className="outline-actions">
        <button
          disabled={!selectedIds.length}
          title="Create a named group from selection"
          onClick={() => {
            setNaming(!naming);
            setName('');
          }}
        >
          <Icon name="folder" size={15} /> Group
        </button>
        <button
          disabled={!selectedIds.length}
          title="Duplicate selected waypoints (Ctrl/⌘+D in outline)"
          aria-label="Duplicate selected waypoints"
          onClick={() => st.duplicateWaypoints(selectedIds)}
        >
          <Icon name="copy" size={15} />
        </button>
        <button
          disabled={!selectedIds.length}
          title="Move selection up (Alt+↑)"
          aria-label="Move selected waypoints up"
          onClick={() => st.nudgeWaypoints(selectedIds, -1)}
        >
          <Icon name="up" size={15} />
        </button>
        <button
          disabled={!selectedIds.length}
          title="Move selection down (Alt+↓)"
          aria-label="Move selected waypoints down"
          onClick={() => st.nudgeWaypoints(selectedIds, 1)}
        >
          <Icon name="down" size={15} />
        </button>
        <button
          disabled={!selectedIds.length}
          className="delete-selection"
          title="Delete selection (Delete); undo with Ctrl/⌘+Z"
          aria-label="Delete selected waypoints"
          onClick={() => {
            st.removeWaypoints(selectedIds);
            st.notify(`Deleted ${selectedIds.length} waypoints. Undo is available.`);
          }}
        >
          <Icon name="trash" size={15} />
        </button>
      </div>
      {naming && (
        <form
          className="outline-group-form"
          onSubmit={(e) => {
            e.preventDefault();
            st.groupWaypoints(selectedIds, name);
            setNaming(false);
          }}
        >
          <input
            autoFocus
            aria-label="New group name"
            placeholder="e.g. Approach or Survey block A"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setNaming(false);
              }
            }}
          />
          <button type="submit" className="primary" disabled={!name.trim() || !selectedIds.length}>
            Create
          </button>
          <button type="button" aria-label="Cancel group creation" onClick={() => setNaming(false)}>
            <Icon name="close" size={14} />
          </button>
        </form>
      )}
      <p className="outline-help" id="outline-help">
        {dragging && drop
          ? dropIndex >= 0
            ? `Drop before waypoint ${dropIndex + 1}`
            : 'Drop at the end of the flight'
          : filtered
            ? 'Filtered view · moves use the full flight order'
            : 'Shift: range · Ctrl / ⌘: multi-select · Drag to reorder'}
      </p>
    </section>
  );
}
