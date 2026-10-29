import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMission, createWaypoint, serializeMission } from '@odc/core';
import { exportLitchiCsv } from '@odc/exporters';
import {
  closeApplication,
  openBinaryFile,
  readProjectFile,
  writeProjectFile,
} from '../src/platform';
import { flushProjectRecovery, useProject } from '../src/projectStore';
import {
  PROJECTS_KEY,
  emptyProjectData,
  loadProjectData,
  projectKey,
  rememberRecovery,
} from '../src/projectStorage';
import { useStore } from '../src/store';
import { useView } from '../src/viewStore';
import { MemoryStorage } from './memoryStorage';

vi.mock('../src/platform', () => ({
  openBinaryFile: vi.fn(),
  readProjectFile: vi.fn(),
  writeProjectFile: vi.fn(),
  rememberProjectFile: vi.fn().mockResolvedValue(undefined),
  closeApplication: vi.fn().mockResolvedValue(undefined),
}));

const makeMission = () => ({
  ...createMission({ lat: 46, lon: 7, groundHeight: 500 }),
  name: 'Sunset flight',
  waypoints: [createWaypoint({ lat: 46.001, lon: 7, groundHeight: 500, alt: 50 })],
});
const picked = (mission = makeMission(), path = 'C:\\Projects\\sunset.odc.json') => ({
  name: 'sunset.odc.json',
  path,
  data: new TextEncoder().encode(serializeMission(mission)),
});
const edit = (name = 'Edited flight') => useStore.getState().setMission((m) => ({ ...m, name }));
const openSaved = async () => {
  const file = picked();
  vi.mocked(openBinaryFile).mockResolvedValueOnce(file);
  await useProject.getState().request({ kind: 'open' });
  return file;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', new MemoryStorage());
  useProject.setState({
    screen: 'home',
    active: false,
    path: undefined,
    fileName: undefined,
    cleanContent: undefined,
    dirty: false,
    savedAt: undefined,
    recoveryAt: undefined,
    recoveryState: 'idle',
    busy: undefined,
    pendingAction: undefined,
    closeApproved: false,
    data: emptyProjectData(),
    storageError: undefined,
    actionError: undefined,
  });
  useStore.getState().loadMission(makeMission());
  useView.setState({
    fly: false,
    render: undefined,
    takes: [],
    activeTakeId: undefined,
    compare: false,
  });
  vi.mocked(openBinaryFile).mockResolvedValue(undefined);
  vi.mocked(writeProjectFile).mockResolvedValue({
    name: 'sunset.odc.json',
    path: 'C:\\Projects\\sunset.odc.json',
  });
  vi.mocked(closeApplication).mockResolvedValue(undefined);
});
afterEach(() => {
  useProject.setState({ active: false });
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('project sessions', () => {
  it('imports a mission as an unsaved project without keeping a writable source path', async () => {
    const data = new TextEncoder().encode(exportLitchiCsv(makeMission()).data);
    vi.mocked(openBinaryFile).mockResolvedValueOnce({
      name: 'source.csv',
      path: 'C:\\Projects\\source.csv',
      data,
    });
    await useProject.getState().request({ kind: 'open' });
    expect(useProject.getState()).toMatchObject({
      active: true,
      dirty: true,
      path: undefined,
      fileName: undefined,
    });
    expect(useStore.getState().toast?.text).toContain('Terrain heights were not sampled');
    await useProject.getState().save();
    expect(writeProjectFile).toHaveBeenCalledWith('source.odc.json', expect.any(String), undefined);
  });

  it('starts on home and opens a file as a fresh, clean session', async () => {
    expect(useProject.getState()).toMatchObject({ screen: 'home', active: false });
    useStore.getState().select(useStore.getState().mission.waypoints[0]!.id);
    edit();
    useStore.setState({ playing: true, time: 10, safetyPending: true });
    const file = await openSaved();
    expect(useProject.getState()).toMatchObject({
      screen: 'editor',
      active: true,
      dirty: false,
      path: file.path,
    });
    expect(useStore.getState()).toMatchObject({
      past: [],
      future: [],
      selectedWaypointIds: [],
      selectedId: undefined,
      time: 0,
      playing: false,
      safetyPending: false,
    });
    expect(useProject.getState().data.recents).toHaveLength(1);
  });

  it('debounces recovery and flushes the latest edit immediately when requested', async () => {
    await openSaved();
    edit('First edit');
    vi.advanceTimersByTime(499);
    expect(loadProjectData().data.recoveries).toHaveLength(0);
    edit('Latest edit');
    expect(useProject.getState()).toMatchObject({ dirty: true, recoveryState: 'pending' });
    flushProjectRecovery();
    expect(loadProjectData().data.recoveries[0]?.mission.name).toBe('Latest edit');
    expect(useProject.getState().recoveryState).toBe('saved');
  });

  it('returns to a clean state, including recovery, when edits are undone', async () => {
    await openSaved();
    edit();
    flushProjectRecovery();
    expect(loadProjectData().data.recoveries).toHaveLength(1);
    useStore.getState().undo();
    expect(useProject.getState().dirty).toBe(false);
    vi.advanceTimersByTime(500);
    expect(loadProjectData().data.recoveries).toHaveLength(0);
    useStore.getState().redo();
    expect(useProject.getState().dirty).toBe(true);
  });

  it('keeps the current session alive when visiting home', async () => {
    await openSaved();
    edit();
    const current = useStore.getState().mission;
    await useProject.getState().request({ kind: 'home' });
    expect(useProject.getState()).toMatchObject({
      screen: 'home',
      dirty: true,
      pendingAction: undefined,
    });
    expect(loadProjectData().data.recoveries).toHaveLength(1);
    useProject.getState().resume();
    expect(useProject.getState().screen).toBe('editor');
    expect(useStore.getState().mission).toBe(current);
  });

  it('restores a local draft without pretending it is saved to its original file', async () => {
    const mission = makeMission();
    const path = 'C:\\Projects\\recovered.odc.json';
    const key = projectKey(mission, path);
    useProject.setState({
      data: rememberRecovery(emptyProjectData(), { key, mission, path, updatedAt: 10 }),
    });
    await useProject.getState().request({ kind: 'recover', key });
    expect(useProject.getState()).toMatchObject({ active: true, dirty: true, path });
    expect(useStore.getState().mission).toEqual(mission);
    expect(writeProjectFile).not.toHaveBeenCalled();
  });

  it('does not overwrite unrelated startup recovery drafts when starting fresh', async () => {
    const mission = makeMission();
    useProject.setState({
      data: rememberRecovery(emptyProjectData(), {
        key: projectKey(mission),
        mission,
        updatedAt: 10,
      }),
    });
    await useProject.getState().request({ kind: 'new' });
    edit('Another project');
    flushProjectRecovery();
    expect(loadProjectData().data.recoveries).toHaveLength(2);
  });
});

describe('save and Save as', () => {
  it('writes Save to the existing desktop path and clears only the saved draft', async () => {
    const file = await openSaved();
    edit();
    flushProjectRecovery();
    expect(await useProject.getState().save()).toBe(true);
    expect(writeProjectFile).toHaveBeenCalledWith(
      file.name,
      expect.stringContaining('Edited flight'),
      file.path,
    );
    expect(useProject.getState()).toMatchObject({ dirty: false, busy: undefined });
    expect(loadProjectData().data.recoveries).toHaveLength(0);
    expect(useProject.getState().data.recents[0]?.mission.name).toBe('Edited flight');
  });

  it('asks for a new destination for Save as and keeps both files in recents', async () => {
    const original = await openSaved();
    edit();
    vi.mocked(writeProjectFile).mockResolvedValueOnce({
      name: 'copy.odc.json',
      path: 'C:\\Projects\\copy.odc.json',
    });
    await useProject.getState().save(true);
    expect(writeProjectFile).toHaveBeenCalledWith(
      'Edited flight.odc.json',
      expect.any(String),
      undefined,
    );
    expect(useProject.getState().data.recents.map((p) => p.path)).toEqual([
      'C:\\Projects\\copy.odc.json',
      original.path,
    ]);
    expect(useProject.getState().path).toBe('C:\\Projects\\copy.odc.json');
  });

  it.each(['cancel', 'failure'])('does not mark work saved after %s', async (mode) => {
    await openSaved();
    edit();
    if (mode === 'cancel') vi.mocked(writeProjectFile).mockResolvedValueOnce(undefined);
    else vi.mocked(writeProjectFile).mockRejectedValueOnce(new Error('Disk full'));
    const before = useProject.getState().cleanContent;
    expect(await useProject.getState().save()).toBe(false);
    expect(useProject.getState()).toMatchObject({
      dirty: true,
      cleanContent: before,
      busy: undefined,
    });
    if (mode === 'failure') {
      expect(useProject.getState().actionError).toContain('Disk full');
      expect(loadProjectData().data.recoveries).toHaveLength(1);
    }
  });

  it('keeps edits made while a save was in flight dirty and recoverable', async () => {
    await openSaved();
    edit('Snapshot being saved');
    let finish!: (file: { name: string; path: string }) => void;
    vi.mocked(writeProjectFile).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const saving = useProject.getState().save();
    edit('Newer edit');
    finish({ name: 'sunset.odc.json', path: 'C:\\Projects\\sunset.odc.json' });
    await saving;
    expect(useProject.getState().dirty).toBe(true);
    expect(loadProjectData().data.recoveries[0]?.mission.name).toBe('Newer edit');
    expect(useProject.getState().data.recents[0]?.mission.name).toBe('Snapshot being saved');
  });

  it('reports storage failure visibly without falsely failing a successful file save', async () => {
    await openSaved();
    edit();
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Quota');
    });
    flushProjectRecovery();
    expect(useProject.getState()).toMatchObject({ dirty: true, recoveryState: 'error' });
    expect(useProject.getState().storageError).toContain('Storage may be full');
    expect(await useProject.getState().save()).toBe(true);
    expect(useProject.getState().dirty).toBe(false);
    expect(useProject.getState().storageError).toBeTruthy();
  });
});

