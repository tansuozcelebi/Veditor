#!/usr/bin/env node
/**
 * Deploys the production build (dist/) to a SiteGround site over FTP / FTPS.
 *
 *   npm run deploy            build + upload
 *   npm run deploy:dry        build + show what would be uploaded / removed, no changes
 *   node scripts/deploy-siteground.mjs --no-build   upload an existing dist/ (used by CI)
 *
 * Configuration (environment variables, or a .env.deploy file next to package.json):
 *   SITEGROUND_FTP_HOST        e.g. ftp.example.com or the SiteGround server hostname   (required)
 *   SITEGROUND_FTP_USER        FTP account user name                                    (required)
 *   SITEGROUND_FTP_PASSWORD    FTP account password                                     (required)
 *   SITEGROUND_REMOTE_DIR      target directory on the server, e.g. public_html or
 *                              public_html/veditor                                      (default: public_html)
 *   SITEGROUND_FTP_PORT        21 for FTP / explicit FTPS                               (default: 21)
 *   SITEGROUND_FTP_SECURE      "true" = explicit FTPS (FTP over TLS, SiteGround default),
 *                              "false" = plain FTP, "implicit" = implicit FTPS          (default: true)
 *   SITEGROUND_SITE_URL        public URL of the deployed app; when set, the deploy is
 *                              verified over HTTP afterwards                             (optional)
 *   SITEGROUND_VERIFY          auto (default: a wrong/missing file fails the deploy, but a bot-protection
 *                              challenge page only warns) | strict (any failure fails) | warn | off
 *   SITEGROUND_FTP_INSECURE_TLS  "true" skips TLS certificate validation (testing only)
 *   VITE_BASE_PATH             (build time) URL path the app is served from, e.g. /veditor/ – only the path of
 *                              a full URL is used; keep it unset when the app is at the site root
 *
 * Flags: --no-build  --dry-run  --no-prune  --verbose
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { Client } from 'basic-ftp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const args = new Set(process.argv.slice(2));
const flags = { build: !args.has('--no-build'), dryRun: args.has('--dry-run'), prune: !args.has('--no-prune'), verbose: args.has('--verbose') };
// Fetch like a browser: SiteGround's bot protection answers bare clients with a 202 challenge page.
// statuses (with an HTML body) that mean "blocked by bot protection / interstitial", not "wrong deploy"
const CHALLENGE_STATUSES = new Set([202, 403, 429, 503]);
const BROWSER_HEADERS = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 veditor-deploy-check', accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'tr,en;q=0.8', 'cache-control': 'no-cache', pragma: 'no-cache' };

// ---------- configuration ----------
loadDotEnv(join(root, '.env.deploy'));
const cfg = {
  host: env('SITEGROUND_FTP_HOST'),
  user: env('SITEGROUND_FTP_USER'),
  password: env('SITEGROUND_FTP_PASSWORD'),
  remoteDir: env('SITEGROUND_REMOTE_DIR', 'public_html'),
  port: Number(env('SITEGROUND_FTP_PORT', '21')),
  secure: parseSecure(env('SITEGROUND_FTP_SECURE', 'true')),
  siteUrl: env('SITEGROUND_SITE_URL', '').replace(/\/+$/, ''),
  insecureTls: env('SITEGROUND_FTP_INSECURE_TLS', 'false') === 'true',
  verify: env('SITEGROUND_VERIFY', 'auto').trim().toLowerCase(), // auto | strict | warn | off
};
const missing = ['host', 'user', 'password'].filter((k) => !cfg[k]);
if (missing.length) {
  console.error(`✖ Missing configuration: ${missing.map((k) => 'SITEGROUND_FTP_' + k.toUpperCase()).join(', ')}\n  Set them as environment variables or in .env.deploy (see .env.deploy.example).`);
  process.exit(2);
}
if (!Number.isInteger(cfg.port) || cfg.port <= 0) { console.error('✖ SITEGROUND_FTP_PORT must be a positive integer'); process.exit(2); }

// ---------- build ----------
if (flags.build) {
  console.log('▶ Building (npm run build)…');
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { console.error('✖ Build failed'); process.exit(1); }
}
if (!existsSync(join(distDir, 'index.html'))) { console.error('✖ dist/index.html not found – run `npm run build` first or drop --no-build'); process.exit(1); }

// ---------- local file list ----------
const localFiles = listLocal(distDir); // [{ rel, abs, size }], rel uses "/" separators
const totalBytes = localFiles.reduce((s, f) => s + f.size, 0);
// index.html goes last so visitors never see a page that references assets that are not there yet
localFiles.sort((a, b) => (a.rel === 'index.html') - (b.rel === 'index.html') || a.rel.localeCompare(b.rel));
console.log(`▶ ${localFiles.length} files (${fmtBytes(totalBytes)}) in dist/ → ${cfg.secure === false ? 'ftp' : 'ftps'}://${cfg.user}@${cfg.host}:${cfg.port}/${cfg.remoteDir}${flags.dryRun ? '  [dry run]' : ''}`);

// ---------- upload ----------
const started = Date.now();
const client = new Client(60_000);
client.ftp.verbose = flags.verbose;
let uploaded = 0, uploadedBytes = 0, pruned = 0;
try {
  await withRetry('connect', () => client.access({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
    secure: cfg.secure, secureOptions: tlsOptions(),
  }));
  await client.ensureDir(cfg.remoteDir); // creates the path if needed and cds into it
  const remoteRoot = await client.pwd();
  console.log(`▶ Connected, remote root: ${remoteRoot}`);

  const remoteAssets = flags.prune ? await listRemote(client, posix.join(remoteRoot, 'assets')) : [];
  const localSet = new Set(localFiles.map((f) => f.rel));
  const stale = remoteAssets.filter((rel) => !localSet.has(rel));

  let lastDir = '';
  for (const f of localFiles) {
    const dir = posix.dirname(f.rel);
    if (flags.dryRun) { console.log(`  ↑ ${f.rel} (${fmtBytes(f.size)})`); uploaded++; uploadedBytes += f.size; continue; }
    await withRetry(`upload ${f.rel}`, async () => {
      if (client.closed) await reconnect();
      if (dir !== lastDir) { await client.cd(remoteRoot); if (dir !== '.') await client.ensureDir(dir); lastDir = dir; }
      await client.uploadFrom(f.abs, posix.basename(f.rel));
    });
    uploaded++; uploadedBytes += f.size;
    if (flags.verbose || f.rel === 'index.html') console.log(`  ↑ ${f.rel} (${fmtBytes(f.size)})`);
  }

  // Remove old hashed bundles under assets/ that this build no longer references.
  for (const rel of stale) {
    if (flags.dryRun) { console.log(`  ✂ ${rel} (stale)`); pruned++; continue; }
    await withRetry(`remove ${rel}`, async () => { if (client.closed) await reconnect(); await client.remove(posix.join(remoteRoot, rel)); });
    pruned++;
    if (flags.verbose) console.log(`  ✂ ${rel}`);
  }
} catch (e) {
  console.error(`✖ Deploy failed: ${e?.message || e}`);
  client.close();
  process.exit(1);
}
client.close();
console.log(`✔ ${flags.dryRun ? 'Would upload' : 'Uploaded'} ${uploaded} files (${fmtBytes(uploadedBytes)}), ${flags.dryRun ? 'would remove' : 'removed'} ${pruned} stale asset(s) in ${((Date.now() - started) / 1000).toFixed(1)} s`);

// ---------- verification over HTTP ----------
if (cfg.siteUrl && !flags.dryRun && cfg.verify !== 'off') {
  console.log(`▶ Verifying ${cfg.siteUrl} …`);
  const html = readFileSync(join(distDir, 'index.html'), 'utf8');
  const assets = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map((m) => m[1]);
  const results = [];
  // 1. the start page references exactly this build's bundles
  results.push(await checkUrl(`${cfg.siteUrl}/?deploy-check=${Date.now()}`, (body) => assets.every((a) => body.includes(a)), 'index.html does not reference the new bundles'));
  // 2. every bundle is served byte-for-byte as built (also proves REMOTE_DIR maps to SITE_URL)
  for (const a of assets) {
    const url = new URL(a, cfg.siteUrl + '/').href; // absolute paths resolve against the origin, relative ones against the app URL
    const local = readFileSync(join(distDir, decodeURIComponent(new URL(url).pathname.replace(/^.*\/assets\//, 'assets/'))));
    results.push(await checkUrl(url, (body, buf) => buf.equals(local), `content differs from dist/ (${local.length} bytes locally)`));
  }
  // 3. client-side routes fall back to index.html (the .htaccess rewrite is active)
  results.push(await checkUrl(`${cfg.siteUrl}/video-editor?deploy-check=${Date.now()}`, (body) => body.includes('<div id="root">') && assets.every((a) => body.includes(a)), 'route is not rewritten to index.html'));

  const failed = results.filter((r) => !r.ok);
  const blocked = failed.length > 0 && failed.every((r) => r.blocked);
  if (!failed.length) console.log('✔ Site serves the new build (index, assets and the /video-editor route)');
  else if (cfg.verify === 'warn' || (cfg.verify === 'auto' && blocked)) {
    console.warn(blocked
      ? '⚠ Could not verify: the site\'s bot protection answers automated requests with a challenge page (HTTP 202). The upload itself succeeded; open the site in a browser to confirm. (SITEGROUND_VERIFY=strict makes this fatal, =off skips the check.)'
      : '⚠ Verification failed, but SITEGROUND_VERIFY=warn – the upload itself succeeded (check SITEGROUND_REMOTE_DIR / SITEGROUND_SITE_URL / caching).');
  } else {
    console.error('✖ Verification failed – the upload finished but the site does not serve the expected build (check SITEGROUND_REMOTE_DIR / SITEGROUND_SITE_URL / caching / bot protection). Set SITEGROUND_VERIFY=warn to keep deploys green while you investigate.');
    process.exit(1);
  }
}

// ---------- helpers ----------
function env(name, def) { const v = process.env[name]; return v === undefined || v === '' ? def : v; }
function parseSecure(v) {
  const s = String(v).trim().toLowerCase();
  if (s === 'false' || s === '0' || s === 'no') return false;
  if (s === 'implicit') return 'implicit';
  if (!['true', '1', 'yes', 'explicit', ''].includes(s)) console.warn(`  ⚠ SITEGROUND_FTP_SECURE="${v}" is not one of true | false | implicit – using explicit FTPS (true)`);
  return true;
}
function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (!m || line.trim().startsWith('#')) continue;
    let val = m[2]; if (/^(['"]).*\1$/.test(val)) val = val.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
function listLocal(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name); const st = statSync(abs);
    if (st.isDirectory()) listLocal(abs, base, out);
    else if (name !== '.DS_Store') out.push({ rel: relative(base, abs).split('\\').join('/'), abs, size: st.size });
  }
  return out;
}
async function listRemote(c, absDir, prefix = 'assets', out = []) {
  let entries;
  try { entries = await c.list(absDir); } catch { return out; } // directory does not exist yet
  for (const e of entries) {
    if (e.name === '.' || e.name === '..') continue;
    const rel = posix.join(prefix, e.name);
    if (e.isDirectory) await listRemote(c, posix.join(absDir, e.name), rel, out);
    else if (e.isFile) out.push(rel);
  }
  return out;
}
async function reconnect() {
  await client.access({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, secure: cfg.secure, secureOptions: tlsOptions() });
}
async function withRetry(what, fn, attempts = 3) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= attempts) throw e;
      const wait = 1500 * i;
      console.warn(`  ⚠ ${what} failed (${e?.message || e}); retrying in ${wait / 1000}s (${i}/${attempts - 1})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
// Accepts only a real 200 with the expected content; retries because caches/CDNs can lag right after an upload.
// Returns { ok, blocked } – blocked = every attempt was answered by a bot-protection / interstitial page.
async function checkUrl(url, test = () => true, why = 'unexpected content', attempts = 4) {
  let last = '', blocked = true;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
      const buf = Buffer.from(await res.arrayBuffer());
      const body = buf.toString('utf8');
      if (res.status === 200 && test(body, buf)) { console.log(`  ✔ 200 ${url}`); return { ok: true, blocked: false }; }
      const challenge = CHALLENGE_STATUSES.has(res.status) && /text\/html/i.test(res.headers.get('content-type') || '');
      blocked = blocked && challenge;
      last = res.status !== 200 ? `HTTP ${res.status}${challenge ? ' (challenge/interstitial page – bot protection?)' : ''}` : why;
      if (flags.verbose) console.log(`    ↳ ${last}: ${body.replace(/\s+/g, ' ').slice(0, 160)}`);
    } catch (e) { blocked = false; last = e?.name === 'TimeoutError' ? 'timed out' : (e?.message || String(e)); }
    if (i < attempts) await new Promise((r) => setTimeout(r, 2000 * i));
  }
  console.log(`  ✖ ${url} – ${last}`);
  return { ok: false, blocked };
}
// SNI needs a host name; an IP address is not allowed as servername
function tlsOptions() { return { rejectUnauthorized: !cfg.insecureTls, ...(isIP(cfg.host) ? {} : { servername: cfg.host }) }; }
function fmtBytes(n) { return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`; }
