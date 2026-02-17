// tests/dashboard-html-crud.test.ts
// Dashboard CRUD UI elements - validates buttons, modals, and JS functions exist.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Extract and assemble full dashboard HTML from source parts */
function getDashboardHtml(): string {
  const base = resolve(import.meta.dirname, '..', 'src', 'services', 'dashboard');
  const htmlSrc = readFileSync(join(base, 'html.ts'), 'utf-8');
  const stylesSrc = readFileSync(join(base, 'htmlStyles.ts'), 'utf-8');
  const renderSrc = readFileSync(join(base, 'htmlRenderScript.ts'), 'utf-8');
  const actionSrc = readFileSync(join(base, 'htmlActionScript.ts'), 'utf-8');

  function extractLiteral(src: string): string {
    const start = src.indexOf('`');
    const end = src.lastIndexOf('`');
    if (start === -1 || end === -1 || start === end) return '';
    return src.substring(start + 1, end);
  }

  const css = extractLiteral(stylesSrc);
  const renderScript = extractLiteral(renderSrc);
  const actionScript = extractLiteral(actionSrc);

  const htmlMatch = htmlSrc.match(/<!DOCTYPE[\s\S]*?<\/html>/);
  if (!htmlMatch) throw new Error('Could not extract HTML');
  let result = htmlMatch[0];
  result = result.replace('${DASHBOARD_CSS}', () => css);
  result = result.replace('${DASHBOARD_RENDER_SCRIPT}', () => renderScript);
  result = result.replace('${DASHBOARD_ACTION_SCRIPT}', () => actionScript);
  return result;
}

let html: string;

describe('Dashboard CRUD UI elements', () => {
  it('loads dashboard HTML', () => {
    html = getDashboardHtml();
    expect(html).toContain('<!DOCTYPE html>');
  });

  // ── Skill CRUD ───────────────────────────────────────────────────────

  it('contains "Add Skill" button', () => {
    expect(html).toContain('Add Skill');
    expect(html).toContain('openSkillModal()');
  });

  it('contains skill Edit and Delete action buttons in render script', () => {
    expect(html).toContain('editSkill(');
    expect(html).toContain('deleteSkill(');
  });

  // ── Workspace CRUD ───────────────────────────────────────────────────

  it('contains "Add Workspace" button', () => {
    expect(html).toContain('Add Workspace');
    expect(html).toContain('openWorkspaceModal()');
  });

  it('contains workspace Stop and Mine action buttons in render script', () => {
    expect(html).toContain('stopWorkspace(');
    expect(html).toContain('mineWorkspace(');
  });

  it('contains workspace History tab', () => {
    expect(html).toContain('History');
    expect(html).toContain('workspaceHistoryTable');
    expect(html).toContain('switchWorkspaceTab');
  });

  // ── Automation CRUD ──────────────────────────────────────────────────

  it('contains "Add Rule" button', () => {
    expect(html).toContain('Add Rule');
    expect(html).toContain('openAutomationModal()');
  });

  it('contains automation Edit, Delete, Toggle, Trigger action buttons', () => {
    expect(html).toContain('editAutomation(');
    expect(html).toContain('deleteAutomation(');
    expect(html).toContain('toggleAutomation(');
    expect(html).toContain('triggerAutomation(');
  });

  // ── Modal ────────────────────────────────────────────────────────────

  it('contains modal overlay and structure', () => {
    expect(html).toContain('crudModal');
    expect(html).toContain('modal-overlay');
    expect(html).toContain('modalTitle');
    expect(html).toContain('modalBody');
    expect(html).toContain('modalSubmit');
    expect(html).toContain('closeModal()');
  });

  // ── Ask Agent ────────────────────────────────────────────────────────

  it('contains Ask Agent button and response area', () => {
    expect(html).toContain('modalAskAgent');
    expect(html).toContain('askAgentResponse');
    expect(html).toContain('askAgent()');
    expect(html).toContain('btn-ask-agent');
    expect(html).toContain('ask-agent-response');
  });

  it('contains Ask Agent JS functions', () => {
    expect(html).toContain('function askAgent()');
    expect(html).toContain('function collectFormData()');
    expect(html).toContain('function buildAskPrompt(');
    expect(html).toContain('/api/ask-agent');
  });

  // ── JavaScript validity ──────────────────────────────────────────────

  it('all CRUD JS functions are syntactically valid', () => {
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    const scripts: string[] = [];
    while ((match = scriptRegex.exec(html)) !== null) {
      if (match[1].trim()) scripts.push(match[1]);
    }

    expect(scripts.length).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < scripts.length; i++) {
      const tmpFile = join(tmpdir(), `crud-js-check-${i}-${Date.now()}.js`);
      try {
        writeFileSync(tmpFile, scripts[i], 'utf-8');
        execFileSync(process.execPath, ['--check', tmpFile], {
          encoding: 'utf-8',
          timeout: 10_000,
        });
      } catch (err: any) {
        throw new Error(`Script block ${i + 1} has JS syntax errors:\n${err.stderr || err.message}`);
      } finally {
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
      }
    }
  });

  it('has no broken inline event handlers', () => {
    const onclickPattern = /\bon\w+="([^"]*?)"/g;
    let onMatch;
    const issues: string[] = [];
    while ((onMatch = onclickPattern.exec(html)) !== null) {
      const attrValue = onMatch[1];
      const singleQuotes = (attrValue.match(/'/g) || []).length;
      if (singleQuotes % 2 !== 0) {
        issues.push(`Unmatched quotes in ${onMatch[0].substring(0, 80)}`);
      }
    }
    expect(issues).toEqual([]);
  });
});
