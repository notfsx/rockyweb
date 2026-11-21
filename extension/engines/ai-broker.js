// Runs Chrome's built-in model (LanguageModel, Gemini Nano) from the service worker.
// One request at a time, a small bounded queue, per-request timeouts and cancellation,
// and the session is destroyed after a short idle period. Never downloads a model.
(function (root) {
  'use strict';
  const RW = (root.RockyShared = root.RockyShared || {});

  // Timers never keep a Node test process alive; in Chrome unref does not exist and this is a no-op.
  const unref = (t) => { if (t && typeof t.unref === 'function') t.unref(); return t; };

  function withTimeout(promise, ms) {
    let t;
    return Promise.race([promise, new Promise((_, reject) => { t = unref(setTimeout(() => reject(new Error('timeout')), ms)); })])
      .finally(() => clearTimeout(t));
  }

  // Rejects as soon as the signal aborts, even if the API ignores it.
  function untilAborted(promise, signal) {
    if (!signal) return promise;
    let onAbort;
    return Promise.race([promise, new Promise((_, reject) => {
      onAbort = () => reject(new Error('aborted'));
      if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
    })]).finally(() => signal.removeEventListener('abort', onAbort));
  }

  function createAiBroker(opts) {
    const o = opts || {};
    const getLM = o.getLM || (() => root.LanguageModel);
    const MAX_QUEUE = o.maxQueue || 4;
    const PROMPT_TIMEOUT = o.promptTimeout || 20000;
    const IDLE_RELEASE = o.idleRelease || 60000;
    // A timeout before the session has answered once means Chrome is still loading the model
    // (on the first prompt or during creation): answer at once for a while instead of waiting again.
    const COLD_BACKOFF = o.coldBackoff || 60000;
    const now = o.now || (() => Date.now());
    const systemPrompt = o.systemPrompt || RW.AI_SYSTEM_PROMPT;
    // availability() and create() always use the same options, including the input languages.
    const modelOptions = o.modelOptions || RW.AI_MODEL_OPTIONS;
    // Called with a session creation that is still going, so the caller can keep the worker alive.
    const hold = o.hold || (() => {});
    // Told when a session is ready and when it first answers, for the popup's loading note.
    const onLoad = o.onLoad || (() => {});

    let base = null;
    let basePromise = null;
    let idleTimer = 0;
    let running = false;
    let coldUntil = 0;
    let keepUntil = 0; // the session is kept at least until then (see warm)
    // Chrome unloaded the model about 5 minutes after its last answer even with a session open
    // (measured), so a kept session asks one tiny question this often while it is kept.
    const TOUCH_EVERY = o.touchEvery || 4 * 60000;
    let touchTimer = 0;
    let proven = false; // the current session has answered at least once
    const queue = [];
    const inflight = new Map();
    const stats = { prompts: 0, sessionsCreated: 0, sessionsDestroyed: 0, failures: 0, timeouts: 0, cancelled: 0, invalid: 0, deduplicated: 0, warming: 0, touches: 0 };

    async function availability() {
      const LM = getLM();
      if (!LM || typeof LM.availability !== 'function') return 'absent';
      try {
        const a = await withTimeout(LM.availability(modelOptions), 5000);
        return ['unavailable', 'downloadable', 'downloading', 'available'].includes(a) ? a : 'unavailable';
      } catch (_) {
        return 'error';
      }
    }

    function release() {
      clearTimeout(idleTimer);
      idleTimer = 0;
      clearTimeout(touchTimer);
      touchTimer = 0;
      keepUntil = 0;
      if (base) {
        try { base.destroy(); } catch (_) { /* already gone */ }
        stats.sessionsDestroyed++;
        base = null;
      }
    }

    function scheduleRelease() {
      clearTimeout(idleTimer);
      idleTimer = unref(setTimeout(release, Math.max(IDLE_RELEASE, keepUntil - now())));
      scheduleTouch();
    }

    function scheduleTouch() {
      clearTimeout(touchTimer);
      touchTimer = 0;
      if (base && keepUntil - now() > TOUCH_EVERY / 2) touchTimer = unref(setTimeout(touch, TOUCH_EVERY));
    }

    async function touch() {
      touchTimer = 0;
      if (!base || running || now() >= keepUntil) return;
      let c = null;
      try {
        c = typeof base.clone === 'function' ? await base.clone() : null;
        if (c) { await withTimeout(c.prompt('Reply with OK.'), 20000); stats.touches++; }
      } catch (_) { /* the next real request finds out */ }
      if (c) { try { c.destroy(); } catch (_) { /* ignore */ } }
      scheduleTouch();
    }

    // A request waits for creation only as long as its own timeout, but creation itself is never cut
    // short: an aborted create() destroys the session, and the next one starts Chrome's slow first
    // load again (measured: 13 cut-off tries in 25 minutes, none finished). A late session is kept.
    function session(signal) {
      if (base) return Promise.resolve(base);
      if (!basePromise) {
        const startedAt = now();
        basePromise = RW.aiCreate(getLM(), { initialPrompts: [{ role: 'system', content: systemPrompt }] }, modelOptions)
          .then((s) => {
            stats.sessionsCreated++;
            base = s;
            proven = false;
            coldUntil = 0;
            onLoad({ readyMs: now() - startedAt });
            scheduleRelease();
            return s;
          })
          .finally(() => { basePromise = null; });
        basePromise.catch(() => {});
        hold(basePromise);
      }
      return untilAborted(basePromise, signal);
    }

    async function run(job) {
      if (job.signal && job.signal.aborted) { stats.cancelled++; return { ok: false, reason: 'cancelled' }; }
      if ((!base || !proven) && (now() < coldUntil || (basePromise && coldUntil))) { stats.warming++; return { ok: false, reason: 'model_warming' }; }
      const avail = await availability();
      if (avail !== 'available') { release(); return { ok: false, reason: `model_${avail}` }; }
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      if (job.signal) job.signal.addEventListener('abort', onAbort);
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, PROMPT_TIMEOUT);
      let child = null;
      const cold = !base || !proven;
      try {
        const s = await session(ctrl.signal);
        // A clone keeps each decision independent of earlier ones.
        child = typeof s.clone === 'function' ? await s.clone({ signal: ctrl.signal }) : s;
        stats.prompts++;
        const text = await child.prompt(job.prompt, { responseConstraint: job.schema, signal: ctrl.signal });
        if (!proven) onLoad({ answered: true });
        proven = true;
        return { ok: true, text: typeof text === 'string' ? text : String(text) };
      } catch (_) {
        if (timedOut) {
          stats.timeouts++;
          if (cold) coldUntil = now() + COLD_BACKOFF;
          return { ok: false, reason: 'timeout' };
        }
        if (job.signal && job.signal.aborted) { stats.cancelled++; return { ok: false, reason: 'cancelled' }; }
        stats.failures++;
        release(); // a failed or evicted session is never reused
        return { ok: false, reason: 'session_error' };
      } finally {
        clearTimeout(timer);
        if (job.signal) job.signal.removeEventListener('abort', onAbort);
        if (child && child !== base) { try { child.destroy(); } catch (_) { /* ignore */ } }
        scheduleRelease();
      }
    }

    async function pump() {
      if (running || !queue.length) return;
      running = true;
      const job = queue.shift();
      try {
        job.resolve(await run(job));
      } finally {
        running = false;
        pump();
      }
    }

    // job: { key, prompt, schema, signal }. Identical keys share one request.
    function prompt(job) {
      if (inflight.has(job.key)) { stats.deduplicated++; return inflight.get(job.key); }
      if (queue.length >= MAX_QUEUE) return Promise.resolve({ ok: false, reason: 'busy' });
      const p = new Promise((resolve) => {
        queue.push(Object.assign({}, job, { resolve }));
        if (job.signal) {
          job.signal.addEventListener('abort', () => {
            const i = queue.findIndex((q) => q.key === job.key);
            if (i >= 0) { queue.splice(i, 1); stats.cancelled++; resolve({ ok: false, reason: 'cancelled' }); }
          }, { once: true });
        }
        pump();
      });
      inflight.set(job.key, p);
      p.finally(() => inflight.delete(job.key));
      return p;
    }

    function cancelQueued() {
      for (const j of queue.splice(0)) { stats.cancelled++; j.resolve({ ok: false, reason: 'cancelled' }); }
    }

    // Gets the model ready without asking anything; resolves when the session exists. keepMs keeps
    // the session that long: Chrome unloads the model once no session is left, and loading it
    // again took minutes on the test laptop.
    async function warm(keepMs) {
      if (keepMs) { keepUntil = Math.max(keepUntil, now() + keepMs); if (base) scheduleRelease(); }
      const avail = await availability();
      if (avail !== 'available') return { ok: false, reason: `model_${avail}` };
      const t = now();
      try { await session(null); } catch (_) { stats.failures++; return { ok: false, reason: 'session_error' }; }
      // Counted from when the model is ready, since the load itself can take minutes.
      if (keepMs) { keepUntil = Math.max(keepUntil, now() + keepMs); scheduleRelease(); }
      return { ok: true, ms: now() - t };
    }

    return {
      availability,
      prompt,
      warm,
      release,
      cancelQueued,
      stats,
      get hasSession() { return !!base; },
      get warming() { return now() < coldUntil; },
      get keptUntil() { return keepUntil; },
      get pending() { return queue.length + (running ? 1 : 0); }
    };
  }

  RW.createAiBroker = createAiBroker;
  if (typeof module === 'object' && module.exports) module.exports = RW;
})(typeof globalThis !== 'undefined' ? globalThis : self);
