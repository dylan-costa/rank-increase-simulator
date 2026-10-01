// Computation engine: a pool of PARI workers and the ordered twist search.

// Bump when pari-worker.js or gp/ris.gp change, so browsers don't keep a
// stale cached copy (GitHub Pages caches for 10 minutes).
const BUILD = "3";
const WORKER_URL = new URL(`./pari-worker.js?v=${BUILD}`, import.meta.url);

// ---------------------------------------------------------------------------
// Result normalisation (GP emits every number as a string)
// ---------------------------------------------------------------------------

function normMW(mw) {
  return {
    ...mw,
    rank: Number(mw.rank),
    lower: Number(mw.lower),
    upper: Number(mw.upper),
    sha2: Number(mw.sha2),
    analytic: Number(mw.analytic),
    complete: mw.complete === "1",
    full: mw.full === "1",
    heights: mw.heights.map(cleanReal),
    regulator: mw.regulator === "-1" ? null : cleanReal(mw.regulator),
  };
}

function normInfo(info) {
  return {
    ...info,
    rootno: Number(info.rootno),
    torsion: { ...info.torsion, order: Number(info.torsion.order), structure: info.torsion.structure.map(Number) },
  };
}

// PARI prints reals like "1.2345 E-5"; make them JS-friendly.
function cleanReal(s) {
  return String(s).replace(/\s+/g, "").replace("E", "e");
}

export function normalizeCurve(v) {
  return { info: normInfo(v.info), mw: normMW(v.mw) };
}

export function normalizeTwist(v) {
  return { d: Number(v.d), info: normInfo(v.info), mw: normMW(v.mw), hit: v.hit === "1" };
}

// ---------------------------------------------------------------------------
// Worker pool
// ---------------------------------------------------------------------------

export class PariPool {
  constructor(size) {
    this.size = size;
    this.queue = [];
    this.slots = [];
    this.nextId = 1;
    // Start one worker first so the 16 MB wasm lands in the HTTP cache before
    // the others ask for it. `ready` resolves as soon as one worker is usable.
    this.ready = this._spawn(0);
    this.ready.then(() => {
      for (let i = 1; i < size; i++) this._spawn(i).catch(() => {});
    }, () => {});
  }

