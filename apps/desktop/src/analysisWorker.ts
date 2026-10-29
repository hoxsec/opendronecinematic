import type { AnalysisRequest, AnalysisResult } from './analysisTasks';

/** Each settled edit owns its worker; a newer edit immediately terminates obsolete work. */
export function runAnalysis(
  request: AnalysisRequest,
  signal: AbortSignal,
): Promise<AnalysisResult> {
  if (signal.aborted) return Promise.reject(new DOMException('Analysis cancelled', 'AbortError'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./mission-analysis.worker.ts', import.meta.url), {
      type: 'module',
    });
    const cleanup = () => {
      signal.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Analysis cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ result?: AnalysisResult; error?: string }>) => {
      cleanup();
      if (event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error ?? 'Mission analysis failed'));
    };
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || 'Mission analysis worker failed'));
    };
    worker.postMessage(request);
  });
}
