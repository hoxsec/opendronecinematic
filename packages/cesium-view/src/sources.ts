import {
  BingMapsImageryProvider,
  BingMapsStyle,
  Cesium3DTileset,
  CesiumTerrainProvider,
  EllipsoidTerrainProvider,
  ImageryLayer,
  Ion,
  IonResource,
  MapboxImageryProvider,
  MapboxStyleImageryProvider,
  OpenStreetMapImageryProvider,
  UrlTemplateImageryProvider,
  WebMapServiceImageryProvider,
  WebMapTileServiceImageryProvider,
  createOsmBuildingsAsync,
  createWorldTerrainAsync,
  type ImageryLayerCollection,
  type ImageryProvider,
  type Scene,
  type TerrainProvider,
} from 'cesium';
import type { Dem, Obstacle } from '@odc/core';
import { createDemTerrainProvider } from './dem';
import { LocalBuildings } from './localBuildings';
import { createRgbTerrainProvider } from './terrain';
import { VectorTileImageryProvider, VectorTileSource, fetchTileJson } from './vectorTiles';
import { installTileCache } from './tileCacheAdapter';

export type ImagerySource =
  | 'ion'
  | 'osm'
  | 'esri'
  | 'opentopomap'
  | 'carto-light'
  | 'carto-dark'
  | 's2cloudless'
  | 'maptiler-satellite'
  | 'maptiler-streets'
  | 'maptiler-topo'
  | 'mapbox-satellite'
  | 'mapbox-streets'
  | 'bing'
  | 'stadia-satellite'
  | 'stadia-terrain'
  | 'custom'
  | 'local';
export type TerrainSource =
  'ion' | 'terrarium' | 'maptiler' | 'mapbox' | 'custom' | 'geotiff' | 'none';
export type BuildingSource = 'none' | 'osm' | 'google' | 'local';

export interface ApiKeys {
  maptiler: string;
  mapbox: string;
  bing: string;
  stadia: string;
}

export interface CustomImagery {
  kind: 'xyz' | 'wms' | 'wmts';
  /** XYZ template ({z}/{x}/{y}, {s}, {reverseY}), WMS endpoint, or WMTS KVP/REST URL. */
  url: string;
  /** WMS layers (comma-separated) or the WMTS layer. */
  layers: string;
  /** WMTS only. */
  style: string;
  tileMatrixSet: string;
  /** Image MIME type for WMS/WMTS. */
  format: string;
  maxLevel: number;
}

export interface LocalDataSettings {
  /** The desktop app's local tile server, e.g. http://127.0.0.1:47831. */
  serverUrl: string;
  /** Key of a downloaded region, e.g. "germany" or "us__california". */
  region: string;
  /** Check the path against masts, power lines and airfields from the region's OSM data. */
  obstacles: boolean;
}

export interface DataSourceSettings {
  /** Personal Cesium ion token. Without one, ion sources fall back to free ones. */
  ionToken: string;
  keys: ApiKeys;
  imagery: ImagerySource;
  terrain: TerrainSource;
  buildings: BuildingSource;
  customImagery: CustomImagery;
  /** Quantized-mesh terrain (layer.json) URL for terrain 'custom'. */
  customTerrainUrl: string;
  local: LocalDataSettings;
  /** URLs of the user's own 3D Tiles tileset.json files (photogrammetry, scans, ...). */
  customTilesets: string[];
  /** File name of the loaded GeoTIFF DEM (the raster itself is kept in IndexedDB). */
  demName?: string;
  /** Metres added to DEM heights, usually the geoid height to turn sea-level heights into WGS84. */
  demOffset: number;
}

export const DEFAULT_DATA_SOURCES: DataSourceSettings = {
  ionToken: '',
  keys: { maptiler: '', mapbox: '', bing: '', stadia: '' },
  imagery: 'ion',
  terrain: 'ion',
  buildings: 'osm',
  customImagery: {
    kind: 'xyz',
    url: '',
    layers: '',
    style: 'default',
    tileMatrixSet: 'GoogleMapsCompatible',
    format: 'image/jpeg',
    maxLevel: 19,
  },
  customTerrainUrl: '',
  local: { serverUrl: 'http://127.0.0.1:47831', region: '', obstacles: true },
  customTilesets: [],
  demOffset: 0,
};

