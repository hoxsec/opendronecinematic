import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMission } from '@odc/core';
import { runAnalysis } from '../src/analysisWorker';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string }) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});

describe('cancellable analysis workers', () => {
  const request = {
    kind: 'zoom' as const,
    mission: createMission({ lat: 46, lon: 7, groundHeight: 0 }),
  };

  it('terminates obsolete work on the next edit', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const controller = new AbortController();
    const result = runAnalysis(request, controller.signal);
    const worker = FakeWorker.instances[0]!;
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith(request);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('returns completed results and releases the worker', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const controller = new AbortController();
    const result = runAnalysis(request, controller.signal);
    const worker = FakeWorker.instances[0]!;
    worker.onmessage!({ data: { result: { kind: 'zoom', events: [] } } });
    await expect(result).resolves.toEqual({ kind: 'zoom', events: [] });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('does not start work for an already cancelled edit and reports worker errors', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const controller = new AbortController();
    controller.abort();
    await expect(runAnalysis(request, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(FakeWorker.instances).toHaveLength(0);
    const result = runAnalysis(request, new AbortController().signal);
    FakeWorker.instances[0]!.onerror!({ message: 'Worker unavailable' });
    await expect(result).rejects.toThrow('Worker unavailable');
    expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledTimes(1);
  });
});
