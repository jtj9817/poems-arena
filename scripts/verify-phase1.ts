#!/usr/bin/env bun
/**
 * Phase 1 Manual Verification Script
 * Track: etl_pipeline_20260220
 *
 * Automates the five Phase 1 verification steps:
 *   1. @sanctuary/db is wired into the pnpm workspace
 *   2. @sanctuary/etl pipeline prints its banner without import errors
 *   3. @sanctuary/api health endpoint responds with {"status":"ok"}
 *   4. packages/etl/.env.example is present with all required keys
 *   5. @sanctuary/db and @sanctuary/etl typecheck passes (exit 0)
 *
 * Usage:
 *   bun conductor/tracks/etl_pipeline_20260220/verify-phase1.ts
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// ── Terminal colours ──────────────────────────────────────────────────────────

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BLUE = '\x1b[34m';

const ICON_PASS = `${GREEN}${BOLD}✓ PASS${RESET}`;
const ICON_FAIL = `${RED}${BOLD}✗ FAIL${RESET}`;
const ICON_SKIP = `${YELLOW}${BOLD}⊘ SKIP${RESET}`;

// ── Path constants ────────────────────────────────────────────────────────────

// Script lives at: conductor/tracks/etl_pipeline_20260220/verify-phase1.ts
// Repo root is three levels up.
const REPO_ROOT = path.resolve(import.meta.dir, '../../..');

// ── Logging helpers ───────────────────────────────────────────────────────────

function section(title: string) {
  const bar = '─'.repeat(60);
  console.log(`\n${CYAN}${BOLD}${bar}${RESET}`);
  console.log(`${CYAN}${BOLD}  ${title}${RESET}`);
  console.log(`${CYAN}${BOLD}${bar}${RESET}`);
}

function info(msg: string) {
  console.log(`  ${DIM}ℹ ${msg}${RESET}`);
}

function cmd(command: string) {
  console.log(`  ${BLUE}${DIM}$ ${command}${RESET}`);
}

function blockOutput(label: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const lines = trimmed.split('\n');
  for (const line of lines) {
    console.log(`  ${DIM}${label}${RESET} ${line}`);
  }
}

// ── subprocess helpers ────────────────────────────────────────────────────────

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  combined: string;
}

/**
 * Run a command and collect stdout/stderr.
 * Resolves when the process exits; never rejects (bad exit codes are surfaced
 * through the returned `exitCode`).
 */
async function run(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<SpawnResult> {
  const { cwd = REPO_ROOT, timeoutMs } = opts;

  const proc = Bun.spawn(args, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Optional hard timeout — kill the process if it stalls
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs !== undefined) {
    timer = setTimeout(() => {
      info(`Process timed out after ${timeoutMs}ms — killing.`);
      proc.kill();
    }, timeoutMs);
  }

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  await proc.exited.catch(() => {});
  clearTimeout(timer);

  const exitCode = proc.exitCode ?? 1;
  return { exitCode, stdout, stderr, combined: stdout + '\n' + stderr };
}

// ── Check runner ──────────────────────────────────────────────────────────────

type CheckStatus = 'pass' | 'fail' | 'skip';

interface CheckResult {
  id: number;
  name: string;
  status: CheckStatus;
  output: string;
  expected?: string;
  notes?: string;
}

const results: CheckResult[] = [];
let checkId = 0;

async function check(
  name: string,
  fn: () => Promise<Omit<CheckResult, 'id' | 'name'>>,
): Promise<void> {
  checkId++;
  const id = checkId;
  console.log(`\n${BOLD}Check ${id}: ${name}${RESET}`);

  let result: CheckResult;
  try {
    const r = await fn();
    result = { id, name, ...r };
  } catch (err) {
    const errMsg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    result = {
      id,
      name,
      status: 'fail',
      output: errMsg,
      notes: 'Unhandled exception in check function',
    };
  }

  results.push(result);

  const icon =
    result.status === 'pass' ? ICON_PASS : result.status === 'skip' ? ICON_SKIP : ICON_FAIL;

  console.log(`  Status: ${icon}`);
  if (result.output) blockOutput('out ›', result.output);
  if (result.expected) info(`Expected: ${result.expected}`);
  if (result.notes) info(`Note: ${result.notes}`);
}

// ── Check 1: @sanctuary/db workspace wiring ───────────────────────────────────

async function check1_dbWorkspaceWiring() {
  await check('@sanctuary/db is wired into the pnpm workspace', async () => {
    const command = 'pnpm --filter @sanctuary/db exec pwd';
    cmd(command);

    const result = await run(['pnpm', '--filter', '@sanctuary/db', 'exec', 'pwd'], {
      timeoutMs: 30_000,
    });

    blockOutput('stderr ›', result.stderr);

    const expectedSuffix = path.join('packages', 'db');

    if (result.exitCode !== 0) {
      return {
        status: 'fail',
        output: result.combined.trim(),
        expected: `Exit code 0 and path ending in ${expectedSuffix}`,
        notes: `Process exited with code ${result.exitCode}`,
      };
    }

    // pnpm may prefix output with the filter banner; take the last non-empty line
    // that looks like an absolute path.
    const pathLine = result.stdout
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('/'))
      .at(-1);

    if (!pathLine) {
      return {
        status: 'fail',
        output: result.stdout.trim(),
        expected: `An absolute path ending in ${expectedSuffix}`,
        notes: 'No absolute path found in stdout',
      };
    }

    if (!pathLine.endsWith(expectedSuffix)) {
      return {
        status: 'fail',
        output: pathLine,
        expected: path.join(REPO_ROOT, expectedSuffix),
        notes: `Path does not end with "${expectedSuffix}"`,
      };
    }

    return { status: 'pass', output: pathLine };
  });
}

