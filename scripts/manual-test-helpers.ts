import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export class TestLogger {
  private static logFile: string;
  private static startedAt = 0;
  private static phaseStartedAt = 0;

  static init(testRunId: string, logDir = 'logs/manual_tests'): string {
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    this.startedAt = performance.now();
    this.logFile = path.join(logDir, `${testRunId}.log`);
    this.append('INFO', `=== Test Run Started: ${testRunId} ===`);
    return this.logFile;
  }

  static info(message: string, context?: Record<string, unknown>): void {
    this.write('INFO', message, context);
  }

  static warning(message: string, context?: Record<string, unknown>): void {
    this.write('WARN', message, context);
  }

  static error(message: string, context?: Record<string, unknown>): void {
    this.write('ERROR', message, context);
  }

  static startPhase(phaseName: string): void {
    this.phaseStartedAt = performance.now();
    this.info(`=== Phase: ${phaseName} ===`);
  }

  static endPhase(phaseName: string): void {
    const durationSeconds = ((performance.now() - this.phaseStartedAt) / 1000).toFixed(3);
    this.info(`=== Phase Complete: ${phaseName} (${durationSeconds}s) ===`);
  }

  private static write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const elapsedSeconds = ((performance.now() - this.startedAt) / 1000).toFixed(3);
    const mergedContext = context ? { ...context, elapsed: `${elapsedSeconds}s` } : undefined;
    this.append(level, message, mergedContext);
    const line = `[${level}] ${message}`;
    if (level === 'ERROR') {
      console.error(line);
      return;
    }
    if (level === 'WARN') {
      console.warn(line);
      return;
    }
    console.log(line);
  }

  private static append(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const details = context ? ` ${JSON.stringify(context)}` : '';
    appendFileSync(this.logFile, `[${timestamp}] [${level}] ${message}${details}\n`, 'utf8');
  }
}

type CleanupFn = () => Promise<void>;

export class DataTracker {
  private readonly cleanups: Array<{
    label: string;
    ids: Array<string | number>;
    cleanupFn: CleanupFn;
  }> = [];

  track(label: string, ids: Array<string | number>, cleanupFn: CleanupFn): void {
    this.cleanups.push({ label, ids, cleanupFn });
    TestLogger.info(`Tracking cleanup for ${label}`, { ids });
  }

  async cleanup(): Promise<void> {
    TestLogger.startPhase('Cleanup');
    for (const item of [...this.cleanups].reverse()) {
      try {
        await item.cleanupFn();
        TestLogger.info(`Cleanup succeeded for ${item.label}`, { ids: item.ids });
      } catch (error) {
        TestLogger.error(`Cleanup failed for ${item.label}`, {
          ids: item.ids,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    TestLogger.endPhase('Cleanup');
  }
}

export class TestAssertion {
  private static passed = 0;
  private static failed = 0;

  static assertEquals<T>(expected: T, actual: T, message: string): boolean {
    if (expected === actual) {
      this.passed += 1;
      TestLogger.info(`PASS: ${message}`);
      return true;
    }

    this.failed += 1;
    TestLogger.error(`FAIL: ${message}`, { expected, actual });
    return false;
  }

  static assertNotNull(value: unknown, message: string): boolean {
    return this.assertTrue(value !== null && value !== undefined, message);
  }

  static assertTrue(condition: boolean, message: string): boolean {
    if (condition) {
      this.passed += 1;
      TestLogger.info(`PASS: ${message}`);
      return true;
    }

    this.failed += 1;
    TestLogger.error(`FAIL: ${message}`);
    return false;
  }

  static assertCount(expected: number, values: unknown[], message: string): boolean {
    return this.assertEquals(expected, values.length, message);
  }

  static summary(): boolean {
    const total = this.passed + this.failed;
    const passRate = total === 0 ? 0 : Math.round((this.passed / total) * 100);
    TestLogger.info('Assertion summary', {
      total,
      passed: this.passed,
      failed: this.failed,
      passRate: `${passRate}%`,
    });
    return this.failed === 0;
  }
}

export class TestEnvironment {
  static guardProduction(): void {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Manual verification is blocked in production environment.');
    }
  }

  static displayInfo(): void {
    TestLogger.info('Environment info', {
      nodeEnv: process.env.NODE_ENV ?? 'undefined',
      bunVersion: typeof Bun !== 'undefined' ? Bun.version : 'unknown',
      platform: process.platform,
      cwd: process.cwd(),
    });
  }
}

export class RollbackSignal extends Error {
  constructor() {
    super('__TEST_ROLLBACK__');
    this.name = 'RollbackSignal';
  }
}
