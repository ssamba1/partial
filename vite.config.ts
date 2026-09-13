import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Writes precache.json listing every built file, and stamps a build id into the
 * service worker so each release installs cleanly and replaces the old cache.
 */
function offlineSupport(): Plugin {
  let outDir = 'dist';
  let buildId = 'dev';
  return {
    name: 'partial-offline',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map')).sort();
      buildId = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(files) });
    },
    closeBundle() {
      // Public files are copied before this hook runs.
      const sw = join(outDir, 'sw.js');
      writeFileSync(sw, readFileSync(sw, 'utf8').replaceAll('__BUILD_ID__', buildId));
    },
  };
}

export default defineConfig({
  // Relative base so the build works from any path (GitHub Pages, a subfolder, a local file server).
  base: './',
  plugins: [offlineSupport()],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
