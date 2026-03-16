#!/usr/bin/env node
import { start } from './index.js';

start().catch((err) => {
  console.error('[RevaHub] Fatal error:', err);
  process.exit(1);
});
