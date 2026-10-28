# Contributing

Thanks for helping make drone flight planning open.

## Setup

```bash
npm install
npm run dev        # browser at http://localhost:1420
npm run tauri dev  # desktop (needs Rust + Tauri prerequisites)
```

## Before opening a PR

```bash
npm run typecheck
npm test
npm run format:check
```

- Keep `packages/core` and `packages/exporters` free of Cesium and DOM APIs.
- When you change exporter output, update the golden files (`npx vitest run -u`) and explain in the PR why the output changed.
- Each UI change should come with a screenshot.

## Especially wanted

- **Verified DJI enum values** (`droneEnumValue` / `payloadEnumValue`) for consumer drones. Take them from a KMZ that DJI Fly or Pilot 2 created, and say which app and firmware version produced it.
- **Flight test reports**: export → app → real flight, plus whether the path and camera matched the preview.
- **New drone profiles** with a source for each spec.
- **Exporters**: QGroundControl `.plan`, Mission Planner, Autel, Skydio.

## Safety

This software plans flights for real aircraft. Changes that affect heights, units, coordinate order or speeds need a test that pins the behaviour. Never weaken a safety check without discussing it in an issue first.

## Code of conduct

Be kind and constructive. Harassment of any kind is not tolerated.
