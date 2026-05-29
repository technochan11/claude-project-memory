/**
 * Local LLM service for AI-assisted seed entry generation.
 *
 * Lazy-loads a small Qwen2.5 instruction model via @xenova/transformers and
 * exposes a single `generateSeedEntries()` function. Mirrors the singleton
 * pattern used by ../embeddings/index.ts.
 *
 * Loading is never triggered automatically by importing this module — callers
 * must call startDownload() (Settings page download button, or server startup
 * auto-warm when ai_enabled === 'true').
 */
import { z } from 'zod';
import { SeedEntryInputSchema, type SeedEntryInput } from '@cpm/shared';

export const MODEL_PRIMARY = 'Xenova/Qwen2.5-1.5B-Instruct';
export const MODEL_FALLBACK = 'Xenova/Qwen2.5-0.5B-Instruct';

export type ModelState = 'not_downloaded' | 'downloading' | 'ready' | 'unloaded';

export interface ModelStatus {
  state: ModelState;
  progress?: number;
  model?: string;
}

export class ModelNotLoadedError extends Error {
  constructor() {
    super('Local AI model is not loaded.');
    this.name = 'ModelNotLoadedError';
  }
}

export class GenerationParseError extends Error {
  constructor(reason: string) {
    super(`Could not parse model output as valid seed entries: ${reason}`);
    this.name = 'GenerationParseError';
  }
}

interface MinimalLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

type TextGenerationPipeline = ((
  prompt: string,
  opts?: Record<string, unknown>,
) => Promise<Array<{ generated_text: string }> | { generated_text: string }>) & {
  tokenizer: {
    apply_chat_template: (
      messages: Array<{ role: string; content: string }>,
      opts?: { tokenize?: boolean; add_generation_prompt?: boolean },
    ) => string;
  };
};

let generator: TextGenerationPipeline | null = null;
let state: ModelState = 'not_downloaded';
let progress = 0;
let activeModel: string | undefined;
let loading: Promise<void> | null = null;

// Aggregate progress across all model files (transformers.js fires per-file
// events; without aggregation the bar would jump back to 0% on each new file).
const fileProgress = new Map<string, { loaded: number; total: number }>();

function recomputeProgress(): void {
  let loaded = 0;
  let total = 0;
  for (const v of fileProgress.values()) {
    loaded += v.loaded;
    total += v.total;
  }
  progress = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
}

function makeProgressCallback() {
  return (ev: { status?: string; file?: string; loaded?: number; total?: number; progress?: number }) => {
    const file = ev.file;
    if (!file) return;
    if (ev.status === 'progress' && typeof ev.loaded === 'number' && typeof ev.total === 'number' && ev.total > 0) {
      fileProgress.set(file, { loaded: ev.loaded, total: ev.total });
      recomputeProgress();
    } else if (ev.status === 'done') {
      const cur = fileProgress.get(file);
      if (cur) fileProgress.set(file, { loaded: cur.total, total: cur.total });
      recomputeProgress();
    }
  };
}

export function getModelStatus(): ModelStatus {
  return {
    state,
    ...(state === 'downloading' ? { progress } : {}),
    ...(activeModel ? { model: activeModel } : {}),
  };
}

