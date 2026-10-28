import { classifyRings } from '@mapbox/vector-tile';
import {
  Cartesian3,
  Cartographic,
  Color,
  ColorGeometryInstanceAttribute,
  EllipsoidTerrainProvider,
  GeometryInstance,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
  type Scene,
} from 'cesium';
import { sampleTerrainHeights } from './terrain';
import type { VectorTileSource } from './vectorTiles';

interface Footprint {
  ring: [number, number][];
  bbox: [number, number, number, number];
  /** Ellipsoid heights of the roof and of the ground under it. */
  top: number;
  base: number;
}

interface Tile {
  x: number;
  y: number;
  footprints: Footprint[];
  primitive?: Primitive;
  ready: Promise<void>;
}

const MAX_TILES = 80;
const MAX_ENSURE_TILES = 150;
/** Load buildings once the camera is this low; above it they are too small to matter. */
const MAX_CAMERA_HEIGHT = 6000;
const DEFAULT_HEIGHT = 8;
const COLOR = Color.fromCssColorString('#d8d2ca');

/**
 * 3D buildings extruded from the `buildings` layer of downloaded vector tiles (Protomaps schema,
 * with OSM heights), so building clearance checks and the camera preview work fully offline.
 */
export class LocalBuildings {
  private readonly tiles = new Map<string, Tile>();
  private readonly zoom: number;
  private readonly removeListener: () => void;
  private lastTick = 0;
  private lastCenter?: Cartesian3;
  private destroyed = false;
  private pending = 0;
  private visible = true;

  constructor(
    private readonly scene: Scene,
    private readonly source: VectorTileSource,
  ) {
    this.zoom = Math.min(15, source.maxZoom);
    this.removeListener = scene.postRender.addEventListener(() => this.tick());
  }

  /** Buildings only exist in detailed tiles; a low-zoom download has none. */
  get available() {
    return this.zoom >= 14;
  }

  /** Nothing loading or still being tessellated, so a rendered frame is complete. */
  get idle() {
    if (this.pending > 0) return false;
    for (const t of this.tiles.values()) if (t.primitive && !t.primitive.ready) return false;
    return true;
  }

  /** Show or hide extrusions without discarding building data used by safety checks. */
  setVisible(visible: boolean) {
    this.visible = visible;
    for (const tile of this.tiles.values()) if (tile.primitive) tile.primitive.show = visible;
  }

  owns(primitive: unknown) {
    for (const t of this.tiles.values()) if (t.primitive === primitive) return true;
    return false;
  }

  /** Load the tiles under these positions (for safety checks away from the camera). */
  async ensure(positions: { lat: number; lon: number }[]) {
    if (!this.available) return;
    const keys = new Map<string, [number, number]>();
    for (const p of positions) {
      const [x, y] = tileOf(p.lat, p.lon, this.zoom);
      keys.set(`${x}/${y}`, [x, y]);
      if (keys.size >= MAX_ENSURE_TILES) break;
    }
    await Promise.all([...keys.values()].map(([x, y]) => this.load(x, y).ready));
  }

  /** Roof height (ellipsoid) of the tallest loaded building containing the point. */
  heightAt(lat: number, lon: number): number | undefined {
    if (!this.available) return undefined;
    const [x, y] = tileOf(lat, lon, this.zoom);
    const t = this.tiles.get(`${x}/${y}`);
    let best: number | undefined;
    for (const f of t?.footprints ?? []) {
      const [w, s, e, n] = f.bbox;
      if (lon < w || lon > e || lat < s || lat > n || !inside(f.ring, lon, lat)) continue;
      best = best === undefined ? f.top : Math.max(best, f.top);
    }
    return best;
  }

  destroy() {
    this.destroyed = true;
    this.removeListener();
    for (const t of this.tiles.values()) if (t.primitive) this.scene.primitives.remove(t.primitive);
    this.tiles.clear();
  }

  private tick() {
    const now = performance.now();
    if (!this.available || now - this.lastTick < 500) return;
    this.lastTick = now;
    const cam = this.scene.camera;
    const carto = cam.positionCartographic;
    if (carto.height > MAX_CAMERA_HEIGHT + 3000) return;
    if (this.lastCenter && Cartesian3.distance(this.lastCenter, cam.positionWC) < 150) return;
    this.lastCenter = Cartesian3.clone(cam.positionWC);
    const lat = (carto.latitude * 180) / Math.PI;
    const lon = (carto.longitude * 180) / Math.PI;
    const [cx, cy] = tileOf(lat, lon, this.zoom);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.load(cx + dx, cy + dy);
    this.evict(cx, cy);
  }

