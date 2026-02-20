import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { logger } from './logger';

describe('logger', () => {
  const originalScraperLogLevel = process.env.SCRAPER_LOG_LEVEL;
  const originalScraperVerbose = process.env.SCRAPER_VERBOSE;

  beforeEach(() => {
    delete process.env.SCRAPER_LOG_LEVEL;
    delete process.env.SCRAPER_VERBOSE;
  });

  afterEach(() => {
    if (originalScraperLogLevel === undefined) {
      delete process.env.SCRAPER_LOG_LEVEL;
    } else {
      process.env.SCRAPER_LOG_LEVEL = originalScraperLogLevel;
    }

    if (originalScraperVerbose === undefined) {
      delete process.env.SCRAPER_VERBOSE;
    } else {
      process.env.SCRAPER_VERBOSE = originalScraperVerbose;
    }
  });

  test('logs info, warn, and error at default level', () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});

    logger.info('test info');
    logger.warn('test warn');
    logger.error('test error');

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('suppresses info logs when SCRAPER_LOG_LEVEL is warn', () => {
    process.env.SCRAPER_LOG_LEVEL = 'warn';

    const logSpy = spyOn(console, 'log').mockImplementation(() => {});

    logger.info('hidden info');

    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  test('emits debug logs when SCRAPER_VERBOSE is true', () => {
    process.env.SCRAPER_VERBOSE = 'true';

    const debugSpy = spyOn(console, 'debug').mockImplementation(() => {});

    logger.debug('verbose debug');

    expect(debugSpy).toHaveBeenCalledTimes(1);
    debugSpy.mockRestore();
  });
});
