import { expect, test, describe, spyOn } from 'bun:test';
import { logger } from './logger';

describe('logger', () => {
  test('should log messages', () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    logger.info('test info');
    expect(logSpy).toHaveBeenCalled();

    logger.error('test error');
    expect(errorSpy).toHaveBeenCalled();

    logger.warn('test warn');
    expect(warnSpy).toHaveBeenCalled();

    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
