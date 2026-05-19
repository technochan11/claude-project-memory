import { encodingForModel } from 'js-tiktoken';
import type { ReferenceCategory } from '@cpm/shared';

const CATEGORY_ORDER: { key: ReferenceCategory; heading: string }[] = [
  { key: 'decision', heading: 'Decisions' },
  { key: 'constraint', heading: 'Constraints' },
  { key: 'specification', heading: 'Specifications' },
  { key: 'pattern', heading: 'Patterns' },
  { key: 'todo', heading: 'TODOs' },
];

export interface ReferenceProjectInput {
  display_name: string;
  description: string | null;
  reference_token_budget: number;
}

export interface ReferenceEntryInput {
  category: ReferenceCategory;
  content: string;
}

let encoder: ReturnType<typeof encodingForModel> | null = null;
function getEncoder() {
  if (!encoder) encoder = encodingForModel('gpt-4');
  return encoder;
}

export function countTokens(text: string): number {
  try {
    return getEncoder().encode(text).length;
  } catch {
    // Fallback: rough char-based estimate.
    return Math.ceil(text.length / 4);
  }
}

export function renderReferenceMarkdown(
  project: ReferenceProjectInput,
  entries: ReferenceEntryInput[],
): string {
  const lines: string[] = [];
  lines.push(`# ${project.display_name} — Reference`);
  lines.push('');
  if (project.description) {
    lines.push(project.description.trim());
    lines.push('');
  }

  for (const cat of CATEGORY_ORDER) {
    const items = entries.filter((e) => e.category === cat.key);
    if (items.length === 0) continue;
    lines.push(`## ${cat.heading}`);
    for (const item of items) {
      // Normalize multi-line content into a single bullet (preserve markdown).
      const content = item.content.trim();
      if (content.includes('\n')) {
        const [first, ...rest] = content.split('\n');
        lines.push(`- ${first}`);
        for (const r of rest) lines.push(`  ${r}`);
      } else {
        lines.push(`- ${content}`);
      }
    }
    lines.push('');
  }

  const body = lines.join('\n').trimEnd() + '\n';
  const tokenCount = countTokens(body);
  const footer = [
    '',
    '---',
    `Last updated: ${new Date().toISOString()}`,
    `Token count: ${tokenCount} / ${project.reference_token_budget}`,
    '',
  ].join('\n');
  return body + footer;
}
