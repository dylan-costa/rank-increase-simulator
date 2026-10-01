// Smoke test for gp/ris.gp: runs the PARI WebAssembly build under Node.
//   node tests/gp-smoke.cjs
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const pariDir = path.join(root, "vendor", "pari");
let out = [], err = [];

function gp(cmd) {
  out = []; err = [];
  Module.ccall("gp_embedded", null, ["string"], [cmd]);
  return { out: out.join("\n"), err: err.join("\n") };
}
function call(expr) {
  const t = Date.now(), r = gp(`print(${expr});`);
  if (!r.out) throw new Error(`${expr}\n${r.err}`);
  return { ms: Date.now() - t, v: JSON.parse(r.out.trim().split("\n").pop()) };
}

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failures++;
}

globalThis.Module = {
  noInitialRun: true,
  print: (t) => out.push(t),
  printErr: (t) => err.push(t),
  onRuntimeInitialized() {
    Module.ccall("pari_emscripten_init", null, ["number", "number"], [4000000, 1000000000]);
    const lib = gp(fs.readFileSync(path.join(root, "gp", "ris.gp"), "utf8"));
    check("library loads", !lib.err, lib.err);

    // Known ranks from the LMFDB: 11.a2 (0), 37.a1 (1), 389.a1 (2), 5077.a1 (3).
    for (const [label, ai, rank] of [
      ["11.a2", "[0,-1,1,-10,-20]", 0], ["37.a1", "[0,0,1,-1,0]", 1],
      ["389.a1", "[0,1,1,-2,0]", 2], ["5077.a1", "[0,0,1,-7,6]", 3],
      ["234446.a1", "[1,-1,0,-79,289]", 4], ["19047851.a1", "[0,0,1,-79,342]", 5],
    ]) {
      const { v, ms } = call(`ris_curve(${ai}, 0, 1)`);
      check(`${label} rank ${rank}`, Number(v.mw.rank) === rank && v.mw.complete === "1",
        `${ms}ms gens=${JSON.stringify(v.mw.gens)} reg=${v.mw.regulator}`);
    }

    // Non-minimal short Weierstrass model y^2 = x^3 - x/16 -> y^2 = x^3 - x (32.a3).
    const m = call(`ris_curve([0,0,0,-1/16,0], 0, 1)`).v;
    check("minimal model of y^2=x^3-x/16", JSON.stringify(m.info.ainvs) === '["0","0","0","-1","0"]' && m.info.conductor === "32");

    // Singular input is reported as an error.
    const s = gp(`print(ris_curve([0,0,0,0,0], 0, 1));`);
    check("singular curve rejected", !s.out && /singular/.test(s.err));

    // Twists of 11.a2: d=2 has rank 1, d=3 rank 0 (checked against LMFDB 176.a / 99.d).
    const t2 = call(`ris_twist([0,-1,1,-10,-20], 2, 0, 1, 1)`).v;
    check("twist d=2 rank 1 + generator", Number(t2.mw.rank) === 1 && t2.hit === "1" && t2.mw.gens.length === 1, JSON.stringify(t2.info.ainvs));
    const t3 = call(`ris_twist([0,-1,1,-10,-20], 3, 0, 1, 0)`).v;
    check("twist d=3 rank 0, not a hit", Number(t3.mw.rank) === 0 && t3.hit === "0");

    // Target 4 means "rank at least 4"; target 3 means exactly 3. (d = 1 is E itself.)
    const r4 = call(`ris_twist([1,-1,0,-79,289], 1, 0, 4, 0)`).v;
    const r5 = call(`ris_twist([0,0,1,-79,342], 1, 0, 4, 0)`).v;
    const r5as3 = call(`ris_twist([0,0,1,-79,342], 1, 0, 3, 0)`).v;
    check("ranks 4 and 5 are hits for target >= 4, not for 3", r4.hit === "1" && r5.hit === "1" && r5as3.hit === "0");

    // Stack-growth warnings are silenced, so they cannot pollute the JSON.
    const big = gp(`print(ris_twist([1,-1,0,-79,289], 38, 0, 4, 0));`);
    check("no PARI warnings on a large twist", !big.err, big.err.slice(0, 120));

    // Timing over a batch of twists.
    let t0 = Date.now(), n = 0, hist = {};
    for (let d = 2; d <= 200; d++) {
      for (const e of [d, -d]) {
        const r = call(`ris_twist([0,0,1,-1,0], ${e}, 0, 2, 0)`).v; n++;
        hist[r.mw.rank + "/" + r.mw.status] = (hist[r.mw.rank + "/" + r.mw.status] || 0) + 1;
      }
    }
    console.log(`${n} twists of 37.a1 in ${Date.now() - t0}ms`, hist);
    console.log(failures ? `${failures} FAILED` : "all passed");
    process.exitCode = failures ? 1 : 0;
  },
};
new Function("Module", "require", "__dirname", "__filename", "module",
  fs.readFileSync(path.join(pariDir, "gp-sta.js"), "utf8"))(
  globalThis.Module, require, pariDir, path.join(pariDir, "gp-sta.js"), {});
