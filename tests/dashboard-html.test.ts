// tests/dashboard-html.test.ts
// Validates that the dashboard HTML contains syntactically valid JavaScript.
// Catches quoting issues in inline JS, template string mismatches, etc.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Extract the dashboard HTML string from the compiled source.
 * We import the module and call the handler with a mock request to get the HTML.
 */
async function getDashboardHtml(): Promise<string> {
  // The dashboard HTML is returned by the / route handler.
  // Instead of starting the HTTP server, we import the module and extract
  // the HTML template string directly from the source file.
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');

  const srcPath = resolve(import.meta.dirname, '..', 'src', 'services', 'dashboard', 'html.ts');
  const source = readFileSync(srcPath, 'utf-8');

  // The HTML is assembled from parts (styles, render script, action script).
  // We need to also read those parts and substitute them.
  const stylesPath = resolve(import.meta.dirname, '..', 'src', 'services', 'dashboard', 'htmlStyles.ts');
  const renderPath = resolve(import.meta.dirname, '..', 'src', 'services', 'dashboard', 'htmlRenderScript.ts');
  const actionPath = resolve(import.meta.dirname, '..', 'src', 'services', 'dashboard', 'htmlActionScript.ts');

  const stylesSource = readFileSync(stylesPath, 'utf-8');
  const renderSource = readFileSync(renderPath, 'utf-8');
  const actionSource = readFileSync(actionPath, 'utf-8');

  // Extract string constants from each file (between first ` and last `)
  function extractTemplateLiteral(src: string): string {
    const start = src.indexOf('`');
    const end = src.lastIndexOf('`');
    if (start === -1 || end === -1 || start === end) return '';
    return src.substring(start + 1, end);
  }

  const css = extractTemplateLiteral(stylesSource);
  const renderScript = extractTemplateLiteral(renderSource);
  const actionScript = extractTemplateLiteral(actionSource);

  // Substitute the interpolations in the main template
  // Use function replacement to avoid $' special pattern interpretation
  let html = source;
  const htmlMatch = html.match(/<!DOCTYPE[\s\S]*?<\/html>/);
  if (!htmlMatch) throw new Error('Could not extract HTML from dashboard/html.ts');
  let result = htmlMatch[0];
  result = result.replace('${DASHBOARD_CSS}', () => css);
  result = result.replace('${DASHBOARD_RENDER_SCRIPT}', () => renderScript);
  result = result.replace('${DASHBOARD_ACTION_SCRIPT}', () => actionScript);
  return result;
}

/**
 * Extract all <script>...</script> blocks from HTML.
 */
function extractScriptBlocks(html: string): string[] {
  const blocks: string[] = [];
  const regex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    if (match[1].trim()) blocks.push(match[1]);
  }
  return blocks;
}

/**
 * Check for common HTML issues.
 */
function validateHtml(html: string): string[] {
  const issues: string[] = [];

  // Check for unclosed tags (simple heuristic)
  const openTags = (html.match(/<(?!\/|!|br|hr|img|input|meta|link)[a-z][a-z0-9]*[^>]*>/gi) || []).length;
  const closeTags = (html.match(/<\/[a-z][a-z0-9]*>/gi) || []).length;
  if (Math.abs(openTags - closeTags) > 5) {
    issues.push(`Tag mismatch: ${openTags} opening vs ${closeTags} closing tags (diff > 5)`);
  }

  // Check for unescaped quotes in onclick/on* attributes that could break JS
  const onclickPattern = /\bon\w+="([^"]*?)"/g;
  let onMatch;
  while ((onMatch = onclickPattern.exec(html)) !== null) {
    const attrValue = onMatch[1];
    // Check for unmatched single quotes (rough check)
    const singleQuotes = (attrValue.match(/'/g) || []).length;
    if (singleQuotes % 2 !== 0) {
      issues.push(`Unmatched single quotes in ${onMatch[0].substring(0, 60)}...`);
    }
  }

  return issues;
}

describe('Dashboard HTML Validation', () => {
  let html: string;

  it('extracts dashboard HTML', async () => {
    html = await getDashboardHtml();
    expect(html).toBeTruthy();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('has valid HTML structure', async () => {
    if (!html) html = await getDashboardHtml();
    const issues = validateHtml(html);
    if (issues.length > 0) {
      console.warn('HTML issues:', issues);
    }
    // Tag mismatch is a warning, not a hard failure (template strings make counting hard)
    expect(html).toContain('<head>');
    expect(html).toContain('</head>');
    expect(html).toContain('<body>');
    expect(html).toContain('</body>');
  });

  it('contains syntactically valid JavaScript', async () => {
    if (!html) html = await getDashboardHtml();
    const scripts = extractScriptBlocks(html);
    expect(scripts.length).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < scripts.length; i++) {
      const tmpFile = join(tmpdir(), `dashboard-js-check-${i}-${Date.now()}.js`);
      try {
        writeFileSync(tmpFile, scripts[i], 'utf-8');
        // node --check performs syntax validation without executing
        execFileSync(process.execPath, ['--check', tmpFile], {
          encoding: 'utf-8',
          timeout: 10_000,
        });
      } catch (err: any) {
        const stderr = err.stderr || err.message || '';
        // Extract the relevant error line for debugging
        const lines = scripts[i].split('\n');
        const errorLineMatch = stderr.match(/:(\d+)/);
        const errorLine = errorLineMatch ? parseInt(errorLineMatch[1], 10) : -1;
        const context = errorLine > 0
          ? lines.slice(Math.max(0, errorLine - 3), errorLine + 2).join('\n')
          : '';

        throw new Error(
          `Dashboard script block ${i + 1} has JavaScript syntax errors:\n${stderr}\n` +
          (context ? `\nContext around line ${errorLine}:\n${context}` : '')
        );
      } finally {
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
      }
    }
  });

  it('has no broken inline event handlers', async () => {
    if (!html) html = await getDashboardHtml();
    const issues = validateHtml(html);
    const quoteIssues = issues.filter(i => i.includes('Unmatched'));
    expect(quoteIssues).toEqual([]);
  });

  it('contains all required dashboard sections', async () => {
    if (!html) html = await getDashboardHtml();
    const requiredSections = [
      'agentsTable', 'skillsTable', 'monitorCard', 'automationCard',
      'eventLog', 'debugPanel', 'mAgents', 'mSkills', 'mTasks', 'mTokens',
    ];
    for (const section of requiredSections) {
      expect(html).toContain(section);
    }
  });
});
