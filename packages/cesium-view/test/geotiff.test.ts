import { describe, expect, it } from 'vitest';
import { writeArrayBuffer } from 'geotiff';
import { Dem, toUtm } from '@odc/core';
import { readGeoTiffDem } from '../src/dem';

/** A tiny 2x2 GeoTIFF with the given CRS key and tie point (the writer only does 8-bit). */
function tiff(keys: Record<string, number>, origin: [number, number], res: number) {
  const values = new Uint8Array([100, 200, 150, 250]);
  return writeArrayBuffer(values, {
    width: 2,
    height: 2,
    ModelPixelScale: [res, res, 0],
    ModelTiepoint: [0, 0, 0, origin[0], origin[1], 0],
    GTModelTypeGeoKey: keys.ProjectedCSTypeGeoKey ? 1 : 2,
    GTRasterTypeGeoKey: 1,
    ...keys,
  }) as ArrayBuffer;
}

describe('readGeoTiffDem', () => {
  it('reads a geographic WGS84 raster', async () => {
    const grid = await readGeoTiffDem(tiff({ GeographicTypeGeoKey: 4326 }, [8, 47], 0.01));
    expect(grid.crs).toEqual({ kind: 'geographic' });
    expect([grid.width, grid.height, grid.originX, grid.originY]).toEqual([2, 2, 8, 47]);
    expect(grid.resY).toBeCloseTo(-0.01);
    const dem = new Dem(grid, 10);
    // Two pixel centres, then the middle of all four.
    expect(dem.heightAt(46.995, 8.005)).toBeCloseTo(110);
    expect(dem.heightAt(46.985, 8.015)).toBeCloseTo(260);
    expect(dem.heightAt(46.99, 8.01)).toBeCloseTo(185);
  });

  it('reads a UTM raster', async () => {
    const [e, n] = toUtm({ lat: 47.3769, lon: 8.5417 }, 32, false);
    const grid = await readGeoTiffDem(tiff({ ProjectedCSTypeGeoKey: 32632 }, [e - 10, n + 10], 10));
    expect(grid.crs).toEqual({ kind: 'utm', zone: 32, south: false });
    expect(new Dem(grid).heightAt(47.3769, 8.5417)).toBeCloseTo(175, 0);
  });

  it('rejects unsupported projections with a hint', async () => {
    await expect(readGeoTiffDem(tiff({ ProjectedCSTypeGeoKey: 2056 }, [0, 0], 1))).rejects.toThrow(
      /EPSG:2056.*gdalwarp/,
    );
  });
});
