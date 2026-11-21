import test from 'node:test';
import assert from 'node:assert/strict';
import { loadShared } from '../scripts/load-shared.mjs';

const RW = loadShared();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Deterministic stand-in for Chrome's LanguageModel. respond(prompt) decides each answer.
function fakeLM({ availability = 'available', respond = () => '{"candidate":"c1","action":"leave_unchanged","confidence":"high"}', delay = 5, failCreate = false, createDelay = 0, ignoreSignal = false } = {}) {
  const log = { created: 0, cloned: 0, destroyed: 0, prompts: 0, availabilityCalls: 0 };
  const makeSession = () => ({
    async clone() { log.cloned++; return makeSession(); },
    prompt(text, opts) {
      log.prompts++;
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(respond(text, opts)), typeof delay === 'function' ? delay() : delay);
        if (opts && opts.signal) opts.signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); });
      });
    },
    destroy() { log.destroyed++; }
  });
  return {
    log,
    LM: {
      async availability(o) { log.availabilityCalls++; assert.deepEqual(o, RW.AI_MODEL_OPTIONS); return availability; },
      async create(o) {
        if (failCreate) throw new Error('no');
        assert.ok(o.initialPrompts);
        log.createCalls = (log.createCalls || 0) + 1;
        if (createDelay) {
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, createDelay);
            if (o.signal && !ignoreSignal) o.signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); });
          });
        }
        log.created++;
        return makeSession();
      }
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

test('a cold model that is slow to create times out without blocking the queue, and the load goes on', async () => {
  // Real Nano on a cold start took up to 24 minutes for the first session; requests stay bounded,
  // but creation is never cut short, since an aborted create() is thrown away.
  const f = fakeLM({ createDelay: 150 });
  const held = [];
  const loads = [];
  const b = RW.createAiBroker({ getLM: () => f.LM, promptTimeout: 40, hold: (p) => held.push(p), onLoad: (e) => loads.push(e) });
  const t0 = Date.now();
  assert.deepEqual(await b.prompt({ key: 'a', prompt: 'x' }), { ok: false, reason: 'timeout' });
  assert.ok(Date.now() - t0 < 120, 'bounded by the request timeout');
  assert.equal(b.pending, 0, 'queue is free again');
  assert.equal(b.stats.prompts, 0, 'no prompt was sent');
  assert.equal(held.length, 1, 'the caller was told a load is going');
  await sleep(200);
  assert.equal(f.log.destroyed, 0, 'the late session is kept');
  assert.equal(b.hasSession, true);
  assert.ok(loads.some((e) => typeof e.readyMs === 'number'));
});

test('cancelling during session creation frees the queue', async () => {
  const f = fakeLM({ createDelay: 200 });
  const b = RW.createAiBroker({ getLM: () => f.LM });
  const c = new AbortController();
  const p = b.prompt({ key: 'a', prompt: 'x', signal: c.signal });
  setTimeout(() => c.abort(), 20);
  assert.deepEqual(await p, { ok: false, reason: 'cancelled' });
  assert.equal(b.pending, 0);
  const f2 = fakeLM();
  const b2 = RW.createAiBroker({ getLM: () => f2.LM });
  assert.equal((await b2.prompt({ key: 'b', prompt: 'y' })).ok, true);
});

test('after a creation timeout, requests are answered at once while the load goes on, with no second load', async () => {
  let clock = 1000;
  const f = fakeLM({ createDelay: 150 });
  const b = RW.createAiBroker({ getLM: () => f.LM, promptTimeout: 40, coldBackoff: 60000, now: () => clock });
  assert.deepEqual(await b.prompt({ key: 'a', prompt: 'x' }), { ok: false, reason: 'timeout' });
  assert.equal(b.warming, true);
  const t0 = Date.now();
  assert.deepEqual(await b.prompt({ key: 'b', prompt: 'x' }), { ok: false, reason: 'model_warming' });
  assert.ok(Date.now() - t0 < 20, 'answered at once');
  assert.equal(f.log.availabilityCalls, 1, 'no availability check either');
  clock += 60001;
  assert.deepEqual(await b.prompt({ key: 'c', prompt: 'x' }), { ok: false, reason: 'model_warming' }, 'still loading after the backoff');
  assert.equal(f.log.createCalls, 1, 'no second load');
  await sleep(200);
  assert.equal((await b.prompt({ key: 'd', prompt: 'x' })).ok, true);
  assert.equal(f.log.createCalls, 1, 'the first load is used');
  assert.equal(b.warming, false);
});

