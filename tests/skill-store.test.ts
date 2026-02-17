// tests/skill-store.test.ts
// Skill Store - CRUD operations, prompt resolution, search, and category filtering.

import { describe, it, expect, beforeAll, afterAll, beforeEach, type MockInstance } from 'vitest';
import { skillStore } from '../src/services/skillStore.js';
import { createPersistSpies, restoreSpies, cleanState } from './helpers/setup.js';
import type { SkillDefinition } from '../src/types/index.js';

let persistSpies: MockInstance[];
beforeAll(() => { persistSpies = createPersistSpies(); });
afterAll(() => { restoreSpies(persistSpies); });
beforeEach(() => { cleanState(); });

// ===========================================================================
// Skill Store - CRUD & Prompt Resolution
// ===========================================================================

describe('Skill Store - CRUD & Prompt Resolution', () => {
  it('registers and retrieves a skill', () => {
    const skill: SkillDefinition = {
      id: 'func-skill-1',
      name: 'Functional Skill',
      description: 'Test skill',
      promptTemplate: 'Review: {code}\nContext: {context}',
      strategy: 'single',
      targetTags: ['code'],
      version: '1.0.0',
      categories: ['test'],
    };

    skillStore.register(skill);
    const retrieved = skillStore.get('func-skill-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe('func-skill-1');
    expect(retrieved!.strategy).toBe('single');
    expect(retrieved!.targetTags).toEqual(['code']);

    skillStore.remove('func-skill-1');
  });

  it('resolves prompt templates with parameters', () => {
    const skill: SkillDefinition = {
      id: 'func-prompt-test',
      name: 'Prompt Test',
      description: 'Tests prompt resolution',
      promptTemplate: 'Review {code} in {context} for {language}',
      strategy: 'single',
      version: '1.0.0',
      categories: ['test'],
    };

    const result = skillStore.resolvePrompt(skill, {
      code: 'function hello() {}',
      context: 'main.ts',
      language: 'TypeScript',
    });

    expect(result).toBe('Review function hello() {} in main.ts for TypeScript');
  });

  it('lists skills filtered by category', () => {
    const testSkill: SkillDefinition = {
      id: 'func-list-test',
      name: 'List Test Skill',
      description: 'For list test',
      promptTemplate: 'test',
      strategy: 'single',
      version: '1.0.0',
      categories: ['code', 'test'],
    };
    skillStore.register(testSkill);

    const all = skillStore.list();
    expect(all.length).toBeGreaterThanOrEqual(1);

    const codeSkills = skillStore.list('code');
    expect(codeSkills.length).toBeGreaterThanOrEqual(1);
    for (const s of codeSkills) {
      expect(s.categories).toContain('code');
    }

    skillStore.remove('func-list-test');
  });

  it('searches skills by keywords', () => {
    const testSkill: SkillDefinition = {
      id: 'func-search-test',
      name: 'Code Review Skill',
      description: 'Reviews code for issues',
      promptTemplate: 'test',
      strategy: 'single',
      version: '1.0.0',
      categories: ['code', 'review'],
    };
    skillStore.register(testSkill);

    const results = skillStore.search(['review', 'code']);
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const s of results) {
      const haystack = `${s.name} ${s.description} ${s.categories.join(' ')}`.toLowerCase();
      expect(haystack).toMatch(/review|code/);
    }

    skillStore.remove('func-search-test');
  });

  it('removes a skill and confirms deletion', () => {
    const skill: SkillDefinition = {
      id: 'func-removable',
      name: 'Removable',
      description: 'Will be removed',
      promptTemplate: 'test',
      strategy: 'single',
      version: '1.0.0',
      categories: ['test'],
    };

    skillStore.register(skill);
    expect(skillStore.get('func-removable')).toBeDefined();

    const removed = skillStore.remove('func-removable');
    expect(removed).toBe(true);
    expect(skillStore.get('func-removable')).toBeUndefined();
  });
});
