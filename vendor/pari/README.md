# PARI/GP (WebAssembly build)

`gp-sta.js` and `gp-sta.wasm` are the official 32-bit WebAssembly build of
[PARI/GP](https://pari.math.u-bordeaux.fr/), downloaded unmodified from
<https://pari.math.u-bordeaux.fr/gpjswasm/> (the build behind
<https://pari.math.u-bordeaux.fr/gpwasm.html>).

- Version: GP/PARI 2.19.0 (development 31294-19e00f7164), GMP-6.3.0 kernel, compiled 28 Sep 2026
- Copyright © 2000–2026 The PARI Group
- License: GNU General Public License, version 2 or later
- Source code: <https://pari.math.u-bordeaux.fr/download.html>, or the git
  repository at <https://pari.math.u-bordeaux.fr/git/pari.git> (commit `19e00f7164`)

To update, download fresh copies of both files from the URL above, run
`node tests/gp-smoke.cjs`, and bump `BUILD` in `js/engine.js`.