/** Merge stored (possibly older) settings over the defaults, nested objects included. */
export function withDefaults(s: Partial<DataSourceSettings>): DataSourceSettings {
  const d = DEFAULT_DATA_SOURCES;
  return {
    ...d,
    ...s,
    keys: { ...d.keys, ...s.keys },
    customImagery: { ...d.customImagery, ...s.customImagery },
    local: { ...d.local, ...s.local },
  };
}

/** What a source needs before it can be used. */
export type Requirement =
  'ion' | keyof ApiKeys | 'customImagery' | 'customTerrain' | 'dem' | 'local';

export interface SourceOption<T extends string> {
  value: T;
  label: string;
  group: 'Free' | 'Cesium ion' | 'API key' | 'Your own' | 'Offline';
  needs?: Requirement;
}

export const IMAGERY_OPTIONS: SourceOption<ImagerySource>[] = [
  { value: 'osm', label: 'OpenStreetMap', group: 'Free' },
  { value: 'esri', label: 'Esri World Imagery (aerial)', group: 'Free' },
  { value: 'opentopomap', label: 'OpenTopoMap (contours)', group: 'Free' },
  { value: 'carto-light', label: 'CARTO Positron (light)', group: 'Free' },
  { value: 'carto-dark', label: 'CARTO Dark Matter', group: 'Free' },
  { value: 's2cloudless', label: 'Sentinel-2 cloudless (EOX, non-commercial)', group: 'Free' },
  { value: 'ion', label: 'Bing aerial', group: 'Cesium ion', needs: 'ion' },
  { value: 'maptiler-satellite', label: 'MapTiler Satellite', group: 'API key', needs: 'maptiler' },
  { value: 'maptiler-streets', label: 'MapTiler Streets', group: 'API key', needs: 'maptiler' },
  { value: 'maptiler-topo', label: 'MapTiler Topo', group: 'API key', needs: 'maptiler' },
  { value: 'mapbox-satellite', label: 'Mapbox Satellite', group: 'API key', needs: 'mapbox' },
  { value: 'mapbox-streets', label: 'Mapbox Streets', group: 'API key', needs: 'mapbox' },
  { value: 'bing', label: 'Bing aerial (own key)', group: 'API key', needs: 'bing' },
  {
    value: 'stadia-satellite',
    label: 'Stadia Alidade Satellite',
    group: 'API key',
    needs: 'stadia',
  },
  { value: 'stadia-terrain', label: 'Stadia Stamen Terrain', group: 'API key', needs: 'stadia' },
  { value: 'custom', label: 'Custom XYZ / WMS / WMTS', group: 'Your own', needs: 'customImagery' },
  { value: 'local', label: 'Downloaded country (offline)', group: 'Offline', needs: 'local' },
];

export const TERRAIN_OPTIONS: SourceOption<TerrainSource>[] = [
  { value: 'terrarium', label: 'AWS Terrain Tiles (SRTM, ~30 m)', group: 'Free' },
  { value: 'none', label: 'Flat (ellipsoid)', group: 'Free' },
  { value: 'ion', label: 'Cesium World Terrain', group: 'Cesium ion', needs: 'ion' },
  { value: 'maptiler', label: 'MapTiler Terrain', group: 'API key', needs: 'maptiler' },
  { value: 'mapbox', label: 'Mapbox Terrain-RGB', group: 'API key', needs: 'mapbox' },
  {
    value: 'custom',
    label: 'Custom quantized-mesh URL',
    group: 'Your own',
    needs: 'customTerrain',
  },
  { value: 'geotiff', label: 'GeoTIFF DEM (local file)', group: 'Your own', needs: 'dem' },
];

export const BUILDING_OPTIONS: SourceOption<BuildingSource>[] = [
  { value: 'none', label: 'None', group: 'Free' },
  { value: 'osm', label: 'OSM Buildings', group: 'Cesium ion', needs: 'ion' },
  { value: 'google', label: 'Google Photorealistic', group: 'Cesium ion', needs: 'ion' },
  { value: 'local', label: 'Downloaded country (offline)', group: 'Offline', needs: 'local' },
];

