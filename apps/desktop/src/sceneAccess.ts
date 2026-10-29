import type { MissionScene } from '@odc/cesium-view';

/** Optional ground sampler; opening a project must not construct a WebGL viewer. */
export let activeScene: MissionScene | undefined;
export function setActiveScene(scene?: MissionScene) {
  activeScene = scene;
}
