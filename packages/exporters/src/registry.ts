import type { ExportFormat, Mission } from '@odc/core';
import type { ExportOptions, ExportResult } from './points';

export const EXPORTER_API_VERSION = 1;
export type ExporterValue = string | number | boolean;
export type ExporterValues = Readonly<Record<string, ExporterValue>>;
export type ExporterOption = { id: string; label: string } & (
  | { type: 'boolean'; default: boolean }
  | { type: 'number'; default: number; min?: number; max?: number; step?: number }
  | { type: 'select'; default: string; choices: readonly { value: string; label: string }[] }
);

/** Trusted, build-time extension. This API does not sandbox JavaScript or load downloaded code. */
export interface ExporterPlugin {
  apiVersion: typeof EXPORTER_API_VERSION;
  id: string;
  name: string;
  description: string;
  extension: string;
  /** Existing profile compatibility hint; omission means compatibility is unverified. */
  profileFormat?: ExportFormat;
  supportsDensify?: boolean;
  options?: readonly ExporterOption[];
  export(
    mission: Mission,
    options: ExportOptions,
    values: ExporterValues,
  ): ExportResult<string | Uint8Array> | Promise<ExportResult<string | Uint8Array>>;
}

export function exporterDefaults(plugin: ExporterPlugin): Record<string, ExporterValue> {
  return Object.fromEntries((plugin.options ?? []).map((o) => [o.id, o.default]));
}

const idPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const validText = (v: unknown) => typeof v === 'string' && !!v.trim() && v.length <= 2000;

function validateValues(plugin: ExporterPlugin, values: ExporterValues) {
  const options = plugin.options ?? [];
  for (const key of Object.keys(values)) {
    if (!options.some((o) => o.id === key)) throw new Error(`Unknown exporter option: ${key}`);
  }
  for (const option of options) {
    const value = values[option.id];
    const valid =
      option.type === 'boolean'
        ? typeof value === 'boolean'
        : option.type === 'number'
          ? typeof value === 'number' &&
            Number.isFinite(value) &&
            (option.min === undefined || value >= option.min) &&
            (option.max === undefined || value <= option.max)
          : typeof value === 'string' && option.choices.some((c) => c.value === value);
    if (!valid) throw new Error(`Invalid value for exporter option: ${option.label}`);
  }
}

export class ExporterRegistry {
  private readonly plugins = new Map<string, ExporterPlugin>();

  /** Duplicate IDs (including built-ins) and incompatible API versions are rejected. */
  register(plugin: ExporterPlugin): void {
    if (plugin.apiVersion !== EXPORTER_API_VERSION)
      throw new Error('Unsupported exporter API version.');
    if (typeof plugin.id !== 'string' || !idPattern.test(plugin.id) || this.plugins.has(plugin.id))
      throw new Error(`Invalid or duplicate exporter ID: ${plugin.id}`);
    if (
      !validText(plugin.name) ||
      !validText(plugin.description) ||
      typeof plugin.extension !== 'string' ||
      !/^[a-z0-9]{1,16}$/.test(plugin.extension) ||
      typeof plugin.export !== 'function'
    )
      throw new Error('Invalid exporter metadata.');
    if (
      plugin.profileFormat !== undefined &&
      !['litchi', 'dji-kmz', 'qgc', 'mp-waypoints'].includes(plugin.profileFormat)
    )
      throw new Error('Invalid exporter profile format.');
    const ids = new Set<string>();
    for (const option of plugin.options ?? []) {
      if (!idPattern.test(option.id) || ids.has(option.id) || !validText(option.label))
        throw new Error('Invalid or duplicate exporter option.');
      ids.add(option.id);
      if (option.type === 'number') {
        if (
          [option.min, option.max, option.step].some(
            (v) => v !== undefined && !Number.isFinite(v),
          ) ||
          (option.min !== undefined && option.max !== undefined && option.min > option.max) ||
          (option.step !== undefined && option.step <= 0)
        )
          throw new Error('Invalid exporter number bounds.');
      } else if (option.type === 'select') {
        if (
          !option.choices?.length ||
          option.choices.some((c) => !validText(c.value) || !validText(c.label)) ||
          new Set(option.choices.map((c) => c.value)).size !== option.choices.length
        )
          throw new Error('Invalid exporter choices.');
      } else if (option.type !== 'boolean') throw new Error('Unsupported exporter option type.');
    }
    validateValues(plugin, exporterDefaults(plugin));
    // Snapshot metadata so callers cannot replace IDs or option schemas after validation.
    const options = structuredClone(plugin.options ?? []);
    for (const option of options) {
      if (option.type === 'select') {
        option.choices.forEach(Object.freeze);
        Object.freeze(option.choices);
      }
      Object.freeze(option);
    }
    this.plugins.set(plugin.id, Object.freeze({ ...plugin, options: Object.freeze(options) }));
  }

  list(): readonly ExporterPlugin[] {
    return [...this.plugins.values()];
  }

  get(id: string): ExporterPlugin {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`Unknown exporter: ${id}`);
    return plugin;
  }

  async run(
    id: string,
    mission: Mission,
    options: ExportOptions = {},
    values: ExporterValues = {},
  ): Promise<ExportResult<string | Uint8Array>> {
    const plugin = this.get(id);
    const densify = options.densify ?? 0;
    if (!Number.isFinite(densify) || (densify !== 0 && densify < 1))
      throw new Error('Point spacing must be at least 1 m.');
    if (densify && !plugin.supportsDensify)
      throw new Error('This exporter does not support densification.');
    const resolved = { ...exporterDefaults(plugin), ...values };
    validateValues(plugin, resolved);
    // An extension must never mutate the editor's mission or options, including nested actions.
    const result = await plugin.export(
      structuredClone(mission),
      { densify },
      Object.freeze(resolved),
    );
    if (
      !result ||
      (!(typeof result.data === 'string') && !(result.data instanceof Uint8Array)) ||
      !result.data.length ||
      !Array.isArray(result.warnings) ||
      !result.warnings.every((w) => typeof w === 'string')
    )
      throw new Error(`Exporter ${plugin.name} returned an invalid or empty result.`);
    return {
      data: typeof result.data === 'string' ? result.data : result.data.slice(),
      warnings: [...result.warnings],
    };
  }
}