export function hasRequirement(s: DataSourceSettings, need?: Requirement): boolean {
  switch (need) {
    case undefined:
      return true;
    case 'ion':
      return s.ionToken.trim().length > 0;
    case 'customImagery':
      return s.customImagery.url.trim().length > 0;
    case 'customTerrain':
      return s.customTerrainUrl.trim().length > 0;
    case 'dem':
      return !!s.demName;
    case 'local':
      return s.local.serverUrl.trim().length > 0 && s.local.region.length > 0;
    default:
      return s.keys[need].trim().length > 0;
  }
}

/** Resolve requested sources against the keys and downloads actually available. */
export function effectiveSources(s: DataSourceSettings): DataSourceSettings {
  // Unknown values (settings from another version of the app) count as unavailable.
  const ok = <T extends string>(opts: SourceOption<T>[], v: T) => {
    const opt = opts.find((o) => o.value === v);
    return !!opt && hasRequirement(s, opt.needs);
  };
  return {
    ...s,
    imagery: ok(IMAGERY_OPTIONS, s.imagery) ? s.imagery : 'osm',
    // Free SRTM terrain beats a flat world for clearance checks.
    terrain: ok(TERRAIN_OPTIONS, s.terrain) ? s.terrain : 'terrarium',
    buildings: ok(BUILDING_OPTIONS, s.buildings) ? s.buildings : 'none',
  };
}

const localBase = (l: LocalDataSettings) =>
  `${l.serverUrl.replace(/\/+$/, '')}/regions/${encodeURIComponent(l.region)}`;

/** Obstacles from the local server within [west, south, east, north]. */
export async function fetchObstacles(
  l: LocalDataSettings,
  bbox: [number, number, number, number],
): Promise<Obstacle[]> {
  const res = await fetch(
    `${localBase(l)}/obstacles?bbox=${bbox.map((v) => v.toFixed(5)).join(',')}`,
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Obstacles: HTTP ${res.status}`);
  return res.json();
}

/** Vector tile sources are shared across scenes so a tile is fetched and decoded once. */
const vectorSources = new Map<string, Promise<VectorTileSource>>();

/** Forget decoded tiles, e.g. after a region was downloaded again. */
export const resetLocalTiles = () => vectorSources.clear();
function localVectorSource(l: LocalDataSettings): Promise<VectorTileSource> {
  const url = `${localBase(l)}/tiles.json`;
  let p = vectorSources.get(url);
  if (!p) {
    p = fetchTileJson(url).then(
      (tj) => new VectorTileSource(tj.tiles[0]!, tj.minzoom, tj.maxzoom, tj.bounds),
    );
    p.catch(() => vectorSources.delete(url));
    vectorSources.set(url, p);
  }
  return p;
}

const xyz = (url: string, maximumLevel: number, credit: string, subdomains?: string) =>
  new UrlTemplateImageryProvider({ url, maximumLevel, credit, subdomains });

async function imageryProvider(s: DataSourceSettings): Promise<ImageryLayer> {
  const k = s.keys;
  const layer = (p: ImageryProvider) => new ImageryLayer(p);
  switch (s.imagery) {
    case 'ion':
      return ImageryLayer.fromWorldImagery({});
    case 'osm':
      // OSM serves zoom 0-19; asking for 20 fails and stalls offline renders on tile timeouts.
      return layer(
        new OpenStreetMapImageryProvider({
          url: 'https://tile.openstreetmap.org/',
          maximumLevel: 19,
        }),
      );
    case 'esri':
      return layer(
        xyz(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          19,
          'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        ),
      );
    case 'opentopomap':
      return layer(
        xyz(
          'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
          17,
          '© OpenStreetMap contributors, SRTM · © OpenTopoMap (CC-BY-SA)',
          'abc',
        ),
      );
    case 'carto-light':
    case 'carto-dark':
      return layer(
        xyz(
          `https://{s}.basemaps.cartocdn.com/${s.imagery === 'carto-light' ? 'light_all' : 'dark_all'}/{z}/{x}/{y}.png`,
          19,
          '© OpenStreetMap contributors © CARTO',
          'abcd',
        ),
      );
    case 's2cloudless':
      return layer(
        xyz(
          'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg',
          15,
          'Sentinel-2 cloudless by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024)',
        ),
      );
    case 'maptiler-satellite':
      return layer(
        xyz(
          `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${k.maptiler}`,
          20,
          '© MapTiler © OpenStreetMap contributors',
        ),
      );
    case 'maptiler-streets':
    case 'maptiler-topo': {
      const map = s.imagery === 'maptiler-streets' ? 'streets-v2' : 'topo-v2';
      return layer(
        xyz(
          `https://api.maptiler.com/maps/${map}/256/{z}/{x}/{y}.png?key=${k.maptiler}`,
          20,
          '© MapTiler © OpenStreetMap contributors',
        ),
      );
    }
    case 'mapbox-satellite':
      return layer(new MapboxImageryProvider({ mapId: 'mapbox.satellite', accessToken: k.mapbox }));
    case 'mapbox-streets':
      return layer(
        new MapboxStyleImageryProvider({ styleId: 'streets-v12', accessToken: k.mapbox }),
      );
    case 'bing':
      return layer(
        await BingMapsImageryProvider.fromUrl('https://dev.virtualearth.net', {
          key: k.bing,
          mapStyle: BingMapsStyle.AERIAL,
        }),
      );
    case 'stadia-satellite':
      return layer(
        xyz(
          `https://tiles.stadiamaps.com/tiles/alidade_satellite/{z}/{x}/{y}.jpg?api_key=${k.stadia}`,
          20,
          '© CNES, Airbus DS, PlanetObserver · © Stadia Maps © OpenMapTiles © OpenStreetMap',
        ),
      );
    case 'stadia-terrain':
      return layer(
        xyz(
          `https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png?api_key=${k.stadia}`,
          18,
          '© Stadia Maps © Stamen Design © OpenMapTiles © OpenStreetMap',
        ),
      );
    case 'custom':
      return layer(customImagery(s.customImagery));
    case 'local': {
      const src = await localVectorSource(s.local);
      return layer(new VectorTileImageryProvider(src).asProvider());
    }
  }
}

