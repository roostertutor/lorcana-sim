// =============================================================================
// SEEDED RNG — Determinism + distribution tests
// =============================================================================

import { describe, it, expect } from "vitest";
import { createRng, rngNext, rngNextInt, cloneRng } from "../utils/seededRng.js";

describe("Seeded RNG (xoshiro128**)", () => {
  it("same seed produces identical sequence of 1000 numbers", () => {
    const rng1 = createRng(42);
    const rng2 = createRng(42);

    for (let i = 0; i < 1000; i++) {
      expect(rngNext(rng1)).toBe(rngNext(rng2));
    }
  });

  it("different seeds produce different sequences", () => {
    const rng1 = createRng(42);
    const rng2 = createRng(99);

    let same = 0;
    for (let i = 0; i < 100; i++) {
      if (rngNext(rng1) === rngNext(rng2)) same++;
    }
    // Statistically impossible for all to match
    expect(same).toBeLessThan(100);
  });

  it("rngNext returns values in [0, 1)", () => {
    const rng = createRng(12345);
    for (let i = 0; i < 10000; i++) {
      const v = rngNext(rng);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("rngNextInt distribution: 10000 calls with max=6, each bucket within 10% of expected", () => {
    const rng = createRng(7);
    const buckets = [0, 0, 0, 0, 0, 0];
    const N = 10000;

    for (let i = 0; i < N; i++) {
      buckets[rngNextInt(rng, 6)]++;
    }

    const expected = N / 6;
    for (let i = 0; i < 6; i++) {
      expect(buckets[i]).toBeGreaterThan(expected * 0.9);
      expect(buckets[i]).toBeLessThan(expected * 1.1);
    }
  });

  it("cloneRng produces an independent copy", () => {
    const rng = createRng(42);
    // Advance a few times
    rngNext(rng);
    rngNext(rng);

    const clone = cloneRng(rng);

    // Both should produce the same next value
    expect(rngNext(rng)).toBe(rngNext(clone));

    // Advancing original doesn't affect clone
    rngNext(rng);
    const cloneVal = rngNext(clone);
    const origVal = rngNext(rng);
    expect(cloneVal).not.toBe(origVal);
  });
});
