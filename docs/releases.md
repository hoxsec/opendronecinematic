# Signature-verified desktop updates

M3 supports **updater signing only**: a free, locally generated key pair verifies downloaded updates. Windows publisher signing and Apple notarization are intentionally not configured or required. macOS bundles use ad-hoc signing, which does not establish publisher trust.

**Never put private keys or passwords in chat, project files or Git commits.** Release keys are not included in this repository, and adding the code does not activate an update feed. Unconfigured builds continue to use manual installers; no placeholder trust key is shipped.

## Set up the updater

### 1. Generate one key pair

Run from the project directory on your trusted Windows machine:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.tauri"
npm run tauri -- signer generate -w "$env:USERPROFILE\.tauri\opendronecinematic.key"
```

Choose a strong password when prompted. This creates the private `.key` and public `.key.pub` files **outside the repository**. Back up the private key and its password securely. Generate the pair once and reuse it for future releases: losing or replacing it prevents existing installations from trusting future updates without a migration.

### 2. Add the GitHub configuration

In the repository, open **Settings → Secrets and variables → Actions**:

| Name                                 | Location      | Value                                                                                         |
| ------------------------------------ | ------------- | --------------------------------------------------------------------------------------------- |
| `ODC_UPDATER_PUBLIC_KEY`             | **Variables** | Exact contents of `opendronecinematic.key.pub`, not its path                                  |
| `TAURI_SIGNING_PRIVATE_KEY`          | **Secrets**   | Exact contents of `opendronecinematic.key`, not its path                                      |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | **Secrets**   | The key password, if set                                                                      |
| `ODC_REQUIRE_SIGNING`                | **Variables** | Recommended: `true` after adding the keys; requires **only updater signing** on all platforms |

No `WINDOWS_CERTIFICATE`, Apple account, PFX, P12, paid signing service or developer membership is needed. `ODC_REQUIRE_SIGNING` does not require OS publisher certificates or notarization.

### 3. Build and review a release

The existing `v*` workflow builds **draft** releases. The tag must match `apps/desktop/src-tauri/tauri.conf.json`'s version. `apps/desktop/scripts/prepare-release.mjs` writes an ignored `tauri.release.conf.json` override containing only public trust material and configuration. The private key stays in the CI environment.

To rebuild an existing draft without moving its tag, run the **Release** workflow from `main` with `release_tag` set to that existing tag. The updated workflow checks out the tag's exact source and verifies its version before building. Leaving `release_tag` empty retains the cache-warming-only behavior. Rebuilds remain drafts; neither this input nor a tag push publishes a release. Cargo's `--locked` flag follows Tauri's `--` argument separator.

When the keys are configured, Tauri signs the updater artifacts, and the action uploads the bundles, `.sig` files and `latest.json`. Windows updater metadata prefers NSIS. Universal macOS builds must have both architecture entries pointing to the universal archive. The feed is:

```text
https://github.com/<workflow-repository>/releases/latest/download/latest.json
```

Drafts and prereleases do not replace the stable feed. Review/test the draft before explicitly publishing it. Older installations without the configured updater need **one manual installer upgrade** first.

Partial or malformed updater configuration fails instead of silently falling back to unsigned updates. With **neither** key, the updater feed/artifacts remain disabled, unless `ODC_REQUIRE_SIGNING=true`, in which case the release fails. Local/browser builds do not require keys or make update requests by default.

## User experience and OS trust

Configured desktop releases check the HTTPS feed once at startup. **Map data → Updates** also offers a manual check, release notes, download progress, retry and **Download, install and restart**. Checking never downloads or installs automatically. The browser explains that updates require the desktop app.

Installing requires a saved project and no pending project action, fly mode or active render. Readiness is checked again after downloading, because editing may have continued. A recovery draft alone does not authorize closing. Installation locks the UI and native window-close action. Windows installers exit the app themselves; macOS/Linux relaunch after installing. Failed download/signature verification never proceeds to installation. A failed restart can be retried without reinstalling.

**Updater signatures verify downloaded updates; they are not OS publisher signatures.** Windows installers remain unsigned by a trusted publisher, and macOS apps are not Developer ID-signed or notarized. SmartScreen, Gatekeeper or organizational policy may warn or block installation. Ad-hoc macOS signing supports Apple Silicon but does not remove those warnings. Test first installation and updates on the target systems; do not weaken security settings to claim compatibility. Linux AppImage updater signatures do not sign `.deb` repositories.

## Before declaring M3 release-ready

1. Provision the updater keys, enable required-signing mode, and build a draft on all three operating systems. No paid OS-signing credentials are required.
2. Inspect `latest.json`: correct version, HTTPS asset URLs, nonempty signatures, Windows NSIS, Linux x86_64, and both macOS architectures.
3. On disposable installations, test the first manual installation and a real signature-verified upgrade, including macOS ad-hoc bundles. Record any OS trust restrictions honestly.
4. Test offline feeds, corrupt downloads, wrong signatures, unavailable targets, permission errors and restart failures. Verify saved projects survive; never use valuable unsaved work as an update test.
5. Test dirty-project/render/fly-mode guards, including edits made during a download.
6. Publish only the reviewed draft with explicit maintainer approval. Do not rotate the embedded trust key without a migration plan.

Unit tests exercise configuration gating and update lifecycle guards; native checks verify integration. These do **not** substitute for real cross-platform upgrade tests. See [M3 status](m3.md).