function customImagery(c: CustomImagery): ImageryProvider {
  const url = c.url.trim();
  switch (c.kind) {
    case 'xyz':
      return xyz(url, c.maxLevel, '', url.includes('{s}') ? 'abc' : undefined);
    case 'wms':
      return new WebMapServiceImageryProvider({
        url,
        layers: c.layers,
        parameters: { format: c.format || 'image/png', transparent: false },
        maximumLevel: c.maxLevel,
      });
    case 'wmts':
      return new WebMapTileServiceImageryProvider({
        url,
        layer: c.layers,
        style: c.style || 'default',
        tileMatrixSetID: c.tileMatrixSet || 'GoogleMapsCompatible',
        format: c.format || 'image/jpeg',
        maximumLevel: c.maxLevel,
      });
  }
}

async function terrainProvider(s: DataSourceSettings, dem?: Dem): Promise<TerrainProvider> {
  switch (s.terrain) {
    case 'ion':
      return createWorldTerrainAsync();
    case 'terrarium':
      return createRgbTerrainProvider({
        url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
        encoding: 'terrarium',
        maxLevel: 15,
        credit: 'Terrain Tiles: Mapzen, AWS Open Data (SRTM, GMTED2010, ETOPO1, and others)',
      });
    case 'maptiler':
      return CesiumTerrainProvider.fromUrl(
        `https://api.maptiler.com/tiles/terrain-quantized-mesh-v2/?key=${s.keys.maptiler}`,
        { requestVertexNormals: true },
      );
    case 'mapbox':
      return createRgbTerrainProvider({
        url: `https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}.pngraw?access_token=${s.keys.mapbox}`,
        encoding: 'mapbox',
        maxLevel: 15,
        credit: '© Mapbox',
      });
    case 'custom':
      return CesiumTerrainProvider.fromUrl(s.customTerrainUrl.trim(), {
        requestVertexNormals: true,
      });
    case 'geotiff':
      if (!dem) throw new Error('the GeoTIFF DEM is not loaded.');
      return createDemTerrainProvider(dem);
    case 'none':
      return new EllipsoidTerrainProvider();
  }
}

