// Input parsing and TeX formatting. Pure functions (no DOM), so they can be
// unit-tested under Node: see tests/format.test.mjs.

const RATIONAL = /^[+-]?\d+(\/\d+)?$/;
const MAX_DIGITS = 200;

// Normalise one coefficient: "+3" -> "3", "" -> "0", "-0" -> "0", "4/2" kept
// (PARI reduces it). Returns null if it is not an integer or fraction.
export function normCoeff(raw) {
  let s = String(raw ?? "").replace(/\s+/g, "").replace(/[−–]/g, "-");
  if (s === "" || s === "+" ) return "0";
  if (!RATIONAL.test(s) || s.replace(/\D/g, "").length > MAX_DIGITS) return null;
  if (s[0] === "+") s = s.slice(1);
  const [num, den] = s.split("/");
  if (den !== undefined && /^0+$/.test(den)) return null;
  const n = num.replace(/^(-?)0+(?=\d)/, "$1");
  if (/^-?0$/.test(n)) return "0";
  return den === undefined ? n : `${n}/${den.replace(/^0+(?=\d)/, "")}`;
}

// Parse text such as "[0,-1,1,-10,-20]", "0 -1 1 -10 -20", "[-1, 0]" or a
// pasted "EllipticCurve([0,0,1,-7,6])" (Sage/Magma). Returns
//   {ok: true, kind: "long" | "short", coeffs}   (5 or 2 strings)
//   {ok: false, error}
export function parseCoeffText(text) {
  let s = String(text).trim();
  if (!s) return { ok: false, error: "Enter some coefficients." };
  const inner = s.match(/\[([^\[\]]*)\]/);
  if (inner) s = inner[1];
  const parts = s.split(/[\s,;]+/).filter(Boolean);
  if (parts.length !== 5 && parts.length !== 2) {
    return { ok: false, error: `Expected 5 numbers [a1,a2,a3,a4,a6] or 2 numbers [a,b], got ${parts.length}.` };
  }
  const coeffs = parts.map(normCoeff);
  const bad = parts.find((_, i) => coeffs[i] === null);
  if (bad !== undefined) return { ok: false, error: `“${bad}” is not an integer or fraction.` };
  return { ok: true, kind: parts.length === 5 ? "long" : "short", coeffs };
}

// [a1,a2,a3,a4,a6] for either kind of input.
export function toAinvs(kind, coeffs) {
  return kind === "short" ? ["0", "0", "0", coeffs[0], coeffs[1]] : coeffs.slice();
}

export function coeffText(coeffs) {
  return "[" + coeffs.join(",") + "]";
}

// ---------------------------------------------------------------------------
// TeX
// ---------------------------------------------------------------------------

export function numTeX(s) {
  s = String(s);
  const neg = s[0] === "-";
  const a = neg ? s.slice(1) : s;
  const [p, q] = a.split("/");
  const body = q === undefined ? p : `\\frac{${p}}{${q}}`;
  return neg ? `-${body}` : body;
}

// One signed term "+ 3x^2", "- x", "+ \frac{1}{2}y"; "" when the coefficient is 0.
function term(c, mon, first) {
  if (c === "0") return "";
  const neg = c[0] === "-";
  const abs = neg ? c.slice(1) : c;
  const coef = abs === "1" && mon ? "" : numTeX(abs);
  const sign = neg ? "-" : first ? "" : "+";
  return `${sign} ${coef}${mon}`.trim();
}

function side(terms) {
  let out = "";
  for (const [c, mon] of terms) {
    const t = term(c, mon, out === "");
    if (t) out += (out ? " " : "") + t;
  }
  return out || "0";
}

export function weierstrassTeX([a1, a2, a3, a4, a6]) {
  const lhs = side([["1", "y^2"], [a1, "xy"], [a3, "y"]]);
  const rhs = side([["1", "x^3"], [a2, "x^2"], [a4, "x"], [a6, ""]]);
  return `${lhs} = ${rhs}`;
}

export function pointTeX(P) {
  if (P.length === 1) return "\\mathcal{O}";
  return `\\left(${numTeX(P[0])},\\ ${numTeX(P[1])}\\right)`;
}

// Factor |n| over the given primes (n is an integer string). Returns
// [[p, e], ...] and the leftover cofactor (1 when the primes suffice).
export function factorOver(n, primes) {
  let m = BigInt(n);
  if (m < 0n) m = -m;
  const fac = [];
  for (const p of primes.map((x) => BigInt(x))) {
    let e = 0;
    while (m % p === 0n) {
      m /= p;
      e++;
    }
    if (e) fac.push([p.toString(), e]);
  }
  return { fac, rest: m.toString() };
}

export function factoredTeX(n, primes) {
  const s = String(n);
  if (s === "1" || s === "-1") return s;
  const { fac, rest } = factorOver(s, primes);
  const parts = fac.map(([p, e]) => (e === 1 ? p : `${p}^{${e}}`));
  if (rest !== "1") parts.push(rest);
  return (s[0] === "-" ? "-" : "") + parts.join(" \\cdot ");
}

export function mwGroupTeX(rank, torsionStructure, name = "E") {
  const parts = [];
  if (rank === 1) parts.push("\\mathbb{Z}");
  else if (rank > 1) parts.push(`\\mathbb{Z}^{${rank}}`);
  for (const n of torsionStructure) parts.push(`\\mathbb{Z}/${n}\\mathbb{Z}`);
  const lhs = `${name}(\\mathbb{Q})`;
  return parts.length ? `${lhs} \\cong ${parts.join(" \\oplus ")}` : `${lhs} = \\{\\mathcal{O}\\}`;
}

export function twistName(d) {
  return `E^{(${d})}`;
}

// How a rank was determined, for badges and tooltips.
export function rankStatus(mw) {
  switch (mw.status) {
    case "descent":
      return { short: "proven", long: "Proven: the 2-descent upper and lower bounds agree." };
    case "gzk":
      return {
        short: "proven",
        long: `Proven: analytic rank ${mw.analytic}, so the rank equals it by Gross–Zagier–Kolyvagin (2-descent alone gave ${mw.lower} ≤ r ≤ ${mw.upper}).`,
      };
    case "bsd":
      return {
        short: "assumes BSD",
        long: `Analytic rank ${mw.analytic}; 2-descent gives ${mw.lower} ≤ r ≤ ${mw.upper}. Rank = analytic rank assumes the Birch–Swinnerton-Dyer conjecture.`,
      };
    default:
      return { short: "undetermined", long: `Not determined: 2-descent gives ${mw.lower} ≤ r ≤ ${mw.upper}.` };
  }
}

export function rankText(mw) {
  return mw.rank >= 0 ? String(mw.rank) : `${mw.lower}–${mw.upper}`;
}

// LMFDB's search box accepts Weierstrass coefficients and redirects to the
// curve's page when the curve is in the database.
export function lmfdbURL(ainvs) {
  return `https://www.lmfdb.org/EllipticCurve/Q/?jump=${encodeURIComponent(coeffText(ainvs))}`;
}

export function shortReal(s, digits = 6) {
  const x = Number(s);
  if (!Number.isFinite(x)) return String(s);
  let t = x.toPrecision(digits);
  if (t.includes(".")) t = t.replace(/0+(?=e|$)/, "").replace(/\.(?=e|$)/, "");
  return t;
}
