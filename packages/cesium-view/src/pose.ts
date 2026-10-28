import { Cartesian3, HeadingPitchRoll, Math as CMath, type Camera } from 'cesium';
import type { Geodetic } from '@odc/core';

/** Where the drone camera is and where it points. A path sample or the live fly-mode state. */
export interface CameraPose {
  position: Geodetic;
  /** Degrees clockwise from north. */
  yaw: number;
  /** Gimbal pitch in degrees, 0 = horizon. */
  pitch: number;
}

export function applyPose(camera: Camera, pose: CameraPose) {
  camera.setView({
    destination: Cartesian3.fromDegrees(pose.position.lon, pose.position.lat, pose.position.height),
    orientation: new HeadingPitchRoll(CMath.toRadians(pose.yaw), CMath.toRadians(pose.pitch), 0),
  });
}