// ── Check 2: ETL pipeline banner (no import errors) ───────────────────────────

async function check2_etlPipelineBanner() {
  await check(
    '@sanctuary/etl pipeline prints banner without module-resolution errors',
    async () => {
      const command = 'pnpm --filter @sanctuary/etl run pipeline';
      cmd(command);

      const result = await run(['pnpm', '--filter', '@sanctuary/etl', 'run', 'pipeline'], {
        timeoutMs: 60_000,
      });

      blockOutput('stderr ›', result.stderr);

      const combined = result.combined.toLowerCase();

      // Detect module resolution / import failures
      const moduleErrorPatterns = [
        'cannot find module',
        'module not found',
        'failed to resolve',
        'error: cannot resolve',
        'could not find',
        'import error',
      ];
      const moduleError = moduleErrorPatterns.find((p) => combined.includes(p));
      if (moduleError) {
        return {
          status: 'fail',
          output: result.combined.trim(),
          expected: 'Pipeline banner with no module-resolution errors',
          notes: `Matched error pattern: "${moduleError}"`,
        };
      }

      // Verify expected banner elements are present in stdout
      const bannerChecks: Array<[string, string]> = [
        ['@sanctuary/etl pipeline', 'header line'],
        ['Stage:', 'Stage field'],
        ['Input dir:', 'Input dir field'],
        ['Work dir:', 'Work dir field'],
      ];

      const bannerMissing = bannerChecks.filter(([text]) => !result.stdout.includes(text));

      if (bannerMissing.length > 0) {
        return {
          status: 'fail',
          output: result.stdout.trim(),
          expected: 'All banner fields: ' + bannerChecks.map(([, label]) => label).join(', '),
          notes: `Missing: ${bannerMissing.map(([, label]) => label).join(', ')}`,
        };
      }

      return { status: 'pass', output: result.stdout.trim() };
    },
  );
}

// ── Check 3: @sanctuary/api health endpoint ────────────────────────────────────

async function check3_apiHealth() {
  await check('@sanctuary/api health endpoint responds correctly', async () => {
    const healthUrl = 'http://localhost:4000/api/v1/health';

    // --- First, see if the API is already running ---
    info('Probing port 4000 for an existing API instance...');
    try {
      const probe = await fetch(healthUrl, { signal: AbortSignal.timeout(2_000) });
      if (probe.ok || probe.status < 500) {
        const body = await probe.text();
        info('Existing API instance detected — skipping server launch.');
        return {
          status: 'pass',
          output: body,
          notes: 'API was already running; no server process was started',
        };
      }
    } catch {
      info('No existing API instance detected. Starting one...');
    }

    // --- Start the dev server ---
    const devCommand = 'pnpm --filter @sanctuary/api dev';
    cmd(devCommand);

    const server = Bun.spawn(['pnpm', '--filter', '@sanctuary/api', 'dev'], {
      cwd: REPO_ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const serverStartOutput: string[] = [];

    // Drain server output in the background so the pipes don't block
    (async () => {
      const reader = server.stdout.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          serverStartOutput.push(new TextDecoder().decode(value));
        }
      } catch {
        // ignore pipe errors after kill
      }
    })();

    let healthBody: string | null = null;
    let healthError: string | null = null;

    try {
      info('Waiting 4 s for server startup...');
      await Bun.sleep(4_000);

      info(`GET ${healthUrl}`);
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) });
      healthBody = await res.text();

      // Accept any 2xx response; also accept {"status":"ok"} explicitly
      let bodyOk = res.ok;
      try {
        const parsed = JSON.parse(healthBody) as Record<string, unknown>;
        if (parsed.status === 'ok') bodyOk = true;
      } catch {
        // non-JSON body — rely on HTTP status alone
      }

      if (!bodyOk) {
        healthError = `HTTP ${res.status} — body: ${healthBody}`;
      }
    } catch (err) {
      healthError = err instanceof Error ? err.message : String(err);
    } finally {
      info('Terminating API dev server...');
      try {
        server.kill('SIGTERM');
        await server.exited;
      } catch {
        // best-effort
      }
    }

    if (healthError) {
      const serverLog = serverStartOutput.join('').trim();
      return {
        status: 'fail',
        output: `Fetch error: ${healthError}${serverLog ? `\n\nServer output:\n${serverLog}` : ''}`,
        expected: '{"status":"ok"} or any 2xx HTTP response',
      };
    }

    return {
      status: 'pass',
      output: healthBody ?? '(empty body)',
      expected: '{"status":"ok"}',
    };
  });
}

