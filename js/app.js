// UI controller for the Rank Increase Simulator.

import { PariPool, TwistSearch, normalizeCurve, normalizeTwist, twistList } from "./engine.js";
import * as F from "./format.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const MAX_X = 10000;
const CURVE_TIMEOUT = 90000;
const GENS_TIMEOUT = 120000;
const TWIST_TIMEOUT = 60000;
const MAX_LOG_ROWS = 2500;
const MAX_TARGET = 4; // must match the "target >= 4" rule in gp/ris.gp
const TALLY = [
  { key: 0, label: "rank 0", color: "var(--rank0)" },
  { key: 1, label: "rank 1", color: "var(--rank1)" },
  { key: 2, label: "rank 2", color: "var(--rank2)" },
  { key: 3, label: "rank 3", color: "var(--rank3)" },
  { key: 4, label: "rank ≥ 4", color: "var(--rank4)" },
  { key: -1, label: "undetermined", color: "var(--rank-unknown)" },
];

const state = {
  form: "long",
  pool: null,
  curve: null, // {ainvs, info, mw}
  target: null,
  search: null, // {ts, target, tally, skipped, found, lastD}
  running: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function tex(src, display = false) {
  if (window.katex) return window.katex.renderToString(src, { throwOnError: false, displayMode: display });
  return `<code>${esc(src)}</code>`;
}

function renderStaticMath(root = document) {
  $$(".m[data-tex]", root).forEach((el) => (el.innerHTML = tex(el.dataset.tex)));
}

function fmtInt(n) {
  return Number(n).toLocaleString("en-US");
}

function tallyKey(row) {
  if (!row.ok || row.mw.rank < 0) return -1;
  return Math.min(row.mw.rank, MAX_TARGET);
}

// Target ranks are 0, 1, ..., MAX_TARGET, the last meaning "at least MAX_TARGET".
function rankLabel(r) {
  return r >= MAX_TARGET ? `≥ ${MAX_TARGET}` : String(r);
}

// ---------------------------------------------------------------------------
// Equation input
// ---------------------------------------------------------------------------

const forms = { long: $("#form-long"), short: $("#form-short") };
const textEntry = $("#coeff-text");

function boxes(form = state.form) {
  return $$("input.coef", forms[form]).sort((a, b) => a.dataset.i - b.dataset.i);
}

function setForm(form) {
  state.form = form;
  for (const [name, el] of Object.entries(forms)) el.hidden = name !== form;
  $$(".segmented button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.form === form)));
}

function autosize(input) {
  input.style.width = `${Math.max(4.2, input.value.length + 1.6)}ch`;
}

function fillBoxes(form, coeffs) {
  setForm(form);
  boxes(form).forEach((b, i) => {
    b.value = coeffs[i] === "0" ? "" : coeffs[i];
    b.classList.remove("invalid");
    autosize(b);
  });
}

// Read the active fill-in form. Returns {ok, kind, coeffs} or {ok: false, error}.
function readBoxes() {
  const list = boxes();
  const coeffs = list.map((b) => F.normCoeff(b.value));
  list.forEach((b, i) => b.classList.toggle("invalid", coeffs[i] === null));
  const bad = list.findIndex((_, i) => coeffs[i] === null);
  if (bad >= 0) return { ok: false, error: `“${list[bad].value}” is not an integer or fraction.` };
  return { ok: true, kind: state.form, coeffs };
}

function syncTextFromBoxes() {
  const r = readBoxes();
  if (r.ok) textEntry.value = F.coeffText(r.coeffs);
  textEntry.classList.remove("invalid");
}

function syncBoxesFromText() {
  const r = F.parseCoeffText(textEntry.value);
  textEntry.classList.toggle("invalid", !r.ok && textEntry.value.trim() !== "");
  if (r.ok) fillBoxes(r.kind, r.coeffs);
  return r;
}

function setupInput() {
  $$(".segmented button").forEach((b) =>
    b.addEventListener("click", () => {
      setForm(b.dataset.form);
      syncTextFromBoxes();
    }),
  );
  $$("input.coef").forEach((b) => {
    b.addEventListener("input", () => {
      autosize(b);
      syncTextFromBoxes();
    });
    b.addEventListener("keydown", (e) => e.key === "Enter" && analyze());
  });
  textEntry.addEventListener("input", syncBoxesFromText);
  textEntry.addEventListener("keydown", (e) => e.key === "Enter" && analyze());

  $$(".chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      if (chip.dataset.short) fillBoxes("short", chip.dataset.short.split(","));
      else fillBoxes("long", chip.dataset.ainvs.split(","));
      syncTextFromBoxes();
      analyze();
    }),
  );
  $("#btn-analyze").addEventListener("click", analyze);
  syncTextFromBoxes();
}

