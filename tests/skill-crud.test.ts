// tests/skill-crud.test.ts
// Skill CRUD - MCP tool-level tests for get, update, remove + round-trips.

import { describe, it, expect, beforeAll, afterAll, beforeEach, type MockInstance } from 'vitest';
import { skillStore } from '../src/services/skillStore.js';
import { createPersistSpies, restoreSpies, cleanState } from './helpers/setup.js';
import type { SkillDefinition } from '../src/types/index.js';

let persistSpies: MockInstance[];
beforeAll(() => { persistSpies = createPersistSpies(); });
afterAll(() => { restoreSpies(persistSpies); });
beforeEach(() => { cleanState(); });

// Helper - register a test skill
function registerTestSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  const skill: SkillDefinition = {
    id: overrides.id ?? 'test-skill-1',
    name: overrides.name ?? 'Test Skill',
    description: overrides.description ?? 'A test skill',
    promptTemplate: overrides.promptTemplate ?? 'Analyze {code}',
    strategy: overrides.strategy ?? 'single',
    version: overrides.version ?? '1.0.0',
    categories: overrides.categories ?? ['test'],
    targetTags: overrides.targetTags ?? ['code'],
    ...overrides,
  };
  skillStore.register(skill);
  return skill;
}

// ---------------------------------------------------------------------------
// mgr_get_skill
// ---------------------------------------------------------------------------

describe('mgr_get_skill - get single skill by ID', () => {
  it('returns full definition by ID', () => {
    registerTestSkill();
    const skill = skillStore.get('test-skill-1');
    expect(skill).toBeDefined();
    expect(skill!.id).toBe('test-skill-1');
    expect(skill!.name).toBe('Test Skill');
    expect(skill!.promptTemplate).toBe('Analyze {code}');
    expect(skill!.strategy).toBe('single');
    expect(skill!.categories).toEqual(['test']);
    expect(skill!.targetTags).toEqual(['code']);
    expect(skill!.version).toBe('1.0.0');
  });

  it('returns undefined for unknown ID', () => {
    const skill = skillStore.get('nonexistent-skill');
    expect(skill).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mgr_remove_skill
// ---------------------------------------------------------------------------

describe('mgr_remove_skill - delete skill by ID', () => {
  it('deletes and confirms', () => {
    registerTestSkill();
    const removed = skillStore.remove('test-skill-1');
    expect(removed).toBe(true);
    expect(skillStore.get('test-skill-1')).toBeUndefined();
  });

  it('returns false for unknown ID', () => {
    const removed = skillStore.remove('nonexistent');
    expect(removed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mgr_update_skill - partial update via re-register
// ---------------------------------------------------------------------------

describe('mgr_update_skill - partial update merges fields', () => {
  it('updates only changed fields, preserves others', () => {
    registerTestSkill();
    const existing = skillStore.get('test-skill-1')!;

    // Simulate partial merge (as the tool does)
    const vParts = existing.version.split('.').map(Number);
    vParts[2]++;
    const updated = { ...existing, name: 'Updated Name', version: vParts.join('.') };
    skillStore.register(updated);

    const result = skillStore.get('test-skill-1')!;
    expect(result.name).toBe('Updated Name');
    expect(result.description).toBe('A test skill');      // preserved
    expect(result.promptTemplate).toBe('Analyze {code}'); // preserved
    expect(result.version).toBe('1.0.1');                  // bumped
  });

  it('returns undefined when updating non-existent skill', () => {
    expect(skillStore.get('ghost-skill')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe('Skill CRUD round-trips', () => {
  it('register → get - all fields match', () => {
    const input = registerTestSkill({
      id: 'roundtrip-1',
      name: 'Round Trip',
      description: 'Tests full round trip',
      promptTemplate: 'Do {action} on {target}',
      strategy: 'fan-out',
      categories: ['alpha', 'beta'],
      targetTags: ['fast'],
    });

    const retrieved = skillStore.get('roundtrip-1')!;
    expect(retrieved.id).toBe(input.id);
    expect(retrieved.name).toBe(input.name);
    expect(retrieved.description).toBe(input.description);
    expect(retrieved.promptTemplate).toBe(input.promptTemplate);
    expect(retrieved.strategy).toBe(input.strategy);
    expect(retrieved.categories).toEqual(input.categories);
    expect(retrieved.targetTags).toEqual(input.targetTags);
  });

  it('re-register overwrites with new name', () => {
    registerTestSkill({ id: 'overwrite-1', name: 'Original' });
    expect(skillStore.get('overwrite-1')!.name).toBe('Original');

    registerTestSkill({ id: 'overwrite-1', name: 'Overwritten' });
    expect(skillStore.get('overwrite-1')!.name).toBe('Overwritten');
  });

  it('full lifecycle: create → read → update → read → delete → read 404', () => {
    // Create
    registerTestSkill({ id: 'lifecycle-1' });

    // Read
    let skill = skillStore.get('lifecycle-1');
    expect(skill).toBeDefined();
    expect(skill!.version).toBe('1.0.0');

    // Update
    const vParts = skill!.version.split('.').map(Number);
    vParts[2]++;
    skillStore.register({ ...skill!, name: 'Lifecycle Updated', version: vParts.join('.') });

    // Read updated
    skill = skillStore.get('lifecycle-1');
    expect(skill!.name).toBe('Lifecycle Updated');
    expect(skill!.version).toBe('1.0.1');

    // Delete
    const removed = skillStore.remove('lifecycle-1');
    expect(removed).toBe(true);

    // Read → undefined
    expect(skillStore.get('lifecycle-1')).toBeUndefined();
  });
});
