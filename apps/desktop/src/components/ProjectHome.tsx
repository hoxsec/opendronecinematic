import { getProfile } from '@odc/core';
import { useProject } from '../projectStore';
import { projectKey } from '../projectStorage';
import { useStore } from '../store';
import { isTauri } from '../platform';
import { Icon } from './Icon';

function dateLabel(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}

export function ProjectHome({ onSettings }: { onSettings(): void }) {
  const {
    active,
    data,
    dirty,
    path,
    busy,
    request,
    resume,
    removeRecent,
    storageError,
    actionError,
  } = useProject();
  const mission = useStore((s) => s.mission);
  const settings = useStore((s) => s.settings);
  const activeKey = active ? projectKey(mission, path) : undefined;
  const recoveries = data.recoveries.filter((r) => r.key !== activeKey);
  const mapReady =
    !!settings.ionToken.trim() || settings.terrain === 'geotiff' || settings.buildings === 'local';

  return (
    <div className="project-home" aria-busy={!!busy}>
      <header className="home-header">
        <div className="brand">
          <img src="/icon.svg" alt="" />
          <span>
            OpenDrone<span className="brand-light">Cinematic</span>
          </span>
        </div>
        <div className="home-header-actions">
          <span className="local-badge">
            <span /> Local workspace
          </span>
          <button className="quiet" onClick={onSettings}>
            <Icon name="settings" /> Map settings
          </button>
        </div>
      </header>
      <main className="home-content">
        <section className="home-intro">
          <p className="eyebrow">YOUR FLIGHT PLANNING STUDIO</p>
          <h1>Ready for your next flight?</h1>
          <p className="home-subtitle">Plan the route. Frame the shot. Preview before you fly.</p>
          <div className="home-actions">
            <button
              className="primary large"
              disabled={!!busy}
              onClick={() => void request({ kind: 'new' })}
            >
              <Icon name="plus" /> New project <kbd>Ctrl N</kbd>
            </button>
            <button
              className="large"
              disabled={!!busy}
              onClick={() => void request({ kind: 'open' })}
            >
              <Icon name="folder" /> Open project <kbd>Ctrl O</kbd>
            </button>
          </div>
        </section>

        {storageError && (
          <div className="project-alert warning" role="alert">
            <Icon name="shield" />
            <div>
              <strong>Recovery needs attention</strong>
              <p>{storageError}</p>
            </div>
          </div>
        )}
        {actionError && (
          <div className="project-alert error" role="alert">
            <Icon name="file" />
            <div>
              <strong>Project action needs attention</strong>
              <p>{actionError}</p>
              <p>For a moved or inaccessible file, use Open project to locate it again.</p>
            </div>
          </div>
        )}

        {active && (
          <button className="resume-card" onClick={resume} disabled={!!busy}>
            <span className="home-file-icon">
              <Icon name="route" size={24} />
            </span>
            <span>
              <span className="eyebrow">CURRENT SESSION</span>
              <strong>{mission.name || 'Untitled mission'}</strong>
              <span className="muted">
                {dirty ? 'Unsaved changes · ' : ''}
                {mission.waypoints.length} waypoints · {getProfile(mission.droneProfileId).name}
              </span>
            </span>
            <span className="resume-label">
              Back to planner <Icon name="arrow" />
            </span>
          </button>
        )}

        {recoveries.length > 0 && (
          <section className="recovery-section" aria-labelledby="recovery-heading">
            <div className="home-section-heading">
              <h2 id="recovery-heading">
                <Icon name="recover" /> Unsaved work
              </h2>
              <span className="muted">Local recovery drafts · not saved project files</span>
            </div>
            <div className="recovery-grid">
              {recoveries.map((recovery) => (
                <div className="recovery-card" key={recovery.key}>
                  <div>
                    <strong>{recovery.mission.name || 'Untitled mission'}</strong>
                    <span className="muted">
                      {recovery.mission.waypoints.length} waypoints ·{' '}
                      {dateLabel(recovery.updatedAt)}
                    </span>
                    {recovery.path && (
                      <span className="muted small ellipsis" title={recovery.path}>
                        {recovery.path}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => void request({ kind: 'recover', key: recovery.key })}
                    disabled={!!busy}
                  >
                    Recover <Icon name="arrow" size={15} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="home-columns">
          <section className="recent-section" aria-labelledby="recent-heading">
            <div className="home-section-heading">
              <h2 id="recent-heading">
                Recent projects <span className="count-badge">{data.recents.length}</span>
              </h2>
              <span className="muted small">
                {isTauri() ? 'Files stay where you save them' : 'Saved snapshots on this browser'}
              </span>
            </div>
            {data.recents.length ? (
              <ul className="recent-list">
                {data.recents.map((recent) => (
                  <li key={recent.key}>
                    <button
                      className="recent-open"
                      onClick={() => void request({ kind: 'recent', key: recent.key })}
                      disabled={!!busy}
                    >
                      <span className="home-file-icon">
                        <Icon name="file" size={22} />
                      </span>
                      <span className="recent-details">
                        <strong>{recent.mission.name || 'Untitled mission'}</strong>
                        <span className="ellipsis" title={recent.path ?? recent.fileName}>
                          {recent.path ?? `${recent.fileName} · browser snapshot`}
                        </span>
                        <span>
                          {getProfile(recent.mission.droneProfileId).name} ·{' '}
                          {recent.mission.waypoints.length} waypoints
                        </span>
                      </span>
                      <span className="recent-date">{dateLabel(recent.updatedAt)}</span>
                      <Icon name="arrow" size={16} />
                    </button>
                    <button
                      className="recent-remove quiet icon-button"
                      aria-label={`Remove ${recent.mission.name} from recent projects`}
                      title="Remove from this list only. The project file and recovery drafts are not deleted."
                      disabled={!!busy}
                      onClick={() => removeRecent(recent.key)}
                    >
                      <Icon name="close" size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="recent-empty">
                <span className="home-file-icon">
                  <Icon name="folder" size={26} />
                </span>
                <h3>A clear runway.</h3>
                <p>
                  Your projects will appear here after you open or save them.
                  <br />
                  Start fresh, or explore the practice project.
                </p>
                <button
                  className="text-button"
                  disabled={!!busy}
                  onClick={() => void request({ kind: 'open' })}
                >
                  Open an existing project <Icon name="arrow" size={16} />
                </button>
              </div>
            )}
            {!isTauri() && (
              <p className="muted small browser-hint">
                The browser cannot re-read files automatically. Open project loads the latest file;
                recent projects open the last saved snapshot.
              </p>
            )}
          </section>

          <aside className="home-start" aria-label="Getting started">
            <section className="sample-card">
              <div className="sample-art" aria-hidden="true">
                <svg viewBox="0 0 400 150" fill="none">
                  <path
                    className="contour"
                    d="M-20 140C60 0 100 150 200 30s180 70 230-30M-20 170C70 30 110 180 210 60s180 70 230-30M-20 110C50-30 90 120 190 0s180 70 230-30"
                  />
                  <path className="sample-route" d="M60 110C70 45 155 35 215 60s85 55 120-15" />
                  <circle cx="60" cy="110" r="5" />
                  <circle cx="145" cy="47" r="5" />
                  <circle cx="240" cy="74" r="5" />
                  <circle cx="335" cy="45" r="5" />
                  <path d="m185 83 12-26 8 20 20 8-27 10Z" className="sample-aircraft" />
                </svg>
                <span>LEARN BY EXPLORING</span>
              </div>
              <div className="sample-body">
                <h3>Your first cinematic move.</h3>
                <p>Explore a rising orbit, follow the camera, and try editing a waypoint.</p>
                <button onClick={() => void request({ kind: 'sample' })} disabled={!!busy}>
                  <Icon name="film" size={16} /> Open practice project{' '}
                  <Icon name="arrow" size={16} />
                </button>
                <span className="muted small">
                  Illustrative terrain heights. For practice, not flight.
                </span>
              </div>
            </section>
            <button className="map-setup-card" onClick={onSettings}>
              <span className={`setup-icon ${mapReady ? 'ready' : ''}`}>
                <Icon name="map" size={22} />
              </span>
              <span>
                <strong>{mapReady ? 'Your map workspace' : 'Make the map your own'}</strong>
                <span>
                  {mapReady
                    ? 'Review terrain, imagery, and offline data.'
                    : 'Add real terrain and 3D buildings, or start with the basic map.'}
                </span>
              </span>
              <Icon name="arrow" size={16} />
            </button>
            <p className="home-safety">
              <Icon name="shield" size={17} />
              <span>
                DJI Fly has no direct mission import. Export support depends on your drone. Always
                check local airspace and verify your mission before flight.
              </span>
            </p>
          </aside>
        </div>
      </main>
      <footer className="home-footer">
        <span>
          <Icon name="shield" size={14} /> Projects and recovery stay on this device. Map services
          may use the internet.
        </span>
        <span>OpenDroneCinematic · Early development</span>
      </footer>
    </div>
  );
}
