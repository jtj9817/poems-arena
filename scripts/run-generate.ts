#!/usr/bin/env bun
/**
 * run-generate.ts
 *
 * Launches the @sanctuary/ai-gen full generation pipeline as a monitored
 * subprocess. Designed for AI agent execution: persists all state to disk so
 * the agent can check in at any time without needing an active session.
 *
 * Usage:
 *   bun scripts/run-generate.ts [--concurrency N] [--limit N] [--max-retries N]
 *   bun scripts/run-generate.ts --status   # print current status and exit
 *
 * Agent check-in during a running job:
 *   cat logs/generate-status.json          # structured progress
 *   tail -n 40 logs/generate-<ts>.log      # recent output
 *
 * Failure modes handled:
 *   - 402 Insufficient Balance   → alert written to status; agent is told to
 *                                   stop and top up (unmatched poems are safe
 *                                   to retry on next run)
 *   - High permanent failure rate → alert if >50% permanently fail after the
 *                                   first 20 poems processed (systemic issue)
 *   - Silent hang                → alert if no output for >10 min (DeepSeek
 *                                   can legitimately hold connections that long
 *                                   under load, so no auto-kill)
 *   - Concurrent run guard       → refuses to start if generate.pid exists for
 *                                   a live process
 *   - Duel assembly produced 0   → flagged explicitly in next-steps (seen in
 *                                   prior activation run due to missing topics)
 */