test('a prompt timeout on a warm session does not start the backoff', async () => {
  let n = 0;
  const f = fakeLM({ delay: () => (n++ === 0 ? 5 : 200) });
  const b = RW.createAiBroker({ getLM: () => f.LM, promptTimeout: 60 });
  assert.equal((await b.prompt({ key: 'a', prompt: 'x' })).ok, true);
  assert.deepEqual(await b.prompt({ key: 'b', prompt: 'x' }), { ok: false, reason: 'timeout' });
  assert.equal(b.warming, false);
  assert.equal(f.log.created, 1);
});

test('a session created quickly whose first prompt times out (model loading) starts the backoff', async () => {
  let clock = 0;
  let n = 0;
  const f = fakeLM({ delay: () => (n++ === 0 ? 200 : 5) });
  const b = RW.createAiBroker({ getLM: () => f.LM, promptTimeout: 40, now: () => clock });
  assert.deepEqual(await b.prompt({ key: 'a', prompt: 'x' }), { ok: false, reason: 'timeout' });
  assert.equal(b.warming, true);
  const prompts = f.log.prompts;
  assert.deepEqual(await b.prompt({ key: 'b', prompt: 'x' }), { ok: false, reason: 'model_warming' });
  assert.equal(f.log.prompts, prompts, 'no prompt during the backoff');
  clock += 60001;
  assert.equal((await b.prompt({ key: 'c', prompt: 'x' })).ok, true);
  assert.equal(f.log.created, 1, 'the open session is reused');
  assert.equal(b.warming, false);
});

test('a load that finishes during the backoff is used at once', async () => {
  const clock = 0;
  const f = fakeLM({ createDelay: 150 });
  const loads = [];
  const b = RW.createAiBroker({ getLM: () => f.LM, promptTimeout: 40, now: () => clock, onLoad: (e) => loads.push(e) });
  assert.equal((await b.prompt({ key: 'a', prompt: 'x' })).reason, 'timeout');
  await sleep(200);
  assert.equal(b.warming, false, 'a ready session ends the backoff');
  assert.equal((await b.prompt({ key: 'b', prompt: 'x' })).ok, true);
  assert.equal(f.log.created, 1);
  assert.ok(loads.some((e) => e.answered), 'the first answer is reported');

});

test('warm() gets a session ready without a prompt, and is quick once warm', async () => {
  const f = fakeLM({ createDelay: 30 });
  const b = RW.createAiBroker({ getLM: () => f.LM });
  const r = await b.warm();
  assert.equal(r.ok, true);
  assert.equal(f.log.prompts, 0);
  assert.equal(b.hasSession, true);
  assert.equal((await b.warm()).ok, true);
  assert.equal(f.log.createCalls, 1, 'one session');
  const none = RW.createAiBroker({ getLM: () => fakeLM({ availability: 'downloadable' }).LM });
  assert.deepEqual(await none.warm(), { ok: false, reason: 'model_downloadable' });
  b.release();
});

test('warm(keepMs) keeps the session past the idle release, then lets it go', async () => {
  let clock = 0;
  const f = fakeLM();
  const b = RW.createAiBroker({ getLM: () => f.LM, idleRelease: 30, now: () => clock });
  assert.equal((await b.warm(100)).ok, true);
  assert.equal(b.keptUntil, 100);
  await sleep(60);
  assert.equal(b.hasSession, true, 'kept beyond the idle release');
  clock = 200;
  assert.equal((await b.prompt({ key: 'a', prompt: 'x' })).ok, true);
  await sleep(60);
  assert.equal(b.hasSession, false, 'released once the keep time has passed');
});

test('a kept session asks one tiny question now and then, and stops once the keep ends', async () => {
  let clock = 0;
  const f = fakeLM();
  const b = RW.createAiBroker({ getLM: () => f.LM, idleRelease: 20, touchEvery: 30, now: () => clock });
  assert.equal((await b.warm(100)).ok, true);
  // Wait for the first touch (timers run late when the machine is busy).
  for (let i = 0; i < 50 && !b.stats.touches; i++) await sleep(10);
  assert.equal(b.stats.touches >= 1, true, 'a touch after touchEvery');
  assert.equal(f.log.cloned, 1, 'on a clone, never the kept session itself');
  clock = 200;
  await sleep(80);
  assert.equal(b.stats.touches <= 2, true, 'no more touches once the keep has passed');
  b.release();
  const plain = fakeLM();
  const p = RW.createAiBroker({ getLM: () => plain.LM, idleRelease: 20, touchEvery: 10 });
  await p.prompt({ key: 'a', prompt: 'x' });
  await sleep(40);
  assert.equal(p.stats.touches, 0, 'nothing kept, nothing asked');
});
