# M3 validation draft

This is an **unpublished draft for testing**, not a claim of flight readiness. Review the installers and update artifacts before publishing. No existing installation is offered this draft by the stable updater feed.

## What's new

- **Airspace overlays:** import local GeoJSON polygons, retain them on this device, show colored map footprints, and check the preview route for potential horizontal crossings in a background worker. Source/freshness limits are explicit; hiding footprints does not disable warnings.
- **Exporter plugin API v1:** reviewed, build-time extensions can declare formats and options and return asynchronous text/binary exports. All four existing exporters use the registry, with their golden-file behavior preserved.
- **Signature-verified desktop updates:** configured builds check for updates at startup and offer manual checks, release notes, download progress and explicit install/restart consent. Unsaved projects, renders and fly mode prevent installation; failed signature verification never proceeds to installation.

## Installation and updater notes

- Users on v1.2.7 or earlier need **one manual installation** of this configured build before they can receive future in-app updates.
- Only the free updater key pair is used. Windows installers are not publisher-signed; macOS bundles are ad-hoc signed, not Developer ID-signed or notarized. SmartScreen, Gatekeeper or organizational policy may warn or block installation.
- Updater signatures do not remove OS trust restrictions. Linux updater support uses the AppImage, not a signed `.deb` repository.
- The stable feed only becomes available once a reviewed release with `latest.json` is published. A draft does not expose public update downloads or prove an end-to-end upgrade.

## Important limits

- Airspace data is user-supplied. No authoritative country coverage or live NOTAM feed is included. Checks are horizontal only: vertical limits, activation schedules and takeoff/return/emergency paths are not evaluated. Always consult official sources before flying.
- Exporter extensions are trusted application code, not sandboxed downloads or a marketplace.
- Flight plans still require independent review and safe-area testing. Existing aircraft safety thresholds are unchanged.

See [M3 status](https://github.com/hoxsec/opendronecinematic/blob/v1.3.0/docs/m3.md), [airspace limits](https://github.com/hoxsec/opendronecinematic/blob/v1.3.0/docs/airspace.md), [exporter API](https://github.com/hoxsec/opendronecinematic/blob/v1.3.0/docs/exporter-plugins.md), and [updater setup](https://github.com/hoxsec/opendronecinematic/blob/v1.3.0/docs/releases.md).
