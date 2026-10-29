import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cesium3DTileset, ImageryLayerCollection, Ion, IonResource, type Scene } from 'cesium';
import { applySources, withDefaults } from '../src/sources';

const originalToken = Ion.defaultAccessToken;
afterEach(() => {
  vi.restoreAllMocks();
  Ion.defaultAccessToken = originalToken;
});

function world() {
  const scene = {
    globe: { show: true },
    primitives: { add: vi.fn(), remove: vi.fn() },
  };
  return { scene: scene as unknown as Scene, layers: new ImageryLayerCollection() };
}

const settings = () =>
  withDefaults({ ionToken: 'test-token', imagery: 'osm', terrain: 'none', buildings: 'google' });

describe('Google photorealistic sources', () => {
  it('keeps the fallback globe visible when Google fails, even with a custom tileset', async () => {
    vi.spyOn(IonResource, 'fromAssetId').mockRejectedValue(new Error('HTTP 503'));
    const custom = {} as Cesium3DTileset;
    vi.spyOn(Cesium3DTileset, 'fromUrl').mockResolvedValue(custom);
    const { scene, layers } = world();
    const result = await applySources(scene, layers, {
      ...settings(),
      customTilesets: ['https://example.com/tileset.json'],
    });
    expect(result.errors).toEqual(['Google 3D Tiles: HTTP 503']);
    expect(result.tilesets).toEqual([custom]);
    expect(result.showGlobe).toBe(true);
    expect(scene.globe.show).toBe(true);
    expect(layers.length).toBe(1);
  });

  it('loads independent resources for concurrent views and allows requests while flying', async () => {
    const resources = [{}, {}] as IonResource[];
    const resource = vi.spyOn(IonResource, 'fromAssetId');
    resource.mockResolvedValueOnce(resources[0]!).mockResolvedValueOnce(resources[1]!);
    const tileset = vi.spyOn(Cesium3DTileset, 'fromUrl').mockResolvedValue({} as Cesium3DTileset);
    const map = world();
    const drone = world();
    const results = await Promise.all([
      applySources(map.scene, map.layers, settings()),
      applySources(drone.scene, drone.layers, settings()),
    ]);
    expect(resource).toHaveBeenCalledTimes(2);
    for (const r of resources)
      expect(tileset).toHaveBeenCalledWith(
        r,
        expect.objectContaining({ cullRequestsWhileMoving: false }),
      );
    for (const result of results) {
      expect(result.errors).toEqual([]);
      expect(result.showGlobe).toBe(false);
    }
  });
});
