# RESEARCH-determinism.md

**Owner:** game-engine · **Phase:** Multiplayer R2 (research only) · **Date:** 2026-07-12

> THE load-bearing question: **is client-side replay of a match bit-identical across
> browser JS engines (V8/Chrome, JavaScriptCore/Safari, SpiderMonkey/Firefox)?**
> If yes, the architect's model (b) — deterministic client replay over a thin relay —
> is safe. If no, we need server-computed timelines. This doc audits every
> transcendental/float-order dependence in the engine, probes divergence empirically,
> sizes the server-timeline alternative, and recommends.

---

## TL;DR

- The engine is **deterministic across compliant ES2019+ engines in every respect
  except one call: `Math.exp(-lambda)` in the Poisson goal sampler** (`match.ts:25`).
  That is the *only* transcendental anywhere in the client-run path. RNG, xG math,
  scorer attribution, shootout, and all timeline cosmetics use only IEEE-754-exact
  ops (`+ − × ÷`, `Math.imul`, `min/max/round/floor/abs`, integer bit ops), which are
  bit-identical on every conforming engine.
- ECMA-262 declares `Math.exp` **implementation-approximated** — engines may (and do)
  return results differing in the last ~1 ULP. This is a *real, documented* cross-engine
  difference (it is literally used for browser fingerprinting). [1][2][4][5]
- **But it almost never bites us.** Empirically: perturbing `Math.exp` by up to **16 ULP**
  produced **0 outcome divergences over 200,000 matches**. Over **5,000,000** Poisson
  draws the closest any draw came to its decision boundary was a **relative margin of
  1.48 × 10⁻⁷** — about **6.7 × 10⁸ ULPs** away from flipping. Practical per-match desync
  probability is ~**10⁻¹⁵**, i.e. astronomically rare but **not a provable zero**, and a
  single desync has **unbounded consequence** (permanent divergence → wrong bracket).
- **Recommendation: HYBRID, defaulting the online driver to SERVER-COMPUTED TIMELINES.**
  A watched match's timeline is **3.6 KB gzipped**; a client only ever needs the match(es)
  it is watching. Paying ~KB/round to remove the determinism question *entirely* beats
  carrying a 10⁻¹⁵ asterisk plus a cross-browser golden-test burden. Client-replay stays a
  sound fallback (the margin analysis backs it), and if we ever want it, a **20-line
  deterministic-exp polyfill** upgrades the asterisk to a hard zero. Solo mode is
  unaffected (local engine, single machine).

---

## 1. Audit — every determinism-relevant operation in the engine

Scope: the pure code a client would re-execute to replay a match — `rng.ts`, `match.ts`,
`rating.ts`, `timeline.ts`, `morale.ts`, `affinity.ts`, `params.ts`, `types.ts`
(formations). Method: `grep` for every `Math.*` call and `**` operator in `src/engine`
(source only), then read the hot paths.

### 1.1 RNG — `rng.ts` (mulberry32): **bit-identical** ✓
```
s = (s + 0x6d2b79f5) >>> 0;
t = Math.imul(t ^ (t >>> 15), t | 1);
t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
```
Every op is exactly specified: `>>>`/`^`/`|`/`+` are 32-bit integer ops, `Math.imul` is
defined to return the low 32 bits of an exact integer product, and the final `/ 2³²` is a
division by a power of two → exactly representable, correctly rounded, identical on all
engines. `int(max) = Math.floor(next() * max)` — IEEE multiply is correctly rounded and
`floor` is exact, so identical. **The RNG stream is provably engine-independent.**

### 1.2 Transcendentals: exactly one — `Math.exp` in `poisson()` ⚠️
`grep -oE 'Math\.(exp|log|pow|sqrt|sin|cos|tan|...)'` over source finds **`Math.exp` once**
(`match.ts:25`) and **nothing else** — no `log`, `pow`, `sqrt`, `sin`, `cos`, no `**`.
```ts
export function poisson(lambda: number, rng: Rng): number {
  const limit = Math.exp(-lambda);   // ← the ONLY non-exact value in the whole engine
  let k = 0, p = 1;
  do { k++; p *= rng.next(); } while (p > limit);
  return k - 1;
}
```
`p` is a running product of RNG uniforms (exact multiplies, identical everywhere). The
**only** value that can differ across engines is `limit`. Divergence requires the stopping
product `p` (and its predecessor `p_prev`) to *straddle* the tiny interval between two
engines' `limit` values — i.e. `p ≤ limit_A` but `p > limit_B`. λ ∈ [0.15, 4.5] here
(xG clamps), where 1 ULP of `exp(-λ)` ≈ 10⁻¹⁶ … 10⁻¹⁸ (measured below).

