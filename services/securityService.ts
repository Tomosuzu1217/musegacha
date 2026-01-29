/**
 * Security Service - XSS Protection and Input Sanitization
 *
 * This module provides security utilities for sanitizing user input and
 * AI-generated content to prevent XSS attacks and other security issues.
 */

// DOMPurify will be used when available, otherwise fallback to built-in sanitization
let DOMPurify: any = null;

// Try to load DOMPurify dynamically
const loadDOMPurify = async (): Promise<void> => {
  try {
    const module = await import('dompurify');
    DOMPurify = module.default;
  } catch {
    console.warn('DOMPurify not available, using fallback sanitization');
  }
};

// Initialize on module load
loadDOMPurify();

// Security configuration
const SECURITY_CONFIG = {
  MAX_TEXT_LENGTH: 10000,
  MAX_URL_LENGTH: 2000,
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'a', 'span'],
  ALLOWED_ATTRS: ['href', 'title', 'class'],
  ALLOWED_PROTOCOLS: ['http:', 'https:', 'mailto:'],
};

/**
 * Sanitize HTML content using DOMPurify or fallback
 * Use this for any AI-generated content that may contain HTML
 */
export const sanitizeHtml = (dirty: string): string => {
  if (!dirty || typeof dirty !== 'string') return '';

  // Limit length
  const limited = dirty.slice(0, SECURITY_CONFIG.MAX_TEXT_LENGTH);

  // Use DOMPurify if available
  if (DOMPurify) {
    return DOMPurify.sanitize(limited, {
      ALLOWED_TAGS: SECURITY_CONFIG.ALLOWED_TAGS,
      ALLOWED_ATTR: SECURITY_CONFIG.ALLOWED_ATTRS,
      ALLOW_DATA_ATTR: false,
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    });
  }

  // Fallback: escape all HTML
  return escapeHtml(limited);
};

/**
 * Escape HTML entities (safe for rendering as text)
 * Use this for plain text that should never contain HTML
 */
export const escapeHtml = (text: string): string => {
  if (!text || typeof text !== 'string') return '';

  const limited = text.slice(0, SECURITY_CONFIG.MAX_TEXT_LENGTH);

  return limited
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .replace(/`/g, '&#x60;')
    .replace(/=/g, '&#x3D;');
};

/**
 * Sanitize text for safe display (removes potential script injection)
 * Use this for AI-generated text content
 */
export const sanitizeText = (text: string): string => {
  if (!text || typeof text !== 'string') return '';

  const limited = text.slice(0, SECURITY_CONFIG.MAX_TEXT_LENGTH);

  // Remove potential script injection patterns
  return limited
    // Remove script tags and event handlers
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=/gi, '')
    // Remove javascript: protocol
    .replace(/javascript:/gi, '')
    // Remove data: protocol (except for images we control)
    .replace(/data:(?!image\/)/gi, '')
    // Remove expression() CSS
    .replace(/expression\s*\(/gi, '')
    // Remove vbscript
    .replace(/vbscript:/gi, '')
    // Trim whitespace
    .trim();
};

/**
 * Validate and sanitize URLs
 * Use this for any user-provided or AI-generated URLs
 */
export const sanitizeUrl = (url: string): string => {
  if (!url || typeof url !== 'string') return '';

  const trimmed = url.trim().slice(0, SECURITY_CONFIG.MAX_URL_LENGTH);

  try {
    const parsed = new URL(trimmed);

    // Only allow safe protocols
    if (!SECURITY_CONFIG.ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
      return '';
    }

    // Remove credentials from URL
    parsed.username = '';
    parsed.password = '';

    return parsed.toString();
  } catch {
    // Invalid URL
    return '';
  }
};

/**
 * Sanitize user input for voice recognition results
 * Use this for speech-to-text output
 */
export const sanitizeVoiceInput = (text: string, maxLength: number = 1000): string => {
  if (!text || typeof text !== 'string') return '';

  return text
    .slice(0, maxLength)
    // Remove control characters
    .replace(/[\x00-\x1F\x7F]/g, '')
    // Remove potential injection patterns
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim();
};

/**
 * Sanitize AI-generated script messages
 * Use this for moderator/commentator responses
 */
export const sanitizeScriptMessage = (message: {
  role: string;
  text: string;
}): { role: string; text: string } => {
  return {
    role: ['moderator', 'commentator', 'user'].includes(message.role)
      ? message.role
      : 'user',
    text: sanitizeText(message.text).slice(0, 500),
  };
};

/**
 * Content Security Policy helper
 * Returns a CSP meta tag content for the application
 */
export const getCSPContent = (): string => {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'", // React needs inline scripts
    "style-src 'self' 'unsafe-inline'",  // Tailwind needs inline styles
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://generativelanguage.googleapis.com",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
};

/**
 * Check if content appears to contain malicious patterns
 * Returns true if suspicious content is detected
 */
export const detectMaliciousContent = (content: string): boolean => {
  if (!content || typeof content !== 'string') return false;

  const maliciousPatterns = [
    /<script/i,
    /javascript:/i,
    /vbscript:/i,
    /on\w+\s*=/i,
    /expression\s*\(/i,
    /eval\s*\(/i,
    /document\.cookie/i,
    /document\.location/i,
    /window\.location/i,
    /\.innerHTML\s*=/i,
    /\.outerHTML\s*=/i,
  ];

  return maliciousPatterns.some(pattern => pattern.test(content));
};

/**
 * Rate limiting for user actions
 */
interface RateLimitEntry {
  count: number;
  firstAttempt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

export const checkRateLimit = (
  action: string,
  maxAttempts: number = 10,
  windowMs: number = 60000
): boolean => {
  const now = Date.now();
  const entry = rateLimitStore.get(action);

  if (!entry || now - entry.firstAttempt > windowMs) {
    rateLimitStore.set(action, { count: 1, firstAttempt: now });
    return true;
  }

  if (entry.count >= maxAttempts) {
    return false;
  }

  entry.count++;
  return true;
};

/**
 * Reset rate limit for an action
 */
export const resetRateLimit = (action: string): void => {
  rateLimitStore.delete(action);
};
