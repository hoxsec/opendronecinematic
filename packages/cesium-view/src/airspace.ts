import { Cartesian3, Color, PolygonHierarchy, type Entity } from 'cesium';
import type { AirspaceZone } from '@odc/core';

export const AIRSPACE_COLORS = {
  restricted: '#f87171',
  controlled: '#a78bfa',
  advisory: '#fbbf24',
};

/** Ground footprints, not regulatory 3D volumes. No HTML or external resources from imported properties. */
export function airspaceEntities(
  zones: AirspaceZone[],
): (Entity.ConstructorOptions & { id: string })[] {
  return zones.flatMap((zone) =>
    zone.polygons.map((rings, i) => ({
      id: `airspace:${zone.id}:${i}`,
      name: zone.name,
      polygon: {
        hierarchy: new PolygonHierarchy(
          rings[0]!.slice(0, -1).map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat)),
          rings
            .slice(1)
            .map(
              (ring) =>
                new PolygonHierarchy(
                  ring.slice(0, -1).map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat)),
                ),
            ),
        ),
        material: Color.fromCssColorString(AIRSPACE_COLORS[zone.category]).withAlpha(0.22),
        // No extruded height: imported limits are intentionally informational only.
      },
    })),
  );
}