  private evict(cx: number, cy: number) {
    if (this.tiles.size <= MAX_TILES) return;
    const far = [...this.tiles.entries()].sort(
      ([, a], [, b]) => Math.hypot(b.x - cx, b.y - cy) - Math.hypot(a.x - cx, a.y - cy),
    );
    for (const [key, t] of far.slice(0, this.tiles.size - MAX_TILES)) {
      if (t.primitive) this.scene.primitives.remove(t.primitive);
      this.tiles.delete(key);
    }
  }

  private load(x: number, y: number): Tile {
    const key = `${x}/${y}`;
    const existing = this.tiles.get(key);
    if (existing) return existing;
    const tile: Tile = { x, y, footprints: [], ready: Promise.resolve() };
    this.pending++;
    tile.ready = this.build(tile)
      .catch(() => {
        this.tiles.delete(key);
      })
      .finally(() => this.pending--);
    this.tiles.set(key, tile);
    return tile;
  }

  private async build(tile: Tile) {
    const vt = await this.source.get(this.zoom, tile.x, tile.y);
    const layer = vt?.layers.buildings;
    if (!layer || this.destroyed) return;
    const n = 2 ** this.zoom;
    const toLonLat = (p: { x: number; y: number }): [number, number] => {
      const lon = ((tile.x + p.x / layer.extent) / n) * 360 - 180;
      const my = Math.PI * (1 - (2 * (tile.y + p.y / layer.extent)) / n);
      return [lon, (Math.atan(Math.sinh(my)) * 180) / Math.PI];
    };

    const shapes: { rings: [number, number][][]; height: number; min: number }[] = [];
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 3) continue;
      const height = Number(f.properties.height) || DEFAULT_HEIGHT;
      const min = Number(f.properties.min_height) || 0;
      for (const poly of classifyRings(f.loadGeometry())) {
        shapes.push({ rings: poly.map((r) => r.map(toLonLat)), height, min });
      }
    }
    if (!shapes.length) return;

    const terrain = this.scene.terrainProvider;
    let bases = shapes.map(() => 0);
    if (!(terrain instanceof EllipsoidTerrainProvider)) {
      const carts = shapes.map((s) =>
        Cartographic.fromDegrees(s.rings[0]![0]![0], s.rings[0]![0]![1]),
      );
      bases = await sampleTerrainHeights(terrain, carts).catch(() => bases);
    }
    if (this.destroyed) return;

    const instances: GeometryInstance[] = [];
    shapes.forEach((s, i) => {
      // Sink the base a little so buildings on slopes don't float.
      const base = (Number.isFinite(bases[i]) ? bases[i]! : 0) - 2;
      const [outer, ...holes] = s.rings;
      if (!outer || outer.length < 4) return;
      const bbox: Footprint['bbox'] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [lon, lat] of outer) {
        bbox[0] = Math.min(bbox[0], lon);
        bbox[1] = Math.min(bbox[1], lat);
        bbox[2] = Math.max(bbox[2], lon);
        bbox[3] = Math.max(bbox[3], lat);
      }
      tile.footprints.push({ ring: outer, bbox, base, top: base + 2 + s.height });
      instances.push(
        new GeometryInstance({
          geometry: new PolygonGeometry({
            polygonHierarchy: new PolygonHierarchy(
              Cartesian3.fromDegreesArray(outer.flat()),
              holes.map((h) => new PolygonHierarchy(Cartesian3.fromDegreesArray(h.flat()))),
            ),
            height: base + s.min,
            extrudedHeight: base + 2 + s.height,
            vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          attributes: { color: ColorGeometryInstanceAttribute.fromColor(COLOR) },
        }),
      );
    });
    if (!instances.length) return;
    tile.primitive = this.scene.primitives.add(
      new Primitive({
        show: this.visible,
        geometryInstances: instances,
        appearance: new PerInstanceColorAppearance({ closed: true }),
        releaseGeometryInstances: true,
      }),
    );
    this.scene.requestRender();
  }
}

function tileOf(lat: number, lon: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}

function inside(ring: [number, number][], x: number, y: number) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
