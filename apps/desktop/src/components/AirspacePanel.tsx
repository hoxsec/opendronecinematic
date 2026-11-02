import { useEffect, useState } from 'react';
import { fmtTime } from '@odc/core';
import { useAirspace, useAirspaceConflicts } from '../airspaceStore';
import { activeScene } from '../sceneAccess';
import { isTauri, openBinaryFile } from '../platform';
import { OPENAIP_EXPORTS } from '../openaip';
import { useStore } from '../store';
import { Section } from './fields';

export function AirspacePanel() {
  const { layer, busy, initialized, error, importFile, downloadCountry, setVisible, remove } =
    useAirspace();
  const { conflicts, pending, error: checkError } = useAirspaceConflicts();
  const [picking, setPicking] = useState(false);
  const [country, setCountry] = useState('');
  // Re-evaluate expiry while the app remains open. Expired layers still warn about crossings.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const expired = layer?.data.validUntil && Date.parse(layer.data.validUntil) <= now;
  const load = async (format?: 'openaip') => {
    setPicking(true);
    try {
      const file = await openBinaryFile([
        { name: 'Airspace GeoJSON', extensions: ['geojson', 'json'] },
      ]);
      if (file) await importFile(file.name, file.data, format);
    } catch (error) {
      useStore.getState().notify(`Could not open airspace: ${String(error)}`, 'error');
    } finally {
      setPicking(false);
    }
  };

  return (
    <Section title="Airspace overlays">
      <p className="note">
        Planning aid, not flight clearance. No live airspace or NOTAM feed is connected. Always
        check the official authority before flying.
      </p>
      <label>
        OpenAIP country code
        <input
          type="text"
          value={country}
          onChange={(e) => setCountry(e.target.value.toUpperCase())}
          maxLength={2}
          placeholder="e.g. AT, DE, GB"
          disabled={busy || picking}
        />
      </label>
      <div className="button-row">
        <button
          disabled={!isTauri() || !initialized || busy || picking || !/^[A-Z]{2}$/.test(country)}
          onClick={() => void downloadCountry(country)}
        >
          {busy ? 'Loading…' : 'Download OpenAIP airspaces'}
        </button>
        <button disabled={!initialized || busy || picking} onClick={() => void load('openaip')}>
          Import OpenAIP…
        </button>
      </div>
      <p className="muted small">
        Daily GeoJSON exports, no API key. Replaces the current layer; saved locally for offline
        use.
        {!isTauri() &&
          ' Direct downloads require the desktop app. In the browser, download airspace GeoJSON from OpenAIP and import it here.'}{' '}
        Data ©{' '}
        <a href={OPENAIP_EXPORTS} target="_blank" rel="noreferrer">
          OpenAIP
        </a>
        {' · '}
        <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noreferrer">
          CC BY-NC 4.0
        </a>
        . Check licensing for commercial use. Export date does not establish validity or complete
        coverage.
      </p>
      {error && (
        <p className="note" role="alert">
          {error}
        </p>
      )}
      {!initialized ? (
        <p role="status">Loading saved airspace…</p>
      ) : !layer ? (
        <p className="muted">
          No airspace loaded. Import WGS84 GeoJSON polygons from a source you trust.
        </p>
      ) : (
        <>
          <p>
            <strong>{layer.fileName}</strong> · {layer.data.zones.length.toLocaleString()} zones
          </p>
          <p className="muted small">
            Source: {layer.data.source ?? 'not supplied'}
            <br />
            Imported {new Date(layer.importedAt).toLocaleString()}
          </p>
          <p className={expired ? 'note' : 'muted small'}>
            {layer.data.validUntil
              ? `${expired ? 'Expired' : 'Declared validity ends'}: ${new Date(layer.data.validUntil).toLocaleString()}. Verify with the source.`
              : 'Freshness unknown: the source supplies no validity timestamp.'}
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={layer.visible}
              disabled={busy}
              onChange={(e) => void setVisible(e.target.checked)}
            />
            Show footprints on map (warnings stay on)
          </label>
          <div className="airspace-legend" aria-label="Airspace colors">
            <span className="restricted">Restricted</span>
            <span className="controlled">Controlled</span>
            <span className="advisory">Advisory</span>
          </div>
          <p className="muted small">
            Horizontal footprints only. Altitude limits and activation times are not evaluated.
            Checks follow the preview route, not takeoff, return or emergency procedures.
          </p>
          {pending ? (
            <p role="status">Checking route in the background…</p>
          ) : checkError ? (
            <p className="note" role="alert">
              {checkError}
            </p>
          ) : conflicts.length ? (
            <ul className="issues">
              {conflicts.map((c) => (
                <li key={c.zone.id} className="warning">
                  <button
                    className="issue-button"
                    onClick={() => {
                      useStore.getState().setTime(c.time);
                      activeScene?.flyTo(
                        c.position.lat,
                        c.position.lon,
                        1200,
                        1,
                        useStore.getState().mission.takeoff.groundHeight,
                      );
                    }}
                  >
                    <strong>Potential crossing · {c.zone.name}</strong>
                    <span>
                      {c.zone.category} · ~{Math.round(c.distance)} m · {fmtTime(c.time)}
                    </span>
                    {(c.zone.lower || c.zone.upper) && (
                      <span>
                        Published limits: {c.zone.lower ?? '?'} – {c.zone.upper ?? '?'}
                      </span>
                    )}
                    {c.zone.description && <span>{c.zone.description}</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">
              No horizontal crossings found in this file. This does not establish coverage or
              permission to fly.
            </p>
          )}
        </>
      )}
      <div className="button-row">
        <button disabled={!initialized || busy || picking} onClick={() => void load()}>
          {busy || picking ? 'Loading…' : layer ? 'Replace GeoJSON…' : 'Import GeoJSON…'}
        </button>
        {layer && (
          <button disabled={busy || picking} onClick={() => void remove()}>
            Remove layer
          </button>
        )}
      </div>
      <p className="muted small">
        Local to this device, not embedded in project files. Format: docs/airspace.md.
      </p>
    </Section>
  );
}
