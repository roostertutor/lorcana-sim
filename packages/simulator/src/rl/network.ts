// =============================================================================
// NEURAL NETWORK — Simple feedforward net for RL policy gradient
// Architecture: Input → Hidden1 (ReLU) → Hidden2 (ReLU) → Output (linear)
// Uses REINFORCE update rule. All randomness is seeded.
// =============================================================================

import type { RngState } from "@lorcana-sim/engine";
import { rngNext } from "@lorcana-sim/engine";

// -----------------------------------------------------------------------------
// MATH HELPERS
// -----------------------------------------------------------------------------

export function relu(x: number): number {
  return x > 0 ? x : 0;
}

export function softmax(logits: number[]): number[] {
  if (logits.length === 0) return [];
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/** Matrix multiply: (rows × inner) × (inner × cols) → (rows × cols) stored flat */
function matVecMul(
  mat: Float32Array,
  vec: Float32Array,
  rows: number,
  cols: number
): Float32Array {
  const out = new Float32Array(rows);
  for (let r = 0; r < rows; r++) {
    let sum = 0;
    const offset = r * cols;
    for (let c = 0; c < cols; c++) {
      sum += mat[offset + c]! * vec[c]!;
    }
    out[r] = sum;
  }
  return out;
}

/** Clip array values in-place to [-max, +max] */
function clipInPlace(arr: Float32Array, max: number): void {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = Math.max(-max, Math.min(max, arr[i]!));
  }
}

/** Seeded random float in [-scale, +scale] using Xavier init */
function randomFloat32(rng: RngState, scale: number): number {
  return (rngNext(rng) * 2 - 1) * scale;
}

// -----------------------------------------------------------------------------
// NEURAL NETWORK
// -----------------------------------------------------------------------------

export interface NetworkJSON {
  inputSize: number;
  h1Size: number;
  h2Size: number;
  outputSize: number;
  w1: number[];
  b1: number[];
  w2: number[];
  b2: number[];
  w3: number[];
  b3: number[];
}

export class NeuralNetwork {
  readonly inputSize: number;
  readonly h1Size: number;
  readonly h2Size: number;
  readonly outputSize: number;

  // Weights and biases
  private w1: Float32Array; // h1Size × inputSize
  private b1: Float32Array; // h1Size
  private w2: Float32Array; // h2Size × h1Size
  private b2: Float32Array; // h2Size
  private w3: Float32Array; // outputSize × h2Size
  private b3: Float32Array; // outputSize

  constructor(
    inputSize: number,
    h1Size: number,
    h2Size: number,
    outputSize: number,
    rng?: RngState
  ) {
    this.inputSize = inputSize;
    this.h1Size = h1Size;
    this.h2Size = h2Size;
    this.outputSize = outputSize;

    // Xavier initialization
    const initW1 = rng
      ? (i: number) => { void i; return randomFloat32(rng, Math.sqrt(6 / (inputSize + h1Size))); }
      : (_i: number) => (Math.random() * 2 - 1) * Math.sqrt(6 / (inputSize + h1Size));
    const initW2 = rng
      ? (i: number) => { void i; return randomFloat32(rng, Math.sqrt(6 / (h1Size + h2Size))); }
      : (_i: number) => (Math.random() * 2 - 1) * Math.sqrt(6 / (h1Size + h2Size));
    const initW3 = rng
      ? (i: number) => { void i; return randomFloat32(rng, Math.sqrt(6 / (h2Size + outputSize))); }
      : (_i: number) => (Math.random() * 2 - 1) * Math.sqrt(6 / (h2Size + outputSize));

    this.w1 = new Float32Array(h1Size * inputSize);
    this.b1 = new Float32Array(h1Size);
    this.w2 = new Float32Array(h2Size * h1Size);
    this.b2 = new Float32Array(h2Size);
    this.w3 = new Float32Array(outputSize * h2Size);
    this.b3 = new Float32Array(outputSize);

    for (let i = 0; i < this.w1.length; i++) this.w1[i] = initW1(i);
    for (let i = 0; i < this.w2.length; i++) this.w2[i] = initW2(i);
    for (let i = 0; i < this.w3.length; i++) this.w3[i] = initW3(i);
    // Biases start at zero
  }

  /** Forward pass: returns output array of length outputSize */
  forward(input: number[]): number[] {
    const x = new Float32Array(input);

    // Layer 1: W1 * x + b1, then ReLU
    const h1 = matVecMul(this.w1, x, this.h1Size, this.inputSize);
    for (let i = 0; i < this.h1Size; i++) {
      h1[i] = relu(h1[i]! + this.b1[i]!);
    }

    // Layer 2: W2 * h1 + b2, then ReLU
    const h2 = matVecMul(this.w2, h1, this.h2Size, this.h1Size);
    for (let i = 0; i < this.h2Size; i++) {
      h2[i] = relu(h2[i]! + this.b2[i]!);
    }

    // Output: W3 * h2 + b3 (linear)
    const out = matVecMul(this.w3, h2, this.outputSize, this.h2Size);
    for (let i = 0; i < this.outputSize; i++) {
      out[i] = out[i]! + this.b3[i]!;
    }

    return Array.from(out);
  }

