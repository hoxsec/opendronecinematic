import { describe, expect, it, vi } from 'vitest';
import {
  Cartesian3,
  Color,
  EntityCollection,
  JulianDate,
  PolylineGlowMaterialProperty,
} from 'cesium';
import { EntityBatch } from '../src/entities';

describe('incremental mission entities', () => {
  it('retains markers and graphics while updating their positions and selection', () => {
    const entities = new EntityCollection();
    const update = (position: Cartesian3, selected: boolean) => {
      const batch = new EntityBatch(entities);
      batch.upsert({
        id: 'waypoint:a',
        position,
        point: { pixelSize: selected ? 16 : 12, color: Color.WHITE },
        label: { text: '1' },
      });
      batch.finish();
    };
    update(new Cartesian3(1, 2, 3), false);
    const marker = entities.getById('waypoint:a')!;
    const { point, label, position } = marker;
    const changed = vi.fn();
    entities.collectionChanged.addEventListener(changed);
    update(new Cartesian3(4, 5, 6), true);
    expect(entities.getById(marker.id)).toBe(marker);
    expect(marker.point).toBe(point);
    expect(marker.label).toBe(label);
    expect(marker.position).toBe(position);
    expect(marker.position!.getValue(JulianDate.now())).toEqual(new Cartesian3(4, 5, 6));
    expect(marker.point!.pixelSize!.getValue()).toBe(16);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0]![1]).toEqual([]); // no additions
    expect(changed.mock.calls[0]![2]).toEqual([]); // no removals
    changed.mockClear();
    update(new Cartesian3(4, 5, 6), true);
    expect(changed).not.toHaveBeenCalled();
  });

  it('only removes entities missing from the next render', () => {
    const entities = new EntityCollection();
    const first = new EntityBatch(entities);
    first.upsert({ id: 'keep', point: { pixelSize: 12 } });
    first.upsert({ id: 'deleted', point: { pixelSize: 12 } });
    first.upsert({ id: 'flight:issue:0', polyline: { positions: [] } });
    first.finish();
    const kept = entities.getById('keep');
    const next = new EntityBatch(entities);
    next.upsert({ id: 'keep', point: { pixelSize: 16 } });
    next.finish();
    expect(entities.values).toEqual([kept]);
  });

  it('does not invalidate unchanged path geometry or materials', () => {
    const entities = new EntityCollection();
    const update = (height: number) => {
      const batch = new EntityBatch(entities);
      batch.upsert({
        id: 'flight:path',
        polyline: {
          positions: [new Cartesian3(1, 2, height), new Cartesian3(4, 5, 6)],
          material: new PolylineGlowMaterialProperty({ color: Color.BLUE, glowPower: 0.2 }),
        },
      });
      batch.finish();
    };
    update(3);
    const path = entities.getById('flight:path')!;
    const changed = vi.fn();
    path.definitionChanged.addEventListener(changed);
    update(3);
    expect(changed).not.toHaveBeenCalled();
    update(9);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(path.polyline!.positions!.getValue()[0].z).toBe(9);
  });
});
