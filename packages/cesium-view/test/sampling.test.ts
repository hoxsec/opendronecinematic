import { describe, expect, it, vi } from 'vitest';
import { CustomDataSource, EllipsoidTerrainProvider } from 'cesium';
import { MissionScene } from '../src/scene';

function samplingScene(sample: ReturnType<typeof vi.fn>) {
  const scene = Object.create(MissionScene.prototype) as MissionScene;
  const gizmo = new CustomDataSource('gizmo');
  gizmo.entities.add({ id: 'gizmo:x' });
  Object.assign(scene, {
    viewer: {
      isDestroyed: () => false,
      scene: {
        terrainProvider: new EllipsoidTerrainProvider(),
        sampleHeightSupported: true,
        sampleHeightMostDetailed: sample,
      },
    },
    applied: { tilesets: [{}] },
    missionLayer: new CustomDataSource('mission'),
    droneLayer: new CustomDataSource('drone'),
    obstacleLayer: new CustomDataSource('obstacles'),
    gizmo: { layer: gizmo },
  });
  return scene;
}

describe('responsive terrain sampling', () => {
  it('bounds GPU sampling batches and preserves sample order and height results', async () => {
    let height = 10;
    const sample = vi.fn(async (positions: { height: number }[]) =>
      positions.map(() => ({ height: height++ })),
    );
    const scene = samplingScene(sample);
    const result = await scene.sampleGround(
      Array.from({ length: 11 }, () => ({ lat: 46, lon: 7 })),
    );
    expect(sample.mock.calls.map(([positions]) => positions.length)).toEqual([4, 4, 3]);
    expect(result).toEqual(Array.from({ length: 11 }, (_, i) => 10 + i));
    expect((sample.mock.calls[0] as unknown as [unknown, { id: string }[]])[1]).toEqual([
      expect.objectContaining({ id: 'gizmo:x' }),
    ]);
  });

  it('stops obsolete sampling between batches instead of finishing the old mission', async () => {
    const controller = new AbortController();
    const sample = vi.fn(async (positions: unknown[]) => {
      controller.abort();
      return positions.map(() => ({ height: 10 }));
    });
    const scene = samplingScene(sample);
    await expect(
      scene.sampleGround(
        Array.from({ length: 20 }, () => ({ lat: 46, lon: 7 })),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(sample).toHaveBeenCalledTimes(1);
  });
});
