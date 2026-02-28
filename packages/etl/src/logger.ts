/**
 * Lightweight pipeline logger with timing support.
 *
 * Matches the existing ETL console style (human-readable, not JSON)
 * while adding timestamps and elapsed time tracking.
 */

interface StageTimer {
  name: string;
  number: number;
  startMs: number;
}

interface StageTiming {
  name: string;
  number: number;
  elapsedMs: number;
  summary: Record<string, number | string>;
}

const timers = new Map<string, StageTimer>();
const completedStages: StageTiming[] = [];

function timestamp(): string {
  return new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = ((ms % 60_000) / 1000).toFixed(0);
  return `${mins}m ${secs}s`;
}

export function pipelineLog(message: string): void {
  console.log(`[${timestamp()}] ${message}`);
}

export function stageStart(number: number, name: string): void {
  const timer: StageTimer = { name, number, startMs: performance.now() };
  timers.set(name, timer);
  console.log(`\n[${timestamp()}] ▶ Running Stage ${number}: ${name}`);
}

export function stageEnd(name: string, summary: Record<string, number | string>): void {
  const timer = timers.get(name);
  const elapsedMs = timer ? performance.now() - timer.startMs : 0;
  const number = timer?.number ?? 0;

  const summaryParts = Object.entries(summary)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');

  console.log(`[${timestamp()}] ✔ ${name} complete (${formatElapsed(elapsedMs)}): ${summaryParts}`);

  completedStages.push({ name, number, elapsedMs, summary });
  timers.delete(name);
}

export function pipelineSummary(totalElapsedMs: number): void {
  console.log('');
  console.log('═'.repeat(60));
  console.log('  ETL PIPELINE SUMMARY');
  console.log('═'.repeat(60));

  for (const stage of completedStages) {
    const summaryParts = Object.entries(stage.summary)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    console.log(
      `  Stage ${stage.number}: ${stage.name.padEnd(14)} ${formatElapsed(stage.elapsedMs).padStart(8)}  │  ${summaryParts}`,
    );
  }

  console.log('─'.repeat(60));
  console.log(`  Total elapsed: ${formatElapsed(totalElapsedMs)}`);
  console.log('═'.repeat(60));
}

export function resetTimers(): void {
  timers.clear();
  completedStages.length = 0;
}
