import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as storage from '../src/airspaceStorage';
import { useAirspace } from '../src/airspaceStore';

const json = JSON.stringify({
  type: 'FeatureCollection',
  source: 'Test authority',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Test zone' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
    },
  ],
});
const bytes = new TextEncoder().encode(json);
beforeEach(async () => {
  vi.restoreAllMocks();
  await storage.deleteAirspace();
  useAirspace.setState({
    initialized: false,
    busy: false,
    layer: undefined,
    error: undefined,
    analysis: undefined,
  });
});

describe('local airspace layers', () => {
  it('persists and reloads a validated layer independently of a project', async () => {
    await useAirspace.getState().importFile('zones.geojson', bytes);
    expect(useAirspace.getState().layer?.data.zones[0]!.name).toBe('Test zone');
    useAirspace.setState({ layer: undefined, initialized: false });
    await useAirspace.getState().initialize();
    expect(useAirspace.getState().layer?.fileName).toBe('zones.geojson');
  });
  it('hides visualization without removing the zones used for checks', async () => {
    await useAirspace.getState().importFile('zones.geojson', bytes);
    await useAirspace.getState().setVisible(false);
    expect(useAirspace.getState().layer).toMatchObject({
      visible: false,
      data: { zones: [{ name: 'Test zone' }] },
    });
    expect((await storage.loadAirspace())?.visible).toBe(false);
  });
  it('keeps the previous layer when replacement data is invalid or too large', async () => {
    await useAirspace.getState().importFile('zones.geojson', bytes);
    const before = useAirspace.getState().layer;
    await useAirspace.getState().importFile('bad.json', new TextEncoder().encode('{}'));
    expect(useAirspace.getState().layer).toBe(before);
    await useAirspace.getState().importFile('large.json', new Uint8Array(10 * 1024 * 1024 + 1));
    expect(useAirspace.getState().layer).toBe(before);
    expect(useAirspace.getState().error).toContain('10 MB');
  });
  it('reports storage failures and keeps a session-only layer usable', async () => {
    vi.spyOn(storage, 'saveAirspace').mockRejectedValueOnce(new Error('quota'));
    await useAirspace.getState().importFile('zones.geojson', bytes);
    expect(useAirspace.getState().layer?.data.zones).toHaveLength(1);
    expect(useAirspace.getState().error).toContain('session only');
  });
  it('reports corrupt stored data rather than claiming coverage', async () => {
    await storage.saveAirspace({
      fileName: 'bad.json',
      json: '{}',
      importedAt: Date.now(),
      visible: true,
    });
    await useAirspace.getState().initialize();
    expect(useAirspace.getState().layer).toBeUndefined();
    expect(useAirspace.getState().error).toContain('could not be loaded');
  });
  it('does not remove the active layer if its persisted copy cannot be deleted', async () => {
    await useAirspace.getState().importFile('zones.geojson', bytes);
    vi.spyOn(storage, 'deleteAirspace').mockRejectedValueOnce(new Error('storage unavailable'));
    await useAirspace.getState().remove();
    expect(useAirspace.getState().layer).toBeDefined();
    await useAirspace.getState().remove();
    expect(useAirspace.getState().layer).toBeUndefined();
    expect(await storage.loadAirspace()).toBeUndefined();
  });
});
