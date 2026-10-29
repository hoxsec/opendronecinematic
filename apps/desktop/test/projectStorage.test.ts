import { describe, expect, it, vi } from 'vitest';
import { createMission } from '@odc/core';
import {
  LEGACY_AUTOSAVE_KEY,
  PROJECTS_KEY,
  RECENT_LIMIT,
  RECOVERY_LIMIT,
  emptyProjectData,
  loadProjectData,
  persistProjectData,
  projectFileName,
  projectKey,
  rememberProject,
  rememberRecovery,
} from '../src/projectStorage';
import { MemoryStorage } from './memoryStorage';

const mission = () => createMission({ lat: 46, lon: 7, groundHeight: 500 });

describe('project history and recovery persistence', () => {
  it('starts empty and round-trips portable mission snapshots', () => {
    const storage = new MemoryStorage();
    expect(loadProjectData(storage).data).toEqual(emptyProjectData());
    const m = mission();
    const entry = { key: projectKey(m), mission: m, fileName: 'flight.odc.json', updatedAt: 100 };
    const data = rememberRecovery(rememberProject(emptyProjectData(), entry), entry);
    expect(persistProjectData(data, storage)).toBeUndefined();
    expect(loadProjectData(storage)).toEqual({ data, error: undefined });
  });

  it('offers the legacy autosave as recovery instead of silently opening it', () => {
    const storage = new MemoryStorage();
    const m = mission();
    storage.setItem(LEGACY_AUTOSAVE_KEY, JSON.stringify(m));
    const { data } = loadProjectData(storage);
    expect(data.recoveries[0]?.mission).toEqual(m);
    expect(data.recents).toEqual([]);
    expect(storage.getItem(LEGACY_AUTOSAVE_KEY)).not.toBeNull();
    expect(persistProjectData(data, storage)).toBeUndefined();
    expect(storage.getItem(LEGACY_AUTOSAVE_KEY)).toBeNull();
    expect(loadProjectData(storage).data.recoveries).toHaveLength(1);
  });

  it('does not retire the legacy draft or last successful write on quota failure', () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_AUTOSAVE_KEY, JSON.stringify(mission()));
    storage.setItem(PROJECTS_KEY, JSON.stringify(emptyProjectData()));
    const before = storage.getItem(PROJECTS_KEY);
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    expect(persistProjectData(emptyProjectData(), storage)).toContain(
      'Save your project to a file',
    );
    expect(storage.getItem(LEGACY_AUTOSAVE_KEY)).not.toBeNull();
    expect(storage.getItem(PROJECTS_KEY)).toBe(before);
  });

  it('isolates damaged entries and leaves valid projects usable', () => {
    const storage = new MemoryStorage();
    const m = mission();
    storage.setItem(
      PROJECTS_KEY,
      JSON.stringify({
        version: 1,
        recents: [
          { mission: m, fileName: 'good.odc.json', updatedAt: 1 },
          { mission: { version: 1 }, updatedAt: 2 },
        ],
        recoveries: [{ mission: { ...m, waypoints: [null] }, updatedAt: 3 }],
      }),
    );
    const result = loadProjectData(storage);
    expect(result.data.recents).toHaveLength(1);
    expect(result.data.recoveries).toHaveLength(0);
    expect(result.error).toContain('damaged');
  });

  it.each(['{broken', 'null', '{"version":2,"recents":[],"recoveries":[]}'])(
    'reports an unreadable index without crashing: %s',
    (raw) => {
      const storage = new MemoryStorage();
      storage.setItem(PROJECTS_KEY, raw);
      const result = loadProjectData(storage);
      expect(result.data).toEqual(emptyProjectData());
      expect(result.error).toBeTruthy();
      expect(storage.getItem(PROJECTS_KEY)).toBe(raw);
    },
  );

  it('deduplicates paths, preserves Save as copies, and bounds history size', () => {
    let data = emptyProjectData();
    const m = mission();
    for (let i = 0; i < 20; i++) {
      const path = `C:\\Projects\\flight${i}.odc.json`;
      const entry = {
        key: projectKey(m, path),
        path,
        mission: m,
        fileName: `flight${i}.odc.json`,
        updatedAt: i,
      };
      data = rememberProject(data, entry);
      data = rememberRecovery(data, entry);
    }
    expect(data.recents).toHaveLength(RECENT_LIMIT);
    expect(data.recoveries).toHaveLength(RECOVERY_LIMIT);
    const latest = data.recents[0]!;
    data = rememberProject(data, { ...latest, mission: { ...m, name: 'Updated' } });
    expect(data.recents).toHaveLength(RECENT_LIMIT);
    expect(data.recents[0]?.mission.name).toBe('Updated');
    expect(projectKey(m, 'C:\\Projects\\Flight.odc.json')).toBe(
      projectKey(m, 'c:/projects/flight.odc.json'),
    );
    expect(projectKey(m, '/home/A.json')).not.toBe(projectKey(m, '/home/a.json'));
  });
});

describe('Windows-safe default project names', () => {
  it.each([
    ['Sunset / valley: take 1?', 'Sunset _ valley_ take 1_.odc.json'],
    ['  München sunset. ', 'München sunset.odc.json'],
    ['CON', '_CON.odc.json'],
    ['LPT1.test', '_LPT1.test.odc.json'],
    ['...', 'mission.odc.json'],
    ['', 'mission.odc.json'],
  ])('names %s safely', (name, expected) => expect(projectFileName(name)).toBe(expected));
});
