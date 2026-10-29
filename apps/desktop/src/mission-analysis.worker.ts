import { analyzeMission, type AnalysisRequest } from './analysisTasks';

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  try {
    self.postMessage({ result: analyzeMission(event.data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
