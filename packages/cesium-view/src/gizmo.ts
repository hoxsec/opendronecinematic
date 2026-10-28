import {
  ArcType,
  CallbackProperty,
  Cartesian3,
  Cartesian4,
  Color,
  CustomDataSource,
  Matrix4,
  PolylineArrowMaterialProperty,
  Transforms,
  type Camera,
} from 'cesium';

/** A local axis at a marker: x = east, y = north, z = up. */
export type Axis = 'x' | 'y' | 'z';

export const AXES: readonly Axis[] = ['x', 'y', 'z'];

const AXIS_COLORS: Record<Axis, Color> = {
  x: Color.fromCssColorString('#ef4444'),
  y: Color.fromCssColorString('#22c55e'),
  z: Color.fromCssColorString('#3b82f6'),
};

const ID_PREFIX = 'gizmo:';
/** Arrow length as a fraction of the camera distance, so it stays the same size on screen. */
const SCREEN_SCALE = 0.12;
/** Arrows start this far along so the marker dot itself stays grabbable for free dragging. */
const START = 0.18;

export function gizmoAxis(entityId: string): Axis | undefined {
  if (!entityId.startsWith(ID_PREFIX)) return undefined;
  const a = entityId.slice(ID_PREFIX.length);
  return (AXES as string[]).includes(a) ? (a as Axis) : undefined;
}

/** Unit east/north/up direction of `axis` in Earth-fixed coordinates at `origin`. */
export function axisDirection(origin: Cartesian3, axis: Axis): Cartesian3 {
  const enu = Transforms.eastNorthUpToFixedFrame(origin);
  const col = Matrix4.getColumn(enu, axis === 'x' ? 0 : axis === 'y' ? 1 : 2, new Cartesian4());
  return Cartesian3.normalize(Cartesian3.fromCartesian4(col), new Cartesian3());
}

/**
 * Parameter t of the point on the line `origin + t·dir` closest to a ray, or undefined when the
 * ray runs (nearly) parallel to the line or the closest point is behind the ray's start.
 * Both directions must be unit vectors.
 */
export function closestOnLine(
  origin: Cartesian3,
  dir: Cartesian3,
  rayOrigin: Cartesian3,
  rayDir: Cartesian3,
): number | undefined {
  const w = Cartesian3.subtract(origin, rayOrigin, new Cartesian3());
  const b = Cartesian3.dot(dir, rayDir);
  const d = Cartesian3.dot(dir, w);
  const e = Cartesian3.dot(rayDir, w);
  const denom = 1 - b * b;
  if (denom < 1e-6) return undefined;
  const t = (b * e - d) / denom;
  const s = (e - b * d) / denom;
  return s < 0 ? undefined : t;
}

/** East/north/up drag arrows drawn on the selected marker. */
export class AxisGizmo {
  readonly layer = new CustomDataSource('gizmo');
  private origin?: Cartesian3;
  private axes: readonly Axis[] = AXES;

  constructor(private readonly camera: Camera) {
    for (const axis of AXES) {
      const color = AXIS_COLORS[axis];
      const material = new PolylineArrowMaterialProperty(color);
      this.layer.entities.add({
        id: ID_PREFIX + axis,
        show: false,
        polyline: {
          positions: new CallbackProperty(() => this.arrow(axis), false),
          width: 14,
          material,
          depthFailMaterial: new PolylineArrowMaterialProperty(color.withAlpha(0.6)),
          arcType: ArcType.NONE,
        },
      });
    }
  }

  /** Show the arrows at `origin` (hidden when undefined), limited to `axes`. */
  set(origin: Cartesian3 | undefined, axes: readonly Axis[] = AXES) {
    this.origin = origin;
    this.axes = axes;
    for (const axis of AXES) {
      this.layer.entities.getById(ID_PREFIX + axis)!.show = !!origin && axes.includes(axis);
    }
  }

  get visible() {
    return !!this.origin;
  }

  private arrow(axis: Axis): Cartesian3[] {
    const o = this.origin;
    if (!o || !this.axes.includes(axis)) return [];
    const len = Cartesian3.distance(this.camera.positionWC, o) * SCREEN_SCALE;
    const dir = axisDirection(o, axis);
    const at = (f: number) =>
      Cartesian3.add(
        o,
        Cartesian3.multiplyByScalar(dir, len * f, new Cartesian3()),
        new Cartesian3(),
      );
    return [at(START), at(1)];
  }
}
