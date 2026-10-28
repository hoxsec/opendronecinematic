import {
  Cesium3DTileset,
  EllipsoidTerrainProvider,
  ImageryLayer,
  Ion,
  OpenStreetMapImageryProvider,
  createGooglePhotorealistic3DTileset,
  createOsmBuildingsAsync,
  createWorldTerrainAsync,
  type Scene,
  type ImageryLayerCollection,
} from 'cesium';
import type { Dem } from '@odc/core';
import { createDemTerrainProvider } from './dem';

export type ImagerySource = 'ion' | 'osm';
export type TerrainSource = 'ion' | 'none' | 'geotiff';
export type BuildingSource = 'none' | 'osm' | 'google';

export interface DataSourceSettings {
  /** Personal Cesium ion token. Without one, only open OSM imagery and flat terrain are used. */
  ionToken: string;
  imagery: ImagerySource;
  terrain: TerrainSource;
  buildings: BuildingSource;
  /** URLs of the user's own 3D Tiles tileset.json files (photogrammetry, scans, ...). */
  customTilesets: string[];
  /** File name of the loaded GeoTIFF DEM (the raster itself is kept in IndexedDB). */
  demName?: string;
  /** Metres added to DEM heights, usually the geoid height to turn sea-level heights into WGS84. */
  demOffset: number;
}

export const DEFAULT_DATA_SOURCES: DataSourceSettings = {
  ionToken: '',
  imagery: 'ion',
  terrain: 'ion',
  buildings: 'osm',
  customTilesets: [],
  demOffset: 0,
};

/** Resolve requested sources against what is actually possible without a token. */
export function effectiveSources(s: DataSourceSettings): DataSourceSettings {
  const hasToken = s.ionToken.trim().length > 0;
  return {
    ...s,
    imagery: hasToken ? s.imagery : 'osm',
    // A local DEM works offline; Cesium World Terrain needs the token.
    terrain: s.terrain === 'geotiff' || hasToken ? s.terrain : 'none',
    buildings: hasToken ? s.buildings : 'none',
  };
}

export interface AppliedSources {
  tilesets: Cesium3DTileset[];
  errors: string[];
}

/**
 * Configure imagery, terrain and tilesets on a scene. Called for both the main globe and the
 * POV preview so they show the same world. Returns the tilesets it added so they can be removed.
 */
export async function applySources(
  scene: Scene,
  layers: ImageryLayerCollection,
  settings: DataSourceSettings,
  previous: Cesium3DTileset[] = [],
  dem?: Dem,
): Promise<AppliedSources> {
  const s = effectiveSources(settings);
  const errors: string[] = [];
  if (s.ionToken) Ion.defaultAccessToken = s.ionToken.trim();

  for (const t of previous) scene.primitives.remove(t);

  layers.removeAll();
  try {
    if (s.imagery === 'ion') {
      layers.add(ImageryLayer.fromWorldImagery({}));
    } else {
      layers.addImageryProvider(
        new OpenStreetMapImageryProvider({
          url: 'https://tile.openstreetmap.org/',
          // OSM serves zoom 0-19; asking for 20 fails and stalls offline renders on tile timeouts.
          maximumLevel: 19,
        }),
      );
    }
  } catch (e) {
    errors.push(`Imagery: ${message(e)}`);
  }

  try {
    if (s.terrain === 'geotiff' && !dem) errors.push('Terrain: the GeoTIFF DEM is not loaded.');
    scene.terrainProvider =
      s.terrain === 'ion'
        ? await createWorldTerrainAsync()
        : s.terrain === 'geotiff' && dem
          ? createDemTerrainProvider(dem)
          : new EllipsoidTerrainProvider();
  } catch (e) {
    errors.push(`Terrain: ${message(e)}`);
    scene.terrainProvider = new EllipsoidTerrainProvider();
  }

  const tilesets: Cesium3DTileset[] = [];
  const add = async (label: string, make: () => Promise<Cesium3DTileset>) => {
    try {
      const t = await make();
      scene.primitives.add(t);
      tilesets.push(t);
    } catch (e) {
      errors.push(`${label}: ${message(e)}`);
    }
  };
  if (s.buildings === 'osm') await add('OSM Buildings', () => createOsmBuildingsAsync());
  if (s.buildings === 'google')
    await add('Google 3D Tiles', () => createGooglePhotorealistic3DTileset());
  for (const url of s.customTilesets)
    await add(`Tileset ${url}`, () => Cesium3DTileset.fromUrl(url));

  // Photorealistic tiles already contain terrain; hiding the globe avoids z-fighting.
  scene.globe.show = s.buildings !== 'google';
  return { tilesets, errors };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