  /**
   * REINFORCE policy gradient update.
   * Adjusts weights to increase the probability of the chosen action
   * proportional to the discounted return G.
   *
   * @param input - The input features used during forward pass
   * @param actionIndex - Index of the chosen output (0 for action net)
   * @param G - Discounted return signal (positive = reinforce, negative = discourage)
   * @param lr - Learning rate
   */
  update(input: number[], actionIndex: number, G: number, lr: number): void {
    const x = new Float32Array(input);

    // --- Forward pass (save activations) ---
    const h1Pre = matVecMul(this.w1, x, this.h1Size, this.inputSize);
    const h1 = new Float32Array(this.h1Size);
    for (let i = 0; i < this.h1Size; i++) {
      h1Pre[i] = h1Pre[i]! + this.b1[i]!;
      h1[i] = relu(h1Pre[i]!);
    }

    const h2Pre = matVecMul(this.w2, h1, this.h2Size, this.h1Size);
    const h2 = new Float32Array(this.h2Size);
    for (let i = 0; i < this.h2Size; i++) {
      h2Pre[i] = h2Pre[i]! + this.b2[i]!;
      h2[i] = relu(h2Pre[i]!);
    }

    // --- Backward pass ---
    // Gradient at output layer: for the chosen action, grad = G * lr
    const dOut = new Float32Array(this.outputSize);
    dOut[actionIndex] = G * lr;

    // Clip gradient at each layer to prevent explosion
    const maxGrad = 0.1;
    clipInPlace(dOut, maxGrad);

    // Update W3, b3
    for (let r = 0; r < this.outputSize; r++) {
      for (let c = 0; c < this.h2Size; c++) {
        this.w3[r * this.h2Size + c] += dOut[r]! * h2[c]!;
      }
      this.b3[r] += dOut[r]!;
    }

    // Backprop through layer 2
    const dH2 = new Float32Array(this.h2Size);
    for (let c = 0; c < this.h2Size; c++) {
      let sum = 0;
      for (let r = 0; r < this.outputSize; r++) {
        sum += this.w3[r * this.h2Size + c]! * dOut[r]!;
      }
      dH2[c] = h2Pre[c]! > 0 ? sum : 0; // ReLU derivative
    }
    clipInPlace(dH2, maxGrad);

    // Update W2, b2
    for (let r = 0; r < this.h2Size; r++) {
      for (let c = 0; c < this.h1Size; c++) {
        this.w2[r * this.h1Size + c] += dH2[r]! * h1[c]!;
      }
      this.b2[r] += dH2[r]!;
    }

    // Backprop through layer 1
    const dH1 = new Float32Array(this.h1Size);
    for (let c = 0; c < this.h1Size; c++) {
      let sum = 0;
      for (let r = 0; r < this.h2Size; r++) {
        sum += this.w2[r * this.h1Size + c]! * dH2[r]!;
      }
      dH1[c] = h1Pre[c]! > 0 ? sum : 0; // ReLU derivative
    }
    clipInPlace(dH1, maxGrad);

    // Update W1, b1
    for (let r = 0; r < this.h1Size; r++) {
      for (let c = 0; c < this.inputSize; c++) {
        this.w1[r * this.inputSize + c] += dH1[r]! * x[c]!;
      }
      this.b1[r] += dH1[r]!;
    }
  }

  /** Serialize to JSON-safe object */
  toJSON(): NetworkJSON {
    return {
      inputSize: this.inputSize,
      h1Size: this.h1Size,
      h2Size: this.h2Size,
      outputSize: this.outputSize,
      w1: Array.from(this.w1),
      b1: Array.from(this.b1),
      w2: Array.from(this.w2),
      b2: Array.from(this.b2),
      w3: Array.from(this.w3),
      b3: Array.from(this.b3),
    };
  }

  /** Reconstruct from serialized JSON */
  static fromJSON(json: NetworkJSON): NeuralNetwork {
    const net = new NeuralNetwork(json.inputSize, json.h1Size, json.h2Size, json.outputSize);
    // TS private is compile-time only — direct assignment works at runtime
    (net as unknown as Record<string, Float32Array>)["w1"] = new Float32Array(json.w1);
    (net as unknown as Record<string, Float32Array>)["b1"] = new Float32Array(json.b1);
    (net as unknown as Record<string, Float32Array>)["w2"] = new Float32Array(json.w2);
    (net as unknown as Record<string, Float32Array>)["b2"] = new Float32Array(json.b2);
    (net as unknown as Record<string, Float32Array>)["w3"] = new Float32Array(json.w3);
    (net as unknown as Record<string, Float32Array>)["b3"] = new Float32Array(json.b3);
    return net;
  }

  /** Get weight count for debugging */
  get weightCount(): number {
    return this.w1.length + this.b1.length + this.w2.length + this.b2.length + this.w3.length + this.b3.length;
  }

  /** Get a snapshot of all weights for comparison */
  getWeightSnapshot(): Float32Array {
    const total = this.weightCount;
    const snapshot = new Float32Array(total);
    let offset = 0;
    for (const arr of [this.w1, this.b1, this.w2, this.b2, this.w3, this.b3]) {
      snapshot.set(arr, offset);
      offset += arr.length;
    }
    return snapshot;
  }
}
