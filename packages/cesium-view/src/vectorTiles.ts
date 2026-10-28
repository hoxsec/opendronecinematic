import { VectorTile, type VectorTileFeature } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import {
  Credit,
  Event,
  Rectangle,
  WebMercatorTilingScheme,
  type ImageryProvider,
  type Request,
} from 'cesium';

/** TileJSON fields the local tile server (or any MVT server) reports. */
export interface TileJson {
  tiles: string[];
  minzoom: number;
  maxzoom: number;
  bounds?: [number, number, number, number];
  attribution?: string;
}

export async function fetchTileJson(url: string): Promise<TileJson> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const MAX_CACHED = 512;

/** Fetches and decodes Mapbox Vector Tiles, shared by the basemap and the 3D buildings. */
export class VectorTileSource {
  private readonly cache = new Map<string, Promise<VectorTile | undefined>>();

  constructor(
    readonly template: string,
    readonly minZoom: number,
    readonly maxZoom: number,
    readonly bounds?: [number, number, number, number],
  ) {}

  get(z: number, x: number, y: number): Promise<VectorTile | undefined> {
    const key = `${z}/${x}/${y}`;
    const hit = this.cache.get(key);
    if (hit) {
      // Refresh recency.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const url = this.template
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y));
    const p = fetchTile(url).then((t) => {
      if (t === null) this.cache.delete(key);
      return t ?? undefined;
    });
    this.cache.set(key, p);
    if (this.cache.size > MAX_CACHED) this.cache.delete(this.cache.keys().next().value!);
    return p;
  }
}

/** Decoded tile, undefined for an empty tile, null for a failed request (retried later). */
async function fetchTile(url: string): Promise<VectorTile | undefined | null> {
  try {
    const res = await fetch(url);
    if (res.status === 204 || res.status === 404) return undefined;
    if (!res.ok) return null;
    let buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0) return undefined;
    // Servers that store gzipped tiles without a Content-Encoding header.
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
      buf = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return new VectorTile(new PbfReader(buf));
  } catch {
    return null;
  }
}

// Colours for the Protomaps basemap schema (https://docs.protomaps.com/basemaps/layers),
// close to the familiar OSM look so planning feels the same online and offline.
const C = {
  water: '#aad3df',
  earth: '#f2efe9',
  building: '#d9d0c9',
  buildingLine: '#c4b6ab',
  highway: '#f9b29c',
  major: '#fcd6a4',
  minor: '#ffffff',
  casing: '#b9b2a8',
  path: '#d97c6c',
  rail: '#8c8c8c',
  boundary: '#9e8fa8',
  text: '#3b3b3b',
  waterText: '#3d6b8c',
  halo: 'rgba(255,255,255,0.85)',
};

const LANDCOVER: Record<string, string> = {
  forest: '#c8dfb0',
  grassland: '#dcebc5',
  farmland: '#eef0d5',
  scrub: '#d5e5bb',
  barren: '#e8e0d4',
  glacier: '#ffffff',
  urban_area: '#e6e2dd',
};

const LANDUSE: Record<string, string> = {
  park: '#cdebb0',
  garden: '#cdebb0',
  grass: '#cdebb0',
  recreation_ground: '#cdebb0',
  playground: '#cdebb0',
  golf_course: '#cdebb0',
  pitch: '#aae0cb',
  forest: '#add19e',
  wood: '#add19e',
  nature_reserve: '#c4dcae',
  national_park: '#d4e5c0',
  protected_area: '#d4e5c0',
  meadow: '#d7ecbf',
  farmland: '#eef0d5',
  orchard: '#aedfa3',
  vineyard: '#aedfa3',
  residential: '#e0dfdf',
  industrial: '#ebdbe8',
  commercial: '#f2dad9',
  retail: '#f2dad9',
  railway: '#e5dde0',
  cemetery: '#aacbaf',
  hospital: '#f0e7d8',
  school: '#f0e7d8',
  university: '#f0e7d8',
  college: '#f0e7d8',
  military: '#f5dcdc',
  aerodrome: '#e9e7e2',
  runway: '#bbbbcc',
  taxiway: '#bbbbcc',
  beach: '#fff1ba',
  sand: '#f5e9c6',
  glacier: '#ddecec',
  wetland: '#d6e5dc',
  bare_rock: '#e5ddd6',
  scree: '#e5ddd6',
  scrub: '#c8d7ab',
  pedestrian: '#dddde8',
};

type Ctx = OffscreenCanvasRenderingContext2D;
type Project = (p: { x: number; y: number }) => [number, number];

