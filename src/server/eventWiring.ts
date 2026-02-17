// mcp-agent-manager/src/server/eventWiring.ts
// Wire EventBus events → MCP logging notifications + resource change signals

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { eventBus } from '../services/events.js';

export function wireEvents(server: McpServer): void {
  eventBus.onEvent('agent:registered', (data) => {
    server.sendLoggingMessage({ level: 'info', data: { event: 'agent:registered', ...data } });
    server.sendResourceListChanged();
  });
  eventBus.onEvent('agent:unregistered', (data) => {
    server.sendLoggingMessage({ level: 'info', data: { event: 'agent:unregistered', ...data } });
    server.sendResourceListChanged();
  });
  eventBus.onEvent('agent:state-changed', (data) => {
    server.sendLoggingMessage({ level: 'info', data: { event: 'agent:state-changed', ...data } });
    server.sendResourceListChanged();
  });
  eventBus.onEvent('task:started', (data) => {
    server.sendLoggingMessage({ level: 'info', data: { event: 'task:started', ...data } });
  });
  eventBus.onEvent('task:completed', (data) => {
    const level = data.success ? 'info' : 'warning';
    server.sendLoggingMessage({ level, data: { event: 'task:completed', ...data } });
    server.sendResourceListChanged();
  });
  eventBus.onEvent('skill:registered', (data) => {
    server.sendLoggingMessage({ level: 'info', data: { event: 'skill:registered', ...data } });
    server.sendToolListChanged();
  });
  eventBus.onEvent('skill:removed', (data) => {
    server.sendLoggingMessage({ level: 'info', data: { event: 'skill:removed', ...data } });
    server.sendToolListChanged();
  });
  eventBus.onEvent('workspace:monitoring', (data) => {
    server.sendLoggingMessage({ level: 'info', data: { event: 'workspace:monitoring', ...data } });
  });
  eventBus.onEvent('workspace:stopped', (data) => {
    server.sendLoggingMessage({ level: 'info', data: { event: 'workspace:stopped', ...data } });
  });
  eventBus.onEvent('workspace:file-changed', (data) => {
    server.sendLoggingMessage({ level: 'debug', data: { event: 'workspace:file-changed', ...data } });
  });
  eventBus.onEvent('workspace:session-updated', (data) => {
    server.sendLoggingMessage({ level: 'info', data: { event: 'workspace:session-updated', ...data } });
  });
  eventBus.onEvent('workspace:git-event', (data) => {
    server.sendLoggingMessage({ level: 'info', data: { event: 'workspace:git-event', gitAction: data.event, path: data.path, detail: data.detail } });
  });
}
