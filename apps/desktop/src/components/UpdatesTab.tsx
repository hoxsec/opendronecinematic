import { isTauri } from '../platform';
import { useUpdates, updateBlockReason } from '../updateStore';
import { useProject } from '../projectStore';
import { useView } from '../viewStore';
import { formatBytes } from '../localData';

export function UpdatesTab() {
  const state = useUpdates();
  const dirty = useProject((s) => s.dirty);
  const projectBusy = useProject((s) => s.busy);
  // Subscribe to every readiness input, including work started while a download is running.
  useProject((s) => s.pendingAction);
  useView((s) => s.render);
  useView((s) => s.fly);
  const blocked = updateBlockReason();
  const busy = ['checking', 'downloading', 'installing'].includes(state.phase);
  return (
    <>
      <h3>App updates{state.currentVersion ? ` · ${state.currentVersion}` : ''}</h3>
      <p className="muted small">
        Signed updates are checked at startup in configured desktop releases. Nothing is downloaded
        or installed without your approval.
      </p>
      {!isTauri() ? (
        <p className="note">
          Updates are available in the desktop app only. Download installers from the GitHub
          releases page.
        </p>
      ) : state.phase === 'disabled' ? (
        <p className="note">
          This build has no update verification key/feed configured. Use a release installer to
          update manually.
        </p>
      ) : state.phase === 'current' ? (
        <p className="ok">You are running the latest available version.</p>
      ) : state.phase === 'checking' ? (
        <p role="status">Checking for updates…</p>
      ) : null}
      {state.version && (
        <p>
          <strong>
            {state.phase === 'installed' ? 'Installed' : 'Available'}: {state.version}
          </strong>
        </p>
      )}
      {state.notes && <pre className="update-notes">{state.notes}</pre>}
      {state.phase === 'downloading' && (
        <p role="status">
          Downloading and verifying… {formatBytes(state.bytes)}
          {state.total ? ` / ${formatBytes(state.total)}` : ''}
        </p>
      )}
      {state.error && (
        <p className="note" role="alert">
          {state.error}
        </p>
      )}
      {(state.phase === 'available' || state.phase === 'installed') && (
        <>
          <p className="note">
            Installing may close and restart the app. Save your project file first. On Windows, the
            installer closes the app automatically.
          </p>
          {blocked && <p className="note">{blocked}</p>}
          <div className="button-row">
            {dirty && (
              <button disabled={!!projectBusy} onClick={() => void useProject.getState().save()}>
                Save project…
              </button>
            )}
            <button
              className="primary"
              disabled={!!blocked}
              onClick={() => void (state.phase === 'installed' ? state.restart() : state.install())}
            >
              {state.phase === 'installed'
                ? 'Restart app'
                : state.downloaded
                  ? 'Install and restart'
                  : 'Download, install and restart'}
            </button>
          </div>
        </>
      )}
      <button
        disabled={!isTauri() || busy || state.phase === 'installed'}
        onClick={() => void state.check()}
      >
        Check for updates
      </button>
      <p className="muted small">
        Update signatures verify the publisher of the downloaded app; they are separate from Windows
        code signing and Apple notarization.
      </p>
    </>
  );
}