// ---------------------------------------------------------------------------
// Rendering a curve
// ---------------------------------------------------------------------------

function factsHTML(info, name) {
  // Value on one line; its factorisation over the bad primes underneath.
  const valueAndFactors = (sym, n) => {
    const s = String(n);
    const fac = F.factoredTeX(s, info.badprimes);
    if (fac === s) return tex(`${sym} = ${s}`);
    if (s.replace("-", "").length > 24) return tex(`${sym} = ${fac}`);
    return `${tex(`${sym} = ${s}`)}<div class="fact-sub">${tex(`= ${fac}`)}</div>`;
  };
  const tors = info.torsion;
  const torsTeX = tors.structure.length
    ? tors.structure.map((n) => `\\mathbb{Z}/${n}\\mathbb{Z}`).join(" \\oplus ")
    : "\\text{trivial}";
  const fact = (label, html, title = "") =>
    `<div class="fact"${title ? ` title="${esc(title)}"` : ""}><dt>${label}</dt><dd>${html}</dd></div>`;
  return `<dl class="facts">
    ${fact("Conductor", valueAndFactors("N", info.conductor))}
    ${fact("Minimal discriminant", valueAndFactors("\\Delta", info.disc))}
    ${fact("j-invariant", tex(`j = ${F.numTeX(info.j)}`))}
    ${fact("Root number", tex(`w = ${info.rootno > 0 ? "+1" : "-1"}`), "Sign of the functional equation; conjecturally w = (−1)^rank.")}
    ${fact("Torsion subgroup", tex(`${name}(\\mathbb{Q})_{\\mathrm{tors}} \\cong ${torsTeX}`))}
  </dl>`;
}

function mwHTML(info, mw, name) {
  const status = F.rankStatus(mw);
  const badgeClass = status.short === "proven" ? "proven" : status.short === "assumes BSD" ? "bsd" : "undetermined";
  const r = mw.rank;
  let group;
  if (r >= 0) group = tex(F.mwGroupTeX(r, info.torsion.structure, name));
  else group = tex(`${name}(\\mathbb{Q}) \\cong \\mathbb{Z}^r \\oplus E(\\mathbb{Q})_{\\mathrm{tors}},\\quad ${mw.lower} \\le r \\le ${mw.upper}`);

  const gens = mw.gens.map((P, i) => {
    const h = mw.heights[i] !== undefined ? `<span class="h">${tex(`\\hat h(P_{${i + 1}}) \\approx ${F.shortReal(mw.heights[i], 8)}`)}</span>` : "";
    return `<li><span>${tex(`\\displaystyle P_{${i + 1}} = ${F.pointTeX(P)}`)}</span>${h}</li>`;
  });
  const torsGens = info.torsion.gens.map((T, i) => {
    const order = info.torsion.gens.length === 1 ? info.torsion.order : info.torsion.structure[i];
    return `<li><span>${tex(`T_{${i + 1}} = ${F.pointTeX(T)}`)}</span><span class="h">order ${order}</span></li>`;
  });

  let notes = "";
  if (r > 0 && !mw.full) {
    notes += `<p class="status-line">Points found by 2-descent (not yet saturated).</p>`;
  } else if (r > 0 && mw.complete) {
    notes += `<p class="status-line">Generators of ${tex(`${name}(\\mathbb{Q})`)} modulo torsion, saturated at every prime ${tex("p \\le 100")} and LLL-reduced.${mw.regulator ? ` Regulator ${tex(`\\approx ${F.shortReal(mw.regulator, 8)}`)}.` : ""}</p>`;
  }
  if (r > 0 && mw.gens.length < r) {
    notes += `<div class="warn-box">Only ${mw.gens.length} of ${r} independent generators were found${mw.full ? "" : " (the generator computation timed out)"}.</div>`;
  }
  if (r < 0 && mw.gens.length) notes += `<p class="status-line">${mw.gens.length} independent point(s) found so far.</p>`;

  return `<div class="mw">
    <div class="rank-big"><div class="num">${esc(F.rankText(mw))}</div><div class="lbl">rank</div>
      <span class="badge ${badgeClass}" title="${esc(status.long)}">${esc(status.short)}</span></div>
    <div class="mw-body">
      <div class="mw-group">${group}</div>
      <p class="status-line">${esc(status.long)}</p>
      ${gens.length ? `<div class="gens-title">Generators of infinite order</div><ul class="gens">${gens.join("")}</ul>` : ""}
      ${notes}
      ${torsGens.length ? `<div class="gens-title">Torsion generators</div><ul class="gens">${torsGens.join("")}</ul>` : ""}
    </div>
  </div>`;
}

