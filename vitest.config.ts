import { defineConfig } from 'vitest/config';

// Tests run with the server's clock settings: TZ=UTC, rules in site wall-clock time.
process.env.TZ = 'UTC';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/api/test/**/*.test.ts'],
    env: { TZ: 'UTC' },
  },
});
