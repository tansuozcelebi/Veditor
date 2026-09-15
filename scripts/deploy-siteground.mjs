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
 *   SITEGROUND_FTP_INSECURE_TLS  "true" skips TLS certificate validation (testing only)
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
if (cfg.siteUrl && !flags.dryRun) {
  console.log(`▶ Verifying ${cfg.siteUrl} …`);
  const html = readFileSync(join(distDir, 'index.html'), 'utf8');
  const assets = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map((m) => m[1]);
  const okIndex = await checkUrl(`${cfg.siteUrl}/?deploy-check=${Date.now()}`, (body) => assets.every((a) => body.includes(a)));
  let okAssets = true;
  for (const a of assets) {
    const url = new URL(a, cfg.siteUrl + '/').href; // absolute paths resolve against the origin, relative ones against the app URL
    if (!(await checkUrl(url))) okAssets = false;
  }
  const okRoute = await checkUrl(`${cfg.siteUrl}/video-editor?deploy-check=${Date.now()}`, (body) => /<div id="root">/.test(body));
  if (okIndex && okAssets && okRoute) console.log('✔ Site serves the new build (index, assets and the /video-editor route)');
  else { console.error('✖ Verification failed – the upload finished but the site does not serve the expected build (check SITEGROUND_REMOTE_DIR / SITEGROUND_SITE_URL / caching).'); process.exit(1); }
}

// ---------- helpers ----------
function env(name, def) { const v = process.env[name]; return v === undefined || v === '' ? def : v; }
function parseSecure(v) { v = String(v).toLowerCase(); if (v === 'false' || v === '0' || v === 'no') return false; if (v === 'implicit') return 'implicit'; return true; }
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
async function checkUrl(url, test = () => true) {
  try {
    const res = await fetch(url, { headers: { 'cache-control': 'no-cache' }, redirect: 'follow' });
    const body = await res.text();
    const ok = res.ok && test(body);
    console.log(`  ${ok ? '✔' : '✖'} ${res.status} ${url}`);
    return ok;
  } catch (e) { console.log(`  ✖ ${url} (${e?.message || e})`); return false; }
}
// SNI needs a host name; an IP address is not allowed as servername
function tlsOptions() { return { rejectUnauthorized: !cfg.insecureTls, ...(isIP(cfg.host) ? {} : { servername: cfg.host }) }; }
function fmtBytes(n) { return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`; }
