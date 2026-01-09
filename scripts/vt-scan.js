#!/usr/bin/env node

/**
 * VirusTotal URL Scanner for MAX Video Downloader CoApp
 * Moves VT logic out of bash into Node for better resilience and maintainability.
 */

const fs = require('fs');
const path = require('path');

// Configuration & Constants
const ARTIFACT_MAPPING = {
  'mvdcoapp-mac-arm64.dmg': 'https://github.com/suwot/mvd-coapp/releases/latest/download/mvdcoapp-mac-arm64.dmg',
  'mvdcoapp-mac-x64.dmg': 'https://github.com/suwot/mvd-coapp/releases/latest/download/mvdcoapp-mac-x64.dmg',
  'mvdcoapp-mac10-x64.dmg': 'https://github.com/suwot/mvd-coapp/releases/latest/download/mvdcoapp-mac10-x64.dmg',
  'mvdcoapp-win-x64.exe': 'https://github.com/suwot/mvd-coapp/releases/latest/download/mvdcoapp-win-x64.exe',
  'mvdcoapp-win-arm64.exe': 'https://github.com/suwot/mvd-coapp/releases/latest/download/mvdcoapp-win-arm64.exe',
  'mvdcoapp-win7-x64.exe': 'https://github.com/suwot/mvd-coapp/releases/latest/download/mvdcoapp-win7-x64.exe',
  'mvdcoapp-linux-x64.tar.gz': 'https://github.com/suwot/mvd-coapp/releases/latest/download/mvdcoapp-linux-x64.tar.gz',
  'mvdcoapp-linux-arm64.tar.gz': 'https://github.com/suwot/mvd-coapp/releases/latest/download/mvdcoapp-linux-arm64.tar.gz',
};

const VT_BASE_URL = 'https://www.virustotal.com/api/v3';
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

// CLI Args parsing
const args = process.argv.slice(2);
function getArgValue(flag) {
  const index = args.findIndex(a => a === flag || a.startsWith(`${flag}=`));
  if (index === -1) return null;
  const arg = args[index];
  if (arg.includes('=')) return arg.split('=')[1];
  const next = args[index + 1];
  return (next && !next.startsWith('--')) ? next : null;
}

const distPathArg = getArgValue('--dist');
const apiKey = process.env.VT_API_KEY || getArgValue('--api-key');

if (!distPathArg) {
  console.error('[ERROR] Missing required --dist argument');
  process.exit(1);
}

if (!apiKey) {
  console.error('[ERROR] Missing VirusTotal API key (pass via VT_API_KEY env or --api-key flag)');
  process.exit(1);
}

const DIST_DIR = path.resolve(distPathArg);

// utility to wait for X ms
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// utility to compute VT URL ID (base64url without padding)
function computeUrlId(url) {
  return Buffer.from(url)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Enhanced Fetch with Retries and proper Header merging
 */
async function vtFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${VT_BASE_URL}${endpoint}`;
  
  // Build merged headers to avoid spreading issues
  const mergedHeaders = { 
    'x-apikey': apiKey, 
    'accept': 'application/json',
    ...(options.headers || {}) 
  };

  const finalOptions = { 
    ...options, 
    headers: mergedHeaders 
  };

  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, finalOptions);
      
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : RETRY_DELAY * (attempt + 1);
        console.warn(`[WARN] Rate limited (429). Retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        console.error(`[ERROR] VT Auth/Permission error: ${response.status} ${response.statusText}`);
        process.exit(2);
      }

      return response;
    } catch (err) {
      lastError = err;
      await sleep(RETRY_DELAY * (attempt + 1));
    }
  }

  throw lastError || new Error(`Failed to fetch ${url} after ${MAX_RETRIES} attempts`);
}

/**
 * Triggers a fresh analysis with robust fallback
 */
