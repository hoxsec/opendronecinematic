import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TitleBar } from '../src/components/TitleBar';

afterEach(() => vi.unstubAllGlobals());

describe('desktop title bar', () => {
  it('replaces native decorations and grants the required window controls', () => {
    const config = JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8'));
    const capability = JSON.parse(
      readFileSync('apps/desktop/src-tauri/capabilities/default.json', 'utf8'),
    );
    expect(
      config.app.windows.find((window: { label: string }) => window.label === 'main'),
    ).toMatchObject({ decorations: false });
    expect(capability.permissions).toEqual(
      expect.arrayContaining([
        'core:window:allow-close',
        'core:window:allow-minimize',
        'core:window:allow-toggle-maximize',
        'core:window:allow-start-dragging',
      ]),
    );
  });

  it.each(['Win32', 'Linux x86_64', 'MacIntel'])(
    'provides branded, accessible controls on %s',
    (platform) => {
      vi.stubGlobal('navigator', { platform });
      const html = renderToStaticMarkup(createElement(TitleBar));
      expect(html).toContain('OpenDrone');
      expect(html).toContain('Cinematic');
      expect(html).toContain('data-tauri-drag-region');
      expect(html).toContain('aria-label="Minimize window"');
      expect(html).toContain('aria-label="Maximize window"');
      expect(html).toContain('aria-label="Close window"');
      expect(html.includes('titlebar-mac')).toBe(platform === 'MacIntel');
    },
  );
});