function curveBlockHTML(info, mw, name) {
  return `<div class="curve-eq">${tex(`${name} : ${F.weierstrassTeX(info.ainvs)}`, true)}</div>
    ${factsHTML(info, name)}
    ${mwHTML(info, mw, name)}
    <div class="links">
      <a class="btn-pill" href="${F.lmfdbURL(info.ainvs)}" target="_blank" rel="noopener">Look up in the LMFDB ↗</a>
    </div>`;
}

// ---------------------------------------------------------------------------
// Step 1: analyse the input curve
// ---------------------------------------------------------------------------

function showCurveError(msg) {
  const el = $("#curve-error");
  el.hidden = !msg;
  el.textContent = msg || "";
}

async function analyze() {
  if (!state.pool || $("#btn-analyze").disabled) return;
  // If the text box holds something unparsable, say so rather than silently using the boxes.
  if (document.activeElement === textEntry || textEntry.classList.contains("invalid")) {
    const t = syncBoxesFromText();
    if (!t.ok) return showCurveError(t.error);
  }
  const input = readBoxes();
  if (!input.ok) return showCurveError(input.error);
  showCurveError("");
  stopSearch();

  const ainvs = F.toAinvs(input.kind, input.coeffs);
  const btn = $("#btn-analyze");
  btn.disabled = true;
  const status = $("#engine-status");
  status.textContent = "Computing the minimal model and Mordell–Weil group…";

  let value, partial = false;
  try {
    ({ value } = await state.pool.run("ris_curve", [ainvs, 0, 1], { timeout: CURVE_TIMEOUT }));
  } catch (e) {
    if (e.kind === "timeout") {
      try {
        ({ value } = await state.pool.run("ris_curve", [ainvs, 0, 0], { timeout: CURVE_TIMEOUT }));
        partial = true;
      } catch (e2) {
        showCurveError(`PARI/GP could not finish: ${e2.message}`);
      }
    } else {
      showCurveError(/singular/.test(e.message) ? "That curve is singular (its discriminant is 0), so it is not an elliptic curve." : `PARI/GP error: ${e.message}`);
    }
  } finally {
    btn.disabled = false;
    setReadyStatus();
  }
  if (!value) return;

  const curve = { ainvs, ...normalizeCurve(value), partial };
  state.curve = curve;
  renderCurve(curve);
  const keep = new URLSearchParams(location.hash.slice(1));
  keep.set("c", input.coeffs.join(","));
  history.replaceState(null, "", "#" + decodeURIComponent(keep.toString()));

  $("#step-twist").hidden = false;
  $("#j1728-note").hidden = curve.info.j !== "1728";
  $("#search-panel").hidden = true;
  $("#results").innerHTML = "";
  updateSearchButton();
}