async function triggerAnalysis(downloadUrl, urlId) {
  let analysisId = null;

  // 1. Try re-analyze existing object first
  try {
    const reanalyzeResp = await vtFetch(`/urls/${urlId}/analyse`, { method: 'POST' });
    if (reanalyzeResp.ok) {
      const data = await reanalyzeResp.json();
      analysisId = data.data?.id;
      if (analysisId) {
        console.log(`  reanalyze: OK -> analysis_id=${analysisId}`);
        return analysisId;
      }
    }
  } catch (err) {
    // Silently continue to fallback on throw
  }

  // 2. Fallback to POST /urls (Scan URL)
  try {
    const params = new URLSearchParams();
    params.append('url', downloadUrl);
    const scanResp = await vtFetch('/urls', {
      method: 'POST',
      body: params,
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    });
    if (scanResp.ok) {
      const data = await scanResp.json();
      analysisId = data.data?.id;
      if (analysisId) {
        console.log(`  scan: OK -> analysis_id=${analysisId}`);
        return analysisId;
      }
    } else {
      const errBody = await scanResp.text();
      console.warn(`  [WARN] Fallback scan failed: ${scanResp.status} ${errBody.slice(0, 100)}`);
    }
  } catch (err) {
    console.warn(`  [WARN] Analysis trigger fallback error: ${err.message}`);
  }

  return null;
}

/**
 * Main logic for a single artifact
 */
async function processArtifact(filename) {
  const downloadUrl = ARTIFACT_MAPPING[filename];
  if (!downloadUrl) {
    console.warn(`[WARN] No URL mapping for ${filename}, skipping.`);
    return null;
  }

  const urlId = computeUrlId(downloadUrl);
  console.log(`VT: ${filename}`);
  console.log(`  url: ${downloadUrl}`);
  console.log(`  id:  ${urlId}`);

  // 1. Trigger fresh analysis
  await triggerAnalysis(downloadUrl, urlId);

  // 2. Fetch report
  try {
    const reportResp = await vtFetch(`/urls/${urlId}`);
    if (reportResp.ok) {
      const data = await reportResp.json();
      const attr = data.data?.attributes || {};
      const stats = attr.last_analysis_stats || {};
      const lastDate = attr.last_analysis_date 
        ? new Date(attr.last_analysis_date * 1000).toISOString() 
        : 'n/a';

      console.log(`  last_analysis: ${lastDate}`);
      console.log(`  stats: malicious=${stats.malicious ?? 0} suspicious=${stats.suspicious ?? 0} harmless=${stats.harmless ?? 0} undetected=${stats.undetected ?? 0} timeout=${stats.timeout ?? 0}`);
      console.log(`  gui: https://www.virustotal.com/gui/url/${urlId}`);
      return true;
    } else {
      console.error(`  [ERROR] Failed to fetch report: ${reportResp.status}`);
      return false;
    }
  } catch (err) {
    console.error(`  [ERROR] report fetch error: ${err.message}`);
    return false;
  }
}

async function main() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error(`[ERROR] Dist directory not found: ${DIST_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(DIST_DIR).filter(f => 
    f.endsWith('.dmg') || f.endsWith('.exe') || f.endsWith('.tar.gz')
  );

  if (files.length === 0) {
    console.warn('[WARN] No artifacts found in dist/ to scan.');
    process.exit(0);
  }

  console.log(`[INFO] Starting VirusTotal scan for ${files.length} artifacts...`);
  
  let successCount = 0;
  let failCount = 0;

  for (const file of files) {
    const success = await processArtifact(file);
    if (success) successCount++;
    else if (success === false) failCount++;
    console.log(''); // spacer
  }

  console.log(`[INFO] Scan complete. ${successCount} processed, ${failCount} failed.`);
  
  if (failCount > 0 && successCount === 0) {
    process.exit(3); // Serious failures
  }
  
  process.exit(0);
}

main().catch(err => {
  console.error('[FATAL] Unexpected error:', err);
  process.exit(3);
});
