# Exporter plugin API v1

`@odc/exporters` exposes `ExporterPlugin`, `ExporterRegistry`, `EXPORTER_API_VERSION`, `exporterDefaults()` and `createBuiltinExporterRegistry()`. The four built-ins use the same registry as extensions. Existing direct exporter functions remain supported and their golden files are unchanged.

This is a **trusted, build-time extension API**, not a downloadable plugin marketplace or JavaScript sandbox. Review extension code like any other app dependency. The app never evaluates scripts from projects, imported files or arbitrary URLs.

## Add an extension

Write a plain TypeScript module using only core/exporter APIs, then statically import and register it in `apps/desktop/src/exportPlugins.ts`:

```ts
import { toExportPoints, type ExporterPlugin } from '@odc/exporters';

export const reviewJson: ExporterPlugin = {
  apiVersion: 1,
  id: 'example.review-json',
  name: 'Review points JSON',
  description: 'Planning review only; not a flyable aircraft mission.',
  extension: 'json',
  supportsDensify: true,
  options: [{ id: 'pretty', label: 'Pretty print', type: 'boolean', default: true }],
  export(mission, options, values) {
    return {
      data: JSON.stringify(toExportPoints(mission, options), null, values.pretty ? 2 : 0),
      warnings: ['Review data only. Do not upload this file to an aircraft.'],
    };
  },
};
```

```ts
// apps/desktop/src/exportPlugins.ts, after creating exportPlugins:
import { reviewJson } from './plugins/reviewJson';
exportPlugins.register(reviewJson);
```

Rebuild the app. The export dialog automatically discovers the format, extension, description, option controls and warnings. There is no format switch to edit.

## Contract

- `apiVersion` must equal `EXPORTER_API_VERSION` (currently `1`). IDs use lowercase letters/digits separated by `-` or `.`; use a vendor prefix. Duplicate IDs, including built-ins, are rejected; metadata is snapshotted/frozen at registration.
- `extension` is a single lowercase alphanumeric suffix, with no dot or path. The host chooses the destination and filename. Extensions return data; they should not perform file I/O or network requests.
- `profileFormat` optionally refers to one existing drone-profile compatibility category (`litchi`, `dji-kmz`, `qgc`, `mp-waypoints`). Omit it for new formats: the UI explicitly marks aircraft compatibility as unverified. Do not claim compatibility without evidence.
- `supportsDensify` opts into **Match preview exactly**. `options.densify` is `0` (off) or a finite spacing ≥ 1 m. Use `toExportPoints(mission, options)` so height references, actions and camera angles agree with the preview. Metres and WGS84 coordinate ordering must have tests.
- `options` declares boolean, number (`min`, `max`, optional `step`) or select (`choices`) controls with required defaults. The host supplies validated values as the third argument. Unknown keys, non-finite numbers, out-of-range values and invalid choices fail before export. `step` is a UI increment, not a numeric quantization rule.
- `export()` may be synchronous or asynchronous. Return `{ data: string | Uint8Array, warnings: string[] }`, with nonempty data. Throw for a fatal error; warn for lossy mappings or unverified assumptions. Binary output and warnings are copied before delivery to the host.
- Each run receives a **deep copy of the mission**, not the live editor object. This prevents accidental editing, but is not a security sandbox. Treat metadata/options as immutable and keep runs independent.
- The dialog ignores obsolete async results and disables saving until the current mission/options have a valid result. Extensions must settle their promises; v1 does not provide process isolation, execution time limits, cancellation or automatic retries.
- Registries belong to their host. Importing a module does not mutate a global registry. `list()`, `get(id)` and `run(id, mission, options?, values?)` support other hosts and tests.

Add deterministic unit/golden tests in `packages/exporters/test`, document units and losses in `docs/exports.md`, and validate in the target ground-control app before any safe-area flight test. A plugin does not bypass airspace, terrain or aircraft checks.
