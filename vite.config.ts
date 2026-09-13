import { defineConfig, type Plugin } from 'vitest/config';

/** Writes precache.json listing every built file, so the service worker can make the whole app available offline. */
function precacheList(): Plugin {
  return {
    name: 'resonare-precache-list',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(files) });
    },
  };
}

export default defineConfig({
  // Relative base so the build works from any path (GitHub Pages, a subfolder, a local file server).
  base: './',
  plugins: [precacheList()],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
