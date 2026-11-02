# OpenDroneCinematic v1.4.1

## OpenAIP airspace downloads

- Download daily country airspace GeoJSON exports from **Safety → Airspace overlays** in the desktop app, without an API key.
- Import downloaded OpenAIP GeoJSON in both the browser and desktop app using **Import OpenAIP…**.
- Convert OpenAIP categories and altitude labels explicitly, preserve source attribution, and save validated layers locally for offline planning.
- Keep the previous layer unchanged when downloads or validation fail. Downloads have a timeout and byte limit and use a fixed HTTPS export endpoint.

Only one layer is retained at a time. Overlays check horizontal footprints, not altitude limits or activation schedules; they do not provide flight clearance, complete coverage or a live NOTAM feed. OpenAIP data is licensed under CC BY-NC 4.0; check provider licensing for commercial use. See [airspace documentation](https://github.com/hoxsec/opendronecinematic/blob/v1.4.1/docs/airspace.md).

## Validation

All 258 automated frontend tests, TypeScript checks, the frontend production build and the native downloader unit test pass locally. A live Austrian OpenAIP export was downloaded and validated with 225 airspaces. Native end-to-end UI interaction and real cross-platform upgrades have not been tested.

## Installation and trust

Windows installers are not publisher-signed, and macOS bundles use ad-hoc signing rather than Apple notarization. Operating-system security warnings may apply. Updater signatures verify update artifacts; they do not establish OS publisher trust. See the [release and updater documentation](https://github.com/hoxsec/opendronecinematic/blob/v1.4.1/docs/releases.md).