describe('unsaved-change protection', () => {
  it('can cancel switching without losing work or undo history', async () => {
    await openSaved();
    edit();
    const current = useStore.getState().mission;
    await useProject.getState().request({ kind: 'new' });
    expect(useProject.getState().pendingAction).toEqual({ kind: 'new' });
    await useProject.getState().resolvePending('cancel');
    expect(useStore.getState().mission).toBe(current);
    expect(useStore.getState().past).toHaveLength(1);
  });

  it('saves before switching, but stays in the guard if Save is canceled', async () => {
    await openSaved();
    edit();
    await useProject.getState().request({ kind: 'new' });
    vi.mocked(writeProjectFile).mockResolvedValueOnce(undefined);
    await useProject.getState().resolvePending('save');
    expect(useProject.getState().pendingAction).toEqual({ kind: 'new' });
    expect(useProject.getState().dirty).toBe(true);
    await useProject.getState().resolvePending('save');
    expect(useProject.getState().pendingAction).toBeUndefined();
    expect(useStore.getState().mission.waypoints).toHaveLength(0);
    expect(useStore.getState().past).toHaveLength(0);
  });

  it('does not discard current work if the next file is invalid or the picker is canceled', async () => {
    await openSaved();
    edit();
    const current = useStore.getState().mission;
    await useProject.getState().request({ kind: 'open' });
    await useProject.getState().resolvePending('discard');
    expect(useStore.getState().mission).toBe(current);
    expect(useProject.getState().dirty).toBe(true);
    await useProject.getState().request({ kind: 'open' });
    vi.mocked(openBinaryFile).mockResolvedValueOnce({
      name: 'broken.json',
      data: new TextEncoder().encode('{"version":1}'),
    });
    await useProject.getState().resolvePending('discard');
    expect(useStore.getState().mission).toBe(current);
    expect(loadProjectData().data.recoveries).toHaveLength(1);
    expect(useProject.getState().actionError).toBeTruthy();
  });

  it('removes an explicitly discarded draft only after a successful switch', async () => {
    await openSaved();
    edit();
    await useProject.getState().request({ kind: 'new' });
    await useProject.getState().resolvePending('discard');
    expect(useProject.getState()).toMatchObject({ dirty: false, path: undefined });
    expect(loadProjectData().data.recoveries).toHaveLength(0);
  });

  it('guards native close and never recreates a discarded draft during pagehide', async () => {
    await openSaved();
    edit();
    await useProject.getState().request({ kind: 'close' });
    expect(closeApplication).not.toHaveBeenCalled();
    await useProject.getState().resolvePending('discard');
    expect(closeApplication).toHaveBeenCalledOnce();
    expect(useProject.getState().closeApproved).toBe(true);
    flushProjectRecovery();
    expect(JSON.parse(localStorage.getItem(PROJECTS_KEY)!).recoveries).toHaveLength(0);
  });

  it('restores recovery protection if native close fails', async () => {
    await openSaved();
    edit();
    vi.mocked(closeApplication).mockRejectedValueOnce(new Error('Close denied'));
    await useProject.getState().request({ kind: 'close' });
    await useProject.getState().resolvePending('discard');
    expect(useProject.getState()).toMatchObject({
      closeApproved: false,
      active: true,
      dirty: true,
    });
    expect(loadProjectData().data.recoveries).toHaveLength(1);
    expect(useProject.getState().actionError).toContain('Could not close');
  });
});

