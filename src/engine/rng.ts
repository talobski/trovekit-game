/** Deterministic PRNG (sfc32 seeded by cyrb128). Same seed, same sequence, on every platform. */

function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1
  h3 ^= h1
  h4 ^= h1
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
}

export interface Rng {
  /** Float in [0, 1). */
  next(): number
  /** Integer in [0, n). */
  int(n: number): number
  shuffle<T>(items: readonly T[]): T[]
}

export function createRng(seed: string): Rng {
  let [a, b, c, d] = cyrb128(seed)
  const next = () => {
    a >>>= 0
    b >>>= 0
    c >>>= 0
    d >>>= 0
    let t = (a + b) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    d = (d + 1) | 0
    t = (t + d) | 0
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
  const int = (n: number) => Math.floor(next() * n)
  return {
    next,
    int,
    shuffle(items) {
      const out = items.slice()
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1)
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return out
    },
  }
}
