import { describe, expect, it } from 'vitest';
import { Cartesian3, Cartographic } from 'cesium';
import { axisDirection, closestOnLine, gizmoAxis } from '../src/gizmo';

describe('axis gizmo', () => {
  it('finds where a ray passes closest to an axis line', () => {
    const o = new Cartesian3(0, 0, 0);
    const x = new Cartesian3(1, 0, 0);
    // A ray looking straight down -z, passing over x = 5.
    const t = closestOnLine(o, x, new Cartesian3(5, 2, 10), new Cartesian3(0, 0, -1));
    expect(t).toBeCloseTo(5);
  });

  it('gives up when the ray runs along the axis or points away', () => {
    const o = new Cartesian3(0, 0, 0);
    const x = new Cartesian3(1, 0, 0);
    expect(closestOnLine(o, x, new Cartesian3(-10, 0, 1), x)).toBeUndefined();
    expect(closestOnLine(o, x, new Cartesian3(5, 0, 10), new Cartesian3(0, 0, 1))).toBeUndefined();
  });

  it('points x east, y north and z up', () => {
    const at = Cartesian3.fromDegrees(7.9, 46.6, 1000);
    const step = (axis: 'x' | 'y' | 'z') =>
      Cartographic.fromCartesian(
        Cartesian3.add(
          at,
          Cartesian3.multiplyByScalar(axisDirection(at, axis), 100, new Cartesian3()),
          new Cartesian3(),
        ),
      );
    const base = Cartographic.fromCartesian(at);
    expect(step('x').longitude).toBeGreaterThan(base.longitude);
    expect(step('y').latitude).toBeGreaterThan(base.latitude);
    expect(step('z').height - base.height).toBeCloseTo(100, 1);
  });

  it('recognises arrow entity ids', () => {
    expect(gizmoAxis('gizmo:z')).toBe('z');
    expect(gizmoAxis('waypoint:abc')).toBeUndefined();
  });
});
