\\ ris.gp -- PARI/GP routines for the Rank Increase Simulator.
\\
\\ Loaded once into each PARI worker. The entry points ris_curve() and
\\ ris_twist() return a JSON string so the JavaScript side can JSON.parse it.
\\ Integers and rationals are emitted as JSON strings so that large
\\ coefficients survive the trip into JavaScript without losing precision.

\\ No "increasing stack size" warnings: they share the output stream with the JSON.
default(debugmem, 0);

\\ ---------------------------------------------------------------------------
\\ JSON encoding
\\ ---------------------------------------------------------------------------

ris_esc(s) =
{
  my(v = Vecsmall(s), out = List());
  for (i = 1, #v,
    my(c = v[i]);
    if (c == 34 || c == 92,
      listput(out, 92); listput(out, c),
      if (c < 32, listput(out, 32), listput(out, c))));
  Strchr(Vec(out));
}

ris_json(x) =
{
  my(t = type(x), s);
  if (t == "t_STR", return(Str("\"", ris_esc(x), "\"")));
  if (t == "t_INT" || t == "t_FRAC", return(Str("\"", x, "\"")));
  if (t == "t_REAL", return(Str("\"", strprintf("%.12g", x), "\"")));
  if (t == "t_VECSMALL" || t == "t_LIST", x = Vec(x); t = "t_VEC");
  if (t == "t_VEC" || t == "t_COL",
    if (#x == 0, return("[]"));
    if (x[1] === "__obj__",
      if (#x == 1, return("{}"));
      s = Str(ris_json(x[2][1]), ":", ris_json(x[2][2]));
      for (i = 3, #x, s = Str(s, ",", ris_json(x[i][1]), ":", ris_json(x[i][2])));
      return(Str("{", s, "}")));
    s = ris_json(x[1]);
    for (i = 2, #x, s = Str(s, ",", ris_json(x[i])));
    return(Str("[", s, "]")));
  Str("\"", ris_esc(Str(x)), "\"");
}

\\ An object, stored as ["__obj__", [key, value], ...] and emitted as JSON.
ris_obj(v) = concat([["__obj__"], v]);

\\ ---------------------------------------------------------------------------
\\ Curve invariants
\\ ---------------------------------------------------------------------------

ris_info(E) =
{
  my(N = ellglobalred(E)[1], T = elltors(E));
  ris_obj([
    ["ainvs", E[1..5]],
    ["conductor", N],
    ["disc", E.disc],
    ["j", E.j],
    ["badprimes", factor(N)[, 1]~],
    ["rootno", ellrootno(E)],
    ["torsion", ris_obj([["order", T[1]], ["structure", T[2]], ["gens", T[3]]])]
  ]);
}

\\ ---------------------------------------------------------------------------
\\ Rank and generators
\\ ---------------------------------------------------------------------------

\\ Returns [rank, status, lower, upper, sha2, analytic, points].
\\ status is one of
\\   "descent" -- 2-descent bounds agree, so the rank is proven;
\\   "gzk"     -- analytic rank 0 or 1, so the rank is proven by
\\                Gross-Zagier-Kolyvagin;
\\   "bsd"     -- analytic rank >= 2 (rank = analytic rank assumes BSD);
\\   "unknown" -- the rank could not be pinned down.
ris_rank(E, effort) =
{
  my(R = ellrank(E, effort), rk, status, ar = -1);
  if (R[1] < R[2], R = ellrank(E, effort + 1, R[4]));
  if (R[1] == R[2],
    rk = R[1]; status = "descent",
    ar = ellanalyticrank(E)[1];
    if (ar < R[1] || ar > R[2],
      rk = -1; status = "unknown",
      rk = ar; status = if (ar <= 1, "gzk", "bsd")));
  [rk, status, R[1], R[2], R[3], ar, R[4]];
}

\\ LLL-reduce independent points with respect to the canonical height.
ris_lll(E, V) =
{
  my(U, P);
  if (#V <= 1, return(V));
  U = qflllgram(ellheightmatrix(E, V));
  vector(#U, i,
    P = [0];
    for (j = 1, #V, if (U[j, i], P = elladd(E, P, ellmul(E, V[j], U[j, i]))));
    P);
}

\\ Turn the output of ris_rank into a JSON-ready object. When full != 0 we
\\ also produce generators: a Heegner point if descent found none for a
\\ rank-one curve, then saturation at all primes <= 100 and LLL reduction.
ris_mw(E, K, full) =
{
  my(pts = K[7], H, reg = 1);
  if (full,
    if (K[1] == 1 && #pts == 0, pts = [ellheegner(E)]);
    if (#pts, pts = ris_lll(E, ellsaturation(E, pts, 100))));
  H = vector(#pts, i, ellheight(E, pts[i]));
  if (full && #pts, reg = matdet(ellheightmatrix(E, pts)));
  ris_obj([
    ["rank", K[1]], ["status", K[2]], ["lower", K[3]], ["upper", K[4]],
    ["sha2", K[5]], ["analytic", K[6]], ["gens", pts], ["heights", H],
    ["regulator", if (full && K[1] >= 0 && #pts == K[1], reg, -1)],
    ["complete", K[1] >= 0 && #pts == K[1]], ["full", full != 0]
  ]);
}

\\ ---------------------------------------------------------------------------
\\ Entry points
\\ ---------------------------------------------------------------------------

\\ ai: Weierstrass coefficients [a1,a2,a3,a4,a6] (integers or rationals).
\\ full: also compute saturated, LLL-reduced generators.
ris_curve(ai, effort, full) =
{
  my(E0 = ellinit(ai), E);
  if (E0 == [], error("singular curve: the discriminant is 0"));
  E = ellminimalmodel(E0);
  ris_json(ris_obj([["info", ris_info(E)], ["mw", ris_mw(E, ris_rank(E, effort), full)]]));
}

\\ Quadratic twist of E by the squarefree integer d, via
\\   E^d : y^2 = x^3 - 27 c4 d^2 x - 54 c6 d^3,
\\ reduced to its minimal model. "hit" says whether the rank equals the
\\ target (target >= 4 means "rank at least 4"). The search calls this with
\\ full = 0 and recomputes hits with full = 1 to get generators.
ris_twist(ai, d, effort, target, full) =
{
  my(E = ellinit(ai), T, K, hit);
  T = ellminimalmodel(ellinit([0, 0, 0, -27*E.c4*d^2, -54*E.c6*d^3]));
  K = ris_rank(T, effort);
  hit = K[1] == target || (target >= 4 && K[1] >= 4);
  ris_json(ris_obj([["d", d], ["info", ris_info(T)], ["mw", ris_mw(T, K, full)], ["hit", hit]]));
}
