import { fromArrayBuffer } from 'geotiff';
import { CustomHeightmapTerrainProvider, GeographicTilingScheme, Math as CMath } from 'cesium';
import { Dem, crsFromEpsg, type DemGrid } from '@odc/core';

/** Larger rasters are resampled on load; 4096² floats is 64 MB, plenty for planning. */
const MAX_SIZE = 4096;

/**
 * Decode a single-band GeoTIFF elevation model (SRTM, Copernicus, national lidar DEMs, a
 * photogrammetry DSM, ...). Supports geographic WGS84, Web Mercator and UTM rasters.
 */
export async function readGeoTiffDem(buffer: ArrayBuffer): Promise<DemGrid> {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const keys = (image.getGeoKeys() ?? {}) as Record<string, number | undefined>;
  const epsg = keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey;
  const crs = epsg === undefined ? undefined : crsFromEpsg(epsg);
  if (!crs) {
    throw new Error(
      `Unsupported DEM coordinate system${epsg ? ` (EPSG:${epsg})` : ''}. Reproject it to WGS84 (EPSG:4326) or UTM first, e.g. with gdalwarp -t_srs EPSG:4326.`,
    );
  }

  const fullW = image.getWidth();
  const fullH = image.getHeight();
  const scale = Math.min(1, MAX_SIZE / Math.max(fullW, fullH));
  const width = Math.max(1, Math.round(fullW * scale));
  const height = Math.max(1, Math.round(fullH * scale));
  const raster = (await image.readRasters({
    samples: [0],
    interleave: true,
    width,
    height,
    resampleMethod: 'bilinear',
  })) as unknown as ArrayLike<number>;

  const [x0, y0] = image.getOrigin();
  const [rx, ry] = image.getResolution();
  // Pixel-is-point rasters tie the coordinate to the pixel centre, not its corner.
  const pointShift = keys.GTRasterTypeGeoKey === 2 ? 0.5 : 0;
  const noData = image.getGDALNoData();
  return {
    width,
    height,
    data: raster,
    originX: x0! - rx! * pointShift,
    originY: y0! - ry! * pointShift,
    resX: (rx! * fullW) / width,
    resY: (ry! * fullH) / height,
    noData: noData ?? undefined,
    crs,
  };
}

const TILE = 65;

/**
 * A Cesium terrain provider backed by a DEM. Tiles outside the raster are flat at height 0
 * (the ellipsoid), so plan inside the DEM's footprint.
 */
export function createDemTerrainProvider(dem: Dem): CustomHeightmapTerrainProvider {
  const tilingScheme = new GeographicTilingScheme();
  const { south, west, north, east } = dem.bounds;
  return new CustomHeightmapTerrainProvider({
    width: TILE,
    height: TILE,
    tilingScheme,
    callback(x, y, level) {
      const rect = tilingScheme.tileXYToRectangle(x, y, level);
      const heights = new Float32Array(TILE * TILE);
      const r = {
        west: CMath.toDegrees(rect.west),
        east: CMath.toDegrees(rect.east),
        south: CMath.toDegrees(rect.south),
        north: CMath.toDegrees(rect.north),
      };
      if (r.west > east || r.east < west || r.south > north || r.north < south) return heights;
      for (let j = 0; j < TILE; j++) {
        const lat = r.north - ((r.north - r.south) * j) / (TILE - 1);
        for (let i = 0; i < TILE; i++) {
          const lon = r.west + ((r.east - r.west) * i) / (TILE - 1);
          heights[j * TILE + i] = dem.heightAt(lat, lon) ?? 0;
        }
      }
      return heights;
    },
  });
}
