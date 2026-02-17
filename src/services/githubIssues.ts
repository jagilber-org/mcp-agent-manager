// mcp-agent-manager/src/services/githubIssues.ts
// GitHub issue creation from review queue items.
// Uses the GitHub REST API with a personal access token (GITHUB_TOKEN env var).
// The target repo can be specified per-call, via GITHUB_REPO env var, or auto-detected from git remote.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from './logger.js';
import type { ReviewItem } from '../types/automation.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubIssueResult {
  success: boolean;
  issueNumber?: number;
  issueUrl?: string;
  error?: string;
}

export interface CreateIssueOptions {
  /** GitHub owner/repo (e.g. "jagilber-org/mcp-agent-manager"). Auto-detected if omitted. */
  repo?: string;
  /** Extra labels to add */
  labels?: string[];
  /** Workspace path - used to auto-detect repo from git remote */
  workspacePath?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getToken(): string | undefined {
  return process.env.GITHUB_TOKEN;
}

function getDefaultRepo(): string | undefined {
  return process.env.GITHUB_REPO;
}

/** Whether auto-creation of GitHub issues is enabled */
export function isAutoIssueEnabled(): boolean {
  return process.env.GITHUB_AUTO_ISSUE === 'true' || process.env.GITHUB_AUTO_ISSUE === '1';
}

/** Detect owner/repo from git remote origin in a workspace directory */
async function detectRepoFromGit(workspacePath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
      cwd: workspacePath,
      timeout: 5_000,
    });
    const url = stdout.trim();
    // Match SSH or HTTPS patterns
    const match = url.match(/github\.com[/:]([^/]+\/[^/.\s]+?)(?:\.git)?$/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/** Build issue title from a review item */
function buildTitle(item: ReviewItem): string {
  const status = item.executionStatus === 'failed' ? '🔴 Failed' : '✅ Success';
  return `[Agent Review] ${status}: ${item.ruleId} → ${item.skillId}`;
}

/** Build issue body from a review item */
function buildBody(item: ReviewItem): string {
  const lines: string[] = [
    `## Agent Task Review`,
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| **Review ID** | \`${item.reviewId}\` |`,
    `| **Rule** | \`${item.ruleId}\` |`,
    `| **Skill** | \`${item.skillId}\` |`,
    `| **Agent** | \`${item.agentId || 'unknown'}\` |`,
    `| **Execution Status** | ${item.executionStatus} |`,
    `| **Review Status** | ${item.status} |`,
    `| **Duration** | ${item.durationMs ? (item.durationMs / 1000).toFixed(1) + 's' : 'n/a'} |`,
    `| **Created** | ${item.createdAt} |`,
    '',
  ];

  if (item.resultSummary) {
    lines.push(`### Result Summary`, '', '```', item.resultSummary.substring(0, 4000), '```', '');
  }

  if (item.error) {
    lines.push(`### Error`, '', '```', item.error.substring(0, 2000), '```', '');
  }

  if (item.notes) {
    lines.push(`### Reviewer Notes`, '', item.notes, '');
  }

  lines.push('---', '*Created by [mcp-agent-manager](https://github.com/jagilber-org/mcp-agent-manager) review queue*');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a GitHub issue from a review item.
 * Requires GITHUB_TOKEN env var. Repo is auto-detected from git remote,
 * GITHUB_REPO env var, or the `options.repo` parameter.
 */
export async function createIssueFromReview(
  item: ReviewItem,
  options: CreateIssueOptions = {},
): Promise<GitHubIssueResult> {
  const token = getToken();
  if (!token) {
    return { success: false, error: 'GITHUB_TOKEN environment variable is not set' };
  }

  // Resolve repo: explicit > env var > git remote detection
  let repo = options.repo || getDefaultRepo();
  if (!repo && options.workspacePath) {
    repo = await detectRepoFromGit(options.workspacePath);
  }
  if (!repo) {
    return { success: false, error: 'Cannot determine GitHub repo. Set GITHUB_REPO env var or pass repo option.' };
  }

  const labels = ['agent-review'];
  if (item.executionStatus === 'failed') labels.push('bug');
  if (item.status === 'flagged') labels.push('flagged');
  if (options.labels) labels.push(...options.labels);

  const title = buildTitle(item);
  const body = buildBody(item);

  try {
    const url = `https://api.github.com/repos/${repo}/issues`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'mcp-agent-manager',
      },
      body: JSON.stringify({ title, body, labels }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      logger.error(`GitHub issue creation failed (${response.status}): ${errBody}`);
      return { success: false, error: `GitHub API ${response.status}: ${errBody.substring(0, 200)}` };
    }

    const data = await response.json() as { number: number; html_url: string };
    logger.info(`[GitHub] Created issue #${data.number}: ${data.html_url}`);
    return { success: true, issueNumber: data.number, issueUrl: data.html_url };
  } catch (err) {
    const msg = (err as Error).message;
    logger.error(`GitHub issue creation error: ${msg}`);
    return { success: false, error: msg };
  }
}
