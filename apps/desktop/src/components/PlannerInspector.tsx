import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useView } from '../viewStore';
import { MissionPanel } from './MissionPanel';
import { WaypointInspector } from './WaypointInspector';
import { PoiInspector } from './PoiPanel';
import { ShotPanel } from './ShotPanel';
import { SurveyPanel } from './SurveyPanel';
import { SunPanel } from './SunPanel';
import { SafetyPanel } from './SafetyPanel';
import { Icon } from './Icon';

const TABS = [
  { id: 'selection', label: 'Details' },
  { id: 'mission', label: 'Mission' },
  { id: 'create', label: 'Create' },
  { id: 'light', label: 'Light' },
  { id: 'safety', label: 'Safety' },
] as const;

export function PlannerInspector() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('selection');
  const selected = useStore((s) => s.selectedId);
  const open = useView((s) => s.inspectorOpen);
  const mode = useStore((s) => s.mode);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (selected) {
      setTab('selection');
      useView.getState().setInspectorOpen(true);
    }
  }, [selected]);
  useEffect(() => {
    if (mode === 'drawSurvey') {
      setTab('create');
      useView.getState().setInspectorOpen(true);
    }
  }, [mode]);
  return (
    <aside className="planner-inspector" aria-label="Inspector" hidden={!open}>
      <header className="workspace-panel-header">
        <div>
          <h2>Inspector</h2>
          <span>{selected ? 'Selection & flight settings' : 'Shape your flight'}</span>
        </div>
        <button
          className="quiet icon-button"
          title="Collapse inspector"
          aria-label="Collapse inspector"
          onClick={() => useView.getState().setInspectorOpen(false)}
        >
          <Icon name="panelRight" size={17} />
        </button>
      </header>
      <div className="sidebar-tabs inspector-tabs" role="tablist" aria-label="Inspector panels">
        {TABS.map((item, index) => (
          <button
            key={item.id}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            role="tab"
            id={`tab-${item.id}`}
            aria-controls={`panel-${item.id}`}
            aria-selected={tab === item.id}
            tabIndex={tab === item.id ? 0 : -1}
            className={tab === item.id ? 'selected' : ''}
            onClick={() => setTab(item.id)}
            onKeyDown={(e) => {
              const next =
                e.key === 'ArrowRight'
                  ? (index + 1) % TABS.length
                  : e.key === 'ArrowLeft'
                    ? (index + TABS.length - 1) % TABS.length
                    : e.key === 'Home'
                      ? 0
                      : e.key === 'End'
                        ? TABS.length - 1
                        : undefined;
              if (next === undefined) return;
              e.preventDefault();
              setTab(TABS[next]!.id);
              buttons.current[next]?.focus();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="inspector-content">
        <div
          role="tabpanel"
          id="panel-selection"
          aria-labelledby="tab-selection"
          hidden={tab !== 'selection'}
        >
          {selected ? (
            <>
              <WaypointInspector />
              <PoiInspector />
            </>
          ) : (
            <div className="inspector-empty">
              <Icon name="cursor" size={28} />
              <h3>Every detail, in its place</h3>
              <p>
                Select a waypoint or a point of interest on the map or in the outline to edit it
                here.
              </p>
              <p>Use the checkboxes to edit multiple waypoints together.</p>
              <button onClick={() => setTab('mission')}>
                <Icon name="settings" size={15} /> Mission settings
              </button>
              <button className="quiet" onClick={() => setTab('create')}>
                <Icon name="plus" size={15} /> Create a shot or survey
              </button>
            </div>
          )}
        </div>
        <div
          role="tabpanel"
          id="panel-mission"
          aria-labelledby="tab-mission"
          hidden={tab !== 'mission'}
        >
          <MissionPanel />
        </div>
        <div
          role="tabpanel"
          id="panel-create"
          aria-labelledby="tab-create"
          hidden={tab !== 'create'}
        >
          <ShotPanel />
          <SurveyPanel />
        </div>
        <div role="tabpanel" id="panel-light" aria-labelledby="tab-light" hidden={tab !== 'light'}>
          <SunPanel />
        </div>
        <div
          role="tabpanel"
          id="panel-safety"
          aria-labelledby="tab-safety"
          hidden={tab !== 'safety'}
        >
          <SafetyPanel />
        </div>
      </div>
    </aside>
  );
}
