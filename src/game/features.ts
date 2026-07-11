/**
 * Feature flags for the Last11 redesign (CONTRACT §7, PLAN-architecture).
 *
 * All OFF by default: with every flag OFF `main` runs the shipped Tier-1 game
 * (12×12 coarse squads, flat-0.75 off-position, fixed 4-3-3, Poisson engine).
 * Each v2 workstream sits behind its own flag so a half-finished stream can be
 * merged dark and the demo never breaks.
 *
 * Ownership note: worker-7 (integrator) owns the flag MATRIX and its enforcement
 * (flipping flags ON for the demo, the regression gate that all-OFF == today).
 * worker-6 seeded this file to land the data-v2 layer behind `dataV2`; if worker-7
 * relocates these into `flags.ts`, keep the `dataV2` name — the data loader reads it.
 */
export interface FeatureFlags {
  /** New squads-by-(nation,year) dataset + detailed positions. OFF ⇒ old 12×12. */
  dataV2: boolean;
  /** Affinity matrix + tactics-aware zonal engine + timeline. OFF ⇒ Poisson v1. */
  engineV2: boolean;
  /** Free pick-then-place draft, formations, styles, year roll. OFF ⇒ slot-walk. */
  draftV2: boolean;
  /** On-screen 2D match playback. OFF ⇒ instant scoreline reveal. */
  simV2: boolean;
}

export const FEATURES: FeatureFlags = {
  dataV2: false,
  engineV2: false,
  draftV2: false,
  simV2: false,
};
