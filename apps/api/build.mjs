// Bundles the API (and the shared rules and services) into one ES module for Azure Functions.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // Installed in the deployment package (npm ci --omit=dev); everything else, including @granted/*, is bundled.
  external: ['@azure/functions', '@azure/communication-email', '@azure/identity', 'mssql'],
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
