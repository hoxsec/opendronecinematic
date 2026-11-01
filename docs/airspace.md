# Airspace overlays

**Safety → Airspace overlays** imports a local GeoJSON file, draws colored footprints on the planning map, and checks the preview route for potential horizontal crossings. Click a warning to locate the first approximate crossing and scrub the timeline to it.

**This is not flight clearance or a live regulatory service.** No country coverage is included. Obtain current data from a source you trust and independently check official airspace, NOTAMs, temporary restrictions, permissions and local rules before every flight. OpenStreetMap airfield/obstacle warnings are separate and are not authoritative airspace boundaries.

## Supported files

Use RFC 7946 WGS84 **FeatureCollection** GeoJSON with **Polygon** or **MultiPolygon** features. Coordinates are **[longitude, latitude]**, not latitude first. Rings must be closed; holes are supported. Unknown geometries or invalid coordinates reject the entire replacement instead of silently leaving gaps. Reproject non-WGS84 data before importing and remove legacy `crs` declarations. Maximum: 10 MB, 5,000 features and 200,000 positions.

Optional feature properties:

| Property         | Meaning                                                                |
| ---------------- | ---------------------------------------------------------------------- |
| `name`           | Display name; otherwise generated                                      |
| `category`       | `restricted` (red), `controlled` (purple), `advisory` (amber, default) |
| `lower`, `upper` | Published altitude-limit **text labels**, e.g. `SFC`, `1500 ft AMSL`   |
| `description`    | Plain-text information displayed with a crossing warning               |

Feature `id`, if present, must be unique. IDs are generated for features without one. Additional properties are ignored, not interpreted as flight rules. Convert provider-specific schemas explicitly; in particular, do not assume EASA U-space, OpenAIP or national datasets use these property names/categories.

Optional collection members are `source` (plain-text attribution) and `validUntil` (ISO timestamp with timezone). Missing validity is displayed as **freshness unknown**, and elapsed validity as **expired**. These are source declarations, not guarantees; importing a file does not refresh its publication date. Expired layers continue to warn about potential crossings.

```json
{
  "type": "FeatureCollection",
  "source": "Illustrative test data — NOT FOR FLIGHT",
  "features": [
    {
      "type": "Feature",
      "id": "test-zone",
      "properties": {
        "name": "Example footprint",
        "category": "advisory",
        "lower": "SFC",
        "upper": "Check official publication"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [7, 46],
            [7.01, 46],
            [7.01, 46.01],
            [7, 46.01],
            [7, 46]
          ]
        ]
      }
    }
  ]
}
```

## What the check does—and does not do

- It checks the **horizontal footprint at every altitude**, conservatively. Vertical limits, classes, schedules and activation times do **not** suppress warnings. A crossing does not necessarily mean flight is prohibited.
- It samples the same curved preview route used by playback (10 m spacing, increasing for very long routes), then intersects **whole segments**, including narrow zones between samples. Boundaries and hole edges count as potential contact. Positions and timeline jumps are approximate, not certified navigation geometry.
- It supports local polygons crossing the antimeridian; split polygons spanning 180° or more of longitude. Global/polar regulatory geometry is not a supported navigation use case.
- Analysis runs in a cancellable background worker after edits settle. Pending/failed checks are shown explicitly, not as zero crossings.
- Transit from takeoff, return-to-home, landing, failsafes, weather and the flown aircraft's deviations are not evaluated.
- **No crossings found** means only that the loaded file's footprints did not intersect the sampled route. It says nothing about coverage, freshness or legal permission.

## Local storage

One layer is retained in IndexedDB on this device, separately from projects and map tiles. **Replace** validates before changing the current layer. **Show footprints on map** hides only the visualization; route warnings stay enabled. **Remove layer** removes the saved copy. Storage errors are visible; a session-only replacement may not survive a restart.

Airspace is **not embedded in `.odc.json` files** and is not exported to the aircraft. Reimport it on another device. The export dialog reminds you of the current check status but never grants authorization.
