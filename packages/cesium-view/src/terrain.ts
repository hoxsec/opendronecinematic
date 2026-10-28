import {
  CustomHeightmapTerrainProvider,
  WebMercatorTilingScheme,
  sampleTerrain,
  sampleTerrainMostDetailed,
  type Cartographic,
  type TerrainProvider,
} from 'cesium';

/** How elevation is packed into the RGB channels of a PNG/WebP tile. */
export type RgbEncoding = 'terrarium' | 'mapbox';

const SIZE = 65;
const MAX_DECODED = 96;

/** Level at which to sample providers that don't publish tile availability. */
const sampleLevels = new WeakMap<TerrainProvider, number>();

/**
 * Heightmap terrain from XYZ elevation image tiles (AWS Terrain Tiles / Mapzen Terrarium,
 * Mapbox Terrain-RGB, MapTiler terrain-rgb, ...). Levels beyond `maxLevel` are resampled from
 * the deepest tile so the globe keeps refining smoothly.
 */
export function createRgbTerrainProvider(opts: {
  url: string;
  encoding: RgbEncoding;
  maxLevel: number;
  credit?: string;
}): TerrainProvider {
  const decoded = new Map<string, Promise<Float32Array | undefined>>();
  const decode = (z: number, x: number, y: number) => {
    const key = `${z}/${x}/${y}`;
    let p = decoded.get(key);
    if (!p) {
      p = fetchHeights(tileUrl(opts.url, z, x, y), opts.encoding).then((h) => {
        // Don't remember failures; the network may come back.
        if (!h) decoded.delete(key);
        return h;
      });
      decoded.set(key, p);
      if (decoded.size > MAX_DECODED) decoded.delete(decoded.keys().next().value!);
    }
    return p;
  };

  const provider = new CustomHeightmapTerrainProvider({
    width: SIZE,
    height: SIZE,
    tilingScheme: new WebMercatorTilingScheme(),
    credit: opts.credit,
    callback: async (x, y, level) => {
      const z = Math.min(level, opts.maxLevel);
      const scale = 2 ** (level - z);
      const px = Math.floor(x / scale);
      const py = Math.floor(y / scale);
      const src = await decode(z, px, py);
      const out = new Float32Array(SIZE * SIZE);
      if (!src) return out;
      // This tile's window inside the source tile, in source pixels.
      const ox = ((x % scale) / scale) * 256;
      const oy = ((y % scale) / scale) * 256;
      const span = 256 / scale;
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          out[r * SIZE + c] = bilinear(
            src,
            ox + (c / (SIZE - 1)) * span,
            oy + (r / (SIZE - 1)) * span,
          );
        }
      }
      return out;
    },
  });
  sampleLevels.set(provider, opts.maxLevel);
  return provider;
}

/** Terrain heights at positions, for any provider (with or without availability). */
export async function sampleTerrainHeights(
  provider: TerrainProvider,
  positions: Cartographic[],
): Promise<number[]> {
  const level = sampleLevels.get(provider);
  const result =
    level !== undefined
      ? await sampleTerrain(provider, level, positions)
      : await sampleTerrainMostDetailed(provider, positions);
  return result.map((c) => c.height);
}

function tileUrl(template: string, z: number, x: number, y: number) {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

async function fetchHeights(url: string, encoding: RgbEncoding) {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const bmp = await createImageBitmap(await res.blob());
    const canvas = new OffscreenCanvas(256, 256);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, 256, 256);
    bmp.close();
    const px = ctx.getImageData(0, 0, 256, 256).data;
    const h = new Float32Array(256 * 256);
    for (let i = 0; i < h.length; i++) {
      const r = px[i * 4]!;
      const g = px[i * 4 + 1]!;
      const b = px[i * 4 + 2]!;
      h[i] =
        encoding === 'terrarium'
          ? r * 256 + g + b / 256 - 32768
          : -10000 + (r * 65536 + g * 256 + b) * 0.1;
    }
    return h;
  } catch {
    return undefined;
  }
}

function bilinear(h: Float32Array, x: number, y: number) {
  const fx = Math.min(255, Math.max(0, x - 0.5));
  const fy = Math.min(255, Math.max(0, y - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(255, x0 + 1);
  const y1 = Math.min(255, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = h[y0 * 256 + x0]! * (1 - tx) + h[y0 * 256 + x1]! * tx;
  const b = h[y1 * 256 + x0]! * (1 - tx) + h[y1 * 256 + x1]! * tx;
  return a * (1 - ty) + b * ty;
}
