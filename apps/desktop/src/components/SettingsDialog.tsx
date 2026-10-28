import { useEffect, useMemo, useState } from 'react';
import { Dem, type DemGrid } from '@odc/core';
import {
  BUILDING_OPTIONS,
  IMAGERY_OPTIONS,
  TERRAIN_OPTIONS,
  effectiveSources,
  hasRequirement,
  readGeoTiffDem,
  type ApiKeys,
  type CustomImagery,
  type DataSourceSettings,
  type Requirement,
  type SourceOption,
} from '@odc/cesium-view';
import { useStore } from '../store';
import { saveDemFile } from '../demStore';
import { isTauri, openBinaryFile, pickLocalTileset } from '../platform';
import {
  canDownload,
  cancelRegionDownload,
  deleteRegion,
  downloadRegion,
  formatBytes,
  geofabrikRegions,
  regionKey,
  regionPbfSize,
  useLocalData,
  type GeofabrikRegion,
  type LocalRegion,
} from '../localData';
import { Field, NumberInput, Select } from './fields';

type Tab = 'sources' | 'offline' | 'keys';

const NEEDS: Record<Requirement, string> = {
  ion: 'a Cesium ion token',
  maptiler: 'a MapTiler key',
  mapbox: 'a Mapbox token',
  bing: 'a Bing Maps key',
  stadia: 'a Stadia Maps key',
  customImagery: 'a tile URL',
  customTerrain: 'a terrain URL',
  dem: 'a GeoTIFF file',
  local: 'a downloaded country',
};

