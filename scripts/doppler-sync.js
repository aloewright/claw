#!/usr/bin/env node
/**
 * Sync secrets from Doppler to Cloudflare Worker secrets.
 *
 * Usage:
 *   node scripts/doppler-sync.js                  # sync dev config
 *   node scripts/doppler-sync.js --config prd     # sync production config
 *   DOPPLER_TOKEN=dp.xxx node scripts/doppler-sync.js  # use service token
 *
 * Prerequisites:
 *   - doppler CLI installed and authenticated (doppler login)
 *   - wrangler CLI authenticated (wrangler login)
 *   - Doppler project "claw" configured (see doppler.yaml)
 */

import { execSync } from 'node:child_process';

// Secrets that should be synced from Doppler to Cloudflare
// These are the ones set via `wrangler secret put` (not Secrets Store bindings)
const SECRETS_TO_SYNC = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENCLAW_GATEWAY_TOKEN',
  'TELEGRAM_BOT_TOKEN',
  'DISCORD_BOT_TOKEN',
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'CDP_SECRET',
  'WORKER_URL',
];

const configFlag = process.argv.includes('--config')
  ? process.argv[process.argv.indexOf('--config') + 1]
  : undefined;

const dopplerFlags = configFlag ? `--config ${configFlag}` : '';

console.log(`Fetching secrets from Doppler${configFlag ? ` (config: ${configFlag})` : ''}...`);

let dopplerSecrets;
try {
  const raw = execSync(`doppler secrets download --no-file --format json ${dopplerFlags}`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  dopplerSecrets = JSON.parse(raw);
} catch (err) {
  console.error('Failed to fetch Doppler secrets. Is doppler CLI installed and authenticated?');
  console.error(err.stderr?.toString() || err.message);
  process.exit(1);
}

let synced = 0;
let skipped = 0;

for (const key of SECRETS_TO_SYNC) {
  const value = dopplerSecrets[key];
  if (!value || value === '') {
    console.log(`  skip ${key} (not set in Doppler)`);
    skipped++;
    continue;
  }

  try {
    execSync(`echo "${value}" | wrangler secret put ${key}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log(`  ✓ ${key}`);
    synced++;
  } catch (err) {
    console.error(`  ✗ ${key}: ${err.stderr?.toString().trim() || err.message}`);
  }
}

console.log(`\nDone: ${synced} synced, ${skipped} skipped`);
