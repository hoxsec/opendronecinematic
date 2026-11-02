# OpenDroneCinematic v1.4.0

## Custom desktop title bar

- Replaced the default operating-system title bar with branded application chrome on Windows, macOS, and Linux.
- Added drag-to-move and minimize, maximize/restore, and close controls, with left-aligned traffic-light controls on macOS.
- Displayed the current project name, unsaved-change indicator, and inactive-window styling.
- Preserved save-before-close protection and blocked closing during update installation.
- Kept browser development free of desktop-only window controls.

## Validation

TypeScript checks, the frontend production build, and all 243 automated tests pass, including title-bar markup and permissions checks for all three platform layouts. Native title-bar interaction and real cross-platform upgrade testing have not been performed for this release.

## Installation and trust

Windows installers are not publisher-signed, and macOS bundles use ad-hoc signing rather than Apple notarization. Operating-system security warnings may apply. Updater signatures verify update artifacts; they do not establish OS publisher trust. See the [release and updater documentation](https://github.com/hoxsec/opendronecinematic/blob/v1.4.0/docs/releases.md).
