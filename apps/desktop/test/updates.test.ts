import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findUpdate,
  restartForUpdate,
  updaterInfo,
  type UpdateHandle,
} from '../src/updatePlatform';
import { useUpdates } from '../src/updateStore';
import { useProject } from '../src/projectStore';
import { useView } from '../src/viewStore';

vi.mock('../src/updatePlatform', () => ({
  findUpdate: vi.fn(),
  restartForUpdate: vi.fn(),
  updaterInfo: vi.fn(),
}));
let handle: UpdateHandle;
beforeEach(() => {
  vi.clearAllMocks();
  useProject.setState({ active: false, dirty: false, busy: undefined, pendingAction: undefined });
  useView.setState({ fly: false, render: undefined });
  useUpdates.setState({
    phase: 'idle',
    downloaded: false,
    bytes: 0,
    total: undefined,
    error: undefined,
  });
  handle = {
    version: '2.0.0',
    body: 'Release notes',
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(updaterInfo).mockResolvedValue({ enabled: true, version: '1.2.7' });
  vi.mocked(findUpdate).mockResolvedValue(handle);
  vi.mocked(restartForUpdate).mockResolvedValue(undefined);
});

describe('consent-based signed updates', () => {
  it('does not contact a feed in disabled builds', async () => {
    vi.mocked(updaterInfo).mockResolvedValue({ enabled: false, version: '1.2.7' });
    await useUpdates.getState().check();
    expect(findUpdate).not.toHaveBeenCalled();
    expect(useUpdates.getState().phase).toBe('disabled');
  });
  it('checks automatically without downloading or installing', async () => {
    await useUpdates.getState().check(true);
    expect(useUpdates.getState()).toMatchObject({ phase: 'available', version: '2.0.0' });
    expect(handle.download).not.toHaveBeenCalled();
    expect(handle.install).not.toHaveBeenCalled();
  });
  it('blocks installation for unsaved work, project actions, renders and fly mode', async () => {
    await useUpdates.getState().check();
    useProject.setState({ active: true, dirty: true });
    await useUpdates.getState().install();
    expect(useUpdates.getState().error).toMatch(/Save your project/);
    useProject.setState({ dirty: false, busy: 'saving' });
    await useUpdates.getState().install();
    useProject.setState({ busy: undefined });
    useView.setState({ fly: true });
    await useUpdates.getState().install();
    useView.setState({
      fly: false,
      render: {} as NonNullable<ReturnType<typeof useView.getState>['render']>,
    });
    await useUpdates.getState().install();
    expect(handle.download).not.toHaveBeenCalled();
    expect(handle.install).not.toHaveBeenCalled();
  });
  it('rechecks unsaved work after a download and reuses the verified bytes only after saving', async () => {
    await useUpdates.getState().check();
    vi.mocked(handle.download).mockImplementationOnce(async (onEvent) => {
      onEvent({ event: 'Started', data: { contentLength: 100 } });
      onEvent({ event: 'Progress', data: { chunkLength: 100 } });
      useProject.setState({ active: true, dirty: true });
    });
    await useUpdates.getState().install();
    expect(handle.install).not.toHaveBeenCalled();
    expect(useUpdates.getState()).toMatchObject({
      phase: 'available',
      downloaded: true,
      bytes: 100,
    });
    useProject.setState({ active: false, dirty: false });
    await useUpdates.getState().install();
    expect(handle.download).toHaveBeenCalledTimes(1);
    expect(handle.install).toHaveBeenCalledTimes(1);
    expect(restartForUpdate).toHaveBeenCalledTimes(1);
  });
  it('never installs when download/signature verification fails, and permits retry', async () => {
    await useUpdates.getState().check();
    vi.mocked(handle.download).mockRejectedValueOnce(new Error('signature mismatch'));
    await useUpdates.getState().install();
    expect(handle.install).not.toHaveBeenCalled();
    expect(restartForUpdate).not.toHaveBeenCalled();
    expect(useUpdates.getState()).toMatchObject({ phase: 'available', downloaded: false });
    expect(useUpdates.getState().error).toContain('signature mismatch');
    await useUpdates.getState().install();
    expect(handle.install).toHaveBeenCalledTimes(1);
  });
  it('does not reinstall if a restart fails', async () => {
    await useUpdates.getState().check();
    vi.mocked(restartForUpdate).mockRejectedValueOnce(new Error('restart failed'));
    await useUpdates.getState().install();
    expect(useUpdates.getState().phase).toBe('installed');
    await useUpdates.getState().restart();
    expect(handle.install).toHaveBeenCalledTimes(1);
    expect(restartForUpdate).toHaveBeenCalledTimes(2);
  });

  it('downloads fresh verified bytes after a failed native install', async () => {
    await useUpdates.getState().check();
    vi.mocked(handle.install).mockRejectedValueOnce(new Error('permission denied'));
    await useUpdates.getState().install();
    expect(useUpdates.getState()).toMatchObject({ phase: 'available', downloaded: false });
    expect(restartForUpdate).not.toHaveBeenCalled();
    await useUpdates.getState().install();
    expect(handle.download).toHaveBeenCalledTimes(2);
    expect(handle.install).toHaveBeenCalledTimes(2);
  });
  it('handles a missing release or unavailable network without claiming success', async () => {
    vi.mocked(findUpdate).mockResolvedValueOnce(null);
    await useUpdates.getState().check();
    expect(useUpdates.getState().phase).toBe('current');
    vi.mocked(findUpdate).mockRejectedValueOnce(new Error('offline'));
    await useUpdates.getState().check();
    expect(useUpdates.getState().phase).toBe('error');
  });
});
