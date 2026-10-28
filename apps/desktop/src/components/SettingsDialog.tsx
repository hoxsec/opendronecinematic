import { useState } from 'react';
import { Dem, type DemGrid } from '@odc/core';
import {
  readGeoTiffDem,
  type BuildingSource,
  type DataSourceSettings,
  type ImagerySource,
  type TerrainSource,
} from '@odc/cesium-view';
import { useStore } from '../store';
import { saveDemFile } from '../demStore';
import { isTauri, openBinaryFile, pickLocalTileset } from '../platform';
import { Field, NumberInput, Select } from './fields';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const current = useStore((s) => s.settings);
  const dem = useStore((s) => s.dem);
  const [draft, setDraft] = useState<DataSourceSettings>(current);
  const [url, setUrl] = useState('');
  const [grid, setGrid] = useState<DemGrid | undefined>(dem?.grid);
  const [demError, setDemError] = useState<string>();
  const [loadingDem, setLoadingDem] = useState(false);
  const up = (patch: Partial<DataSourceSettings>) => setDraft((d) => ({ ...d, ...patch }));
  const hasToken = draft.ionToken.trim().length > 0;

  const loadGeoTiff = async () => {
    const file = await openBinaryFile([{ name: 'GeoTIFF elevation', extensions: ['tif', 'tiff'] }]);
    if (!file) return;
    setLoadingDem(true);
    setDemError(undefined);
    try {
      const buffer = file.data.slice().buffer;
      // Decode first so a bad file is reported here instead of on the next startup.
      setGrid(await readGeoTiffDem(buffer));
      await saveDemFile(buffer);
      up({ terrain: 'geotiff', demName: file.name });
    } catch (e) {
      setDemError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingDem(false);
    }
  };

  const apply = () => {
    const st = useStore.getState();
    if (grid && (grid !== dem?.grid || draft.demOffset !== dem.offset)) {
      st.setDem(new Dem(grid, draft.demOffset));
    }
    st.setSettings(draft);
    onClose();
  };

  const terrain = hasToken || draft.terrain === 'geotiff' ? draft.terrain : 'none';
  const bounds = grid && new Dem(grid).bounds;

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
              value={terrain}
              options={[
                { value: 'ion', label: 'Cesium World Terrain' },
                { value: 'geotiff', label: 'GeoTIFF DEM (local)' },
                { value: 'none', label: 'Flat (ellipsoid)' },
              ]}
              onChange={(t) => up({ terrain: t })}
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

        {terrain === 'geotiff' && (
          <>
            <h3>GeoTIFF terrain</h3>
            <p className="muted small">
              A single-band elevation GeoTIFF (SRTM, Copernicus DEM, national lidar, a
              photogrammetry DSM) in WGS84, Web Mercator or UTM. It works offline and is used for
              the terrain safety checks and survey terrain following.
            </p>
            <div className="button-row">
              <span className="mono ellipsis">
                {draft.demName && grid ? draft.demName : 'No file loaded'}
              </span>
              <button onClick={loadGeoTiff} disabled={loadingDem}>
                {loadingDem ? 'Reading…' : 'Load GeoTIFF…'}
              </button>
            </div>
            {grid && bounds && (
              <p className="muted small mono">
                {grid.width}×{grid.height} px · {bounds.south.toFixed(4)}…{bounds.north.toFixed(4)}
                °N, {bounds.west.toFixed(4)}…{bounds.east.toFixed(4)}°E
              </p>
            )}
            {demError && <p className="note">{demError}</p>}
            <Field
              label="Height offset"
              hint="Added to every DEM height. Most DEMs are above sea level: enter the geoid height for the area (e.g. ~48 m in central Europe, ~-30 m in California) to get WGS84 heights."
            >
              <NumberInput
                value={draft.demOffset}
                step={0.5}
                suffix="m"
                onChange={(demOffset) => up({ demOffset })}
              />
            </Field>
          </>
        )}

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
          <button className="primary" disabled={terrain === 'geotiff' && !grid} onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
