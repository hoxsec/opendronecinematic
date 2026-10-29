import {
  Cartesian3,
  ConstantPositionProperty,
  ConstantProperty,
  Entity,
  type EntityCollection,
} from 'cesium';

/** Update graphics in place so Cesium can retain its visualizers and GPU resources. */
export class EntityBatch {
  private readonly seen = new Set<string>();

  constructor(private readonly entities: EntityCollection) {
    entities.suspendEvents();
  }

  upsert(options: Entity.ConstructorOptions & { id: string }) {
    this.seen.add(options.id);
    const entity = this.entities.getById(options.id);
    if (!entity) {
      this.entities.add(options);
      return;
    }
    if (options.position instanceof Cartesian3) {
      if (entity.position instanceof ConstantPositionProperty)
        entity.position.setValue(options.position);
      else entity.position = new ConstantPositionProperty(options.position);
    } else if (options.position) entity.position = options.position;
    for (const key of ['point', 'label', 'polyline', 'polygon'] as const) {
      const graphics = options[key];
      if (!graphics) continue;
      if (entity[key]) {
        for (const [name, value] of Object.entries(graphics)) {
          const current = Reflect.get(entity[key]!, name);
          if (current instanceof ConstantProperty && name !== 'hierarchy') {
            const previous = current.getValue();
            // Position arrays do not implement equals; avoid rebuilding unchanged polylines.
            if (
              Array.isArray(previous) &&
              Array.isArray(value) &&
              previous.length === value.length &&
              previous.every((item, i) =>
                item instanceof Cartesian3 && value[i] instanceof Cartesian3
                  ? Cartesian3.equals(item, value[i])
                  : item === value[i],
              )
            )
              continue;
            current.setValue(value);
          } else if (!current?.equals?.(value)) Reflect.set(entity[key]!, name, value);
        }
      } else Object.assign(entity, { [key]: graphics });
    }
  }

  finish() {
    for (const entity of [...this.entities.values]) {
      if (!this.seen.has(entity.id)) this.entities.remove(entity);
    }
    this.entities.resumeEvents();
  }
}
