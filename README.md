# Rank Increase Simulator

An interactive page for exploring how the Mordell–Weil rank changes under
quadratic twists. Live at <https://dylan-costa.github.io/rank-increase-simulator/>.

1. Enter an elliptic curve *E*/ℚ, either by filling in the blanks of
   y² + a₁xy + a₃y = x³ + a₂x² + a₄x + a₆ (or y² = x³ + ax + b), or by typing
   the coefficients as in the LMFDB, Sage or Magma: `[a1,a2,a3,a4,a6]` or `[a,b]`.
2. The page shows the reduced minimal model, conductor, discriminant,
   *j*-invariant, root number, torsion, rank, and generators of *E*(ℚ).
3. Choose a target rank (0, 1, 2, 3 or ≥ 4) and a bound *X* ≤ 10,000. The simulator
   checks every squarefree *d* ≠ 1 with |*d*| ≤ *X*, in the order
   −1, 2, −2, 3, −3, 5, −5, …, and stops at the first twist *E*⁽ᵈ⁾ of that rank,
   showing its minimal model, Mordell–Weil group and generators. It then asks
   whether to find another twist of that rank, and continues from where it stopped.

Everything runs in the visitor's browser, with no server: computations use the
[WebAssembly build of PARI/GP](https://pari.math.u-bordeaux.fr/gpwasm.html),
running in up to four Web Workers in parallel.

## How ranks are determined

For each curve, `ellrank` runs a 2-descent and returns lower and upper bounds
for the rank.

- **Bounds agree:** the rank is proven.
- **Bounds differ:** the page computes the analytic rank with `ellanalyticrank`.
  - Analytic rank 0 or 1: the rank equals it by Gross–Zagier–Kolyvagin (still a theorem).
  - Analytic rank ≥ 2: rank = analytic rank assumes BSD, and the page labels it that way.

Generators come from the descent; for an analytic-rank-1 curve with no point
found, a Heegner point is used instead (`ellheegner`). They are then saturated
at every prime ≤ 100 (`ellsaturation`) and LLL-reduced with respect to the
canonical height. Each curve also gets an "LMFDB" link, using the LMFDB's search
box, which accepts Weierstrass coefficients.

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `css/app.css` | The page (styled to match dylan-costa.github.io) |
| `js/app.js` | UI: input forms, rendering, search controls |
| `js/engine.js` | Worker pool and the ordered twist search |
| `js/format.js` | Input parsing and TeX formatting (pure functions) |
| `js/pari-worker.js` | Web Worker that hosts one PARI/GP interpreter |
| `gp/ris.gp` | The GP code: minimal models, twists, ranks, generators, JSON output |
| `vendor/pari/` | PARI/GP WebAssembly build (GPL; see its README) |
| `tests/` | `node tests/gp-smoke.cjs` (PARI under Node) and `node tests/format.test.mjs` |
| `dev_server.py` | Local static server with correct MIME types |

## Running locally

```bash
python dev_server.py
```

Then open <http://localhost:8844/>. (Plain `python -m http.server` can serve
`.js` files as `text/plain` on Windows, which stops the page from loading.)

## Deploying on GitHub Pages

1. Create a public GitHub repository named `rank-increase-simulator` and push this folder to it.
2. In the repository's **Settings → Pages**, choose **Deploy from a branch**,
   branch `main`, folder `/ (root)`.
3. The site appears at `https://dylan-costa.github.io/rank-increase-simulator/`.

The `.nojekyll` file tells GitHub Pages to serve the files as they are. When you
change `js/pari-worker.js` or `gp/ris.gp`, bump `BUILD` in `js/engine.js` so
browsers fetch the new versions.

## License

The PARI/GP files in `vendor/pari/` are distributed under the GPL (version 2 or
later). The rest of the code is by Dylan Costa.
