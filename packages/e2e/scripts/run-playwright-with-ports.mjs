#!/usr/bin/env node
import net from 'node:net';
import { spawn } from 'node:child_process';

const DEFAULT_API_PORT = Number(process.env.API_PORT ?? 4000);
const DEFAULT_WEB_PORT = Number(process.env.WEB_PORT ?? 3000);

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.on('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1' }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(start, maxAttempts = 200) {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = start + offset;
    if (await canListen(port)) return port;
  }
  throw new Error(`No available port found from ${start}..${start + maxAttempts - 1}`);
}

function randomEphemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen({ port: 0, host: '127.0.0.1' }, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to resolve ephemeral port')));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function main() {
  let apiPort;
  try {
    apiPort = await findAvailablePort(DEFAULT_API_PORT);
  } catch {
    apiPort = await randomEphemeralPort();
  }

  let webStart = DEFAULT_WEB_PORT;
  if (webStart === apiPort) {
    webStart += 1;
  }
  let webPort;
  try {
    webPort = await findAvailablePort(webStart);
  } catch {
    webPort = await randomEphemeralPort();
  }

  if (webPort === apiPort) {
    webPort = await randomEphemeralPort();
    if (webPort === apiPort) {
      throw new Error(`Port collision: apiPort and webPort both resolved to ${apiPort}`);
    }
  }

  const args = process.argv.slice(2).filter((arg, idx) => !(idx === 0 && arg === '--'));
  const env = {
    ...process.env,
    API_PORT: String(apiPort),
    WEB_PORT: String(webPort),
    PORT: String(apiPort),
  };

  console.log(`[e2e] Using API_PORT=${apiPort} WEB_PORT=${webPort}`);

  const child = spawn('pnpm', ['exec', 'playwright', 'test', ...args], {
    stdio: 'inherit',
    env,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error('[e2e] Failed to start Playwright runner:', error);
  process.exit(1);
});
