/**
 * Universal UUID generation utility for octoload
 * Works in both Node.js and browser environments
 */

/**
 * Generate a UUID v4
 * Uses crypto.randomUUID() if available (Node.js 15+ or modern browsers)
 * Falls back to manual generation for older environments
 */
export function generateUUID(): string {
  // Check if we're in a browser environment with crypto.randomUUID
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Check if we're in Node.js with crypto.randomUUID
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  // Fallback: manual UUID v4 generation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Server-only UUID generation using Node.js crypto
 * Only use this in server-side code (not in schemas that might be imported by client)
 */
export function generateServerUUID(): string {
  // Use require() to avoid browser bundling issues
  const crypto = require('crypto');
  return crypto.randomUUID();
}
