// =============================================================================
// SEEDED PRNG — xoshiro128** with splitmix64 seeding
// Deterministic random number generation for replay reconstruction and RL.
// All state is a plain serializable object (lives in GameState).
// =============================================================================

export interface RngState {
  /** 4x 32-bit state for xoshiro128** */
  s: [number, number, number, number];
}

// -----------------------------------------------------------------------------
// SPLITMIX64 — used to initialize xoshiro128** from a single seed
// -----------------------------------------------------------------------------

function splitmix64(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

// -----------------------------------------------------------------------------
// XOSHIRO128** — fast, well-distributed, 128-bit state PRNG
// -----------------------------------------------------------------------------

/** Create a new RNG state from a numeric seed. */
export function createRng(seed: number): RngState {
  const next = splitmix64(seed);
  return { s: [next(), next(), next(), next()] };
}

/** Clone an RNG state (for forking). */
export function cloneRng(state: RngState): RngState {
  return { s: [state.s[0], state.s[1], state.s[2], state.s[3]] };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/**
 * Advance the RNG and return a float in [0, 1).
 * Mutates `state.s` in place for performance.
 */
export function rngNext(state: RngState): number {
  const s = state.s;
  const result = (Math.imul(rotl(Math.imul(s[1], 5), 7), 9)) >>> 0;

  const t = (s[1] << 9) >>> 0;

  s[2] = (s[2] ^ s[0]) >>> 0;
  s[3] = (s[3] ^ s[1]) >>> 0;
  s[1] = (s[1] ^ s[2]) >>> 0;
  s[0] = (s[0] ^ s[3]) >>> 0;

  s[2] = (s[2] ^ t) >>> 0;
  s[3] = rotl(s[3], 11);

  // Convert to [0, 1) — divide by 2^32
  return result / 0x100000000;
}

/**
 * Return a random integer in [0, max).
 * Mutates `state.s` in place.
 */
export function rngNextInt(state: RngState, max: number): number {
  return Math.floor(rngNext(state) * max);
}
