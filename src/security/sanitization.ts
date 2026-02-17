// mcp-agent-manager/src/security/sanitization.ts
// Data sanitization utilities to prevent PII exposure in logs and state files

import { createHash } from 'node:crypto';

/** Email regex for basic email detection */
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

/** Common PII patterns */
const PII_PATTERNS = {
  email: EMAIL_REGEX,
  // GitHub usernames (basic pattern)
  username: /\b[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}\b/g,
  // File paths that might contain usernames
  windowsPath: /C:\\Users\\[^\\]+/g,
  // IP addresses (basic detection)
  ipAddress: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,
};

/**
 * Hash a string using SHA-256 for anonymization
 * Returns first 8 characters of hash for readability while preserving uniqueness
 */
function hashPII(value: string): string {
  if (!value) return value;
  return createHash('sha256').update(value).digest('hex').substring(0, 8);
}

/**
 * Sanitize PII from a text string
 * Replaces detected PII with hashed versions
 */
export function sanitizeText(text: string): string {
  if (!text || typeof text !== 'string') return text;

  let sanitized = text;

  // Replace emails with hashed versions
  sanitized = sanitized.replace(PII_PATTERNS.email, (match) => {
    const [local, domain] = match.split('@');
    return `${hashPII(local)}@${domain}`;
  });

  // Replace Windows user paths
  sanitized = sanitized.replace(PII_PATTERNS.windowsPath, (match) => {
    return `C:\\Users\\${hashPII(match.split('\\')[2])}`;
  });

  return sanitized;
}

/**
 * Sanitize an agent message object before logging
 */
export function sanitizeAgentMessage(message: any): any {
  if (!message || typeof message !== 'object') return message;

  return {
    ...message,
    sender: message.sender ? hashPII(message.sender) : message.sender,
    recipients: Array.isArray(message.recipients)
      ? message.recipients.map((r: string) => hashPII(r))
      : message.recipients,
    body: message.body ? sanitizeText(message.body) : message.body,
    // Preserve other fields
    id: message.id,
    channel: message.channel,
    createdAt: message.createdAt,
    ttlSeconds: message.ttlSeconds,
    persistent: message.persistent,
    readBy: Array.isArray(message.readBy)
      ? message.readBy.map((r: string) => hashPII(r))
      : message.readBy,
  };
}

/**
 * Sanitize event log data before writing
 */
export function sanitizeEventData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeText(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item =>
        typeof item === 'string' ? sanitizeText(item) : item
      );
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Check if a string contains potential PII
 * Used for validation before logging
 */
export function containsPII(text: string): boolean {
  if (!text || typeof text !== 'string') return false;

  return PII_PATTERNS.email.test(text) ||
         PII_PATTERNS.windowsPath.test(text);
}

/**
 * Redact sensitive configuration values
 */
export function sanitizeConfig(config: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...config };
  const sensitiveKeys = ['key', 'token', 'password', 'secret', 'api_key', 'apikey'];

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      const value = sanitized[key];
      if (typeof value === 'string' && value.length > 0) {
        sanitized[key] = '*'.repeat(Math.min(value.length, 8));
      }
    }
  }

  return sanitized;
}
