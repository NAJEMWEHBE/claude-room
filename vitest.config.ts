import { defineConfig } from 'vitest/config';

// Root rig covers the BACKEND derivation cluster only (src/**). The web shell
// has its own rig (web/package.json test → vitest in web/), run separately —
// scoping here keeps `npm test` from double-running the web suite.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
