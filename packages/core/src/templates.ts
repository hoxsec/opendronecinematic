import { EnuFrame, bearing, toRad, wrap360, type Vec3 } from './geo';
import {
  altFromHeight,
  createWaypoint,
  newId,
  type Mission,
  type PointOfInterest,
  type Waypoint,
} from './mission';
import { clamp } from './camera';
import { focalRange, missionProfile } from './profiles';

/** A cinematic move generated around a subject. */
export type ShotTemplate =
  'orbit' | 'helix' | 'reveal' | 'dolly' | 'flyby' | 'dronie' | 'dollyzoom';

export interface ShotParams {
  /** The subject. Its height is the point the camera looks at. */
  subject: PointOfInterest;
  /** Ground height (ellipsoid) around the subject, used for altitude conversion. */
  groundHeight: number;
  /** Horizontal distance from the subject in metres. */
  radius: number;
  /** Flight height above the subject's ground in metres. */
  height: number;
  /** Compass bearing from the subject where the shot starts. */
  startBearing: number;
  /** For orbit/helix: degrees to sweep (negative = counter-clockwise). */
  sweep?: number;
  /** For helix/dronie: metres climbed over the shot. */
  climb?: number;
  speed?: number;
  /** For dollyzoom: back away while zooming in, or push in while zooming out. */
  dollyZoom?: 'pull-out' | 'push-in';
  /** For dollyzoom: far distance over near distance, also the zoom ratio. Capped by the lens. */
  zoomRatio?: number;
}

export interface ShotResult {
  waypoints: Waypoint[];
  poi: PointOfInterest;
}

export const SHOT_TEMPLATES: { id: ShotTemplate; name: string; description: string }[] = [
  {
    id: 'orbit',
    name: 'Orbit',
    description: 'Circle the subject at a constant height, camera locked on.',
  },
  { id: 'helix', name: 'Helix', description: 'Orbit while climbing for a rising spiral.' },
  {
    id: 'reveal',
    name: 'Reveal',
    description: 'Fly toward the subject, tilting up from the ground to the horizon.',
  },
  {
    id: 'dolly',
    name: 'Dolly / truck',
    description: 'Slide sideways past the subject, camera tracking it.',
  },
  {
    id: 'flyby',
    name: 'Fly-by',
    description: 'Fly a straight line past the subject while panning to follow it.',
  },
  {
    id: 'dronie',
    name: 'Dronie / pull-back',
    description: 'Start close and pull away while climbing, keeping the subject framed.',
  },
  {
    id: 'dollyzoom',
    name: 'Dolly zoom (vertigo)',
    description:
      'Move toward or away from the subject while zooming the other way, so it keeps its size while the background stretches or squeezes.',
  },
];

export function generateShot(mission: Mission, kind: ShotTemplate, p: ShotParams): ShotResult {
  const poi: PointOfInterest = { ...p.subject, id: p.subject.id || newId('poi') };
  const frame = new EnuFrame({ lat: poi.lat, lon: poi.lon, height: p.groundHeight });
  const speed = p.speed ?? mission.settings.speed;

  const at = (bearingDeg: number, dist: number, up: number): Vec3 => [
    Math.sin(toRad(bearingDeg)) * dist,
    Math.cos(toRad(bearingDeg)) * dist,
    up,
  ];
  const wp = (enu: Vec3, extra: Partial<Waypoint> = {}) => {
    const g = frame.fromEnu(enu);
    return createWaypoint({
      lat: g.lat,
      lon: g.lon,
      groundHeight: p.groundHeight,
      alt: Math.round(altFromHeight(mission, p.groundHeight, g.height) * 10) / 10,
      speed,
      heading: 'poi',
      gimbal: 'poi',
      poiId: poi.id,
      ...extra,
    });
  };

  const b0 = p.startBearing;
  const r = p.radius;
  const h = p.height;
  let waypoints: Waypoint[] = [];

  switch (kind) {
    case 'orbit':
    case 'helix': {
      const sweep = p.sweep ?? 360;
      const climb = kind === 'helix' ? (p.climb ?? h) : 0;
      // 12 points per turn keeps the centripetal spline within ~1% of a true circle
      // (8 points drifts ~4% near the open ends).
      const steps = Math.max(4, Math.ceil((Math.abs(sweep) / 360) * 12));
      for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        waypoints.push(wp(at(b0 + sweep * f, r, h + climb * f)));
      }
      break;
    }
    case 'reveal': {
      // Approach along startBearing, gimbal easing from nadir-ish to the horizon.
      waypoints = [
        wp(at(b0, r, h), {
          heading: 'fixed',
          headingDeg: wrap360(b0 + 180),
          gimbal: 'fixed',
          gimbalPitch: -80,
        }),
        wp(at(b0, r * 0.6, h), {
          heading: 'fixed',
          headingDeg: wrap360(b0 + 180),
          gimbal: 'fixed',
          gimbalPitch: -40,
        }),
        wp(at(b0, r * 0.25, h), {
          heading: 'fixed',
          headingDeg: wrap360(b0 + 180),
          gimbal: 'fixed',
          gimbalPitch: 0,
        }),
      ];
      break;
    }
    case 'dolly':
    case 'flyby': {
      // Straight line perpendicular to the start bearing, passing `radius` from the subject.
      const half = kind === 'dolly' ? r * 0.5 : r * 1.5;
      const centre = at(b0, r, h);
      const side: Vec3 = [Math.sin(toRad(b0 + 90)), Math.cos(toRad(b0 + 90)), 0];
      for (const f of [-1, -0.5, 0, 0.5, 1]) {
        waypoints.push(wp([centre[0] + side[0] * half * f, centre[1] + side[1] * half * f, h]));
      }
      break;
    }
    case 'dronie': {
      const climb = p.climb ?? h * 2;
      waypoints = [
        wp(at(b0, r * 0.2, Math.max(3, h * 0.2))),
        wp(at(b0, r * 0.6, h * 0.2 + climb * 0.4)),
        wp(at(b0, r * 1.2, h * 0.2 + climb)),
      ];
      break;
    }
    case 'dollyzoom': {
      // Starts at the main focal length (pull-out) or zoomed in (push-in); the zoomLock legs
      // then scale the focal length with the distance to the subject.
      const [fMin, fMax] = focalRange(missionProfile(mission));
      const ratio = clamp(p.zoomRatio ?? 3, 1, fMax / fMin);
      const pull = p.dollyZoom !== 'push-in';
      const [d0, d1] = pull ? [r, r * ratio] : [r * ratio, r];
      const dh = p.groundHeight + h - poi.height;
      const start = pull ? fMin : (fMin * Math.hypot(r * ratio, dh)) / Math.hypot(r, dh);
      waypoints = [0, 0.5, 1].map((f, i) =>
        wp(at(b0, d0 + (d1 - d0) * f, h), i === 0 ? { focalMm: start } : { zoomLock: true }),
      );
      break;
    }
  }

  return { waypoints, poi };
}

/** Bearing from the subject toward the takeoff, a sensible default start for most shots. */
export function defaultStartBearing(mission: Mission, subject: PointOfInterest): number {
  return bearing(subject, mission.takeoff);
}
