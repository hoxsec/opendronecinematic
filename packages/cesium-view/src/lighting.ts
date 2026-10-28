import { DynamicAtmosphereLightingType, JulianDate, type Clock, type Scene } from 'cesium';

/**
 * Light a scene by the real sun at `time`: terrain shading, sky and atmosphere colour, and
 * optionally shadows from terrain, buildings and 3D tiles. The clock is frozen so the scene only
 * changes time when this is called.
 */
export function applySunLight(scene: Scene, clock: Clock, time: Date, shadows: boolean) {
  clock.shouldAnimate = false;
  clock.currentTime = JulianDate.fromDate(time, clock.currentTime);
  scene.globe.enableLighting = true;
  scene.atmosphere.dynamicLighting = DynamicAtmosphereLightingType.SUNLIGHT;
  scene.shadowMap.enabled = shadows;
  scene.shadowMap.softShadows = true;
  scene.requestRender();
}
