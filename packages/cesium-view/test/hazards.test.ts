import { describe, expect, it, vi } from 'vitest';
import { CustomDataSource } from 'cesium';
import { MissionScene } from '../src/scene';

describe('hazard readability', () => {
  it('gives masts, power lines and airfields readable, backed labels and outlined markers', () => {
    const layer = new CustomDataSource('obstacles');
    const scene = Object.create(MissionScene.prototype) as MissionScene;
    Object.assign(scene, {
      obstacleLayer: layer,
      viewer: { scene: { requestRender: vi.fn() } },
    });
    scene.setObstacles(
      [
        { kind: 'mast', name: 'Radio mast', height: 80, heightTagged: true, coords: [[7, 46]] },
        {
          kind: 'power_line',
          height: 20,
          heightTagged: false,
          coords: [
            [7, 46],
            [7.01, 46],
          ],
        },
        { kind: 'aerodrome', name: 'Airport', height: 0, heightTagged: false, coords: [[7, 46]] },
      ],
      [500, 500, 500],
    );
    const labels = layer.entities.values.filter((e) => e.label);
    expect(labels).toHaveLength(3);
    expect(labels.map((e) => e.label!.text!.getValue())).toEqual([
      'HAZARD · Radio mast\n80 m above ground',
      'HAZARD · power line\n~20 m above ground',
      'AIRFIELD · Airport',
    ]);
    for (const entity of labels) {
      expect(entity.label!.font!.getValue()).toContain('16px');
      expect(entity.label!.showBackground!.getValue()).toBe(true);
      expect(entity.label!.backgroundColor!.getValue().alpha).toBeGreaterThan(0.9);
      expect(entity.label!.distanceDisplayCondition!.getValue().far).toBe(10_000);
      expect(entity.point!.pixelSize!.getValue()).toBeGreaterThanOrEqual(12);
      expect(entity.point!.disableDepthTestDistance!.getValue()).toBe(Infinity);
    }
    const lines = layer.entities.values.filter((e) => e.polyline);
    expect(lines).toHaveLength(2);
    expect(lines.every((e) => e.polyline!.width!.getValue() >= 5)).toBe(true);
  });
});
