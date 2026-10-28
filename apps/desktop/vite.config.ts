import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const require = createRequire(import.meta.url);
// Forward slashes keep the copy globs working on Windows.
const slash = (p: string) => p.replace(/\\/g, '/');
const cesiumBuild = slash(join(dirname(require.resolve('cesium/package.json')), 'Build', 'Cesium'));

// Tauri expects a fixed dev port and serves the built files from dist/.
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: `${cesiumBuild}/{Workers,ThirdParty,Assets,Widgets}/**/*`,
          dest: 'cesium',
          // Matched paths look like node_modules/cesium/Build/Cesium/Workers/...; drop the first
          // four segments so files are served as /cesium/Workers/...
          rename: { stripBase: 4 },
        },
      ],
    }),
  ],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
  },
});
