// Unit tests for js/format.js and the twist ordering:  node tests/format.test.mjs
import assert from "node:assert/strict";
import * as F from "../js/format.js";

import { twistList } from "../js/engine.js";

// normCoeff
assert.equal(F.normCoeff(""), "0");
assert.equal(F.normCoeff("+3"), "3");
assert.equal(F.normCoeff("-0"), "0");
assert.equal(F.normCoeff("007"), "7");
assert.equal(F.normCoeff("−5"), "-5"); // Unicode minus
assert.equal(F.normCoeff("-1/16"), "-1/16");
assert.equal(F.normCoeff("1/0"), null);
assert.equal(F.normCoeff("x"), null);
assert.equal(F.normCoeff("1.5"), null);

// parseCoeffText
assert.deepEqual(F.parseCoeffText("[0,-1,1,-10,-20]"), { ok: true, kind: "long", coeffs: ["0", "-1", "1", "-10", "-20"] });
assert.deepEqual(F.parseCoeffText("EllipticCurve([0, 0, 1, -7, 6])"), { ok: true, kind: "long", coeffs: ["0", "0", "1", "-7", "6"] });
assert.deepEqual(F.parseCoeffText("-1 0"), { ok: true, kind: "short", coeffs: ["-1", "0"] });
assert.equal(F.parseCoeffText("[1,2,3]").ok, false);
assert.equal(F.parseCoeffText("[a,b]").ok, false);

// TeX
assert.equal(F.weierstrassTeX(["0", "-1", "1", "-10", "-20"]), "y^2 + y = x^3 - x^2 - 10x - 20");
assert.equal(F.weierstrassTeX(["1", "0", "0", "0", "0"]), "y^2 + xy = x^3");
assert.equal(F.weierstrassTeX(["0", "0", "0", "-1/16", "0"]), "y^2 = x^3 - \\frac{1}{16}x");
assert.equal(F.factoredTeX("-161051", ["11"]), "-11^{5}");
assert.equal(F.factoredTeX("24299", ["11", "47"]), "11 \\cdot 47^{2}");
assert.equal(F.mwGroupTeX(0, []), "E(\\mathbb{Q}) = \\{\\mathcal{O}\\}");
assert.equal(F.mwGroupTeX(2, [2, 4]), "E(\\mathbb{Q}) \\cong \\mathbb{Z}^{2} \\oplus \\mathbb{Z}/2\\mathbb{Z} \\oplus \\mathbb{Z}/4\\mathbb{Z}");
assert.equal(F.shortReal("1.00000"), "1");
assert.equal(F.shortReal("100000"), "100000");
assert.equal(F.shortReal("0.0511114082400", 6), "0.0511114");

// Twist order: by |d|, positive first, d = 1 skipped, squarefree only.
assert.deepEqual(twistList(10), [-1, 2, -2, 3, -3, 5, -5, 6, -6, 7, -7, 10, -10]);
assert.equal(twistList(10000).length, 2 * 6083 - 1); // 6083 squarefree n <= 10^4

console.log("format tests passed");