export interface AppliedSources {
  tilesets: Cesium3DTileset[];
  /** Whether the globe should be visible in 3D. */
  showGlobe: boolean;
  /** Offline buildings from the downloaded region, when selected. */
  buildings?: LocalBuildings;
  errors: string[];
}

/**
 * Configure imagery, terrain and buildings on a scene. Called for the main globe, the camera
 * preview and the video renderer so they all show the same world. Pass the previous result to
 * remove what it added, and the loaded DEM when terrain is 'geotiff'.
 */
export async function applySources(
  scene: Scene,
  layers: ImageryLayerCollection,
  settings: DataSourceSettings,
  previous?: AppliedSources,
  dem?: Dem,
): Promise<AppliedSources> {
  installTileCache();
  const s = effectiveSources(settings);
  const errors: string[] = [];
  if (s.ionToken) Ion.defaultAccessToken = s.ionToken.trim();

  for (const t of previous?.tilesets ?? []) scene.primitives.remove(t);
  previous?.buildings?.destroy();

  layers.removeAll();
  try {
    layers.add(await imageryProvider(s));
  } catch (e) {
    errors.push(`Imagery: ${message(e)}`);
    layers.addImageryProvider(
      new OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/',
        maximumLevel: 19,
      }),
    );
  }

  try {
    scene.terrainProvider = await terrainProvider(s, dem);
  } catch (e) {
    errors.push(`Terrain: ${message(e)}`);
    scene.terrainProvider = new EllipsoidTerrainProvider();
  }

  const tilesets: Cesium3DTileset[] = [];
  let googleLoaded = false;
  const add = async (label: string, make: () => Promise<Cesium3DTileset>) => {
    try {
      const t = await make();
      scene.primitives.add(t);
      tilesets.push(t);
      return true;
    } catch (e) {
      errors.push(`${label}: ${message(e)}`);
      return false;
    }
  };
  if (s.buildings === 'osm') await add('OSM Buildings', () => createOsmBuildingsAsync());
  if (s.buildings === 'google') googleLoaded = await add('Google 3D Tiles', createGoogleTileset);
  for (const url of s.customTilesets)
    await add(`Tileset ${url}`, () => Cesium3DTileset.fromUrl(url));

  let buildings: LocalBuildings | undefined;
  if (s.buildings === 'local') {
    try {
      buildings = new LocalBuildings(scene, await localVectorSource(s.local));
      if (!buildings.available)
        errors.push('Offline buildings: re-download the region with zoom 14 or more');
    } catch (e) {
      errors.push(`Offline buildings: ${message(e)}`);
    }
  }

  // Photorealistic tiles already contain terrain; hiding the globe avoids z-fighting.
  // A failed Google request must leave the imagery/terrain fallback visible.
  const showGlobe = !googleLoaded;
  scene.globe.show = showGlobe;
  return { tilesets, buildings, errors, showGlobe };
}

/** Cesium ion asset id of Google Photorealistic 3D Tiles. */
const GOOGLE_3D_TILES_ASSET = 2275207;

/**
 * Like Cesium's createGooglePhotorealistic3DTileset, but with a Resource of its own. Cesium's
 * version hands every caller the same cached Resource, so when the map and the camera preview
 * load at once the second fails with "The Resource is already being fetched".
 */
async function createGoogleTileset(): Promise<Cesium3DTileset> {
  const resource = await IonResource.fromAssetId(GOOGLE_3D_TILES_ASSET);
  return Cesium3DTileset.fromUrl(resource, {
    cacheBytes: 1536 * 1024 * 1024,
    maximumCacheOverflowBytes: 1024 * 1024 * 1024,
    enableCollision: true,
    // The drone camera keeps moving; do not starve its tile requests while flying.
    cullRequestsWhileMoving: false,
  });
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
