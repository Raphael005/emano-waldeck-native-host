#!/usr/bin/env node
'use strict';

/**
 * test.js — simulates the browser extension side of the native messaging protocol.
 *
 * Spawns host.js and exchanges framed messages (4-byte LE length + JSON),
 * exactly as a browser extension would via chrome.runtime.sendNativeMessage.
 *
 * Usage:  node test.js
 */

const { spawn } = require('child_process');
const path = require('path');

// ─── Protocol helpers ────────────────────────────────────────────────────────

/** Encode a JS object as a native message frame. */
function encode(obj) {
  const payload = Buffer.from(JSON.stringify(obj));
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

/** Decode all complete native message frames from a buffer.
 *  Returns { messages: Object[], remainder: Buffer }
 */
function decodeAll(buf) {
  const messages = [];
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    messages.push(JSON.parse(buf.slice(4, 4 + len).toString()));
    buf = buf.slice(4 + len);
  }
  return { messages, remainder: buf };
}

// ─── Host process ────────────────────────────────────────────────────────────

function spawnHost() {
  return spawn(process.execPath, ['host.js'], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Send one request to a fresh host instance and collect all response frames
 * until stdout closes.  Resolves with an array of response objects.
 */
function send(request) {
  return new Promise((resolve, reject) => {
    const child = spawnHost();
    let rxBuf = Buffer.alloc(0);
    const stderr = [];

    child.stdout.on('data', chunk => { rxBuf = Buffer.concat([rxBuf, chunk]); });
    child.stderr.on('data', d => stderr.push(d.toString()));

    child.stdin.write(encode(request));
    child.stdin.end();

    child.on('close', code => {
      if (stderr.length) process.stderr.write(stderr.join(''));
      const { messages } = decodeAll(rxBuf);
      if (code !== 0 && messages.length === 0) {
        reject(new Error(`host exited with code ${code}`));
      } else {
        resolve(messages);
      }
    });

    child.on('error', reject);
  });
}

// ─── Test runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label || 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── Test cases ──────────────────────────────────────────────────────────────

(async () => {
  console.log('\nnative-messaging end-to-end tests\n');

  // 1. spec — host responds with version and environment info
  await test('spec request returns version and platform', async () => {
    const [res] = await send({ method: 'spec' });
    assert(res, 'no response received');
    assertEqual(typeof res.version, 'string', 'version type');
    assert(/^\d+\.\d+\.\d+$/.test(res.version), `version shape: ${res.version}`);
    assertEqual(res.platform, 'darwin', 'platform');
    assert(res.arch, 'arch missing');
    assert(res.tmpdir, 'tmpdir missing');
    assert(res.separator === '/', 'separator');
  });

  // 2. script — host executes sandboxed JS and pushes result via push()
  await test('script execution: arithmetic result', async () => {
    const [res] = await send({
      script: 'push({ result: 6 * 7 }); close();',
      permissions: [],
      args: {},
    });
    assert(res, 'no response received');
    assertEqual(res.result, 42, 'arithmetic result');
  });

  // 3. script — args are forwarded into the sandbox
  await test('script execution: args forwarded into sandbox', async () => {
    const [res] = await send({
      script: 'push({ echo: args.value }); close();',
      permissions: [],
      args: { value: 'hello from extension' },
    });
    assertEqual(res.echo, 'hello from extension', 'echoed arg');
  });

  // 4. script — version constant is available in sandbox
  await test('script execution: version available in sandbox', async () => {
    const [res] = await send({
      script: 'push({ v: version }); close();',
      permissions: [],
      args: {},
    });
    assert(/^\d+\.\d+\.\d+$/.test(res.v), `sandbox version: ${res.v}`);
  });

  // 5. script — permission-gated require: denied without permission
  await test('script execution: require denied without permission', async () => {
    const [res] = await send({
      script: 'var m = require("os"); push({ hasOs: m !== null }); close();',
      permissions: [],
      args: {},
    });
    assertEqual(res.hasOs, false, 'require should return null when not permitted');
  });

  // 6. script — permission-gated require: granted with permission
  await test('script execution: require granted with permission', async () => {
    const [res] = await send({
      script: 'var m = require("os"); push({ platform: m.platform() }); close();',
      permissions: ['os'],
      args: {},
    });
    assertEqual(res.platform, 'darwin', 'os.platform()');
  });

  // 7. error — missing script key returns context error
  await test('missing script key returns error response', async () => {
    const [res] = await send({ method: 'unknown' });
    assert(res, 'no response received');
    assertEqual(res.type, 'context', 'error type');
    assert(typeof res.error === 'string', 'error message missing');
  });

  // 8. multiple pushes — host can stream multiple frames per request
  await test('script execution: multiple push() calls return multiple frames', async () => {
    const responses = await send({
      script: 'push({n:1}); push({n:2}); push({n:3}); close();',
      permissions: [],
      args: {},
    });
    assertEqual(responses.length, 3, 'frame count');
    responses.forEach((r, i) => assertEqual(r.n, i + 1, `frame[${i}].n`));
  });

  // ─── Summary ───────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${passed}/${total} tests passed${failed ? ` (${failed} failed)` : ''}\n`);
  process.exitCode = failed > 0 ? 1 : 0;
})();