function renderCurve(curve) {
  const el = $("#curve-result");
  const same = curve.ainvs.join(",") === curve.info.ainvs.join(",");
  el.innerHTML = `<div class="curve-head">
      <div class="eyebrow">Your curve${same ? "" : ": minimal model"}</div>
    </div>
    ${curveBlockHTML(curve.info, curve.mw, "E")}
    ${same ? "" : `<p class="curve-note">The equation you entered is not a global minimal model. Shown is the reduced minimal model of the same curve (they are isomorphic over ${tex("\\mathbb{Q}")}).</p>`}
    ${curve.partial ? `<div class="warn-box">Computing generators took too long, so only the rank and the points found by 2-descent are shown.</div>` : ""}`;
  el.hidden = false;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------------------
// Step 2: twist search
// ---------------------------------------------------------------------------

function readX() {
  const input = $("#range-x");
  let X = Math.floor(Number(input.value));
  if (!Number.isFinite(X) || X < 1) X = 1;
  if (X > MAX_X) X = MAX_X;
  return X;
}

function updateRangeCount() {
  const X = readX();
  const n = twistList(X).length;
  const raw = Number($("#range-x").value);
  $("#range-count").textContent = raw > MAX_X
    ? `capped at X = ${fmtInt(MAX_X)}: ${fmtInt(n)} twists`
    : `${fmtInt(n)} twist${n === 1 ? "" : "s"} to check`;
}

function updateSearchButton() {
  const btn = $("#btn-search");
  btn.disabled = state.running || !state.curve || state.target === null || !state.pool;
  btn.textContent = state.target === null ? "Choose a rank first" : `Find a twist of rank ${rankLabel(state.target)}`;
}

function setupStep2() {
  $$(".rank-picker button").forEach((b) =>
    b.addEventListener("click", () => {
      state.target = Number(b.dataset.rank);
      $$(".rank-picker button").forEach((o) => o.setAttribute("aria-checked", String(o === b)));
      updateSearchButton();
    }),
  );
  $("#range-x").addEventListener("input", updateRangeCount);
  $("#btn-search").addEventListener("click", () => startSearch());
  $("#btn-stop").addEventListener("click", onStopClick);
  updateRangeCount();
  updateSearchButton();
}

function newTally() {
  return Object.fromEntries(TALLY.map((t) => [t.key, 0]));
}

function startSearch() {
  if (!state.curve || state.target === null || state.running) return;
  const X = readX();
  $("#range-x").value = X;
  updateRangeCount();
  stopSearch();

  const search = {
    target: state.target,
    X,
    tally: newTally(),
    checked: 0,
    skipped: [],
    found: [],
    lastD: null,
    pending: [],
    flushQueued: false,
  };
  search.ts = new TwistSearch(state.pool, state.curve.info.ainvs, state.target, X, {
    timeout: TWIST_TIMEOUT,
    onRow: (row) => onRow(search, row),
  });
  state.search = search;
  const params = new URLSearchParams(location.hash.slice(1));
  params.set("r", state.target);
  params.set("X", X);
  history.replaceState(null, "", "#" + decodeURIComponent(params.toString()));

  $("#results").innerHTML = "";
  $("#log-body").innerHTML = "";
  $("#search-panel").hidden = false;
  renderTally(search);
  runNext(search);
}

async function runNext(search) {
  if (state.search !== search || state.running) return;
  state.running = true;
  updateSearchButton();
  setStopButton("Stop", true);
  $("#search-title").textContent = `Searching for a twist of rank ${rankLabel(search.target)}`;
  renderProgress(search);
  $("#search-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });

  const res = await search.ts.next();
  flushRows(search);
  if (state.search !== search) return;
  state.running = false;

  if (res.hit) {
    $("#search-title").textContent = `Found d = ${res.hit.d}. Computing generators…`;
    setStopButton("Stop", false);
    const row = await fullTwist(search, res.hit);
    if (state.search !== search) return;
    search.found.push(row.d);
    renderHit(search, row);
    search.skipped = [];
    $("#search-title").textContent = `Found a twist of rank ${rankLabel(search.target)}`;
  } else if (res.done) {
    renderExhausted(search);
    $("#search-title").textContent = "Search finished";
  } else if (res.stopped) {
    $("#search-title").textContent = "Search paused";
    setStopButton("Resume", true);
  }
  if (!res.stopped) setStopButton("Stop", false);
  renderProgress(search);
  updateSearchButton();
}

// Recompute a hit with generators (saturation, LLL, Heegner points).
async function fullTwist(search, light) {
  try {
    const { value } = await state.pool.run("ris_twist", [state.curve.info.ainvs, light.d, 0, search.target, 1], { timeout: GENS_TIMEOUT });
    return { ok: true, ...normalizeTwist(value) };
  } catch {
    return light;
  }
}

function setStopButton(label, visible) {
  const b = $("#btn-stop");
  b.textContent = label;
  b.hidden = !visible;
}

function onStopClick() {
  const search = state.search;
  if (!search) return;
  if (state.running) {
    search.ts.stop();
  } else {
    runNext(search);
  }
}

function stopSearch() {
  const search = state.search;
  state.search = null;
  if (search && state.running) search.ts.stop();
  state.running = false;
  updateSearchButton();
}

// ---------------------------------------------------------------------------
// Progress, tally and log (DOM updates are batched)
// ---------------------------------------------------------------------------

function onRow(search, row) {
  search.checked++;
  search.lastD = row.d;
  const k = tallyKey(row);
  search.tally[k]++;
  if (k === -1) search.skipped.push(row);
  search.pending.push(row);
  if (!search.flushQueued) {
    // A timer rather than requestAnimationFrame, which stops in background tabs.
    search.flushQueued = true;
    setTimeout(() => flushRows(search), 80);
  }
}

function flushRows(search) {
  search.flushQueued = false;
  if (state.search !== search) return;
  const body = $("#log-body");
  const scroller = body.closest(".log-scroll");
  const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
  const frag = document.createDocumentFragment();
  for (const row of search.pending.splice(0)) frag.appendChild(logRow(search, row));
  body.appendChild(frag);
  while (body.rows.length > MAX_LOG_ROWS) body.deleteRow(0);
  if (atBottom) scroller.scrollTop = scroller.scrollHeight;
  $("#log-count").textContent = fmtInt(search.checked);
  renderTally(search);
  renderProgress(search);
}

function logRow(search, row) {
  const tr = document.createElement("tr");
  const k = tallyKey(row);
  const color = TALLY.find((t) => t.key === k).color;
  if (row.ok && row.hit) tr.className = "hit";
  else if (!row.ok) tr.className = "bad";
  const how = row.ok ? F.rankStatus(row.mw).short : row.kind === "timeout" ? "timed out" : "error";
  const rank = row.ok ? F.rankText(row.mw) : "?";
  tr.innerHTML = `<td class="mono">${row.d}</td><td class="mono">${row.ok ? esc(row.info.conductor) : "–"}</td>
    <td><span class="rank-dot" style="background:${color}"></span>${esc(rank)}</td>
    <td title="${esc(row.ok ? F.rankStatus(row.mw).long : row.error)}">${esc(how)}</td>`;
  return tr;
}

function renderTally(search) {
  const total = Math.max(1, search.checked);
  $("#tally").innerHTML = TALLY.filter((t) => t.key !== -1 || search.tally[-1] > 0)
    .map((t) => {
      const n = search.tally[t.key];
      const pct = (100 * n) / total;
      return `<span class="t-lbl">${t.label}</span>
        <span class="t-bar"><span class="t-fill" style="display:block;width:${pct}%;background:${t.color}"></span></span>
        <span class="t-num">${fmtInt(n)} · ${search.checked ? pct.toFixed(1) : "0.0"}%</span>`;
    })
    .join("");
}

function renderProgress(search) {
  const total = search.ts.total;
  const done = search.ts.frontier;
  $("#progress-fill").style.width = `${(100 * done) / total}%`;
  const at = search.lastD === null ? "" : ` · last checked d = ${search.lastD}`;
  $("#progress-text").textContent = `Checked ${fmtInt(done)} of ${fmtInt(total)} twists with |d| ≤ ${fmtInt(search.X)}${at}`;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function skippedHTML(search, before) {
  if (!search.skipped.length) return "";
  const ds = search.skipped.map((r) => r.d);
  const shown = ds.slice(0, 12).join(", ") + (ds.length > 12 ? ", …" : "");
  return `<div class="warn-box">The rank of ${ds.length} twist${ds.length === 1 ? "" : "s"} ${before} could not be determined and ${ds.length === 1 ? "was" : "were"} skipped: d = ${shown}.</div>`;
}

function foundSummary(search) {
  const n = search.found.length;
  const ds = search.found.map((d) => tex(`d = ${d}`)).join(", ");
  return `found ${n} twist${n === 1 ? "" : "s"} of rank ${rankLabel(search.target)}: ${ds}.`;
}

// Only the newest result card keeps its buttons.
function clearPrompts(results) {
  $$(".result-card .another, .result-card .actions", results).forEach((a) => a.remove());
}

function renderHit(search, row) {
  const card = document.createElement("section");
  card.className = "card result-card";
  const name = F.twistName(row.d);
  const r0 = state.curve.mw.rank;
  const nth = search.found.length;
  const isFirst = nth === 1;
  const change = r0 >= 0 && row.mw.rank >= 0
    ? `<div class="rank-change">${tex(`\\operatorname{rank} E(\\mathbb{Q}) = ${r0} \\quad\\longrightarrow\\quad \\operatorname{rank} ${name}(\\mathbb{Q}) = ${row.mw.rank}`)}</div>`
    : "";
  const which = isFirst ? "Twist found" : `Twist found · #${nth}`;
  const prev = search.found[nth - 2];
  const where = isFirst
    ? `No squarefree ${tex("d")} with smaller ${tex("|d|")} gives a twist of rank ${rankLabel(search.target)}, so this is the minimal one.`
    : `The next twist of rank ${rankLabel(search.target)} after ${tex(`d = ${prev}`)} in the search order.`;
  card.innerHTML = `
    <div class="eyebrow">${esc(which)}</div>
    <p class="result-headline">${tex(`d = ${row.d}`)}: the twist ${tex(name)} has rank ${esc(F.rankText(row.mw))}</p>
    <p class="hint">${where}</p>
    ${change}
    ${skippedHTML(search, `with smaller |d|`)}
    ${curveBlockHTML(row.info, row.mw, name)}
    <div class="another">
      <p class="another-q">Would you like to find another twist of rank ${rankLabel(search.target)}?</p>
      <p class="hint">The search picks up after ${tex(`d = ${row.d}`)}, so the next one will have ${tex("|d|")} at least ${Math.abs(row.d)}.</p>
      <div class="actions">
        <button class="btn-primary" data-act="next">Yes, find another</button>
        <button class="btn-ghost" data-act="done">No, I'm done</button>
      </div>
    </div>
    <p class="history">${foundSummary(search)}</p>`;
  wireResultButtons(card, search);
  const results = $("#results");
  clearPrompts(results);
  results.prepend(card);
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderExhausted(search) {
  const card = document.createElement("section");
  card.className = "card result-card none";
  const r = search.target;
  const X = search.X;
  const more = Math.min(MAX_X, X * 10);
  const theory = r <= 1
    ? `This is not the end of the story: every elliptic curve over ${tex("\\mathbb{Q}")} has infinitely many quadratic twists of rank 0 and infinitely many of rank 1 (Bump–Friedberg–Hoffstein and Murty–Murty, combined with Gross–Zagier–Kolyvagin), so a larger range will eventually succeed.`
    : `Twists of rank ${rankLabel(r)} are much rarer: by Goldfeld's conjecture they make up 0% of all twists. There is no general theorem guaranteeing one in a given range, so a larger range may or may not succeed.${r >= 4 ? " Tip: high-rank twists are easier to find for curves that already have large rank, such as the 234446.a1 (rank 4) and 19047851.a1 (rank 5) examples." : ""}`;
  const prior = search.found.length
    ? `No further squarefree ${tex("d")} with ${tex(`|d| \\le ${X}`)} gives a twist of rank ${rankLabel(r)} (found so far: ${search.found.map((d) => tex(`d = ${d}`)).join(", ")}).`
    : `None of the ${fmtInt(search.ts.total)} squarefree ${tex("d \\ne 1")} with ${tex(`|d| \\le ${X}`)} gives a twist of rank ${rankLabel(r)}.`;
  card.innerHTML = `
    <div class="eyebrow">No twist found</div>
    <p class="result-headline">Enter a larger range</p>
    <p>${prior}</p>
    <p class="hint">${theory}</p>
    ${skippedHTML(search, "in this range")}
    <div class="actions">
      ${X < MAX_X ? `<button class="btn-primary" data-act="extend" data-x="${more}">Extend the search to X = ${fmtInt(more)}</button>` : `<span class="hint">X is already at the maximum (${fmtInt(MAX_X)}).</span>`}
      <button class="btn-ghost" data-act="other">Search for a different rank</button>
    </div>`;
  wireResultButtons(card, search);
  const results = $("#results");
  clearPrompts(results);
  results.prepend(card);
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function wireResultButtons(card, search) {
  card.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b || state.search !== search) return;
    if (b.dataset.act === "next") {
      b.closest(".another").remove();
      runNext(search);
    } else if (b.dataset.act === "done") {
      const box = b.closest(".another");
      box.innerHTML = `<p class="another-q">Done: ${foundSummary(search)}</p>
        <div class="actions">
          <button class="btn-ghost" data-act="other">Search for a different rank</button>
          <button class="btn-ghost" data-act="curve">Try a different curve</button>
        </div>`;
    } else if (b.dataset.act === "extend") {
      const X = Number(b.dataset.x);
      search.X = X;
      search.ts.extend(X);
      $("#range-x").value = X;
      updateRangeCount();
      b.closest(".actions").remove();
      runNext(search);
    } else if (b.dataset.act === "other") {
      $("#step-twist").scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (b.dataset.act === "curve") {
      $("#step-curve").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

// ---------------------------------------------------------------------------
// Engine start-up and deep links
// ---------------------------------------------------------------------------

function setReadyStatus() {
  const s = $("#engine-status");
  s.className = "engine-status ready";
  s.textContent = `PARI/GP ready · up to ${state.pool.size} parallel worker${state.pool.size === 1 ? "" : "s"}`;
}

function startEngine() {
  const status = $("#engine-status");
  if (typeof WebAssembly !== "object" || typeof Worker !== "function") {
    status.className = "engine-status failed";
    status.textContent = "This browser does not support WebAssembly workers.";
    return Promise.reject(new Error("no wasm"));
  }
  const size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  status.textContent = "Loading PARI/GP (about 16 MB the first time, then cached)…";
  state.pool = new PariPool(size);
  return state.pool.ready.then(
    () => {
      setReadyStatus();
      $("#btn-analyze").disabled = false;
      updateSearchButton();
    },
    (e) => {
      status.className = "engine-status failed";
      status.textContent = `Could not start PARI/GP: ${e.message}`;
      throw e;
    },
  );
}

// #c=0,-1,1,-10,-20&r=1&X=100
function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const c = params.get("c");
  if (c) {
    textEntry.value = `[${c}]`;
    if (!syncBoxesFromText().ok) return false;
  }
  const r = params.get("r");
  if (r !== null && /^[0-4]$/.test(r)) $(`.rank-picker button[data-rank="${r}"]`).click();
  const X = params.get("X");
  if (X && /^\d+$/.test(X)) {
    $("#range-x").value = Math.min(MAX_X, Number(X));
    updateRangeCount();
  }
  return Boolean(c);
}

renderStaticMath();
setupInput();
setupStep2();
const hasCurve = readHash();
if (!hasCurve) fillBoxes("long", ["0", "-1", "1", "-10", "-20"]), syncTextFromBoxes();
startEngine().then(() => hasCurve && analyze(), () => {});
