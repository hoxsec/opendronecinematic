# CI, release caching, and dependency alerts

CI runs web checks and the three-platform Rust matrix concurrently. New commits
cancel superseded CI runs on the same ref; release runs are never auto-cancelled.
The Rust matrix also tests the offline data library, including ZIP handling.

## Warming release caches

Release builds use a separate Rust cache from CI because optimized builds cannot
reuse `cargo check` artifacts. GitHub caches are ref-scoped: one release tag cannot
restore another tag's cache, but tags can restore caches from the default branch.

After merging the workflow changes, run **Actions → Release → Run workflow** with
**main** selected. This compiles all platforms (including both macOS architectures)
and saves release dependency caches without packaging, creating a tag, or
publishing a release. Subsequent tags can reuse those caches. Repeat after major
dependency/toolchain changes or cache eviction. The first warm-up is a cold build.
Installer packaging and final application compilation still take time.

## Blocked `glib` security update

Advisory: [GHSA-wrw7-89jp-8q8g](https://github.com/advisories/GHSA-wrw7-89jp-8q8g).
Dependabot reports `glib` 0.18.5 as the latest resolvable version and 0.20.0 as the
first fixed version. The locked Tauri Linux GTK/WebKit dependency tree requires
the 0.18 series, so a direct dependency override to 0.20 is not a compatible fix.

Keep the alert open. Resolution requires a compatible upstream dependency update
or a reviewed backport of the fix to the required series. No risk acceptance or
alert dismissal has been made. Recheck the chain with:

```sh
cargo tree --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --target x86_64-unknown-linux-gnu -i glib
```
