# OpenDroneCinematic

Open-source 3D flight planner for drone cinematography, built on [CesiumJS](https://cesium.com/platform/cesiumjs/).

Plan a shot on a photorealistic globe, lock the camera onto a subject, preview exactly what the drone will see, check the flight for terrain and battery problems, and export it to your drone.

> **Status:** early development (milestone 1, cinematic MVP). Treat exported missions with care: always do a test flight in a safe area with enough height before you trust a plan near obstacles.

## Features

- **3D planning on a real globe**: Cesium World Terrain, Bing or OSM imagery, OSM Buildings or Google Photorealistic 3D Tiles, and your own 3D Tiles (photogrammetry, scans).
- **Waypoints**: click to place them and drag to move them. Each waypoint has its own altitude, speed, heading mode, gimbal pitch, hover and record/photo actions. Altitudes can be relative to takeoff, above ground (AGL), or WGS84 ellipsoid.
- **Precise camera aiming**: points of interest (POIs), heading modes (along path / face POI / fixed) and gimbal modes (fixed pitch / track POI). The camera eases smoothly between waypoints.
- **Drone POV preview**: a second view renders the real camera frame using the drone's field of view, with a rule-of-thirds overlay and a HUD.
- **Playback and video**: scrub or play the flight and record the POV to WebM to share a previz.
- **Shot templates**: orbit, helix, reveal, dolly, fly-by and dronie, all generated around a POI.
- **Safety checks**: clearance over terrain and buildings, 120 m AGL ceiling, distance from takeoff, speed and climb limits, and battery estimate with reserve.
- **Export**: Litchi CSV and DJI WPML/KMZ. _Densify_ mode bakes the exact previewed path and camera angles into closely spaced waypoints.
- **Drone profiles**: DJI Mini 4 Pro, Air 3, Mavic 3, Mavic 3E, M30, M350 + H20, ArduPilot/PX4, and a custom profile.

## Getting started

Prerequisites: [Node.js 22+](https://nodejs.org/). For the desktop app you also need [Rust](https://rustup.rs/) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
npm install
```

Run in a browser (fastest for UI work):

```bash
npm run dev
```

Then open http://localhost:1420.

Run as a desktop app:

```bash
npm run tauri dev
```

Build installers:

```bash
npm run tauri build
```

### Map data and the Cesium ion token

Without a token the app uses OpenStreetMap imagery on flat terrain. For real terrain, aerial imagery and 3D buildings, create a free account at [ion.cesium.com](https://ion.cesium.com/), copy your default access token, and paste it in **Map data**. The token stays on your computer.

Google Photorealistic 3D Tiles are streamed through Cesium ion. Check the Google and Cesium terms before you use them commercially.

## Using it

1. **Takeoff** (T): click your launch point.
2. **POI** (P): click the subject the camera should look at.
3. **Shot templates**: pick _Orbit_, set distance and height, then click **Replace waypoints**. You can also place waypoints yourself with **Waypoint** (W).
4. Drag waypoints and POIs to adjust them. Select a waypoint to edit its altitude, speed, heading, gimbal and actions.
5. Press **Space** to play, scrub the timeline, and watch the POV preview. Click **● Rec** to save a WebM previz.
6. Check the **Safety** panel. Clicking an issue jumps to that point in the flight.
7. **Export…** to Litchi CSV or DJI KMZ.

### Camera view, fly mode and video

- **Swap views:** press **Tab** or click the mini-screen to make the camera view the main screen with the map as the mini-screen, or the other way round. Drag the mini-screen's top bar to move it, and its top-left corner to resize it.
- **Fly mode (F):** fly the drone from the camera view to scout a shot. The drone keeps the profile's speed and climb limits, accelerates and brakes smoothly, and can't fly into terrain or buildings. It works with keyboard and mouse or a gamepad (Mode 2 sticks).
  - **Space** (pad A) drops a waypoint at the drone's current position, altitude, heading and gimbal tilt.
  - **P** (pad B) marks a POI wherever the centre crosshair hits terrain or buildings.
  - **L** (pad X) starts recording the flight path. Press it again to simplify the path into waypoints that keep your pacing, camera moves and pauses.
- **🎬 Render…** renders the planned flight frame by frame to **MP4 (H.264), WebM or GIF** at 720p–4K and 24–60 fps. Each frame waits for map tiles, so the output is smooth whatever your hardware. A live REC overlay shows progress, file size and ETA.
- **Takes:** each render opens in the camera view. Use **🎞 Takes** to replay, save, delete, or **⇆ Compare** a take side by side with the live 3D view, synced to the timeline.

Keyboard shortcuts: `V` select · `W` waypoint · `P` POI · `T` takeoff · `F` fly · `Tab` swap views · `Space` play · `Del` delete · `Ctrl+Z` / `Ctrl+Y` undo/redo · `Esc` cancel.

See [docs/exports.md](docs/exports.md) for how each format maps to the drone and its known limits.

## Project layout

```
apps/desktop/          Tauri 2 + React app (src/ is the UI, src-tauri/ is the Rust shell)
packages/core/         Pure TypeScript: mission model, geodesy, spline path + timing,
                       camera maths, drone profiles, safety checks, shot templates
packages/exporters/    Litchi CSV and DJI WPML/KMZ writers with golden-file tests
packages/cesium-view/  CesiumJS integration: data sources, mission rendering, picking,
                       ground sampling, POV view and recording
docs/                  Architecture and export notes
```

`core` and `exporters` never import Cesium, so they run and test in plain Node. See [docs/architecture.md](docs/architecture.md).

## Development

```bash
npm test            # unit + golden-file tests (Vitest)
npm run typecheck   # tsc across all packages
npm run format      # prettier
```

If you change an exporter on purpose, update its golden files with `npx vitest run -u` and review the diff.

## Roadmap

- **M2**: survey/mapping grids (polygon, overlap, GSD), QGroundControl `.plan` / MAVLink export, GeoTIFF terrain, importing KMZ/Litchi/.plan files
- **M3**: airspace overlays, signed installers with auto-update, plugin API for new exporters

## Contributing

Contributions are welcome, especially verified DJI enum values, real-world flight test reports and new export formats. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). CesiumJS is Apache-2.0. Map data comes from its respective providers under their own terms.