export function startDownload(logger: MinimalLogger): Promise<void> {
  if (state === 'ready' && generator) return Promise.resolve();
  if (loading) return loading;

  state = 'downloading';
  progress = 0;
  fileProgress.clear();

  loading = (async () => {
    const { pipeline } = await import('@xenova/transformers');
    const tryLoad = async (model: string): Promise<TextGenerationPipeline> => {
      logger.info({ model }, 'llm: loading model');
      // transformers.js v2: `quantized: true` (default) loads the int8 ONNX
      // variant — the smallest/fastest weights the Xenova ports publish. The
      // v3 `dtype: 'q4'` option isn't honored on v2, so we pin the explicit
      // v2 equivalent rather than letting auto-selection decide.
      const p = (await pipeline('text-generation', model, {
        quantized: true,
        progress_callback: makeProgressCallback(),
      })) as unknown as TextGenerationPipeline;
      return p;
    };

    try {
      generator = await tryLoad(MODEL_PRIMARY);
      activeModel = MODEL_PRIMARY;
    } catch (errPrimary: unknown) {
      logger.warn(
        { err: String((errPrimary as Error)?.message ?? errPrimary), model: MODEL_PRIMARY },
        'llm: primary model load failed, falling back',
      );
      fileProgress.clear();
      progress = 0;
      try {
        generator = await tryLoad(MODEL_FALLBACK);
        activeModel = MODEL_FALLBACK;
      } catch (errFallback: unknown) {
        state = 'not_downloaded';
        generator = null;
        activeModel = undefined;
        logger.error(
          { err: String((errFallback as Error)?.message ?? errFallback) },
          'llm: fallback model load failed',
        );
        throw errFallback;
      }
    }
    state = 'ready';
    progress = 100;
    logger.info({ model: activeModel }, 'llm: model ready');
  })().finally(() => {
    loading = null;
  });

  return loading;
}

export function unload(): void {
  generator = null;
  activeModel = undefined;
  state = 'unloaded';
  progress = 0;
  fileProgress.clear();
}

const SYSTEM_PROMPT =
  'You generate seed reference entries for a project memory system. Output JSON only, no preamble, no markdown fences.';

function userPrompt(displayName: string, description: string): string {
  return `Generate 5-8 reference entries that capture the most important decisions, constraints, specifications, and patterns implied by the project description.

Each entry must be:
- Specific (no generic platitudes)
- Concrete (something you could verify later)
- Self-contained (readable without context)
- One sentence

Categorize each as: decision, constraint, specification, pattern, or todo.

Avoid:
- Vague entries like "build a good product"
- Restating the description
- Generic best practices not implied by the description

Project name: ${displayName}
Description: ${description}

Output schema:
[{"content": "...", "category": "decision", "confidence": 0.85}]`;
}

/**
 * Best-effort repair of an LLM JSON response. Handles common quirks:
 *  - leading prose / "Here is the JSON:"
 *  - markdown code fences (```json ... ```)
 *  - truncation past the last valid bracket
 *  - trailing commas
 */
export function repairAndParse(raw: string): SeedEntryInput[] {
  let s = raw.trim();

  // Strip code fences.
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');

  // Locate the first array opener; drop any prose before it.
  const firstBracket = s.indexOf('[');
  if (firstBracket === -1) throw new GenerationParseError('no JSON array found');
  s = s.slice(firstBracket);

  // Walk to find the matching closing bracket, accounting for strings.
  let depth = 0;
  let lastValid = -1;
  let inStr = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0 && ch === ']') lastValid = i;
    }
  }
  if (lastValid === -1) throw new GenerationParseError('unbalanced JSON brackets');
  s = s.slice(0, lastValid + 1);

  // Strip trailing commas before ] or }.
  s = s.replace(/,(\s*[\]}])/g, '$1');

  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (err: unknown) {
    throw new GenerationParseError(String((err as Error)?.message ?? err));
  }

  const schema = z.array(SeedEntryInputSchema).min(1);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new GenerationParseError(result.error.issues.map((i) => i.message).join('; '));
  }
  return result.data;
}

async function runGeneration(prompt: string): Promise<string> {
  if (!generator) throw new ModelNotLoadedError();
  const out = await generator(prompt, {
    max_new_tokens: 800,
    temperature: 0.3,
    do_sample: true,
    top_p: 0.9,
    return_full_text: false,
  });
  const first = Array.isArray(out) ? out[0] : out;
  return first?.generated_text ?? '';
}

export async function generateSeedEntries(
  displayName: string,
  description: string,
): Promise<SeedEntryInput[]> {
  if (state !== 'ready' || !generator) throw new ModelNotLoadedError();

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt(displayName, description) },
  ];
  const prompt = generator.tokenizer.apply_chat_template(messages, {
    tokenize: false,
    add_generation_prompt: true,
  });

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await runGeneration(prompt);
    try {
      return repairAndParse(raw);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof GenerationParseError
    ? lastErr
    : new GenerationParseError(String((lastErr as Error)?.message ?? lastErr));
}
