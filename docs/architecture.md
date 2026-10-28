# Architecture

```
            ┌────────────────────────── apps/desktop (React + Tauri) ─────────────────────────┐
            │  store.ts (zustand: mission, undo, UI state)   components/* (panels, dialogs)  │
            └───────────────┬───────────────────────────────┬─────────────────────────────────┘
                            │                               │
                 @odc/cesium-view                   @odc/exporters
   MissionScene · PovView · sources · DEM     Litchi CSV · DJI WPML/KMZ · MAVLink · importers
                            │                               │
                            └──────────────┬────────────────┘
                                      @odc/core
   geo (WGS84/ENU) · mission model · path (spline + timing) · camera · profiles · safety · templates
                              survey (grid + GSD) · dem (UTM, bilinear heights)
```

## Core ideas

**One source of truth for motion.** `buildFlightPath(mission)` in `packages/core/src/path.ts` turns waypoints into a time-parameterised path. `sample(t)` returns the position, yaw, gimbal pitch and speed at any moment. The POV preview, playback, frustum, safety sampling and densified exports all call it, so they always agree.

- **Geometry:** a centripetal Catmull–Rom spline through the waypoints, computed in a local ENU frame at the takeoff point. _Straight_ mode uses linear legs instead.
- **Timing:** speed ramps linearly with distance between waypoint speeds. Leg time is the closed-form integral of `ds / v(s)`, and its inverse maps time back to distance. Hovers add dwell time at waypoints.
- **Camera:** each waypoint resolves a yaw and pitch at the current position (along path, toward a POI, or fixed). The two ends of a leg are blended with smoothstep along the shortest yaw arc. POI tracking is evaluated continuously, not only at waypoints.

**Heights.** Waypoints store `alt` in the mission's altitude mode plus the `groundHeight` captured when they were placed. `waypointHeight()` resolves the absolute ellipsoid height. Changing the mode re-expresses the values without moving anything.

**Surveys are just waypoints.** `planSurvey()` lays out a serpentine over the outline in a local ENU frame rotated to the line angle, intersecting each line with the polygon (so concave outlines give several segments per line). Line ends carry a `photoDistance` action that starts or stops distance-triggered photos. `surveyWaypoints()` then places the points at the survey height above the sampled ground. Because the result is an ordinary waypoint list, the preview, safety checks and every exporter work unchanged; the spec is kept on `mission.survey` so the outline can be edited and regenerated.

**Terrain from a GeoTIFF.** `readGeoTiffDem()` (cesium-view, using geotiff.js) decodes the raster into a `DemGrid`; `Dem` in core does the CRS maths and bilinear lookups. The same object feeds a `CustomHeightmapTerrainProvider` for display and `MissionScene.sampleGround()` directly, so safety checks read the raster rather than whatever tiles are loaded. The raw file is kept in IndexedDB and decoded again at startup.

**Imports.** Each importer turns a file into an `ImportedPlan` (positions, heights in the file's own reference, POIs, actions) without knowing the ground. The app samples ground heights and `importedToMission()` builds the mission. Round-trip tests export every format, import it again and compare positions and actions.

**No Cesium in core.** `core` and `exporters` are plain TypeScript and are tested in Node. Cesium is confined to `cesium-view`, which provides:

- `MissionScene`: the main viewer. It renders entities, turns clicks and drags into events, draws the frustum with `DebugCameraPrimitive`, and samples ground heights (terrain plus 3D tiles, taking the maximum so buildings count as obstacles).
- `PovView`: a second `CesiumWidget` posed at `sample(t)` with the profile's horizontal FOV. It records through `canvas.captureStream()` and `MediaRecorder`.

**Desktop shell.** Tauri 2 provides native open/save dialogs (`plugin-dialog`), file I/O (`plugin-fs`), and the asset protocol for loading local 3D Tiles. `platform.ts` falls back to browser downloads and file inputs, so the UI also runs with `npm run dev`.

## Adding an exporter

1. Create `packages/exporters/src/<format>.ts` that takes `toExportPoints(mission, opts)` and returns `{ data, warnings }`.
2. Add golden-file tests in `packages/exporters/test`.
3. Add the format to `ExportDialog.tsx` and to the profiles' `exportFormats`.
4. Document the mapping in `docs/exports.md`.
