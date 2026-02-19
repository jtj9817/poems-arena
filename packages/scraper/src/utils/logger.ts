export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    console.log(
      JSON.stringify({ level: 'info', message, timestamp: new Date().toISOString(), ...meta }),
    );
  },
  error: (message: string, error?: unknown) => {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(
      JSON.stringify({
        level: 'error',
        message,
        timestamp: new Date().toISOString(),
        error: errorMsg,
        stack,
      }),
    );
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    console.warn(
      JSON.stringify({ level: 'warn', message, timestamp: new Date().toISOString(), ...meta }),
    );
  },
  debug: (message: string, meta?: Record<string, unknown>) => {
    if (process.env.DEBUG) {
      console.debug(
        JSON.stringify({ level: 'debug', message, timestamp: new Date().toISOString(), ...meta }),
      );
    }
  },
};
