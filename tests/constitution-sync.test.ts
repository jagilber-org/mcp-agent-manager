// tests/constitution-sync.test.ts
// Validates that constitution.json, docs/constitution.md, and .specify/memory/constitution.md
// are consistent and that the sync script produces no-diff output.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(__dirname, '..');
const CONSTITUTION_PATH = path.join(ROOT, 'constitution.json');
const DOCS_PATH = path.join(ROOT, 'docs', 'constitution.md');
const SPECIFY_PATH = path.join(ROOT, '.specify', 'memory', 'constitution.md');

function loadConstitution() {
  return JSON.parse(fs.readFileSync(CONSTITUTION_PATH, 'utf-8'));
}

describe('constitution-sync', () => {
  it('constitution.json is valid JSON with required fields', () => {
    const c = loadConstitution();
    expect(c.name).toBeTruthy();
    expect(c.version).toBeTruthy();
    expect(c.description).toBeTruthy();
    expect(c.articles).toBeInstanceOf(Array);
    expect(c.articles.length).toBeGreaterThan(0);
    expect(c.thresholds).toBeTruthy();
    expect(typeof c.thresholds.minTestCount).toBe('number');
    expect(typeof c.thresholds.maxSourceFileLines).toBe('number');
  });

  it('every article has id, title, and at least one rule', () => {
    const c = loadConstitution();
    for (const article of c.articles) {
      expect(article.id).toBeTruthy();
      expect(article.title).toBeTruthy();
      expect(article.rules.length).toBeGreaterThan(0);
      for (const rule of article.rules) {
        expect(rule.id).toBeTruthy();
        expect(rule.description).toBeTruthy();
      }
    }
  });

  it('docs/constitution.md exists and has AUTO-GENERATED header', () => {
    const content = fs.readFileSync(DOCS_PATH, 'utf-8');
    expect(content).toContain('AUTO-GENERATED from constitution.json');
    expect(content).toContain('do not edit directly');
  });

  it('.specify/memory/constitution.md exists and has AUTO-GENERATED header', () => {
    const content = fs.readFileSync(SPECIFY_PATH, 'utf-8');
    expect(content).toContain('AUTO-GENERATED from constitution.json');
    expect(content).toContain('do not edit directly');
  });

  it('docs/constitution.md reflects current article count', () => {
    const c = loadConstitution();
    const content = fs.readFileSync(DOCS_PATH, 'utf-8');
    for (const article of c.articles) {
      expect(content).toContain(article.title);
    }
  });

  it('.specify/memory/constitution.md reflects current article count', () => {
    const c = loadConstitution();
    const content = fs.readFileSync(SPECIFY_PATH, 'utf-8');
    for (const article of c.articles) {
      expect(content).toContain(article.title);
    }
  });

  it('docs/constitution.md has correct minTestCount threshold', () => {
    const c = loadConstitution();
    const content = fs.readFileSync(DOCS_PATH, 'utf-8');
    expect(content).toContain(String(c.thresholds.minTestCount));
  });

  it('docs/constitution.md has correct version', () => {
    const c = loadConstitution();
    const content = fs.readFileSync(DOCS_PATH, 'utf-8');
    expect(content).toContain(c.version);
  });

  it('sync script produces no diff (derived files are up to date)', () => {
    // Capture current contents
    const docsBefore = fs.readFileSync(DOCS_PATH, 'utf-8');
    const specifyBefore = fs.readFileSync(SPECIFY_PATH, 'utf-8');

    // Run the sync script
    execSync('node scripts/sync-constitution.cjs', { cwd: ROOT, stdio: 'pipe' });

    // Read regenerated contents
    const docsAfter = fs.readFileSync(DOCS_PATH, 'utf-8');
    const specifyAfter = fs.readFileSync(SPECIFY_PATH, 'utf-8');

    expect(docsAfter).toBe(docsBefore);
    expect(specifyAfter).toBe(specifyBefore);
  });
});
