/**
 * Embeddings service.
 *
 * Loads the Xenova/all-MiniLM-L6-v2 model on startup, then exposes a single
 * `embed(text)` function returning a 384-dimensional Float32Array.
 *
 * NOTE: First launch on a new machine downloads ~20MB from Hugging Face. Expect
 * 30s–2min before `isReady()` flips to true. Subsequent launches use the cached
 * model from `~/.cache/huggingface/` and are fast (< 1s).
 */
import { EMBEDDINGS_MODEL } from '@cpm/shared';

type FeatureExtractionPipeline = (
  text: string | string[],
  opts?: { pooling?: 'mean' | 'cls' | 'none'; normalize?: boolean },
) => Promise<{ data: Float32Array }>;

let pipelineFn: FeatureExtractionPipeline | null = null;
let ready = false;
let loading: Promise<void> | null = null;

export function isReady(): boolean {
  return ready;
}

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export function startWarmup(logger: MinimalLogger): void {
  if (loading || ready) return;
  loading = (async () => {
    const start = Date.now();
    logger.info({ model: EMBEDDINGS_MODEL }, 'embeddings: loading model');
    const { pipeline } = await import('@xenova/transformers');
    pipelineFn = (await pipeline('feature-extraction', EMBEDDINGS_MODEL)) as unknown as FeatureExtractionPipeline;
    ready = true;
    logger.info({ ms: Date.now() - start }, 'embeddings: model ready');
  })().catch((err) => {
    logger.error({ err: String(err) }, 'embeddings: failed to load model');
  });
}

export async function embed(text: string): Promise<Float32Array> {
  if (!pipelineFn) throw new Error('Embeddings model not ready yet');
  const out = await pipelineFn(text, { pooling: 'mean', normalize: true });
  return out.data;
}

/** Cosine similarity of two equal-length vectors. Assumes pre-normalized inputs (returns dot product). */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error(`cosine: length mismatch ${a.length} vs ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** L2-normalize in place and return the same buffer. */
export function l2normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  const n = Math.sqrt(s);
  if (n === 0) return v;
  for (let i = 0; i < v.length; i++) v[i] = v[i]! / n;
  return v;
}

/** Weighted sum of vectors, then L2-normalize. */
export function weightedCentroid(items: { vec: Float32Array; weight: number }[]): Float32Array {
  if (items.length === 0) throw new Error('weightedCentroid: empty');
  const dim = items[0]!.vec.length;
  const out = new Float32Array(dim);
  for (const { vec, weight } of items) {
    for (let i = 0; i < dim; i++) {
      out[i] = (out[i] ?? 0) + (vec[i] ?? 0) * weight;
    }
  }
  return l2normalize(out);
}

export function bytesFromVec(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export function vecFromBytes(b: Buffer): Float32Array {
  // Copy to avoid aliasing with the SQLite-owned buffer.
  const copy = Buffer.from(b);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}