const TILE_PX = 512;

/**
 * A Cesium imagery provider that draws vector tiles in the browser, so a downloaded country can
 * be shown with no raster tile server at all. Zooms past the data's max level are rendered from
 * the deepest tile (overzoom), keeping lines crisp.
 */
export class VectorTileImageryProvider {
  readonly tileWidth = TILE_PX;
  readonly tileHeight = TILE_PX;
  readonly minimumLevel = 0;
  readonly maximumLevel = 20;
  readonly tilingScheme = new WebMercatorTilingScheme();
  readonly rectangle: Rectangle;
  readonly tileDiscardPolicy = undefined;
  readonly errorEvent = new Event();
  readonly credit: Credit;
  readonly proxy = undefined;
  readonly hasAlphaChannel = false;
  readonly ready = true;

  constructor(
    private readonly source: VectorTileSource,
    attribution = '© OpenStreetMap contributors · Protomaps',
  ) {
    const b = source.bounds;
    this.rectangle = b
      ? Rectangle.fromDegrees(b[0], b[1], b[2], b[3])
      : this.tilingScheme.rectangle;
    this.credit = new Credit(attribution);
  }

  /** Typed handle for ImageryLayer, which only needs the duck-typed interface above. */
  asProvider(): ImageryProvider {
    return this as unknown as ImageryProvider;
  }

  getTileCredits() {
    return [];
  }

  pickFeatures() {
    return undefined;
  }

  async requestImage(x: number, y: number, level: number, _request?: Request) {
    const z = Math.min(level, this.source.maxZoom);
    const scale = 2 ** (level - z);
    const tile = await this.source.get(z, Math.floor(x / scale), Math.floor(y / scale));
    const canvas = new OffscreenCanvas(TILE_PX, TILE_PX);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = C.water;
    ctx.fillRect(0, 0, TILE_PX, TILE_PX);
    if (tile) drawTile(ctx, tile, level, (x % scale) / scale, (y % scale) / scale, scale);
    // Cesium uploads ImageBitmaps without flipping, expecting them decoded with flipY.
    return createImageBitmap(canvas, { imageOrientation: 'flipY' });
  }
}

