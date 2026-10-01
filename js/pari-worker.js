// Web Worker hosting one PARI/GP (WebAssembly) interpreter.
//
// Protocol
//   worker -> main  {type: "ready"} | {type: "fatal", error}
//   main -> worker  {id, fn, args}        fn is "ris_curve" or "ris_twist"
//   worker -> main  {type: "result", id, ok, value | error, ms}

// Everything lives in a closure: importScripts() shares the global scope, and
// the Emscripten loader declares globals of its own (out, err, ...).
(() => {
  const PARI_DIR = new URL("../vendor/pari/", self.location.href).href;
  const GP_LIB = new URL("../gp/ris.gp" + self.location.search, self.location.href).href;
  const FUNCTIONS = new Set(["ris_curve", "ris_twist"]);
  const ATOM = /^-?\d+(\/\d+)?$/;
  const BEGIN = "<<RIS<";
  const END = ">RIS>>";

  let out = [];
  let err = [];

  function gp(cmd) {
    out = [];
    err = [];
    self.Module.ccall("gp_embedded", null, ["string"], [cmd]);
    return { out: out.join("\n"), err: err.join("\n") };
  }

  // Arguments are numbers, rational strings, or arrays of them; anything else
  // is rejected so user input can never become arbitrary GP code.
  function toGP(arg) {
    if (Array.isArray(arg)) return "[" + arg.map(toGP).join(",") + "]";
    const s = String(arg).trim();
    if (!ATOM.test(s)) throw new Error(`invalid argument: ${s}`);
    return s;
  }

  // PARI error output looks like "  ***   at top-level: ...\n  *** fn: message".
  // Keep just the final message.
  function cleanError(text) {
    const lines = text.split("\n").map((l) => l.replace(/^\s*\*{3}\s*/, "").trim()).filter(Boolean);
    const msg = lines.filter((l) => !/^at top-level|^\^|^\.\.\./.test(l)).pop() || lines.pop() || "PARI error";
    return msg.replace(/^[a-z_]+: /, "");
  }

  self.onmessage = (e) => {
    const { id, fn, args } = e.data;
    const t0 = performance.now();
    try {
      if (!FUNCTIONS.has(fn)) throw new Error(`unknown function ${fn}`);
      // Markers around the JSON, so stray PARI output can't corrupt it.
      const r = gp(`print("${BEGIN}", ${fn}(${args.map(toGP).join(",")}), "${END}");`);
      const i = r.out.lastIndexOf(BEGIN);
      const j = r.out.lastIndexOf(END);
      if (i < 0 || j < i) throw new Error(cleanError(r.err));
      const value = JSON.parse(r.out.slice(i + BEGIN.length, j));
      self.postMessage({ type: "result", id, ok: true, value, ms: performance.now() - t0 });
    } catch (ex) {
      self.postMessage({ type: "result", id, ok: false, error: ex.message, ms: performance.now() - t0 });
    }
  };

  self.Module = {
    noInitialRun: true,
    print: (t) => out.push(t),
    printErr: (t) => err.push(t),
    locateFile: (p) => PARI_DIR + p,
    async onRuntimeInitialized() {
      try {
        // parisize 8 MB, allowed to grow to 1 GB.
        self.Module.ccall("pari_emscripten_init", null, ["number", "number"], [8000000, 1000000000]);
        const lib = await (await fetch(GP_LIB)).text();
        const r = gp(lib);
        if (r.err.includes("***")) throw new Error(cleanError(r.err));
        self.postMessage({ type: "ready" });
      } catch (ex) {
        self.postMessage({ type: "fatal", error: ex.message });
      }
    },
  };

  importScripts(PARI_DIR + "gp-sta.js");
})();