### 1.3 Float math outside the sampler: **bit-identical** ✓
- `computeXg` (`match.ts`): only `+ − × ÷` and `clamp` (`min/max`) over doubles → correctly
  rounded, identical. `sampleScore`'s low-draw trim branches on `rng.next() < 0.55` — exact.
- `rating.ts` zonal sums / averages: `+ − × ÷`, division by weight sums — identical.
- `timeline.ts` cosmetics (AR(1) momentum walk, `ballPosition`, `ballLane`, flavour
  events): only `Math.max/min/round/floor/abs` + the derived cosmetic RNG. **No
  transcendentals.** Bit-identical. (`Math.round` is spec'd round-half-toward-+∞,
  deterministic; `Math.floor`/`abs` exact.)
- `morale.ts`, `affinity.ts`, `squad-rating.ts`: `min/max/round/abs` + arithmetic only.

### 1.4 Ordering / iteration determinism: **safe on ES2019+** ✓
- `Array.prototype.sort` is **stable** since ES2019 and in all shipping V8/JSC/SpiderMonkey.
  `buildGoals` additionally uses an explicit `seq` tiebreak, so goal ordering does not even
  depend on sort stability. `events.sort` keys on `minute` only and *does* rely on stability
  to preserve within-minute authored order (goals/shootout) — spec-guaranteed, but worth a
  golden-test assertion.
- `Map`/`Set` iterate in insertion order (spec); `JSON.stringify` emits string keys in
  insertion order (spec). No `for…in` over data objects in hot paths. All deterministic.

**Audit verdict:** one — and only one — cross-engine hazard, `Math.exp` in `poisson()`.

---

## 2. Is `Math.exp` actually different across engines? (web evidence)

Yes, by design and in practice:

- **ECMA-262** classifies `Math.exp` as *implementation-approximated*: the spec pins only
  special cases (NaN/∞/±0) and otherwise lets implementations pick any approximation, "which
  need not be the most accurate representable double value." [3][1]
- **V8 and SpiderMonkey use *different ports* of Sun's `fdlibm`**, so their last-bit results
  can differ; JavaScriptCore/Safari and (historically) Firefox have used the **platform
  system `libm`**, which differs again per-OS. [1][6]
- This is concrete enough that **math routines are a browser/OS fingerprinting vector** —
  Mozilla explicitly moved `sin/cos/tan` to `fdlibm` *to close* the fingerprint, and
  research catalogs cross-browser discrepancies in `Math.*`. [2][4][5] If engines agreed to
  the bit, none of this would exist.

So `limit = Math.exp(-λ)` **can** differ by ~1 ULP between a Chrome player and a Safari
player. The question is whether that ever changes a *match outcome*. → §3.

---

## 3. Empirical probe (V8 / Node v22, v8 12.4)

I instrumented the **real engine** (`resolveMatchOutcome`, `poisson`, `simulateMatchTimeline`)
via a throwaway vitest probe (written, run, deleted — no src change). Method for the ULP
test: monkeypatch `Math.exp` to return `nextUp(exp(x), K)` (K ULPs up, via `DataView` bit
increment) — a faithful proxy for "a different engine's rounding" — then compare full
outcomes for the same seed against unpatched.

**A. Scale of 1 ULP at our λ** (V8 bits):
| λ | exp(−λ) | 1 ULP |
|---|---|---|
| 0.15 | 0.8607079764250578 | 1.1e-16 |
| 1.7  | 0.18268352405273466 | 2.8e-17 |
| 4.5  | 0.011108996538242306 | 1.7e-18 |

**B. Outcome divergence vs ULP error** (real engine, random plausible sides, 8 formations):
| exp error | matches | score diffs | winner diffs | any diff | rate |
|---|---|---|---|---|---|
| 1 ULP  | 200,000 | 0 | 0 | 0 | 0 |
| 2 ULP  | 200,000 | 0 | 0 | 0 | 0 |
| 4 ULP  | 200,000 | 0 | 0 | 0 | 0 |
| 16 ULP | 200,000 | 0 | 0 | 0 | 0 |

Even a **16-ULP** disagreement (far worse than any real fdlibm-vs-libm gap) desynced **0 of
200k** matches.

