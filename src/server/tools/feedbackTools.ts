// mcp-agent-manager/src/server/tools/feedbackTools.ts
// MCP tool registrations for feedback submission and listing.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  addFeedback,
  listFeedback,
  getFeedback,
  updateFeedbackStatus,
  feedbackStats,
} from '../../services/feedbackStore.js';
import { toolError } from './toolErrors.js';

export function registerFeedbackTools(server: McpServer): void {
  // -----------------------------------------------------------------------
  // mgr_submit_feedback - submit a feedback entry
  // -----------------------------------------------------------------------
  server.tool(
    'mgr_submit_feedback',
    'Submit feedback (bug, feature request, issue, security alert, or general)',
    {
      type: z
        .enum(['issue', 'bug', 'feature-request', 'security', 'general'])
        .describe('Feedback category'),
      title: z.string().describe('Short title'),
      body: z.string().describe('Detailed description'),
      metadata: z
        .record(z.unknown())
        .optional()
        .describe('Optional key-value metadata'),
    },
    async ({ type, title, body, metadata }) => {
      const entry = await addFeedback(type, title, body, metadata);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(entry, null, 2),
          },
        ],
      };
    },
  );

  // -----------------------------------------------------------------------
  // mgr_list_feedback - list feedback entries with optional filters
  // -----------------------------------------------------------------------
  server.tool(
    'mgr_list_feedback',
    'List feedback entries, optionally filtered by type and/or status',
    {
      type: z
        .enum(['issue', 'bug', 'feature-request', 'security', 'general'])
        .optional()
        .describe('Filter by feedback type'),
      status: z
        .enum(['new', 'acknowledged', 'resolved', 'rejected'])
        .optional()
        .describe('Filter by status'),
    },
    async ({ type, status }) => {
      const items = listFeedback({ type, status });
      const stats = feedbackStats();
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ stats, items }, null, 2),
          },
        ],
      };
    },
  );

  // -----------------------------------------------------------------------
  // mgr_get_feedback - get a single feedback entry by ID
  // -----------------------------------------------------------------------
  server.tool(
    'mgr_get_feedback',
    'Get a single feedback entry by ID',
    {
      id: z.string().describe('Feedback entry ID'),
    },
    async ({ id }) => {
      const entry = getFeedback(id);
      if (!entry) {
        return toolError('mgr_get_feedback', `Feedback entry "${id}" not found`);
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(entry, null, 2) }],
      };
    },
  );

  // -----------------------------------------------------------------------
  // mgr_update_feedback - update feedback status
  // -----------------------------------------------------------------------
  server.tool(
    'mgr_update_feedback',
    'Update the status of a feedback entry',
    {
      id: z.string().describe('Feedback entry ID'),
      status: z
        .enum(['new', 'acknowledged', 'resolved', 'rejected'])
        .describe('New status'),
    },
    async ({ id, status }) => {
      const entry = updateFeedbackStatus(id, status);
      if (!entry) {
        return toolError('mgr_update_feedback', `Feedback entry "${id}" not found`);
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(entry, null, 2) }],
      };
    },
  );
}