import { parseArgs } from 'node:util';
import { existsSync, readFileSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(import.meta.dir, '..');
const LOGS_DIR = resolve(REPO_ROOT, 'logs');
const STATUS_FILE = resolve(LOGS_DIR, 'generate-status.json');
const PID_FILE = resolve(LOGS_DIR, 'generate.pid');
const AI_GEN_ENV_FILE = resolve(REPO_ROOT, 'packages', 'ai-gen', '.env');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RunPhase = 'running' | 'completed' | 'failed' | 'killed';

interface Alert {
  type: 'balance_exhausted' | 'high_failure_rate' | 'hang_warning';
  message: string;
  detectedAt: string;
}

interface GenerateStatus {
  phase: RunPhase;
  pid: number | null;
  startedAt: string;
  lastActivityAt: string;
  silentForMs: number;
  totalCandidates: number;
  progress: {
    processed: number;
    stored: number;
    skipped: number;
    permanentlyFailed: number;
    inRetryQueue: number; // currently re-queued, not yet permanent
  };
  avgMsPerPoem: number | null;
  estimatedRemainingMs: number | null;
  alerts: Alert[];
  logFile: string;
  reportFile: string | null;
}

interface DbValidation {
  humanPoems: number;
  aiPoems: number;
  aiPoemsWithParent: number;
  unmatchedHuman: number;
  totalDuels: number;
  queriedAt: string;
}

interface GenerateReport {
  exitCode: number;
  phase: RunPhase;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  logFile: string;
  progress: {
    processed: number;
    stored: number;
    skipped: number;
    permanentlyFailed: number;
  };
  assemblyResult: { newDuels: number; totalCandidates: number } | null;
  alerts: Alert[];
  dbValidation: DbValidation | null;
  nextSteps: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function formatMs(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1_000);
  return `${m}m ${s}s`;
}

/** Parse a simple KEY=value .env file into a string record. */
function loadEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(
    readFileSync(filePath, 'utf8')
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'))
      .flatMap((line) => {
        const eq = line.indexOf('=');
        if (eq === -1) return [];
        const key = line.slice(0, eq).trim();
        const val = line
          .slice(eq + 1)
          .trim()
          .replace(/^["']|["']$/g, '');
        return key ? [[key, val] as [string, string]] : [];
      }),
  );
}

function safeWrite(filePath: string, content: string): void {
  try {
    writeFileSync(filePath, content);
  } catch {
    /* non-fatal */
  }
}

function safeAppend(filePath: string, content: string): void {
  try {
    appendFileSync(filePath, content);
  } catch {
    /* non-fatal */
  }
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const { values: cliArgs } = parseArgs({
  args: process.argv.slice(2),
  options: {
    status: { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '3' },
    limit: { type: 'string' },
    'max-retries': { type: 'string' },
  },
  strict: false,
});

// ---------------------------------------------------------------------------
// --status mode: read and pretty-print the current status file, then exit
// ---------------------------------------------------------------------------

if (cliArgs.status) {
  if (!existsSync(STATUS_FILE)) {
    console.log('No generation run in progress (logs/generate-status.json not found).');
    process.exit(0);
  }
  const s: GenerateStatus = JSON.parse(readFileSync(STATUS_FILE, 'utf8'));
  const silentMin = Math.round(s.silentForMs / 60_000);
  const remaining = s.estimatedRemainingMs != null ? formatMs(s.estimatedRemainingMs) : 'unknown';
  const pct =
    s.totalCandidates > 0
      ? `${Math.round((s.progress.processed / s.totalCandidates) * 100)}%`
      : '?%';
  console.log(`\n${'═'.repeat(52)}`);
  console.log(`  Generation Status`);
  console.log(`${'═'.repeat(52)}`);
  console.log(`  Phase:       ${s.phase}`);
  console.log(
    `  Progress:    ${s.progress.processed}/${s.totalCandidates} (${pct}) — ` +
      `${s.progress.stored} stored, ${s.progress.skipped} skipped, ` +
      `${s.progress.permanentlyFailed} perm-failed, ${s.progress.inRetryQueue} retrying`,
  );
  console.log(`  Avg/poem:    ${s.avgMsPerPoem != null ? formatMs(s.avgMsPerPoem) : 'n/a'}`);
  console.log(`  Remaining:   ${remaining}`);
  console.log(`  Last output: ${s.lastActivityAt} (${silentMin}m ago)`);
  console.log(
    `  Alerts:      ${s.alerts.length > 0 ? s.alerts.map((a) => a.type).join(', ') : 'none'}`,
  );
  console.log(`  Log file:    ${s.logFile}`);
  if (s.reportFile) console.log(`  Report:      ${s.reportFile}`);
  console.log(`${'═'.repeat(52)}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------

// Merge env: script env takes precedence over .env file so already-exported
// vars (e.g. from root .env) are not overwritten.
const fileEnv = loadEnvFile(AI_GEN_ENV_FILE);
const mergedEnv: Record<string, string> = { ...fileEnv };
for (const [k, v] of Object.entries(process.env)) {
  if (v != null) mergedEnv[k] = v;
}

if (!mergedEnv.DEEPSEEK_API_KEY) {
  console.error('ERROR: DEEPSEEK_API_KEY is not set.');
  console.error(`       Add it to ${AI_GEN_ENV_FILE} or export it before running.`);
  process.exit(1);
}

// Concurrent-run guard via PID file
if (existsSync(PID_FILE)) {
  const existingPid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
  let alive = false;
  try {
    process.kill(existingPid, 0);
    alive = true;
  } catch {
    /* stale PID */
  }
  if (alive) {
    console.error(`ERROR: A generation run is already active (PID ${existingPid}).`);
    console.error(
      `       Run with --status to check progress. ` +
        `Remove ${PID_FILE} manually only if that process is truly dead.`,
    );
    process.exit(1);
  }
  unlinkSync(PID_FILE); // stale — clean up
}

// Optional DB pre-flight: count unmatched human poems
let initialUnmatchedCount: number | null = null;
if (mergedEnv.LIBSQL_URL) {
  try {
    const { createClient } = await import('@libsql/client');
    const client = createClient({
      url: mergedEnv.LIBSQL_URL,
      authToken: mergedEnv.LIBSQL_AUTH_TOKEN,
    });
    const result = await client.execute({
      sql: `SELECT count(*) as cnt FROM poems p
            WHERE p.type = 'HUMAN'
              AND NOT EXISTS (
                SELECT 1 FROM poems ai WHERE ai.parent_poem_id = p.id
              )`,
      args: [],
    });
    await client.close();
    initialUnmatchedCount = Number((result.rows[0] as Record<string, unknown>)?.cnt ?? 0);
    console.log(`Pre-flight: ${initialUnmatchedCount} unmatched human poems in DB.`);
  } catch (err) {
    console.warn(
      `Pre-flight DB check skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Setup log and report file paths
// ---------------------------------------------------------------------------

const runTs = new Date().toISOString().replace(/[:.-]/g, '').slice(0, 15); // 20260301T100000Z
const LOG_FILE = resolve(LOGS_DIR, `generate-${runTs}.log`);
const REPORT_FILE = resolve(LOGS_DIR, `generate-report-${runTs}.json`);

// Build passthrough args for the subprocess
const passthroughArgs: string[] = [];
if (cliArgs.concurrency) passthroughArgs.push('--concurrency', cliArgs.concurrency);
if (cliArgs.limit) passthroughArgs.push('--limit', cliArgs.limit);
if (cliArgs['max-retries']) passthroughArgs.push('--max-retries', cliArgs['max-retries']);

console.log(`\n@sanctuary/ai-gen — monitored generation run`);
console.log('─'.repeat(52));
console.log(`  Log file:    ${LOG_FILE}`);
console.log(`  Status file: ${STATUS_FILE}`);
console.log(`  Concurrency: ${cliArgs.concurrency ?? 3}`);
if (cliArgs.limit) console.log(`  Limit:       ${cliArgs.limit}`);
if (initialUnmatchedCount != null)
  console.log(`  Unmatched:   ${initialUnmatchedCount} poems in DB`);
console.log('─'.repeat(52) + '\n');

// ---------------------------------------------------------------------------
// Mutable state (updated by log parser)
// ---------------------------------------------------------------------------

let phase: RunPhase = 'running';
const startedAt = nowIso();
let lastActivityAt = nowIso();
let totalCandidates = initialUnmatchedCount ?? 0;
let processed = 0;
let stored = 0;
let skipped = 0;
let permanentlyFailed = 0;
let retryAttemptsSeen = 0; // incremented on each retry log line
let totalStoredMs = 0;
const alerts: Alert[] = [];
let assemblyResult: { newDuels: number; totalCandidates: number } | null = null;

function buildStatus(pid: number | null): GenerateStatus {
  const silentForMs = Date.now() - new Date(lastActivityAt).getTime();
  const avgMsPerPoem = stored > 0 ? Math.round(totalStoredMs / stored) : null;
  const remaining =
    avgMsPerPoem != null && totalCandidates > processed
      ? (totalCandidates - processed) * avgMsPerPoem
      : null;
  return {
    phase,
    pid,
    startedAt,
    lastActivityAt,
    silentForMs,
    totalCandidates,
    progress: {
      processed,
      stored,
      skipped,
      permanentlyFailed,
      inRetryQueue: Math.max(0, retryAttemptsSeen - permanentlyFailed),
    },
    avgMsPerPoem,
    estimatedRemainingMs: remaining,
    alerts,
    logFile: LOG_FILE,
    reportFile: null,
  };
}

function addAlert(pid: number | null, type: Alert['type'], message: string): void {
  if (alerts.some((a) => a.type === type)) return; // deduplicate
  const alert: Alert = { type, message, detectedAt: nowIso() };
  alerts.push(alert);
  const line = `\n⚠  ALERT [${type}]: ${message}\n`;
  console.error(line);
  safeAppend(LOG_FILE, line);
  safeWrite(STATUS_FILE, JSON.stringify(buildStatus(pid), null, 2));
}

// ---------------------------------------------------------------------------
// Log line parser
// Patterns match the exact output format of runGenerationCli.
// ---------------------------------------------------------------------------

const P = {
  found: /^Found (\d+) unmatched human poem/,
  stored: /^Stored AI poem for \S+ -> \S+ \[(\d+)ms\]/,
  skipped: /^Skipped \S+/,
  failedRetry: /^Failed \S+ \(retry \d+\/\d+\): (.+) \[\d+ms\]/,
  failedPermanent: /^Failed \S+ permanently after \d+ retries: (.+) \[\d+ms\]/,
  completed: /^Completed generation run: processed=(\d+) stored=(\d+) skipped=(\d+) failed=(\d+)/,
  assembly: /^Duel assembly: (\d+) new duel\(s\) created from (\d+) candidate\(s\)/,
};

function parseLine(line: string, pid: number | null): void {
  lastActivityAt = nowIso();
  let m: RegExpMatchArray | null;

  if ((m = line.match(P.found))) {
    totalCandidates = parseInt(m[1]!, 10);
    return;
  }
  if ((m = line.match(P.stored))) {
    processed++;
    stored++;
    totalStoredMs += parseInt(m[1]!, 10);
    return;
  }
  if (line.match(P.skipped)) {
    processed++;
    skipped++;
    return;
  }
  if ((m = line.match(P.failedRetry))) {
    retryAttemptsSeen++;
    if (m[1]?.includes('402') || m[1]?.toLowerCase().includes('insufficient balance')) {
      addAlert(
        pid,
        'balance_exhausted',
        'DeepSeek returned 402 Insufficient Balance. ' +
          'Top up at platform.deepseek.com, then re-run — unmatched poems will be retried automatically.',
      );
    }
    return;
  }
  if ((m = line.match(P.failedPermanent))) {
    processed++;
    permanentlyFailed++;
    if (m[1]?.includes('402') || m[1]?.toLowerCase().includes('insufficient balance')) {
      addAlert(
        pid,
        'balance_exhausted',
        'DeepSeek returned 402 Insufficient Balance. ' +
          'Top up at platform.deepseek.com, then re-run — unmatched poems will be retried automatically.',
      );
    }
    if (processed >= 20) {
      const failRate = permanentlyFailed / processed;
      if (failRate > 0.5) {
        addAlert(
          pid,
          'high_failure_rate',
          `${Math.round(failRate * 100)}% of processed poems are permanently failing. ` +
            'Check DEEPSEEK_API_KEY is valid and inspect recent failure reasons in the log.',
        );
      }
    }
    return;
  }
  if ((m = line.match(P.completed))) {
    // Authoritative counts from the summary line override running totals
    processed = parseInt(m[1]!, 10);
    stored = parseInt(m[2]!, 10);
    skipped = parseInt(m[3]!, 10);
    permanentlyFailed = parseInt(m[4]!, 10);
    return;
  }
  if ((m = line.match(P.assembly))) {
    assemblyResult = {
      newDuels: parseInt(m[1]!, 10),
      totalCandidates: parseInt(m[2]!, 10),
    };
    return;
  }
}

// ---------------------------------------------------------------------------
// Stream reader: yields lines from a ReadableStream
// ---------------------------------------------------------------------------

async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) !== -1) {
      onLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  if (buf) onLine(buf);
}

// ---------------------------------------------------------------------------
// Spawn subprocess
// ---------------------------------------------------------------------------

safeAppend(LOG_FILE, `# Generation run started at ${nowIso()}\n`);

const proc = Bun.spawn(
  ['pnpm', '--filter', '@sanctuary/ai-gen', 'run', 'generate', ...passthroughArgs],
  {
    cwd: REPO_ROOT,
    env: mergedEnv,
    stdout: 'pipe',
    stderr: 'pipe',
  },
);

const pid = proc.pid;
writeFileSync(PID_FILE, String(pid));
console.log(`Subprocess started (PID ${pid}). Output follows.\n`);
safeWrite(STATUS_FILE, JSON.stringify(buildStatus(pid), null, 2));

// ---------------------------------------------------------------------------
// Periodic status writer + hang detector (every 60 s)
// ---------------------------------------------------------------------------

const statusInterval = setInterval(() => {
  const silentMs = Date.now() - new Date(lastActivityAt).getTime();
  if (silentMs > 10 * 60_000) {
    addAlert(
      pid,
      'hang_warning',
      `No output from PID ${pid} for ${Math.round(silentMs / 60_000)} minutes. ` +
        'DeepSeek can legitimately hold connections up to 10 min under load. ' +
        `Verify the process is still alive: kill -0 ${pid}`,
    );
  }
  safeWrite(STATUS_FILE, JSON.stringify(buildStatus(pid), null, 2));
}, 60_000);

// ---------------------------------------------------------------------------
// Tee stdout: parse + terminal + log file
// ---------------------------------------------------------------------------

const stdoutDone = readLines(proc.stdout, (line) => {
  parseLine(line, pid);
  console.log(line);
  safeAppend(LOG_FILE, line + '\n');
});

const stderrDone = readLines(proc.stderr!, (line) => {
  console.error(line);
  safeAppend(LOG_FILE, `[stderr] ${line}\n`);
});

// ---------------------------------------------------------------------------
// Await subprocess exit
// ---------------------------------------------------------------------------

const exitCode = await Promise.all([proc.exited, stdoutDone, stderrDone]).then(
  ([code]) => code ?? 1,
);

clearInterval(statusInterval);

phase = exitCode === 0 ? 'completed' : 'failed';

// Clean up PID file
try {
  unlinkSync(PID_FILE);
} catch {
  /* already gone */
}

// ---------------------------------------------------------------------------
// Post-run DB validation
// ---------------------------------------------------------------------------

let dbValidation: DbValidation | null = null;
if (mergedEnv.LIBSQL_URL) {
  try {
    const { createClient } = await import('@libsql/client');
    const client = createClient({
      url: mergedEnv.LIBSQL_URL,
      authToken: mergedEnv.LIBSQL_AUTH_TOKEN,
    });
    const [counts, unmatched, withParent, duels] = await Promise.all([
      client.execute({ sql: `SELECT type, count(*) as cnt FROM poems GROUP BY type`, args: [] }),
      client.execute({
        sql: `SELECT count(*) as cnt FROM poems p
              WHERE p.type = 'HUMAN'
                AND NOT EXISTS (
                  SELECT 1 FROM poems ai WHERE ai.parent_poem_id = p.id
                )`,
        args: [],
      }),
      client.execute({
        sql: `SELECT count(*) as cnt FROM poems WHERE type = 'AI' AND parent_poem_id IS NOT NULL`,
        args: [],
      }),
      client.execute({ sql: `SELECT count(*) as cnt FROM duels`, args: [] }),
    ]);
    await client.close();

    const humanRow = counts.rows.find((r) => (r as Record<string, unknown>).type === 'HUMAN') as
      | Record<string, unknown>
      | undefined;
    const aiRow = counts.rows.find((r) => (r as Record<string, unknown>).type === 'AI') as
      | Record<string, unknown>
      | undefined;

    dbValidation = {
      humanPoems: Number(humanRow?.cnt ?? 0),
      aiPoems: Number(aiRow?.cnt ?? 0),
      aiPoemsWithParent: Number(
        (withParent.rows[0] as Record<string, unknown> | undefined)?.cnt ?? 0,
      ),
      unmatchedHuman: Number((unmatched.rows[0] as Record<string, unknown> | undefined)?.cnt ?? 0),
      totalDuels: Number((duels.rows[0] as Record<string, unknown> | undefined)?.cnt ?? 0),
      queriedAt: nowIso(),
    };
  } catch (err) {
    console.warn(
      `Post-run DB validation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Build next-steps guidance
// ---------------------------------------------------------------------------

const nextSteps: string[] = [];

if (alerts.some((a) => a.type === 'balance_exhausted')) {
  nextSteps.push(
    'Top up DeepSeek balance at https://platform.deepseek.com, then re-run ' +
      '`bun scripts/run-generate.ts` — unmatched poems are picked up automatically.',
  );
}
if (dbValidation && dbValidation.unmatchedHuman > 0) {
  nextSteps.push(
    `${dbValidation.unmatchedHuman} human poems are still unmatched. ` +
      'Re-run `bun scripts/run-generate.ts` to continue.',
  );
}
if (assemblyResult && assemblyResult.newDuels === 0 && stored > 0) {
  nextSteps.push(
    'Duel assembly produced 0 new duels despite stored poems — ' +
      'this has been seen before when poem_topics rows are missing for AI poems. ' +
      "Verify: SELECT count(*) FROM poem_topics pt JOIN poems p ON p.id = pt.poem_id WHERE p.type = 'AI'",
  );
}
if (
  nextSteps.length === 0 &&
  dbValidation &&
  dbValidation.totalDuels > 0 &&
  phase === 'completed'
) {
  nextSteps.push(
    'Run the post-generation validation SQL from the ticket ' +
      '(spot-check duels, confirm API serves /api/v1/duels correctly).',
  );
}

// ---------------------------------------------------------------------------
// Write final report
// ---------------------------------------------------------------------------

const completedAt = nowIso();
const durationMs = Date.now() - new Date(startedAt).getTime();

const report: GenerateReport = {
  exitCode,
  phase,
  startedAt,
  completedAt,
  durationMs,
  logFile: LOG_FILE,
  progress: { processed, stored, skipped, permanentlyFailed },
  assemblyResult,
  alerts,
  dbValidation,
  nextSteps,
};

writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
safeWrite(
  STATUS_FILE,
  JSON.stringify({ ...buildStatus(null), phase, reportFile: REPORT_FILE }, null, 2),
);

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

console.log(`\n${'═'.repeat(52)}`);
console.log(`  GENERATION COMPLETE`);
console.log(`${'═'.repeat(52)}`);
console.log(`  Phase:       ${phase}`);
console.log(`  Duration:    ${formatMs(durationMs)}`);
console.log(`  Processed:   ${processed}/${totalCandidates}`);
console.log(`  Stored:      ${stored}`);
console.log(`  Skipped:     ${skipped}`);
console.log(`  Perm failed: ${permanentlyFailed}`);

if (assemblyResult) {
  console.log(
    `  Duels:       ${assemblyResult.newDuels} new from ${assemblyResult.totalCandidates} candidates`,
  );
}

if (alerts.length > 0) {
  console.log(`\n  ⚠  Alerts:`);
  for (const a of alerts) {
    console.log(`     [${a.type}] ${a.message}`);
  }
}

if (dbValidation) {
  console.log(`\n  DB state:`);
  console.log(`     HUMAN poems:        ${dbValidation.humanPoems}`);
  console.log(`     AI poems (total):   ${dbValidation.aiPoems}`);
  console.log(`     AI poems (linked):  ${dbValidation.aiPoemsWithParent}`);
  console.log(`     Unmatched human:    ${dbValidation.unmatchedHuman}`);
  console.log(`     Duels:              ${dbValidation.totalDuels}`);
}

if (nextSteps.length > 0) {
  console.log(`\n  Next steps:`);
  for (const step of nextSteps) {
    console.log(`     → ${step}`);
  }
}

console.log(`\n  Report: ${REPORT_FILE}`);
console.log(`${'═'.repeat(52)}\n`);

process.exit(exitCode);