function drawTile(
  ctx: Ctx,
  tile: VectorTile,
  level: number,
  ox: number,
  oy: number,
  scale: number,
) {
  const layer = (name: string) => {
    const l = tile.layers[name];
    const out: VectorTileFeature[] = [];
    if (l) for (let i = 0; i < l.length; i++) out.push(l.feature(i));
    return out;
  };
  const extentOf = (name: string) => tile.layers[name]?.extent ?? 4096;
  // Tile units -> canvas pixels of the (possibly overzoomed) window [ox, ox + 1/scale).
  const projFor = (name: string): Project => {
    const k = (scale * TILE_PX) / extentOf(name);
    const dx = ox * scale * TILE_PX;
    const dy = oy * scale * TILE_PX;
    return (p) => [p.x * k - dx, p.y * k - dy];
  };
  // Road widths grow with zoom like a typical web map.
  const w = (base: number) => Math.max(0.5, base * 2 ** ((level - 14) * 0.75));

  const fillLayer = (name: string, colour: (f: VectorTileFeature) => string | undefined) => {
    const proj = projFor(name);
    for (const f of layer(name)) {
      if (f.type !== 3) continue;
      const c = colour(f);
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.beginPath();
      pathRings(ctx, f, proj, true);
      ctx.fill();
    }
  };

  fillLayer('earth', () => C.earth);
  fillLayer('landcover', (f) => LANDCOVER[String(f.properties.kind)]);
  fillLayer('landuse', (f) => LANDUSE[String(f.properties.kind)]);
  fillLayer('water', () => C.water);

  const waterProj = projFor('water');
  ctx.strokeStyle = C.water;
  ctx.lineCap = 'round';
  for (const f of layer('water')) {
    if (f.type !== 2) continue;
    ctx.lineWidth = f.properties.kind === 'river' ? w(3) : w(1.2);
    ctx.beginPath();
    pathRings(ctx, f, waterProj, false);
    ctx.stroke();
  }

  if (level >= 14) {
    const proj = projFor('buildings');
    ctx.fillStyle = C.building;
    ctx.strokeStyle = C.buildingLine;
    ctx.lineWidth = 0.6;
    for (const f of layer('buildings')) {
      if (f.type !== 3) continue;
      ctx.beginPath();
      pathRings(ctx, f, proj, true);
      ctx.fill();
      ctx.stroke();
    }
  }

  const roads = layer('roads').filter((f) => f.type === 2);
  const roadProj = projFor('roads');
  const style = (f: VectorTileFeature): [string, number, boolean] | undefined => {
    switch (f.properties.kind) {
      case 'highway':
        return [C.highway, 4, true];
      case 'major_road':
        return [C.major, 3, true];
      case 'minor_road':
        return [C.minor, level >= 13 ? 2.2 : 1, level >= 14];
      case 'path':
        return level >= 14 ? [C.path, 0.9, false] : undefined;
      default:
        return level >= 15 ? [C.minor, 1.2, true] : undefined;
    }
  };
  // Casings first, then fills, so junctions merge cleanly.
  ctx.lineJoin = 'round';
  for (const pass of ['casing', 'fill'] as const) {
    for (const f of roads) {
      const s = style(f);
      if (!s || (pass === 'casing' && !s[2])) continue;
      ctx.strokeStyle = pass === 'casing' ? C.casing : s[0];
      ctx.lineWidth = w(s[1]) + (pass === 'casing' ? 1.5 : 0);
      ctx.setLineDash(f.properties.kind === 'path' ? [3, 3] : []);
      ctx.beginPath();
      pathRings(ctx, f, roadProj, false);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  const railProj = projFor('transit');
  ctx.strokeStyle = C.rail;
  for (const f of layer('transit')) {
    if (f.type !== 2 || f.properties.kind !== 'rail') continue;
    ctx.lineWidth = w(1.2);
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    pathRings(ctx, f, railProj, false);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  const boundaryProj = projFor('boundaries');
  ctx.strokeStyle = C.boundary;
  for (const f of layer('boundaries')) {
    if (f.type !== 2) continue;
    const country = f.properties.kind === 'country';
    ctx.lineWidth = country ? 2 : 1;
    ctx.setLineDash(country ? [8, 4] : [4, 4]);
    ctx.beginPath();
    pathRings(ctx, f, boundaryProj, false);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  drawLabels(ctx, layer('pois'), projFor('pois'), level, true);
  drawLabels(ctx, layer('places'), projFor('places'), level, false);
}

function pathRings(ctx: Ctx, f: VectorTileFeature, proj: Project, close: boolean) {
  for (const ring of f.loadGeometry()) {
    ring.forEach((p, i) => {
      const [x, y] = proj(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (close) ctx.closePath();
  }
}

/** Place names and peaks. Labels that would cross the tile edge are skipped, not clipped. */
function drawLabels(
  ctx: Ctx,
  feats: VectorTileFeature[],
  proj: Project,
  level: number,
  pois: boolean,
) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const placed: [number, number, number, number][] = [];
  const sorted = feats
    .filter((f) => f.type === 1 && f.properties.name)
    .filter((f) => !pois || f.properties.kind === 'peak' || f.properties.kind === 'aerodrome')
    .filter((f) => Number(f.properties.min_zoom ?? 0) <= level + 0.5)
    .sort((a, b) =>
      Number(a.properties.population_rank ?? 0) < Number(b.properties.population_rank ?? 0)
        ? 1
        : -1,
    );
  for (const f of sorted) {
    const [x, y] = proj(f.loadGeometry()[0]![0]!);
    const kind = String(f.properties.kind);
    const size =
      kind === 'country'
        ? 15
        : kind === 'region'
          ? 13
          : kind === 'locality'
            ? Number(f.properties.population_rank ?? 0) > 10
              ? 15
              : 13
            : 11;
    let text = String(f.properties.name);
    if (kind === 'peak' && f.properties.elevation)
      text += ` ${Math.round(Number(f.properties.elevation))} m`;
    ctx.font = `${kind === 'locality' || kind === 'country' ? 600 : 500} ${size}px system-ui, sans-serif`;
    const tw = ctx.measureText(text).width;
    const box: [number, number, number, number] = [
      x - tw / 2 - 2,
      y - size,
      x + tw / 2 + 2,
      y + size,
    ];
    if (box[0] < 0 || box[1] < 0 || box[2] > TILE_PX || box[3] > TILE_PX) continue;
    if (placed.some((b) => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1]))
      continue;
    placed.push(box);
    if (kind === 'peak') {
      ctx.fillStyle = '#7a5c3e';
      ctx.beginPath();
      ctx.moveTo(x, y - 12);
      ctx.lineTo(x - 4, y - 5);
      ctx.lineTo(x + 4, y - 5);
      ctx.fill();
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.halo;
    ctx.fillStyle = kind === 'water' ? C.waterText : C.text;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  }
}
