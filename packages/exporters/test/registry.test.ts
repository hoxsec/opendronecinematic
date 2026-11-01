import { describe, expect, it, vi } from 'vitest';
import {
  createBuiltinExporterRegistry,
  ExporterRegistry,
  exportLitchiCsv,
  exportQgcPlan,
  exportMissionPlannerWaypoints,
  type ExporterPlugin,
  type ExporterValues,
} from '../src';
import { orbitMission } from './fixtures';

const extension = (patch: Partial<ExporterPlugin> = {}): ExporterPlugin => ({
  apiVersion: 1,
  id: 'example.json',
  name: 'Example',
  description: 'Test extension',
  extension: 'json',
  export: () => ({ data: '{}', warnings: [] }),
  ...patch,
});

describe('exporter plugin API', () => {
  it('preserves built-in output and compatibility metadata', async () => {
    const registry = createBuiltinExporterRegistry();
    const mission = orbitMission('dji-mini-4-pro');
    expect(registry.list().map((p) => p.id)).toEqual(['litchi', 'dji-kmz', 'qgc', 'mp-waypoints']);
    expect(await registry.run('litchi', mission)).toEqual(exportLitchiCsv(mission));
    expect(await registry.run('qgc', mission)).toEqual(exportQgcPlan(mission, { firmware: 'px4' }));
    expect(await registry.run('qgc', mission, {}, { firmware: 'ardupilot' })).toEqual(
      exportQgcPlan(mission, { firmware: 'ardupilot' }),
    );
    expect(await registry.run('mp-waypoints', mission)).toEqual(
      exportMissionPlannerWaypoints(mission),
    );
    expect(await registry.run('litchi', mission, { densify: 10 })).toEqual(
      exportLitchiCsv(mission, { densify: 10 }),
    );
  });
  it('rejects duplicate IDs, incompatible versions and unsafe file extensions', () => {
    const registry = createBuiltinExporterRegistry();
    for (const patch of [
      { id: 'litchi' },
      { apiVersion: 2 },
      { extension: '../csv' },
      { id: '' },
      {
        options: [
          {
            id: 'mode',
            label: 'Mode',
            type: 'select',
            default: 'missing',
            choices: [{ value: 'ok', label: 'OK' }],
          },
        ],
      },
    ])
      expect(() => registry.register(extension(patch as Partial<ExporterPlugin>))).toThrow();
  });
  it('supports async text/binary exporters without exposing the live mission', async () => {
    const registry = new ExporterRegistry();
    const mission = orbitMission();
    const name = mission.name;
    const actions = structuredClone(mission.waypoints[0]!.actions);
    registry.register(
      extension({
        export: async (copy) => {
          copy.name = 'changed';
          copy.waypoints[0]!.actions.length = 0;
          return { data: new Uint8Array([1, 2]), warnings: ['Verify compatibility'] };
        },
      }),
    );
    expect(await registry.run('example.json', mission)).toEqual({
      data: new Uint8Array([1, 2]),
      warnings: ['Verify compatibility'],
    });
    expect(mission.name).toBe(name);
    expect(mission.waypoints[0]!.actions).toEqual(actions);
  });
  it('validates declared defaults, bounds, choices and caller options', async () => {
    const registry = new ExporterRegistry();
    const run = vi.fn<ExporterPlugin['export']>(() => ({ data: '{}', warnings: [] }));
    registry.register(
      extension({
        options: [
          { id: 'enabled', label: 'Enabled', type: 'boolean', default: false },
          { id: 'height', label: 'Height', type: 'number', default: 5, min: 0, max: 10 },
        ],
        export: run,
      }),
    );
    await registry.run('example.json', orbitMission());
    expect(run.mock.calls[0]![2]).toEqual({ enabled: false, height: 5 });
    const invalid: ExporterValues[] = [
      { height: NaN },
      { height: 11 },
      { enabled: 'yes' },
      { extra: 1 },
    ];
    for (const values of invalid)
      await expect(registry.run('example.json', orbitMission(), {}, values)).rejects.toThrow();
    await expect(registry.run('example.json', orbitMission(), { densify: 10 })).rejects.toThrow(
      /densification/,
    );
    await expect(
      createBuiltinExporterRegistry().run('litchi', orbitMission(), { densify: -1 }),
    ).rejects.toThrow(/spacing/);
  });
  it('snapshots metadata and reports failed or malformed extensions', async () => {
    const registry = new ExporterRegistry();
    const plugin = extension();
    registry.register(plugin);
    plugin.name = 'tampered';
    expect(registry.get('example.json').name).toBe('Example');
    registry.register(
      extension({
        id: 'broken',
        export: async () => {
          throw new Error('failed');
        },
      }),
    );
    await expect(registry.run('broken', orbitMission())).rejects.toThrow('failed');
    registry.register(extension({ id: 'empty', export: () => ({ data: '', warnings: [] }) }));
    await expect(registry.run('empty', orbitMission())).rejects.toThrow(/empty/);
    await expect(registry.run('unknown', orbitMission())).rejects.toThrow(/Unknown/);
  });
});