**C. How close do we come to the razor?** Over **5,000,000** Poisson draws across the λ range,
the *minimum* relative margin between the stopping product and the decision boundary was
**1.484 × 10⁻⁷**. That is ~**6.7 × 10⁸ ULPs**. Number of draws that came within 1 ULP of
flipping: **0**. Interpreting the tail linearly, per-draw flip probability at 1 ULP is
~**10⁻¹⁶**; at ~2 draws/match and ~288 matches/tournament, ~**10⁻¹³ per tournament** — real
but negligible.

**D. Server-timeline wire size** (real `simulateMatchTimeline`, gzip via `zlib`):
| unit | raw | gzip |
|---|---|---|
| one match timeline (91 ticks + events + box) | 13.0 KB | **3.6 KB** |
| full 48-match round (sum of per-match gzip) | 623 KB | 171 KB |
| full 48-match round (one gzip blob) | 623 KB | **153 KB** |
| replay wire (seed + both sides' inputs) | — | **~hundreds of bytes / round** |

Crucially, **a client only needs the timeline of the match it is watching** (fixed
wall-clock playback shows one featured match at a time; spectators likewise watch one at a
time) → realistic per-client cost is **~3.6 KB per watched match**, *not* 153 KB. The bracket
table for the other 47 matches is a few hundred bytes of scores.

> **Environment caveat:** I could only *execute* V8 here (Node). The ULP-perturbation is a
> proxy for cross-engine differences; it does not prove Safari/JSC and Firefox/Gecko agree on
> real hardware. Confirming that is a **cross-browser golden-hash test** — QA's
> `RESEARCH-testing.md` item. My audit says the *only* thing that test can catch is a
> `poisson` boundary flip, and §3B/C say that is ~10⁻¹⁵-rare.

---

## 4. Options compared

### Option 1 — Client-side deterministic replay (relay broadcasts `{matchSeed, inputs}`)
Architect's model (b). Clients re-run the pure engine from the canonical
`matchSeed(tournamentSeed, round, matchIndex)` + both sides' drafted XI/tactics.
- **Pros:** tiniest wire (~hundreds of bytes/round); zero server compute; naturally offline;
  reuses the exact solo code path.
- **Cons:** correctness rests on the `Math.exp` asterisk (§3: ~10⁻¹⁵/match, **nonzero**, and a
  single desync is **permanent** and silent — two players see different brackets). Requires a
  **cross-browser golden test** + a strict **engine-version handshake** (any param change —
  e.g. an affinity retune — changes outcomes, so every client must run identical engine
  code). Mixing engines in one room (Chrome host, Safari peer) is where the tail risk lives.
- **Hardening (Option 1a):** replace the one `Math.exp` in `poisson` with a **deterministic
  pure-JS `exp`** — range-reduce + fixed minimax polynomial, all IEEE-exact ops, so every
  engine returns identical bits (λ only ∈ [−4.5, 0], a tiny domain → ~15–25 lines). Upgrades
  the 10⁻¹⁵ asterisk to a **hard zero** while keeping the hundreds-of-bytes wire. Golden test
  still wanted as a regression guard, but correctness no longer *depends* on it.

### Option 2 — Server-computed timelines (clients never recompute)
Server runs the same pure engine once per match (ms-scale for 48 matches on a Supabase Edge
Function / any Node worker), broadcasts the resulting `MatchTimeline`; clients only render.
- **Pros:** determinism removed from the trust model **entirely** — engine differences,
  version skew, and JSC/Gecko quirks become irrelevant. The authoritative result *is* the
  server's computation. Timeline is plain data, so **late-join / seek / spectator** fall out
  for free (`pure(timeline, now−startAt)`), and ranked **certification** is already this path.
- **Cons:** server must run the engine (trivial, same module); ~**3.6 KB gzip per watched
  match** of egress; needs the engine to run server-side (it already can — it's pure TS).

### Option 3 — Integer-only / fixed-point engine core
Rewrite Poisson + xG in fixed-point to dodge floats entirely.
- **Rejected:** large, invasive rewrite and a balance re-tune, for a guarantee that Option
  1a already buys in ~20 lines. No justification at our scale.

---

## 5. Recommendation — HYBRID (server-timelines as the online default)

| Mode | Driver | Wire format | Why |
|---|---|---|---|
| **Solo** | Local | none (in-proc engine) | single machine; determinism moot; code unchanged |
| **MP — casual / MVP** | Online | **server-computed timelines** | ~3.6 KB/watched match kills the determinism question outright and powers spectator/seek; client-replay's only edge (wire size) is irrelevant at KB scale |
| **MP — ranked / certified** | Online | **server-computed timelines** (authoritative) | server is already the source of truth for certification; same path |

**This mildly inverts the architect's (b)-first lean, and here's the number that drives it:**
a watched timeline is 3.6 KB. Paying that to make cross-engine determinism a *non-issue
forever* is a better trade than shipping client-replay and then owing (a) a deterministic-exp
polyfill, (b) a cross-browser golden CI test, and (c) a hard engine-version lock — all to
manage a 10⁻¹⁵ risk whose failure mode is a silent permanent desync.

**Client-replay is NOT off the table** — §3 shows it is empirically sound, and the architect's
thin-relay design is the right shape if we ever want to cut server compute or go
bandwidth-minimal. If we choose it, **do Option 1a (polyfill) first** and gate a room to a
single wire mode (never mix replay and server-timeline peers in one room).

**Engineering seam (shared with architect's driver abstraction):** both options keep the pure
engine untouched; they differ only in *who calls it*. `OnlineDriver` either (2) receives
`{timeline}` and feeds the existing playback, or (1) receives `{seed, inputs}` and calls
`simulateMatchTimeline` locally. Playback core is identical either way — which is exactly why
`sync-playback.md` should be able to prove ~zero `playback.ts` changes.

---

## 6. Open questions / handoffs

1. **Cross-browser golden test (QA, `RESEARCH-testing.md`).** Run a fixed seed-batch through
   the engine on *real* Chrome, Safari, Firefox (BrowserStack/Playwright) and compare a hash
   of each `MatchTimeline`. I proved V8-vs-V8 identity and ULP-robustness; this confirms JSC
   and Gecko on hardware. Only needed if we adopt client-replay (Option 1); harmless as a
   guard regardless.
2. **Version handshake (architect, `RESEARCH-protocol.md`).** Client-replay requires an exact
   engine-version match per room (any `params.ts`/`affinity.ts` change alters outcomes).
   Server-timelines makes this moot (single computation). Recommend an engine-version field in
   the join handshake either way, to refuse skewed clients.
3. **Server runtime for the engine.** Confirm the pure engine imports run in the chosen
   transport's server env (Supabase Edge = Deno; PartyKit/DO = workers). It's dependency-free
   TS, so expected trivial — flag to `RESEARCH-transport.md`.
4. **Do NOT mix engines within a room.** If some peers replay (their local V8/JSC) and others
   render a Node-computed timeline, they could disagree at the ~10⁻¹⁵ level. Pick one wire
   mode per room; server-timelines avoids the question.
5. **Seek/late-join (sync-playback owner).** Server-timelines make arbitrary seek trivial
   (`pure(timeline, elapsedMs)` on static data) — verify the playback core already supports
   mid-match seek so a reconnecting/late spectator can jump to `now`.
6. **Codec.** gzip gave 3.6 KB/match; Brotli would shave more, but 3.6 KB is already
   comfortably below any concern — not worth optimizing pre-MVP.

---

## Sources
1. Tom MacWright, *"Math keeps changing"* (V8 & SpiderMonkey use different fdlibm ports) — https://macwright.com/2020/02/14/math-keeps-changing
2. Mozilla, *Intent to Implement: use fdlibm for Math.cos/sin/tan to prevent math-based fingerprinting* — https://groups.google.com/a/mozilla.org/g/dev-platform/c/0dxAO-JsoXI/m/eEhjM9VsAgAJ
3. ECMA-262 (ECMAScript 2025), §Math — *implementation-approximated* functions — https://ecma-international.org/wp-content/uploads/ECMA-262_16th_edition_june_2025.pdf
4. *Fingerprinting Math Routines* (math functions are OS/browser-fingerprintable) — https://privacycheck.sec.lrz.de/active/fp_mr/fp_math_routines.html
5. Bruce Dawson, *Floating Point in the Browser, Part 1: Impossible Expectations* — https://randomascii.wordpress.com/2020/09/27/floating-point-in-the-browser-part-1-impossible-expectations/
6. Mozilla Bugzilla #291003, *may want to use native libm instead of mozilla-provided fdlibm* — https://bugzilla.mozilla.org/show_bug.cgi?id=291003

*(Empirical numbers in §3 measured locally on Node v22.12 / V8 12.4 against the actual
`src/engine` at this commit, via a throwaway probe that was removed; no `src/` changes in
this phase.)*