const KEYS: { key: keyof ApiKeys; label: string; hint: string }[] = [
  { key: 'maptiler', label: 'MapTiler key', hint: 'Free tier at cloud.maptiler.com' },
  { key: 'mapbox', label: 'Mapbox access token', hint: 'Free tier at account.mapbox.com' },
  {
    key: 'stadia',
    label: 'Stadia Maps key',
    hint: 'Free for non-commercial use at stadiamaps.com',
  },
  { key: 'bing', label: 'Bing Maps key', hint: 'Enterprise keys from the Bing Maps Dev Center' },
];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const current = useStore((s) => s.settings);
  const dem = useStore((s) => s.dem);
  const [draft, setDraft] = useState<DataSourceSettings>(current);
  const [grid, setGrid] = useState<DemGrid | undefined>(dem?.grid);
  const [tab, setTab] = useState<Tab>('sources');
  const up = (patch: Partial<DataSourceSettings>) => setDraft((d) => ({ ...d, ...patch }));

  const apply = () => {
    const st = useStore.getState();
    if (grid && (grid !== dem?.grid || draft.demOffset !== dem.offset)) {
      st.setDem(new Dem(grid, draft.demOffset));
    }
    st.setSettings(draft);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>Map data</h2>
        <div className="tabs">
          {(
            [
              ['sources', 'Sources'],
              ['offline', 'Offline countries'],
              ['keys', 'Tokens & keys'],
            ] as const
          ).map(([t, label]) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'sources' && <SourcesTab draft={draft} up={up} grid={grid} setGrid={setGrid} />}
        {tab === 'offline' && <OfflineTab draft={draft} up={up} />}
        {tab === 'keys' && <KeysTab draft={draft} up={up} />}

        <div className="button-row end">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={draft.terrain === 'geotiff' && !grid}
            onClick={apply}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

interface TabProps {
  draft: DataSourceSettings;
  up(patch: Partial<DataSourceSettings>): void;
}

/** A select with options grouped by provider type; unusable ones say what they need. */
function SourceSelect<T extends string>({
  draft,
  value,
  options,
  onChange,
}: {
  draft: DataSourceSettings;
  value: T;
  options: SourceOption<T>[];
  onChange: (v: T) => void;
}) {
  const groups = [...new Set(options.map((o) => o.group))];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {options
            .filter((o) => o.group === g)
            .map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
                {!hasRequirement(draft, o.needs) && o.needs ? ` (needs ${NEEDS[o.needs]})` : ''}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

function SourcesTab({
  draft,
  up,
  grid,
  setGrid,
}: TabProps & { grid?: DemGrid; setGrid(g: DemGrid): void }) {
  const [url, setUrl] = useState('');
  const [demError, setDemError] = useState<string>();
  const [loadingDem, setLoadingDem] = useState(false);
  const bounds = grid && new Dem(grid).bounds;

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
  const eff = effectiveSources(draft);
  const label = <T extends string>(opts: SourceOption<T>[], v: T) =>
    opts.find((o) => o.value === v)?.label ?? v;
  const fallbacks = [
    eff.imagery !== draft.imagery &&
      `${label(IMAGERY_OPTIONS, draft.imagery)} needs ${NEEDS[IMAGERY_OPTIONS.find((o) => o.value === draft.imagery)!.needs!]}; using OpenStreetMap for now.`,
    eff.terrain !== draft.terrain &&
      `${label(TERRAIN_OPTIONS, draft.terrain)} needs ${NEEDS[TERRAIN_OPTIONS.find((o) => o.value === draft.terrain)!.needs!]}; using AWS Terrain Tiles for now.`,
    eff.buildings !== draft.buildings &&
      `${label(BUILDING_OPTIONS, draft.buildings)} needs ${NEEDS[BUILDING_OPTIONS.find((o) => o.value === draft.buildings)!.needs!]}; no 3D buildings for now.`,
  ].filter(Boolean);

  const addTileset = (u: string) => {
    if (u && !draft.customTilesets.includes(u))
      up({ customTilesets: [...draft.customTilesets, u] });
    setUrl('');
  };
  const custom = draft.customImagery;
  const upCustom = (patch: Partial<CustomImagery>) =>
    up({ customImagery: { ...custom, ...patch } });

  return (
    <>
      <div className="grid3">
        <Field label="Imagery">
          <SourceSelect
            draft={draft}
            value={draft.imagery}
            options={IMAGERY_OPTIONS}
            onChange={(imagery) => up({ imagery })}
          />
        </Field>
        <Field label="Terrain">
          <SourceSelect
            draft={draft}
            value={draft.terrain}
            options={TERRAIN_OPTIONS}
            onChange={(terrain) => up({ terrain })}
          />
        </Field>
        <Field label="3D buildings">
          <SourceSelect
            draft={draft}
            value={draft.buildings}
            options={BUILDING_OPTIONS}
            onChange={(buildings) => up({ buildings })}
          />
        </Field>
      </div>
      {fallbacks.map((f) => (
        <p key={f as string} className="muted small warn-text">
          {f}
        </p>
      ))}
      <p className="muted small">
        Terrain and buildings feed the clearance checks. Flat terrain disables them, and free
        terrain is ~30 m resolution, so keep a margin.
      </p>

      {draft.imagery === 'custom' && (
        <>
          <h3>Custom imagery</h3>
          <div className="grid3">
            <Field label="Type">
              <Select<CustomImagery['kind']>
                value={custom.kind}
                options={[
                  { value: 'xyz', label: 'XYZ tiles' },
                  { value: 'wms', label: 'WMS' },
                  { value: 'wmts', label: 'WMTS' },
                ]}
                onChange={(kind) => upCustom({ kind })}
              />
            </Field>
            {custom.kind !== 'xyz' && (
              <Field label={custom.kind === 'wms' ? 'Layers' : 'Layer'}>
                <input
                  value={custom.layers}
                  onChange={(e) => upCustom({ layers: e.target.value })}
                />
              </Field>
            )}
            <Field label="Max zoom">
              <NumberInput
                value={custom.maxLevel}
                min={1}
                max={24}
                onChange={(maxLevel) => upCustom({ maxLevel })}
              />
            </Field>
          </div>
          <Field label="URL">
            <input
              value={custom.url}
              placeholder={
                custom.kind === 'xyz'
                  ? 'https://tiles.example.com/{z}/{x}/{y}.png'
                  : custom.kind === 'wms'
                    ? 'https://geo.example.com/wms'
                    : 'https://geo.example.com/wmts'
              }
              onChange={(e) => upCustom({ url: e.target.value })}
            />
          </Field>
          {custom.kind === 'wmts' && (
            <div className="grid3">
              <Field label="Tile matrix set">
                <input
                  value={custom.tileMatrixSet}
                  onChange={(e) => upCustom({ tileMatrixSet: e.target.value })}
                />
              </Field>
              <Field label="Style">
                <input value={custom.style} onChange={(e) => upCustom({ style: e.target.value })} />
              </Field>
              <Field label="Format">
                <input
                  value={custom.format}
                  onChange={(e) => upCustom({ format: e.target.value })}
                />
              </Field>
            </div>
          )}
          <p className="muted small">
            XYZ templates may use {'{z} {x} {y} {s} {reverseY}'}. National orthophoto services
            (PDOK, swisstopo, IGN, USGS, ...) usually offer WMTS in Web Mercator.
          </p>
        </>
      )}

      {draft.terrain === 'custom' && (
        <Field label="Quantized-mesh terrain URL (folder with layer.json)">
          <input
            value={draft.customTerrainUrl}
            placeholder="https://terrain.example.com/tilesets/dem/"
            onChange={(e) => up({ customTerrainUrl: e.target.value })}
          />
        </Field>
      )}

      {draft.terrain === 'geotiff' && (
        <>
          <h3>GeoTIFF terrain</h3>
          <p className="muted small">
            A single-band elevation GeoTIFF (SRTM, Copernicus DEM, national lidar, a photogrammetry
            DSM) in WGS84, Web Mercator or UTM. It works offline and is used for the terrain safety
            checks and survey terrain following.
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
                onClick={() => up({ customTilesets: draft.customTilesets.filter((x) => x !== t) })}
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
    </>
  );
}

function KeysTab({ draft, up }: TabProps) {
  return (
    <>
      <p className="muted small">
        Stored only on this computer. Each key unlocks that provider's sources in the Sources tab.
      </p>
      <Field label="Cesium ion token">
        <input
          type="password"
          value={draft.ionToken}
          placeholder="Free token from ion.cesium.com: world terrain, Bing aerial, OSM and Google 3D buildings"
          onChange={(e) => up({ ionToken: e.target.value })}
          autoComplete="off"
        />
      </Field>
      {KEYS.map(({ key, label, hint }) => (
        <Field key={key} label={label}>
          <input
            type="password"
            value={draft.keys[key]}
            placeholder={hint}
            onChange={(e) => up({ keys: { ...draft.keys, [key]: e.target.value } })}
            autoComplete="off"
          />
        </Field>
      ))}
    </>
  );
}

function OfflineTab({ draft, up }: TabProps) {
  const { regions, progress, error, refresh } = useLocalData();
  const serverUrl = draft.local.serverUrl;
  useEffect(() => {
    refresh(serverUrl);
  }, [serverUrl]);

  const use = (r: LocalRegion) =>
    up({
      local: { ...draft.local, region: r.key },
      imagery: r.basemap ? 'local' : draft.imagery,
      buildings: r.basemap && r.basemap.maxZoom >= 14 ? 'local' : draft.buildings,
    });
  const tileUrl = (r: LocalRegion) => `${serverUrl}/regions/${r.key}/{z}/{x}/{y}.mvt`;

  return (
    <>
      <p className="muted small">
        Download a country (or state) from Geofabrik's region list to plan without internet: a
        vector basemap cut from the daily Protomaps OpenStreetMap build, 3D buildings with OSM
        heights, and masts, pylons, power lines, wind turbines and airfields for the safety checks.
      </p>

      {canDownload() ? (
        <RegionPicker />
      ) : (
        <>
          <Field label="Local tile server">
            <input
              value={serverUrl}
              onChange={(e) => up({ local: { ...draft.local, serverUrl: e.target.value } })}
            />
          </Field>
          <p className="muted small">
            Downloading countries needs the desktop app. While it runs, this build can use its
            downloads through the server above.
          </p>
        </>
      )}

      {Object.values(progress).map((p) => (
        <div key={p.key} className="download">
          <div className="download-head">
            <b>{p.id}</b>
            <span className="muted small ellipsis">{p.message}</span>
            <button onClick={() => cancelRegionDownload(p.key)}>Cancel</button>
          </div>
          <div className="battery">
            <div
              className={p.fraction == null ? 'indeterminate' : ''}
              style={{ width: `${Math.round((p.fraction ?? 1) * 100)}%` }}
            />
          </div>
        </div>
      ))}

      <h3>Downloaded</h3>
      {error && regions.length === 0 ? (
        <p className="muted small">Local tile server not reachable at {serverUrl}.</p>
      ) : regions.length === 0 ? (
        <p className="muted small">Nothing downloaded yet.</p>
      ) : (
        <ul className="list regions">
          {regions.map((r) => (
            <li key={r.key} className={draft.local.region === r.key ? 'selected' : ''}>
              <span>
                <b>{r.name}</b>
                <span className="muted small">
                  {r.basemap
                    ? ` · basemap z${r.basemap.maxZoom} ${formatBytes(r.basemap.bytes)}`
                    : ''}
                  {r.obstacles ? ` · ${r.obstacles.count.toLocaleString()} obstacles` : ''}
                  {r.updated ? ` · ${new Date(r.updated * 1000).toLocaleDateString()}` : ''}
                </span>
              </span>
              <span className="row-actions always">
                <button
                  title="Copy the XYZ vector tile URL for QGIS, MapLibre, ..."
                  onClick={() => navigator.clipboard?.writeText(tileUrl(r))}
                >
                  Copy URL
                </button>
                {draft.local.region === r.key ? (
                  <button disabled>In use</button>
                ) : (
                  <button className="primary" onClick={() => use(r)}>
                    Use
                  </button>
                )}
                {canDownload() && (
                  <button
                    title="Delete downloaded files"
                    onClick={async () => {
                      await deleteRegion(r.key).catch((e) =>
                        useStore.getState().notify(String(e), 'error'),
                      );
                      if (draft.local.region === r.key)
                        up({ local: { ...draft.local, region: '' } });
                      refresh(serverUrl);
                    }}
                  >
                    ✕
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={draft.local.obstacles}
          onChange={(e) => up({ local: { ...draft.local, obstacles: e.target.checked } })}
        />
        Check the path against mapped obstacles and airfields of the region in use
      </label>
      <p className="muted small">
        Tiles are served at {serverUrl}/regions/&lt;region&gt;/{'{z}/{x}/{y}'}.mvt (TileJSON at
        …/tiles.json, raw archive at …/basemap.pmtiles), so other tools on this computer can use
        them too. OSM data © OpenStreetMap contributors (ODbL).
      </p>
    </>
  );
}

const ZOOMS = [
  { value: '15', label: 'z15: full detail + 3D buildings' },
  { value: '14', label: 'z14: streets + 3D buildings' },
  { value: '12', label: 'z12: roads and towns only' },
  { value: '10', label: 'z10: overview only' },
] as const;

function RegionPicker() {
  const [all, setAll] = useState<GeofabrikRegion[]>();
  const [loadError, setLoadError] = useState<string>();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<GeofabrikRegion>();
  const [pbfSize, setPbfSize] = useState<number | null>();
  const [basemap, setBasemap] = useState(true);
  const [obstacles, setObstacles] = useState(true);
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]['value']>('15');
  const progress = useLocalData((s) => s.progress);

  useEffect(() => {
    geofabrikRegions().then(setAll, (e) => setLoadError(String(e)));
  }, []);
  useEffect(() => {
    setPbfSize(undefined);
    if (picked) regionPbfSize(picked.id).then(setPbfSize, () => setPbfSize(null));
  }, [picked]);

  const byId = useMemo(() => new Map((all ?? []).map((r) => [r.id, r])), [all]);
  const pathOf = (r: GeofabrikRegion) => {
    const names = [];
    for (let p = r.parent && byId.get(r.parent); p; p = p.parent ? byId.get(p.parent) : undefined)
      names.unshift(p.name);
    return names.join(' › ');
  };
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!all || !q) return [];
    return all
      .filter((r) => r.name.toLowerCase().includes(q) || r.id.includes(q))
      .sort(
        (a, b) =>
          Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)),
      )
      .slice(0, 40);
  }, [all, query]);

  if (loadError)
    return <p className="muted small">Couldn't load Geofabrik's region list: {loadError}</p>;
  const busy = picked ? !!progress[regionKey(picked.id)] : false;

  return (
    <>
      <Field label="Country or region">
        <input
          value={query}
          placeholder={
            all ? 'Search, e.g. Germany, California, Île-de-France' : 'Loading Geofabrik regions…'
          }
          disabled={!all}
          onChange={(e) => {
            setQuery(e.target.value);
            setPicked(undefined);
          }}
        />
      </Field>
      {!picked && matches.length > 0 && (
        <ul className="list picker">
          {matches.map((r) => (
            <li
              key={r.id}
              onClick={() => {
                setPicked(r);
                setQuery(r.name);
              }}
            >
              <span>
                {r.name} <span className="muted small">{pathOf(r)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <div className="download-options">
          <p className="small">
            <b>{picked.name}</b> <span className="muted">{pathOf(picked)}</span>
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={basemap}
              onChange={(e) => setBasemap(e.target.checked)}
            />
            Basemap and 3D buildings
            <select
              value={zoom}
              onChange={(e) => setZoom(e.target.value as typeof zoom)}
              disabled={!basemap}
            >
              {ZOOMS.map((z) => (
                <option key={z.value} value={z.value}>
                  {z.label}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={obstacles}
              onChange={(e) => setObstacles(e.target.checked)}
            />
            Obstacles and airfields
            <span className="muted small">
              {pbfSize === undefined
                ? '(checking size…)'
                : pbfSize === null
                  ? ''
                  : `(downloads ${formatBytes(pbfSize)} of OSM data, keeps only the obstacles)`}
            </span>
          </label>
          <p className="muted small">
            A z15 basemap is roughly the size of the OSM data; large countries take a few GB and
            several minutes.
          </p>
          <div className="button-row end">
            <button
              className="primary"
              disabled={busy || (!basemap && !obstacles)}
              onClick={() =>
                downloadRegion({ id: picked.id, basemap, obstacles, maxZoom: Number(zoom) }).catch(
                  (e) => useStore.getState().notify(String(e), 'error'),
                )
              }
            >
              {busy ? 'Downloading…' : 'Download'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