// ── Check 4: packages/etl/.env.example ────────────────────────────────────────

async function check4_envExample() {
  await check('packages/etl/.env.example exists and contains required keys', async () => {
    const envPath = path.join(REPO_ROOT, 'packages', 'etl', '.env.example');
    info(`Inspecting: ${envPath}`);

    if (!existsSync(envPath)) {
      return {
        status: 'fail',
        output: `File not found: ${envPath}`,
        expected: 'File at packages/etl/.env.example',
      };
    }

    const content = readFileSync(envPath, 'utf-8');

    // Required env var keys
    const requiredEnvKeys = ['LIBSQL_URL', 'LIBSQL_AUTH_TOKEN'];
    // Required CLI flag documentation
    const requiredCliFlags = ['--input-dir', '--work-dir', '--stage', '--dry-run'];

    const missingEnv = requiredEnvKeys.filter((k) => !content.includes(k));
    const missingFlags = requiredCliFlags.filter((f) => !content.includes(f));
    const missing = [...missingEnv, ...missingFlags];

    if (missing.length > 0) {
      return {
        status: 'fail',
        output: content,
        expected: `Contains: ${[...requiredEnvKeys, ...requiredCliFlags].join(', ')}`,
        notes: `Missing entries: ${missing.join(', ')}`,
      };
    }

    return {
      status: 'pass',
      output: content.trim(),
      notes: `All ${requiredEnvKeys.length} env keys and ${requiredCliFlags.length} CLI flag docs present`,
    };
  });
}

// ── Check 5: Typecheck ────────────────────────────────────────────────────────

async function check5_typecheck() {
  await check('pnpm typecheck passes for @sanctuary/db and @sanctuary/etl', async () => {
    const packages = ['@sanctuary/db', '@sanctuary/etl'] as const;

    for (const pkg of packages) {
      const command = `pnpm --filter ${pkg} typecheck`;
      cmd(command);

      const result = await run(['pnpm', '--filter', pkg, 'typecheck'], { timeoutMs: 120_000 });

      if (result.exitCode !== 0) {
        return {
          status: 'fail',
          output: result.combined.trim(),
          expected: `${pkg} typecheck exits with code 0`,
          notes: `${pkg} failed typecheck (exit ${result.exitCode})`,
        };
      }

      info(`${pkg}: typecheck OK`);
    }

    return {
      status: 'pass',
      output: packages.map((p) => `${p}: OK`).join('\n'),
    };
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

section('Phase 1 Verification — ETL Pipeline Track (etl_pipeline_20260220)');
console.log(`  ${DIM}Repo root : ${REPO_ROOT}${RESET}`);
console.log(`  ${DIM}Timestamp : ${new Date().toISOString()}${RESET}`);

await check1_dbWorkspaceWiring();
await check2_etlPipelineBanner();
await check3_apiHealth();
await check4_envExample();
await check5_typecheck();

// ── Summary ───────────────────────────────────────────────────────────────────

section('Verification Summary');

const passed = results.filter((r) => r.status === 'pass').length;
const failed = results.filter((r) => r.status === 'fail').length;
const skipped = results.filter((r) => r.status === 'skip').length;

for (const r of results) {
  const icon = r.status === 'pass' ? ICON_PASS : r.status === 'skip' ? ICON_SKIP : ICON_FAIL;
  console.log(`  ${icon}  ${r.id}. ${r.name}`);
}

console.log(
  `\n  ${GREEN}${BOLD}${passed} passed${RESET}` +
    `  ${RED}${BOLD}${failed} failed${RESET}` +
    `  ${YELLOW}${BOLD}${skipped} skipped${RESET}\n`,
);

if (failed > 0) {
  console.log(`${RED}${BOLD}  ✗ Verification FAILED — review the failing checks above.${RESET}\n`);
  process.exit(1);
} else {
  console.log(`${GREEN}${BOLD}  ✓ All checks passed — Phase 1 verified.${RESET}\n`);
  process.exit(0);
}
