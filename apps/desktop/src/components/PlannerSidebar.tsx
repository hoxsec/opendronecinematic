import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useProject } from '../projectStore';
import { MissionPanel } from './MissionPanel';
import { SunPanel } from './SunPanel';
import { WaypointPanel } from './WaypointPanel';
import { PoiPanel } from './PoiPanel';
import { ShotPanel } from './ShotPanel';
import { SurveyPanel } from './SurveyPanel';
import { SafetyPanel } from './SafetyPanel';
import { Icon } from './Icon';

const TABS = [
  { id: 'plan', label: 'Plan', icon: 'route' },
  { id: 'create', label: 'Create', icon: 'film' },
  { id: 'light', label: 'Light', icon: 'clock' },
  { id: 'safety', label: 'Safety', icon: 'shield' },
] as const;

export function PlannerSidebar({ onSettings }: { onSettings(): void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('plan');
  const selected = useStore((s) => s.selectedId);
  const waypoints = useStore((s) => s.mission.waypoints.length);
  const needsBuildings = useStore(
    (s) => !s.settings.ionToken.trim() && s.settings.buildings !== 'local',
  );
  const storageError = useProject((s) => s.storageError);
  const actionError = useProject((s) => s.actionError);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (selected) setTab('plan');
  }, [selected]);
  return (
    <aside className="sidebar">
      <div className="sidebar-tabs" role="tablist" aria-label="Planning panels">
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
            <Icon name={item.icon} size={16} />
            {item.label}
          </button>
        ))}
      </div>
      <div className="sidebar-content">
        {storageError && (
          <div className="project-warning" role="alert">
            <strong>Recovery unavailable</strong>
            <p>{storageError}</p>
          </div>
        )}
        {actionError && (
          <div className="project-warning" role="alert">
            <p>{actionError}</p>
          </div>
        )}
        <div role="tabpanel" id="panel-plan" aria-labelledby="tab-plan" hidden={tab !== 'plan'}>
          {!waypoints && (
            <div className="planner-start">
              <span className="eyebrow">START YOUR FLIGHT PLAN</span>
              <h3>Find a place. Add your route.</h3>
              <p>Search for a location on the map, then place your takeoff and waypoints.</p>
              <button onClick={() => useStore.getState().setMode('addWaypoint')}>
                <Icon name="plus" size={15} /> Add waypoints <kbd>W</kbd>
              </button>
            </div>
          )}
          <MissionPanel />
          <WaypointPanel />
          <PoiPanel />
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
        {needsBuildings && (
          <button className="map-data-hint" onClick={onSettings}>
            <Icon name="map" size={18} />
            <span>
              <strong>Add terrain & 3D buildings</strong>
              <span>Configure map data for more useful previews and clearance checks.</span>
            </span>
            <Icon name="arrow" size={15} />
          </button>
        )}
      </div>
    </aside>
  );
}
