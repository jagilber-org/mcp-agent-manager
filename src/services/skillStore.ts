// mcp-agent-manager/src/services/skillStore.ts
// Manages skill definitions - reusable prompt templates with routing config
// Dual-writes to disk AND mcp-index-server (when available) for redundancy.
// On corrupted disk load, attempts recovery from mcp-index-server first.

import * as fs from 'fs';
import * as path from 'path';
import { SkillDefinition, RoutingStrategy } from '../types/index.js';
import { logger } from './logger.js';
import { eventBus } from './events.js';
import { getSkillsDir } from './dataDir.js';
import { watchConfigFile, ConfigWatcher } from './configWatcher.js';
import { indexClient } from './indexClient.js';

const SKILLS_DIR = getSkillsDir();
const SKILLS_FILE = path.join(SKILLS_DIR, 'skills.json');
const INDEX_SKILLS_KEY = 'mgr:skills:all';

class SkillStore {
  private skills: Map<string, SkillDefinition> = new Map();
  private loaded = false;
  private configWatcher: ConfigWatcher | null = null;

  /** Load skills from disk - falls back to mcp-index-server on corruption */
  load(): void {
    if (!fs.existsSync(SKILLS_DIR)) {
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
    }

    let loadedFromDisk = false;

    if (!fs.existsSync(SKILLS_FILE)) {
      // Check for backup if primary is missing
      const backupFile = SKILLS_FILE + '.bak';
      if (fs.existsSync(backupFile)) {
        logger.warn(`[SkillStore] ${SKILLS_FILE} missing but backup exists — restoring`);
        fs.copyFileSync(backupFile, SKILLS_FILE);
      }
    }

    if (fs.existsSync(SKILLS_FILE)) {
      try {
        const raw = fs.readFileSync(SKILLS_FILE, 'utf-8');
        const arr: SkillDefinition[] = JSON.parse(raw);
        if (Array.isArray(arr)) {
          // If file is empty but backup has data, recover
          if (arr.length === 0) {
            const backupFile = SKILLS_FILE + '.bak';
            if (fs.existsSync(backupFile)) {
              try {
                const bakArr: SkillDefinition[] = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));
                if (bakArr.length > 0) {
                  logger.warn(`[SkillStore] skills.json is empty but backup has ${bakArr.length} skills — restoring`);
                  fs.copyFileSync(backupFile, SKILLS_FILE);
                  for (const skill of bakArr) this.skills.set(skill.id, skill);
                  loadedFromDisk = true;
                }
              } catch { /* backup corrupt */ }
            }
          } else {
            for (const skill of arr) {
              this.skills.set(skill.id, skill);
            }
            loadedFromDisk = true;
          }
          if (loadedFromDisk) logger.info(`Loaded ${this.skills.size} skills from disk`);
        } else {
          throw new Error('skills.json is not an array');
        }
      } catch (err) {
        logger.error('Failed to load skills from disk - attempting index-server recovery', { error: String(err) });
        // Try index-server recovery (async, but we block on it)
        this.recoverFromIndex().catch(() => {});
      }
    }

    if (!loadedFromDisk && this.skills.size === 0) {
      // Seed with built-in skills only if no recovery happened
      this.seedDefaults();
      this.persist();
    }

    this.loaded = true;

    // Initial sync to index-server (fire-and-forget)
    if (loadedFromDisk) {
      this.syncToIndex().catch(() => {});
    }

    // Watch for external file changes (other instances, manual edits)
    if (!this.configWatcher) {
      this.configWatcher = watchConfigFile(SKILLS_FILE, () => this.reload(), 'skills');
    }
  }

  /** Reload skills from disk when the file changes externally */
  private reload(): void {
    if (!fs.existsSync(SKILLS_FILE)) return;
    try {
      const raw = fs.readFileSync(SKILLS_FILE, 'utf-8');
      const arr: SkillDefinition[] = JSON.parse(raw);

      // If external change wiped to empty and we have skills in memory, don't wipe
      if (arr.length === 0 && this.skills.size > 0) {
        logger.warn(`[SkillStore] External change wiped skills.json to empty — ignoring (have ${this.skills.size} skills in memory)`);
        return;
      }

      this.skills.clear();
      for (const skill of arr) {
        this.skills.set(skill.id, skill);
      }
      logger.info(`Reloaded ${this.skills.size} skills from disk (external change)`);
    } catch (err) {
      logger.error('Failed to reload skills', { error: String(err) });
    }
  }

  /** Persist skills to disk AND sync to mcp-index-server */
  private persist(): void {
    try {
      if (!fs.existsSync(SKILLS_DIR)) {
        fs.mkdirSync(SKILLS_DIR, { recursive: true });
      }
      this.configWatcher?.markSelfWrite();
      const arr = Array.from(this.skills.values());

      // Safety: backup before overwriting non-empty file with empty array
      if (arr.length === 0 && fs.existsSync(SKILLS_FILE)) {
        try {
          const existing = fs.readFileSync(SKILLS_FILE, 'utf-8').trim();
          if (existing !== '[]' && existing !== '') {
            const backupFile = SKILLS_FILE + '.bak';
            fs.copyFileSync(SKILLS_FILE, backupFile);
            logger.warn(`[SkillStore] Writing empty skills array — backed up ${SKILLS_FILE} → ${backupFile}`);
          }
        } catch { /* file unreadable, skip backup */ }
      }

      fs.writeFileSync(SKILLS_FILE, JSON.stringify(arr, null, 2), 'utf-8');
      logger.debug(`Persisted ${arr.length} skills`);
    } catch (err) {
      logger.error('Failed to persist skills', { error: String(err) });
    }
    // Dual-write to index-server (fire-and-forget, non-blocking)
    this.syncToIndex().catch(() => {});
  }

  /** Stop watching config file */
  close(): void {
    this.configWatcher?.close();
    this.configWatcher = null;
  }

  /** Register or update a skill */
  register(skill: SkillDefinition): void {
    this.skills.set(skill.id, skill);
    this.persist();
    logger.info(`Registered skill: ${skill.id} (${skill.strategy})`);
    eventBus.emitEvent('skill:registered', { skillId: skill.id, name: skill.name, strategy: skill.strategy });
  }

  /** Remove a skill */
  remove(skillId: string): boolean {
    const existed = this.skills.delete(skillId);
    if (existed) {
      this.persist();
      logger.info(`Removed skill: ${skillId}`);
      eventBus.emitEvent('skill:removed', { skillId });
    }
    return existed;
  }

  /** Get a skill by ID */
  get(skillId: string): SkillDefinition | undefined {
    if (!this.loaded) this.load();
    return this.skills.get(skillId);
  }

  /** List all skills */
  list(category?: string): SkillDefinition[] {
    if (!this.loaded) this.load();
    const all = Array.from(this.skills.values());
    if (category) {
      return all.filter(s => s.categories.includes(category));
    }
    return all;
  }

  /** Search skills by keyword */
  search(keywords: string[]): SkillDefinition[] {
    if (!this.loaded) this.load();
    const lowerKeywords = keywords.map(k => k.toLowerCase());
    return Array.from(this.skills.values()).filter(s => {
      const haystack = `${s.name} ${s.description} ${s.categories.join(' ')}`.toLowerCase();
      return lowerKeywords.some(k => haystack.includes(k));
    });
  }

  /** Resolve a prompt template with parameters */
  resolvePrompt(skill: SkillDefinition, params: Record<string, string>): string {
    let prompt = skill.promptTemplate;
    for (const [key, value] of Object.entries(params)) {
      prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return prompt;
  }

  // ── Index-server dual-write (MI-3 recovery, redundancy) ───────────

  /** Sync all skills to mcp-index-server as a single knowledge entry */
  async syncToIndex(): Promise<boolean> {
    if (!indexClient.isConfigured()) return false;
    try {
      const arr = Array.from(this.skills.values());
      const ok = await indexClient.storeKnowledge(INDEX_SKILLS_KEY, JSON.stringify(arr), {
        type: 'skill-definitions',
        count: arr.length,
        skillIds: arr.map(s => s.id),
      });
      if (ok) {
        logger.debug(`Synced ${arr.length} skills to index-server`);
      }
      return ok;
    } catch (err) {
      logger.debug(`Index-server skill sync failed: ${err}`);
      return false;
    }
  }

  /** Attempt to recover skills from mcp-index-server when disk is corrupted */
  async recoverFromIndex(): Promise<boolean> {
    if (!indexClient.isConfigured()) return false;
    try {
      const entry = await indexClient.getKnowledge(INDEX_SKILLS_KEY);
      if (!entry?.content) return false;

      const arr: SkillDefinition[] = JSON.parse(entry.content);
      if (!Array.isArray(arr) || arr.length === 0) return false;

      this.skills.clear();
      for (const skill of arr) {
        this.skills.set(skill.id, skill);
      }
      logger.info(`Recovered ${this.skills.size} skills from index-server (disk was corrupted)`);

      // Re-persist to disk to heal the corrupted file
      this.persist();
      return true;
    } catch (err) {
      logger.debug(`Index-server skill recovery failed: ${err}`);
      return false;
    }
  }

  /** Seed default built-in skills */
  private seedDefaults(): void {
    const defaults: SkillDefinition[] = [
      {
        id: 'ask-multiple',
        name: 'Multi-Model Query',
        description: 'Ask the same question to multiple models and compare their responses side-by-side',
        promptTemplate: 'Answer the following question thoroughly. Provide concrete examples where applicable.\n\nQuestion: {question}',
        strategy: 'fan-out' as RoutingStrategy,
        mergeResults: false,
        maxTokens: 4000,
        version: '2.0.0',
        categories: ['general', 'query'],
      },
      {
        id: 'consensus-check',
        name: 'Consensus Check',
        description: 'Ask multiple models the same question and synthesize consensus - identifies agreement, disagreement, and confidence level',
        promptTemplate: 'Answer the following question carefully and precisely. If uncertain, state your confidence level.\n\nQuestion: {question}',
        strategy: 'consensus' as RoutingStrategy,
        mergeResults: true,
        maxTokens: 4000,
        version: '2.0.0',
        categories: ['general', 'validation'],
      },
      {
        id: 'code-review',
        name: 'Code Review',
        description: 'Multi-agent code review covering bugs, security, performance, and maintainability with structured output',
        promptTemplate:
          'You are an expert code reviewer. Analyze the following code systematically.\n\n' +
          '## Code\n```\n{code}\n```\n\n## Context\n{context}\n\n' +
          '## Review Checklist\nFor each category, list findings as `[SEVERITY] description` where severity is CRITICAL, WARNING, or INFO.\n\n' +
          '### 1. Correctness\n- Logic errors, off-by-one, null/undefined handling, edge cases\n\n' +
          '### 2. Security\n- Injection (SQL, XSS, command), auth/authz gaps, secrets exposure, SSRF\n\n' +
          '### 3. Performance\n- Unnecessary allocations, O(n²) where O(n) possible, missing caching, blocking I/O\n\n' +
          '### 4. Maintainability\n- Code duplication, unclear naming, missing error handling, excessive complexity\n\n' +
          '### 5. Suggested Improvements\n- Concrete refactoring suggestions with before/after code snippets\n\n' +
          '## Summary\nProvide an overall quality score (1-10) and the top 3 action items.',
        strategy: 'fan-out' as RoutingStrategy,
        targetTags: ['code', 'review'],
        mergeResults: true,
        maxTokens: 8000,
        version: '2.0.0',
        categories: ['code', 'review', 'security'],
      },
      {
        id: 'fast-answer',
        name: 'Fast Answer',
        description: 'Get the fastest response from any available agent - races all agents and returns first result',
        promptTemplate: 'Answer concisely: {question}',
        strategy: 'race' as RoutingStrategy,
        maxTokens: 2000,
        timeoutMs: 15000,
        version: '2.0.0',
        categories: ['general', 'fast'],
      },
      {
        id: 'cost-optimized',
        name: 'Cost-Optimized Query',
        description: 'Try cheapest agent first, escalate to more capable agent only if response quality is below threshold',
        promptTemplate: 'Answer the following question thoroughly. Include relevant details, examples, and explanations.\n\nQuestion: {question}',
        strategy: 'cost-optimized' as RoutingStrategy,
        qualityThreshold: 0.4,
        maxTokens: 4000,
        version: '2.0.0',
        categories: ['general', 'cost'],
      },
      {
        id: 'security-audit',
        name: 'Security Audit',
        description: 'Deep multi-agent security analysis covering OWASP Top 10, supply chain, and infrastructure concerns with severity ratings',
        promptTemplate:
          'You are a senior security engineer performing a thorough security audit.\n\n' +
          '## Target\n{input}\n\n## Audit Scope\n' +
          'Analyze for the following vulnerability categories. For each finding, provide:\n' +
          '- **Severity**: CRITICAL / HIGH / MEDIUM / LOW\n' +
          '- **Location**: Where in the code/config the issue exists\n' +
          '- **Description**: What the vulnerability is\n' +
          '- **Impact**: What an attacker could achieve\n' +
          '- **Remediation**: Specific fix with code example\n\n' +
          '### Categories\n' +
          '1. **Injection** - SQL, NoSQL, OS command, LDAP, XSS (stored/reflected/DOM)\n' +
          '2. **Broken Authentication** - Weak credentials, session fixation, token leakage\n' +
          '3. **Broken Access Control** - IDOR, privilege escalation, missing authz checks\n' +
          '4. **Sensitive Data Exposure** - Secrets in code, unencrypted PII, verbose errors\n' +
          '5. **Security Misconfiguration** - Default credentials, debug flags, permissive CORS\n' +
          '6. **Vulnerable Components** - Known CVEs in dependencies, outdated packages\n' +
          '7. **SSRF** - Server-side request forgery vectors\n' +
          '8. **Supply Chain** - Dependency confusion, typosquatting, integrity checks\n\n' +
          '## Summary\nProvide a risk rating (CRITICAL/HIGH/MEDIUM/LOW) and prioritized remediation plan.',
        strategy: 'fan-out' as RoutingStrategy,
        targetTags: ['security', 'code'],
        mergeResults: true,
        maxTokens: 10000,
        version: '2.0.0',
        categories: ['security', 'audit'],
      },
      {
        id: 'explain-code',
        name: 'Code Explainer',
        description: 'Explain code with progressive detail - summary, line-by-line breakdown, data flow, and key concepts',
        promptTemplate:
          'Explain the following code clearly for a developer who is unfamiliar with it.\n\n' +
          '## Code\n```\n{code}\n```\n\n## Explanation Format\n\n' +
          '### 1. Summary (2-3 sentences)\nWhat does this code do at a high level?\n\n' +
          '### 2. Key Concepts\nList any design patterns, algorithms, or language features used.\n\n' +
          '### 3. Step-by-Step Walkthrough\nWalk through the logic flow, explaining what each significant section does and why.\n\n' +
          '### 4. Inputs & Outputs\n- What does this code expect as input?\n- What does it produce as output?\n- What side effects does it have?\n\n' +
          '### 5. Potential Gotchas\nNote any non-obvious behavior, edge cases, or common mistakes when working with this code.',
        strategy: 'single' as RoutingStrategy,
        mergeResults: false,
        maxTokens: 6000,
        version: '2.0.0',
        categories: ['code', 'education'],
      },
      {
        id: 'commit-review',
        name: 'Commit Review',
        description: 'Review a git diff or commit for correctness, completeness, and adherence to best practices - uses evaluate strategy for doer+critic workflow',
        promptTemplate:
          'You are reviewing a code change (git diff or commit). Analyze it for quality and correctness.\n\n' +
          '## Diff\n```diff\n{diff}\n```\n\n## Commit Message\n{message}\n\n' +
          '## Review Criteria\n' +
          '1. **Correctness** - Does the change do what the commit message claims? Any bugs introduced?\n' +
          '2. **Completeness** - Are there missing test updates, doc changes, or related files that should have been modified?\n' +
          '3. **Breaking Changes** - Could this break existing callers, APIs, or contracts?\n' +
          '4. **Style** - Does it follow the project\'s conventions?\n' +
          '5. **Commit Hygiene** - Is the commit message descriptive? Should this be split into multiple commits?\n\n' +
          '## Verdict\nProvide: APPROVE, REQUEST_CHANGES, or NEEDS_DISCUSSION with specific line-level comments.',
        strategy: 'evaluate' as RoutingStrategy,
        targetTags: ['code', 'review'],
        mergeResults: false,
        maxTokens: 8000,
        version: '1.0.0',
        categories: ['code', 'review', 'git'],
      },
      {
        id: 'refactor-suggest',
        name: 'Refactoring Suggestions',
        description: 'Analyze code and suggest concrete refactoring improvements - uses cost-optimized strategy to minimize resource usage',
        promptTemplate:
          'Analyze the following code and suggest refactoring improvements. Focus on practical, high-impact changes.\n\n' +
          '## Code\n```\n{code}\n```\n\n## Goals\n{goals}\n\n' +
          '## Refactoring Analysis\n\n' +
          '### Code Smells Detected\nList each smell with its location and severity.\n\n' +
          '### Suggested Refactorings\nFor each suggestion:\n' +
          '1. **What**: Name the refactoring pattern (Extract Method, Replace Conditional with Polymorphism, etc.)\n' +
          '2. **Where**: Which lines/functions to change\n' +
          '3. **Why**: What problem it solves\n' +
          '4. **How**: Show before/after code\n\n' +
          '### Priority Order\nRank suggestions by impact-to-effort ratio.',
        strategy: 'cost-optimized' as RoutingStrategy,
        qualityThreshold: 0.5,
        targetTags: ['code'],
        maxTokens: 8000,
        version: '1.0.0',
        categories: ['code', 'refactoring'],
      },
    ];

    for (const skill of defaults) {
      this.skills.set(skill.id, skill);
    }
    logger.info(`Seeded ${defaults.length} default skills`);
  }
}

/** Singleton skill store */
export const skillStore = new SkillStore();
