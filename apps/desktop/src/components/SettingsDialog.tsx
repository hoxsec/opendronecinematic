import { useState } from 'react';
import type {
  BuildingSource,
  DataSourceSettings,
  ImagerySource,
  TerrainSource,
} from '@odc/cesium-view';
import { useStore } from '../store';
import { isTauri, pickLocalTileset } from '../platform';
import { Field, Select } from './fields';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const current = useStore((s) => s.settings);
  const [draft, setDraft] = useState<DataSourceSettings>(current);
  const [url, setUrl] = useState('');
  const up = (patch: Partial<DataSourceSettings>) => setDraft((d) => ({ ...d, ...patch }));
  const hasToken = draft.ionToken.trim().length > 0;

  const addTileset = (u: string) => {
    if (u && !draft.customTilesets.includes(u))
      up({ customTilesets: [...draft.customTilesets, u] });
    setUrl('');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Map data</h2>
        <Field label="Cesium ion token">
          <input
            type="password"
            value={draft.ionToken}
            placeholder="Paste your free token from ion.cesium.com"
            onChange={(e) => up({ ionToken: e.target.value })}
            autoComplete="off"
          />
        </Field>
        <p className="muted small">
          Stored only on this computer. Without a token the app uses OpenStreetMap imagery on flat
          terrain, so the terrain and building safety checks are disabled.
        </p>
        <div className="grid3">
          <Field label="Imagery">
            <Select<ImagerySource>
              value={hasToken ? draft.imagery : 'osm'}
              options={[
                { value: 'ion', label: 'Bing aerial (ion)' },
                { value: 'osm', label: 'OpenStreetMap' },
              ]}
              onChange={(imagery) => up({ imagery })}
            />
          </Field>
          <Field label="Terrain">
            <Select<TerrainSource>
              value={hasToken ? draft.terrain : 'none'}
              options={[
                { value: 'ion', label: 'Cesium World Terrain' },
                { value: 'none', label: 'Flat (ellipsoid)' },
              ]}
              onChange={(terrain) => up({ terrain })}
            />
          </Field>
          <Field label="3D buildings">
            <Select<BuildingSource>
              value={hasToken ? draft.buildings : 'none'}
              options={[
                { value: 'none', label: 'None' },
                { value: 'osm', label: 'OSM Buildings' },
                { value: 'google', label: 'Google Photorealistic' },
              ]}
              onChange={(buildings) => up({ buildings })}
            />
          </Field>
        </div>

        <h3>Your own 3D Tiles</h3>
        <p className="muted small">Photogrammetry or scans exported as 3D Tiles (tileset.json).</p>
        <ul className="list">
          {draft.customTilesets.map((t) => (
            <li key={t}>
              <span className="mono ellipsis">{t}</span>
              <span className="row-actions">
                <button
                  onClick={() =>
                    up({ customTilesets: draft.customTilesets.filter((x) => x !== t) })
                  }
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
        <div className="button-row">
          <input
            value={url}
            placeholder="https://…/tileset.json"
            onChange={(e) => setUrl(e.target.value)}
          />
          <button onClick={() => addTileset(url.trim())} disabled={!url.trim()}>
            Add URL
          </button>
          {isTauri() && (
            <button onClick={async () => addTileset((await pickLocalTileset()) ?? '')}>
              Browse…
            </button>
          )}
        </div>

        <div className="button-row end">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            onClick={() => {
              useStore.getState().setSettings(draft);
              onClose();
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
