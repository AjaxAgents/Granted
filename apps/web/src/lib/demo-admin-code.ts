/*
 * Admin set-up code for the public proof of concept. Empty = admin set-up is turned off,
 * because a public page would expose the code's hash. Set VITE_DEMO_ADMIN_CODE_HASH at build
 * time (output of `node tools/admin-code-hash.mjs`) to turn it on for a demo-only code.
 */
export const DEMO_ADMIN_CODE_HASH = '';
