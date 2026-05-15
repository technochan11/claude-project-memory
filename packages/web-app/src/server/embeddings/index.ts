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
