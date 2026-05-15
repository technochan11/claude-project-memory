import { Octokit } from '@octokit/rest';
import { SCHEMA_VERSION } from '@cpm/shared';

export interface ValidateTokenResult {
  ok: boolean;
  username?: string;
  error?: string;
}

/**
 * Validates a GitHub token by hitting GET /user and confirming we can list
 * repositories. We don't strictly check scope strings because fine-grained PATs
 * don't return them via headers — instead we verify we can perform the actions
 * we need (read user, list repos).
 */
export async function validateToken(token: string): Promise<ValidateTokenResult> {
  try {
    const octokit = new Octokit({ auth: token });
    const user = await octokit.rest.users.getAuthenticated();
    // Confirm repo read works (this exercises the `repo` / equivalent scope).
    await octokit.rest.repos.listForAuthenticatedUser({ per_page: 1 });
    return { ok: true, username: user.data.login };
  } catch (err: any) {
    const status = err?.status;
    if (status === 401) return { ok: false, error: 'Token rejected by GitHub (invalid or revoked).' };
    if (status === 403) {
      return {
        ok: false,
        error:
          'Token lacks required scope. Need the "repo" scope (classic) or "Contents: read/write" + "Administration: read/write" on the data repo (fine-grained).',
      };
    }
    return { ok: false, error: `GitHub API error: ${err?.message ?? String(err)}` };
  }
}

export interface EnsureRepoResult {
  owner: string;
  repo: string;
  created: boolean;
  full_name: string;
}

/**
 * Ensures the data repo exists. Creates it as a private repo on the
 * authenticated user's account if missing, then writes the .optimizer/ marker
 * files so we know the repo was initialized by this app.
 */
export async function ensureRepo(token: string, repoName: string): Promise<EnsureRepoResult> {
  const octokit = new Octokit({ auth: token });
  const user = await octokit.rest.users.getAuthenticated();
  const owner = user.data.login;

  let created = false;
  try {
    await octokit.rest.repos.get({ owner, repo: repoName });
  } catch (err: any) {
    if (err?.status !== 404) throw err;
    await octokit.rest.repos.createForAuthenticatedUser({
      name: repoName,
      private: true,
      auto_init: true,
      description: 'Claude Project Memory data — managed by claude-project-memory.',
    });
    created = true;
  }

  await ensureFile(
    octokit,
    owner,
    repoName,
    '.optimizer/schema_version',
    SCHEMA_VERSION + '\n',
    'chore: write schema_version marker',
  );

  const readme = [
    '# Claude Project Memory — Data Repository',
    '',
    'This repository is managed by the `claude-project-memory` app. Do not edit',
    'files here by hand — they are regenerated from the local SQLite database on',
    'each sync.',
    '',
    `Schema version: \`${SCHEMA_VERSION}\``,
    '',
    '## Layout',
    '',
    '- `projects/<id>/reference.md` — rendered project reference file',
    '- `projects/<id>/metadata.json` — project metadata',
    '- `projects/<id>/_events.jsonl` — append-only event log',
    '- `projects/<id>/_pending/` — originals during 30-min undo window',
    '- `projects/<id>/_pruned/` — soft-deleted entries (30-day window)',
    '- `_unlinked/` — conversations not yet assigned to a project',
    '',
  ].join('\n');
  await ensureFile(octokit, owner, repoName, '.optimizer/README.md', readme, 'chore: write data repo README');

  return { owner, repo: repoName, created, full_name: `${owner}/${repoName}` };
}

async function ensureFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
): Promise<void> {
  let sha: string | undefined;
  try {
    const existing = await octokit.rest.repos.getContent({ owner, repo, path });
    if (!Array.isArray(existing.data) && 'sha' in existing.data) sha = existing.data.sha;
  } catch (err: any) {
    if (err?.status !== 404) throw err;
  }
  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    sha,
  });
}
