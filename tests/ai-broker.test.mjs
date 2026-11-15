import test from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from '../scripts/load-shared.mjs';

const RW = loadShared();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Deterministic stand-in for Chrome's LanguageModel. respond(prompt) decides each answer.
function fakeLM({ availability = 'available', respond = () => '{"candidate":"c1","action":"leave_unchanged","confidence":"high"}', delay = 5, failCreate = false } = {}) {
  const log = { created: 0, cloned: 0, destroyed: 0, prompts: 0, availabilityCalls: 0 };
  const makeSession = () => ({
    async clone() { log.cloned++; return makeSession(); },
    prompt(text, opts) {
      log.prompts++;
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(respond(text, opts)), delay);
        if (opts && opts.signal) opts.signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); });
      });
    },
    destroy() { log.destroyed++; }
  });
  return {
    log,
    LM: {
      async availability(o) { log.availabilityCalls++; assert.deepEqual(o, RW.AI_MODEL_OPTIONS); return availability; },
      async create(o) { if (failCreate) throw new Error('no'); assert.ok(o.initialPrompts); log.created++; return makeSession(); }
    }
  };
}

test('absent API and unavailable or downloadable models never create a session', async () => {
  const none = RW.createAiBroker({ getLM: () => undefined });
  assert.equal(await none.availability(), 'absent');
  assert.deepEqual(await none.prompt({ key: 'a', prompt: 'x' }), { ok: false, reason: 'model_absent' });
  for (const a of ['unavailable', 'downloadable', 'downloading']) {
    const f = fakeLM({ availability: a });
    const b = RW.createAiBroker({ getLM: () => f.LM });
    assert.deepEqual(await b.prompt({ key: 'a', prompt: 'x' }), { ok: false, reason: `model_${a}` });
    assert.equal(f.log.created, 0, a);
  }
});

test('one base session, a clone per request, released when idle', async () => {
  const f = fakeLM();
  const b = RW.createAiBroker({ getLM: () => f.LM, idleRelease: 40 });
  const r1 = await b.prompt({ key: 'a', prompt: 'x' });
  const r2 = await b.prompt({ key: 'b', prompt: 'y' });
  assert.equal(r1.ok && r2.ok, true);
  assert.equal(f.log.created, 1);
  assert.equal(f.log.cloned, 2);
  assert.ok(b.hasSession);
  await sleep(80);
  assert.equal(b.hasSession, false);
  assert.equal(f.log.destroyed, 3); // two clones and the base session
});

test('duplicate requests are merged and the queue is bounded', async () => {
  const f = fakeLM({ delay: 30 });
  const b = RW.createAiBroker({ getLM: () => f.LM, maxQueue: 2 });
  const same = [b.prompt({ key: 'k', prompt: 'x' }), b.prompt({ key: 'k', prompt: 'x' })];
  const extra = [b.prompt({ key: 'k2', prompt: 'x' }), b.prompt({ key: 'k3', prompt: 'x' }), b.prompt({ key: 'k4', prompt: 'x' })];
  const res = await Promise.all([...same, ...extra]);
  assert.equal(b.stats.deduplicated, 1);
  assert.ok(res.some((r) => r.reason === 'busy'));
  assert.ok(f.log.prompts <= 3);
});

test('cancellation while queued or running, and timeouts', async () => {
  const f = fakeLM({ delay: 200 });
  const b = RW.createAiBroker({ getLM: () => f.LM, promptTimeout: 60 });
  const running = new AbortController();
  const queued = new AbortController();
  const p1 = b.prompt({ key: 'run', prompt: 'x', signal: running.signal });
  const p2 = b.prompt({ key: 'wait', prompt: 'x', signal: queued.signal });
  queued.abort();
  assert.deepEqual(await p2, { ok: false, reason: 'cancelled' });
  // p1 hits the 60 ms timeout before the 200 ms answer
  assert.deepEqual(await p1, { ok: false, reason: 'timeout' });
  const f2 = fakeLM({ delay: 200 });
  const b2 = RW.createAiBroker({ getLM: () => f2.LM });
  const c = new AbortController();
  const p3 = b2.prompt({ key: 'x', prompt: 'x', signal: c.signal });
  setTimeout(() => c.abort(), 20);
  assert.deepEqual(await p3, { ok: false, reason: 'cancelled' });
});

test('session failures are not reused', async () => {
  const f = fakeLM({ failCreate: true });
  const b = RW.createAiBroker({ getLM: () => f.LM });
  assert.deepEqual(await b.prompt({ key: 'a', prompt: 'x' }), { ok: false, reason: 'session_error' });
  assert.equal(b.hasSession, false);
  assert.equal(b.stats.failures, 1);
});
