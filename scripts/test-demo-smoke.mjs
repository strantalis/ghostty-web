#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const rootDir = process.cwd();
const demoServerPath = path.join(rootDir, 'demo', 'bin', 'demo.js');
const demoUrl = new URL(`http://127.0.0.1:${process.env.GHOSTTY_DEMO_SMOKE_PORT ?? '8080'}/`);
const sentinel = '__GHOSTTY_SMOKE__';
const timeoutMs = 30_000;

function assertFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `${label} not found at ${filePath}. Build artifacts are required before smoke tests.`
    );
  }
}

async function waitFor(check, description, timeout = timeoutMs, interval = 200) {
  const deadline = Date.now() + timeout;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await delay(interval);
  }

  const reason = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${description}.${reason}`);
}

function startDemoServer() {
  const child = spawn(process.execPath, [demoServerPath], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: demoUrl.port,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(5_000).then(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }),
    ]);
  };

  return {
    child,
    stop,
    getOutput() {
      return { stdout, stderr };
    },
  };
}

async function main() {
  assertFileExists(path.join(rootDir, 'dist', 'ghostty-web.js'), 'Built library');
  assertFileExists(path.join(rootDir, 'ghostty-vt.wasm'), 'ghostty-vt.wasm');

  const server = startDemoServer();
  const browser = await chromium.launch();

  try {
    await waitFor(async () => {
      try {
        const response = await fetch(demoUrl);
        return response.ok;
      } catch {
        return false;
      }
    }, `demo server at ${demoUrl}`);

    const page = await browser.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error(`[browser:${msg.type()}] ${msg.text()}`);
      }
    });
    page.on('pageerror', (error) => {
      console.error(`[pageerror] ${error.message}`);
    });

    await page.goto(demoUrl.href, { waitUntil: 'networkidle' });
    await waitForDemoState(
      page,
      () =>
        window.__ghosttyDemo &&
        window.__ghosttyDemo.term &&
        typeof window.__ghosttyDemo.term.focus === 'function',
      'demo hook initialization'
    );
    await waitForDemoState(
      page,
      () => window.__ghosttyDemo?.getStatus?.() === 'Connected',
      'PTY websocket connection'
    );

    await page.evaluate((expected) => {
      const socket = window.__ghosttyDemo?.websocket;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error('Demo websocket is not open');
      }
      socket.send(`echo ${expected}\r`);
    }, sentinel);

    await waitFor(
      async () =>
        page.evaluate((expected) => {
          const term = window.__ghosttyDemo?.term;
          if (!term?.wasmTerm) return false;
          for (let y = 0; y < term.rows; y++) {
            const text = term.wasmTerm
              .getLine(y)
              .map((cell) => {
                if (!cell?.codepoint) return ' ';
                try {
                  return String.fromCodePoint(cell.codepoint);
                } catch {
                  return ' ';
                }
              })
              .join('');
            if (text.includes(expected)) return true;
          }
          return false;
        }, sentinel),
      'terminal echo round-trip'
    );

    const visibleText = await page.evaluate(() => {
      const term = window.__ghosttyDemo?.term;
      if (!term?.wasmTerm) return [];
      const lines = [];
      for (let y = 0; y < term.rows; y++) {
        lines.push(
          term.wasmTerm
            .getLine(y)
            .map((cell) => {
              if (!cell?.codepoint) return ' ';
              try {
                return String.fromCodePoint(cell.codepoint);
              } catch {
                return ' ';
              }
            })
            .join('')
            .trimEnd()
        );
      }
      return lines.filter(Boolean);
    });

    if (!visibleText.some((line) => line.includes(sentinel))) {
      throw new Error(
        `Smoke sentinel not found in viewport. Visible lines: ${visibleText.join(' | ')}`
      );
    }

    console.log(`demo smoke passed at ${demoUrl.href}`);
  } finally {
    await browser.close();
    await server.stop();
    const { stdout, stderr } = server.getOutput();
    if (stderr.trim()) {
      process.stderr.write(stderr);
    }
    if (process.env.GHOSTTY_DEMO_SMOKE_DEBUG === '1' && stdout.trim()) {
      process.stdout.write(stdout);
    }
  }
}

async function waitForDemoState(page, predicate, description, arg) {
  try {
    await page.waitForFunction(predicate, arg, { timeout: timeoutMs });
  } catch (error) {
    const debugState = await page
      .evaluate(() => ({
        hasHook: !!window.__ghosttyDemo,
        hasTerm: !!window.__ghosttyDemo?.term,
        status: window.__ghosttyDemo?.getStatus?.() ?? null,
        websocketReadyState: window.__ghosttyDemo?.websocket?.readyState ?? null,
        viewportLines: (() => {
          const term = window.__ghosttyDemo?.term;
          if (!term?.wasmTerm) return [];
          const lines = [];
          for (let y = 0; y < term.rows; y++) {
            lines.push(
              term.wasmTerm
                .getLine(y)
                .map((cell) => {
                  if (!cell?.codepoint) return ' ';
                  try {
                    return String.fromCodePoint(cell.codepoint);
                  } catch {
                    return ' ';
                  }
                })
                .join('')
                .trimEnd()
            );
          }
          return lines.filter(Boolean).slice(0, 12);
        })(),
        scrollbackLength: window.__ghosttyDemo?.term?.wasmTerm?.getScrollbackLength?.() ?? null,
        bodyText: document.body.innerText.slice(0, 400),
      }))
      .catch(() => null);
    const details = debugState ? ` Debug state: ${JSON.stringify(debugState)}` : '';
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Timed out waiting for ${description}. ${message}${details}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
