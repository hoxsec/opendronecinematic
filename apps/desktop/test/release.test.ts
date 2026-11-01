import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Structurally valid public test key, NOT a trusted/release signing key.
const publicKey = Buffer.from(
  `untrusted comment: test\n${Buffer.concat([Buffer.from('Ed'), Buffer.alloc(40)]).toString('base64')}\n`,
).toString('base64');
function prepare(variables: Record<string, string> = {}) {
  mkdirSync(join(tmpdir(), 'opencode'), { recursive: true });
  const folder = mkdtempSync(join(tmpdir(), 'opencode', 'odc-release-'));
  const output = join(folder, 'release.json');
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^(?:ODC_|TAURI_SIGNING_|APPLE_|WINDOWS_CERTIFICATE|GITHUB_|RUNNER_OS)/.test(key))
      delete env[key];
  try {
    const result = spawnSync(
      process.execPath,
      ['apps/desktop/scripts/prepare-release.mjs', '--output', output],
      { env: { ...env, ...variables }, encoding: 'utf8' },
    );
    return {
      status: result.status,
      error: result.stderr,
      config: result.status === 0 ? JSON.parse(readFileSync(output, 'utf8')) : undefined,
    };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

describe('updater-only release signing configuration', () => {
  it('keeps unconfigured builds offline/manual and never fabricates a key', () => {
    const result = prepare();
    expect(result.status).toBe(0);
    expect(result.config).toMatchObject({
      bundle: { createUpdaterArtifacts: false },
      plugins: { updater: { pubkey: '', endpoints: [] } },
    });
  });
  it('embeds only public trust material and an HTTPS release feed', () => {
    const result = prepare({
      ODC_UPDATER_PUBLIC_KEY: publicKey,
      TAURI_SIGNING_PRIVATE_KEY: 'private-test-secret',
      GITHUB_REPOSITORY: 'owner/repo',
    });
    expect(result.status).toBe(0);
    expect(result.config.plugins.updater.endpoints).toEqual([
      'https://github.com/owner/repo/releases/latest/download/latest.json',
    ]);
    expect(result.config.bundle.createUpdaterArtifacts).toBe(true);
    expect(JSON.stringify(result.config)).not.toContain('private-test-secret');
  });
  it('fails closed for partial, malformed or required-but-missing keys', () => {
    const cases: Record<string, string>[] = [
      { ODC_UPDATER_PUBLIC_KEY: publicKey },
      { TAURI_SIGNING_PRIVATE_KEY: 'secret' },
      { ODC_REQUIRE_SIGNING: 'true' },
      { ODC_REQUIRE_SIGNING: 'TRUE' },
      { ODC_UPDATER_PUBLIC_KEY: 'path/to/key.pub', TAURI_SIGNING_PRIVATE_KEY: 'secret' },
    ];
    for (const variables of cases) expect(prepare(variables).status).not.toBe(0);
  });
  it('requires only updater keys on every desktop platform, even in required-signing mode', () => {
    const base = {
      ODC_UPDATER_PUBLIC_KEY: publicKey,
      TAURI_SIGNING_PRIVATE_KEY: 'secret',
      ODC_REQUIRE_SIGNING: 'true',
    };
    for (const platform of ['Windows', 'macOS', 'Linux']) {
      const result = prepare({ ...base, RUNNER_OS: platform });
      expect(result.status).toBe(0);
      expect(result.config.bundle.createUpdaterArtifacts).toBe(true);
      expect(result.config.plugins.updater.pubkey).toBe(publicKey);
      expect(result.config.bundle.windows?.certificateThumbprint).toBeUndefined();
    }
  });
  it('uses ad-hoc macOS signing without an Apple account or notarization credentials', () => {
    const result = prepare({ RUNNER_OS: 'macOS' });
    expect(result.status).toBe(0);
    expect(result.config.bundle.macOS.signingIdentity).toBe('-');
  });
  it('does not load publisher certificates or credentials in the release workflow', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
    expect(workflow).not.toMatch(
      /WINDOWS_CERTIFICATE|APPLE_(?:CERTIFICATE|SIGNING_IDENTITY|ID|PASSWORD|TEAM_ID)|Import-PfxCertificate/,
    );
    expect(workflow).toContain('secrets.TAURI_SIGNING_PRIVATE_KEY');
  });
  it('uses supported action inputs and passes the lock flag to Cargo, not the Tauri CLI', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
    expect(workflow).toContain('includeUpdaterJson:');
    expect(workflow).not.toContain('uploadUpdaterJson:');
    expect(workflow).toContain('--no-bundle -- --locked');
    expect(workflow).toContain('--config src-tauri/tauri.release.conf.json -- --locked');
    expect(workflow).toContain("format('refs/tags/{0}', inputs.release_tag)");
    expect(workflow).toContain('Release tag must match the checked-out app version.');
  });
  it('rejects mismatched release tags', () => {
    expect(prepare({ GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.0.0' }).error).toContain(
      'release tag',
    );
  });
});