  _spawn(i) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_URL);
      const slot = { worker, busy: null, ready: false };
      this.slots[i] = slot;
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === "ready") {
          slot.ready = true;
          resolve();
          this._pump();
        } else if (m.type === "fatal") {
          reject(new Error(m.error));
        } else if (m.type === "result" && slot.busy && slot.busy.id === m.id) {
          const job = slot.busy;
          clearTimeout(job.timer);
          slot.busy = null;
          if (m.ok) job.resolve({ value: m.value, ms: m.ms });
          else job.reject(Object.assign(new Error(m.error), { kind: "pari" }));
          this._pump();
        }
      };
      worker.onerror = (e) => reject(new Error(e.message || "worker failed to start"));
    });
  }

  // Kill a worker (e.g. on timeout) and start a fresh one in its place.
  _restart(i) {
    this.slots[i].worker.terminate();
    this._spawn(i).catch(() => {});
  }

  run(fn, args, { timeout = 60000 } = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, fn, args, timeout, resolve, reject });
      this._pump();
    });
  }

  _pump() {
    for (let i = 0; i < this.slots.length && this.queue.length; i++) {
      const slot = this.slots[i];
      if (!slot || !slot.ready || slot.busy) continue;
      const job = this.queue.shift();
      slot.busy = job;
      job.timer = setTimeout(() => {
        if (slot.busy !== job) return;
        slot.busy = null;
        job.reject(Object.assign(new Error(`timed out after ${job.timeout / 1000}s`), { kind: "timeout" }));
        this._restart(i);
      }, job.timeout);
      slot.worker.postMessage({ id: job.id, fn: job.fn, args: job.args });
    }
  }

  // Drop queued jobs and abort running ones.
  cancelAll() {
    for (const job of this.queue.splice(0)) job.reject(Object.assign(new Error("cancelled"), { kind: "cancelled" }));
    this.slots.forEach((slot, i) => {
      if (slot && slot.busy) {
        const job = slot.busy;
        clearTimeout(job.timer);
        slot.busy = null;
        job.reject(Object.assign(new Error("cancelled"), { kind: "cancelled" }));
        this._restart(i);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Twist ordering
// ---------------------------------------------------------------------------

// Squarefree d != 1 with |d| <= X, ordered by |d| and then d > 0 before d < 0:
//   -1, 2, -2, 3, -3, 5, -5, 6, -6, 7, -7, 10, ...
export function twistList(X) {
  const sf = new Uint8Array(X + 1).fill(1);
  for (let p = 2; p * p <= X; p++) for (let m = p * p; m <= X; m += p * p) sf[m] = 0;
  const ds = [-1];
  for (let n = 2; n <= X; n++) if (sf[n]) ds.push(n, -n);
  return ds;
}

// ---------------------------------------------------------------------------
// Ordered search
// ---------------------------------------------------------------------------

// Walks the twist list in order, running several twists in parallel but
// reporting them strictly in order, so the first hit really is the one with
// the smallest |d|. A search can be resumed with next() to find the following
// hit; results computed ahead of the frontier are kept.
export class TwistSearch {
  constructor(pool, ainvs, target, X, { onRow, timeout } = {}) {
    this.pool = pool;
    this.ainvs = ainvs;
    this.target = target;
    this.list = twistList(X);
    this.X = X;
    this.onRow = onRow || (() => {});
    this.timeout = timeout || 60000;
    this.results = new Map(); // index -> row
    this.launched = 0; // next index to launch
    this.frontier = 0; // next index to report
    this.inflight = 0;
    this.stopped = false;
    this.waiter = null;
  }

  get total() {
    return this.list.length;
  }

  // Raise the bound X. twistList(X) is a prefix of twistList(X') for X < X',
  // so everything already checked stays valid.
  extend(X) {
    if (X <= this.X) return;
    this.X = X;
    this.list = twistList(X);
  }

  // Resolves with {hit: row} at the next twist of the target rank,
  // {done: true} once the list is exhausted, or {stopped: true}.
  next() {
    if (this.waiter) throw new Error("search already running");
    this.stopped = false;
    return new Promise((resolve) => {
      this.waiter = resolve;
      if (!this._advance()) this._pump();
    });
  }

  stop() {
    this.stopped = true;
    this.pool.cancelAll();
    // Cancelled twists are relaunched on resume; finished ones stay cached.
    this.launched = this.frontier;
    this._finish({ stopped: true });
  }

  _finish(result) {
    const w = this.waiter;
    this.waiter = null;
    if (w) w(result);
  }

  _pump() {
    const ahead = this.pool.size * 3;
    while (!this.stopped && this.waiter && this.launched < this.list.length && this.inflight < ahead) {
      const i = this.launched++;
      if (!this.results.has(i)) this._launch(i);
    }
  }

  _launch(i) {
    const d = this.list[i];
    this.inflight++;
    this.pool
      .run("ris_twist", [this.ainvs, d, 0, this.target, 0], { timeout: this.timeout })
      .then(({ value, ms }) => ({ ok: true, ms, ...normalizeTwist(value) }))
      .catch((e) => ({ ok: false, d, error: e.message, kind: e.kind }))
      .then((row) => {
        this.inflight--;
        if (row.kind === "cancelled") return;
        this.results.set(i, row);
        if (!this.stopped && this.waiter && !this._advance()) this._pump();
      });
  }

  // Report finished rows in order. Returns true if the search settled.
  _advance() {
    while (this.results.has(this.frontier)) {
      const row = this.results.get(this.frontier);
      this.results.delete(this.frontier);
      this.frontier++;
      this.onRow(row, this.frontier);
      if (row.ok && row.hit) {
        this._finish({ hit: row });
        return true;
      }
    }
    if (this.frontier >= this.list.length) {
      this._finish({ done: true });
      return true;
    }
    return false;
  }
}
