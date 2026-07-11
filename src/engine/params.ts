/**
 * Engine v2 tuning knobs — the single place every match-outcome constant lives.
 *
 * These are ENGINE-INTERNAL tuning parameters only: nothing here is a shared
 * contract shape. Contract-owned constants (POINTS, MORALE_GOAL/ASSIST/CAP,
 * VIRTUAL_MINUTES, MATCH_DURATION_MS, SHOOTOUT_MS) live in the types/contract
 * modules and are imported where needed — deliberately NOT redefined here.
 *
 * Every value is calibrated against Lucca's DECISIONS.md targets and re-swept by
 * the balance harness (see `Balance-check` task / TARGETS in balance.report.ts):
 *   • ~3.4 goals/match total  ⇒  base xG ≈ 1.7 per side at parity
 *   • +10 zonal-strength edge ≈ +0.75 xG to the stronger side
 *   • ~15% of matches level after 90' (all resolved by shootout ⇒ 0 real draws)
 *   • stronger side wins ~55-60%; upsets stay a regular occurrence
 *
 * Units: "zonal strength" is on the player-rating scale (~0-99; a typical XI
 * zone averages high-70s to high-80s), so an "edge" here is measured in rating
 * points — that is what Lucca's "+10 strength" refers to.
 */

// ── Base scoring ──────────────────────────────────────────────────────────────

/** xG for each side in a perfectly even matchup ⇒ 2 × 1.7 = 3.4 goals/game. */
export const BASE_XG_PER_SIDE = 1.7;

/** xG added per point of net zonal-strength edge. +10 edge ⇒ +0.75 xG (0.75/10). */
export const STRENGTH_TO_XG = 0.075;

/** Hard clamps on a side's xG. MAX is deliberately spicy (7a0/38-0 blowout fantasy). */
export const XG_MIN = 0.15;
export const XG_MAX = 5.0;

/**
 * Dixon-Coles low-score correction, realized as a DRAW TRIM. Textbook DC uses a
 * negative ρ to ADD real football's excess 0-0/1-1 draws; Lucca wants the opposite
 * (a spicy game with FEWER dull draws, ~15% pre-shootout). So we invert it: after
 * sampling, a 0-0 or 1-1 is converted to a one-goal win for the higher-xG side with
 * probability `LOW_DRAW_TRIM`. Deterministic (one rng draw), tuned in the harness.
 * Set to 0 to disable and let the strength spread alone set the draw rate.
 */
export const LOW_DRAW_TRIM = 0.55;

// ── Zonal edge composition ────────────────────────────────────────────────────
// A side's attacking xG is driven by its attack zones vs the opponent's defensive
// zones, plus a midfield-control term that tilts overall possession/territory.

/** Weight of (my attack) − (their defense) in the attacking edge. */
export const EDGE_ATTACK_WEIGHT = 0.60;
/** Weight of (my midfield) − (their midfield); controls territory & chance volume. */
export const EDGE_MIDFIELD_WEIGHT = 0.25;
/** Weight of (my defense/GK) − (their attack), i.e. how much a strong back line
 *  suppresses the opponent's xG (applied to the OPPONENT's attacking edge). */
export const EDGE_DEFENSE_WEIGHT = 0.15;

// ── Playing style (defensive / balanced / attacking) ──────────────────────────
// Attacking raises xG BOTH ways (more open) — the main upset generator.

export const STYLE_XG_MULT = {
  defensive: 0.90, // fewer goals for and against
  balanced: 1.0,
  attacking: 1.12, // more goals for and against
} as const;

// ── Line height (the Tier-A extra lever, per DECISIONS/PLAN-engine) ────────────

/** High line pushes average ball position up-field (territory / momentum bias). */
export const LINE_HEIGHT_TERRITORY = { deep: -0.12, mid: 0, high: 0.12 } as const;
/** ...but a high line multiplies the OPPONENT's counter-attack shot quality. */
export const LINE_HEIGHT_COUNTER_MULT = { deep: 0.90, mid: 1.0, high: 1.15 } as const;

// ── Formation matchup ─────────────────────────────────────────────────────────

/** xG swing per net central-midfield body (3-in-midfield vs 2 = +1 ⇒ +K edge).
 *  Bounds tactics so a great shape can beat marginally better players, not a huge
 *  talent gap (DECISIONS Q4 posture). */
export const FORMATION_MID_OVERLOAD_K = 0.06;

// ── Stars (chemistry is DELETED; star power kept as attack-zone shot quality) ──

/** New decompressed scale: Messi 2026 = 92, "very good starters" high-80s, Pelé 97. */
export const STAR_THRESHOLD = 90;
/** Attack-zone xG bump per star in the XI (finishing/clutch), not a flat team buff. */
export const STAR_SHOT_QUALITY = 0.05;

// ── Goal attribution (feeds morale) ───────────────────────────────────────────

/** Probability a goal is unassisted (assistPlayerId omitted). */
export const P_SOLO_GOAL = 0.18;

// ── Penalty shootout (deterministic; every level match resolves) ──────────────

export const SHOOTOUT_ROUNDS = 5; // then sudden death
export const SO_CONV_BASE = 0.75; // conversion at taker 75 vs keeper 75
export const SO_CONV_TAKER_K = 0.010; // per taker-rating point above 75
export const SO_CONV_GK_K = 0.008; // per keeper-rating point above 75 (suppresses)
export const SO_CONV_MIN = 0.30;
export const SO_CONV_MAX = 0.95;

// ── Timeline shaping (watched-match cosmetics; do not affect the scoreline) ────

/** Jitter added to band-center / lane-center when projecting the discrete engine
 *  zone to the continuous ballPosition / ballLane (keeps the marker lively). */
export const BALL_JITTER = 0.06;
/** Center X of each of the 5 internal longitudinal bands (home-attacking frame). */
export const BAND_CENTER_X = [0.10, 0.30, 0.50, 0.70, 0.90] as const;
/** Center Y of the 3 internal lanes L/C/R (home-left = 0 … right = 1). */
export const LANE_CENTER_Y = { L: 0.17, C: 0.50, R: 0.83 } as const;