describe('recent projects', () => {
  it('re-reads the actual desktop file rather than silently opening an old snapshot', async () => {
    const original = await openSaved();
    const key = useProject.getState().data.recents[0]!.key;
    const updated = { ...useStore.getState().mission, name: 'Changed on disk' };
    vi.mocked(readProjectFile).mockResolvedValueOnce(picked(updated, original.path));
    await useProject.getState().request({ kind: 'recent', key });
    expect(readProjectFile).toHaveBeenCalledWith(original.path);
    expect(useStore.getState().mission.name).toBe('Changed on disk');
  });

  it('keeps the active project and shows an error when a recent file moved', async () => {
    await openSaved();
    const current = useStore.getState().mission;
    vi.mocked(readProjectFile).mockRejectedValueOnce(new Error('File not found'));
    await useProject
      .getState()
      .request({ kind: 'recent', key: useProject.getState().data.recents[0]!.key });
    expect(useStore.getState().mission).toBe(current);
    expect(useProject.getState().actionError).toContain('File not found');
  });

  it('labels browser recents as snapshots and removes list entries without deleting recovery', async () => {
    const file = picked();
    vi.mocked(openBinaryFile).mockResolvedValueOnce({ ...file, path: undefined });
    await useProject.getState().request({ kind: 'open' });
    const key = useProject.getState().data.recents[0]!.key;
    await useProject.getState().request({ kind: 'recent', key });
    expect(readProjectFile).not.toHaveBeenCalled();
    expect(useStore.getState().toast?.text).toContain('browser snapshot');
    edit();
    flushProjectRecovery();
    useProject.getState().removeRecent(key);
    expect(useProject.getState().data.recents).toHaveLength(0);
    expect(loadProjectData().data.recoveries).toHaveLength(1);
  });
});
