#!/usr/bin/env node
// Soak (npm run test:soak): about 200 navigations through the AI e2e fixtures with the model double,
// stopping the service worker every 40, then checking for accepts, drift and leaks.
// usage: node tests/e2e/run-soak.mjs [navigations]
process.env.SOAK = process.argv[2] || process.env.SOAK || '200';
process.env.E2E_ONLY = 'soak:';
await import('./run-ai-e2e.mjs');
