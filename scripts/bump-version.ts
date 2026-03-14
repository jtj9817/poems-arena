#!/usr/bin/env bun
/**
 * bump-version.ts — version incrementing script for classicist-sanctuary-proto
 *
 * Usage:
 *   bun scripts/bump-version.ts --minor [--skip-ci-check]
 *   bun scripts/bump-version.ts --major [--skip-ci-check]
 *   bun scripts/bump-version.ts --deploy-mode   # implies --minor --skip-ci-check
 *
 * Version format: x.y (no patch component)
 * Roll-over rule: y >= 10 on a --minor bump auto-promotes to (x+1).0
 */

import { execSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PKG_PATH = join(ROOT, 'package.json');
const METADATA_PATH = join(ROOT, 'apps', 'web', 'metadata.json');

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const deployMode = args.includes('--deploy-mode');
const isMinor = deployMode || args.includes('--minor');
const isMajor = args.includes('--major');
const skipCiCheck = deployMode || args.includes('--skip-ci-check');

function die(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

if (!isMinor && !isMajor) die('specify --minor, --major, or --deploy-mode');
if (isMinor && isMajor) die('--minor/--deploy-mode and --major are mutually exclusive');

// ── Read and validate current version ────────────────────────────────────────

const pkgRaw = await Bun.file(PKG_PATH).text();
const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
const current = pkg.version;

if (typeof current !== 'string' || !/^\d+\.\d+$/.test(current)) {
  die(`version "${String(current)}" in package.json does not match x.y format`);
}

const [xStr, yStr] = current.split('.');
const x = parseInt(xStr!, 10);
const y = parseInt(yStr!, 10);

// ── Warn about uncommitted changes ────────────────────────────────────────────

try {
  const status = execSync('git status --porcelain', { encoding: 'utf8', cwd: ROOT }).trim();
  if (status) {
    console.warn('Warning: working tree has uncommitted changes. Version commit may be dirty.\n');
  }
} catch {
  // ignore — git may not be available in all environments
}

// ── CI/CD precondition ────────────────────────────────────────────────────────

if (skipCiCheck) {
  console.warn('Warning: --skip-ci-check in use. Cloud Build gate bypassed.\n');
} else {
  console.log('Checking Cloud Build pipeline status for main branch...');
  let buildFound = false;

  try {
    const out = execSync(
      [
        'gcloud builds list',
        '--filter="substitutions.BRANCH_NAME=main AND status=SUCCESS"',
        '--format="value(id,startTime)"',
        '--limit=1',
      ].join(' '),
      { encoding: 'utf8', cwd: ROOT },
    ).trim();
    buildFound = out.length > 0;
    if (buildFound) console.log(`Successful build found: ${out}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.toLowerCase().includes('gcloud') ||
      msg.includes('not found') ||
      msg.includes('ENOENT')
    ) {
      die(
        'gcloud is not installed or not in PATH. Use --skip-ci-check for local environments without gcloud.',
      );
    }
    die(`Cloud Build query failed: ${msg}`);
  }

  if (!buildFound) {
    die(
      'No successful Cloud Build run found for main branch.\n' +
        'Resolve the failing pipeline before bumping the version.\n' +
        'Use --skip-ci-check to bypass this check in environments without gcloud.',
    );
  }
}

// ── Compute next version ──────────────────────────────────────────────────────

let nextX: number;
let nextY: number;

if (isMajor) {
  nextX = x + 1;
  nextY = 0;
} else if (y >= 10) {
  console.log(`Note: y (${y}) >= 10 — auto-rolling to next major.\n`);
  nextX = x + 1;
  nextY = 0;
} else {
  nextX = x;
  nextY = y + 1;
}

const next = `${nextX}.${nextY}`;
console.log(`Version: ${current} -> ${next}\n`);

// ── Write files ───────────────────────────────────────────────────────────────

const updatedPkg = JSON.stringify({ ...pkg, version: next }, null, 2) + '\n';
await Bun.write(PKG_PATH, updatedPkg);
console.log(`Updated package.json -> ${next}`);

const metaRaw = await Bun.file(METADATA_PATH).text();
const meta = JSON.parse(metaRaw) as Record<string, unknown>;
const updatedMeta = JSON.stringify({ ...meta, version: next }, null, 2) + '\n';
await Bun.write(METADATA_PATH, updatedMeta);
console.log(`Updated apps/web/metadata.json -> ${next}`);

// ── Git commit and tag ────────────────────────────────────────────────────────

const tag = `v${next}`;
const commitMsg = `chore(release): ${tag}`;

execSync('git add -- package.json apps/web/metadata.json', { cwd: ROOT, stdio: 'inherit' });
execSync(`git commit -m ${JSON.stringify(commitMsg)}`, { cwd: ROOT, stdio: 'inherit' });
execSync(`git tag -a ${JSON.stringify(tag)} -m ${JSON.stringify(`Release ${tag}`)}`, {
  cwd: ROOT,
  stdio: 'inherit',
});

console.log(`\nCommitted: ${commitMsg}`);
console.log(`Tagged: ${tag}`);
console.log('\nNext step: git push && git push --tags');
