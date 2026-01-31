/**
 * API Key Rotation Service
 * 
 * Manages multiple Gemini API keys and automatically rotates
 * to the next available key when rate limits are hit.
 * 
 * Features:
 * - Multiple API key management (from env or localStorage)
 * - Automatic key rotation on rate limit (429) errors
 * - Usage tracking per key
 * - Rate limit progress estimation
 */

import { GoogleGenAI } from '@google/genai';

// @ts-ignore - Defined in vite.config.ts
declare const __GEMINI_API_KEY__: string;
// @ts-ignore - Additional keys from env
declare const __GEMINI_API_KEY_2__: string | undefined;
// @ts-ignore
declare const __GEMINI_API_KEY_3__: string | undefined;

export interface ApiKeyInfo {
    key: string;
    id: string;
    usageCount: number;
    lastUsedAt: number;
    rateLimitedUntil: number | null;
    isActive: boolean;
}

export interface RateLimitStatus {
    currentKeyId: string;
    totalKeys: number;
    availableKeys: number;
    usagePercentage: number;
    estimatedResetTime: number | null;
    isRateLimited: boolean;
}

// Constants
const RATE_LIMIT_COOLDOWN = 60 * 1000; // 1 minute cooldown after rate limit
const USAGE_THRESHOLD_PER_KEY = 100; // Estimated requests before potential rate limit
const STORAGE_KEY = 'musegacha_api_keys';
const USAGE_STORAGE_KEY = 'musegacha_api_key_usage';

class ApiKeyRotationService {
    private keys: ApiKeyInfo[] = [];
    private currentKeyIndex: number = 0;
    private clientCache: Map<string, GoogleGenAI> = new Map();
    private listeners: Set<(status: RateLimitStatus) => void> = new Set();

    constructor() {
        this.initializeKeys();
        this.loadUsageFromStorage();
    }

    /**
     * Initialize API keys from environment variables and localStorage
     */
    private initializeKeys(): void {
        const allKeys: string[] = [];

        // 1. Environment variable keys (primary)
        if (typeof __GEMINI_API_KEY__ !== 'undefined' && __GEMINI_API_KEY__?.startsWith('AIza')) {
            allKeys.push(__GEMINI_API_KEY__);
        }
        if (typeof __GEMINI_API_KEY_2__ !== 'undefined' && __GEMINI_API_KEY_2__?.startsWith('AIza')) {
            allKeys.push(__GEMINI_API_KEY_2__);
        }
        if (typeof __GEMINI_API_KEY_3__ !== 'undefined' && __GEMINI_API_KEY_3__?.startsWith('AIza')) {
            allKeys.push(__GEMINI_API_KEY_3__);
        }

        // 2. LocalStorage keys (additional)
        try {
            const storedKeys = localStorage.getItem(STORAGE_KEY);
            if (storedKeys) {
                const parsed = JSON.parse(storedKeys) as string[];
                parsed.forEach(key => {
                    if (key?.startsWith('AIza') && !allKeys.includes(key)) {
                        allKeys.push(key);
                    }
                });
            }

            // Also check storageService key (musegacha_api_key_v3)
            const v3Key = localStorage.getItem('musegacha_api_key_v3');
            if (v3Key?.startsWith('AIza') && !allKeys.includes(v3Key)) {
                allKeys.push(v3Key);
            }

            // Also check the single key storage (backward compatibility)
            const singleKey = localStorage.getItem('gemini_api_key');
            if (singleKey?.startsWith('AIza') && !allKeys.includes(singleKey)) {
                allKeys.push(singleKey);
            }
        } catch (e) {
            console.warn('Failed to load stored API keys:', e);
        }

        // Create ApiKeyInfo objects
        this.keys = allKeys.map((key, index) => ({
            key,
            id: `key_${index + 1}`,
            usageCount: 0,
            lastUsedAt: 0,
            rateLimitedUntil: null,
            isActive: index === 0,
        }));

        // If no keys found, create a placeholder
        if (this.keys.length === 0) {
            console.warn('[ApiKeyRotation] No API keys found');
        } else {
            console.info(`[ApiKeyRotation] Initialized with ${this.keys.length} API key(s)`);
        }
    }

    /**
     * Load usage data from localStorage
     */
    private loadUsageFromStorage(): void {
        try {
            const stored = localStorage.getItem(USAGE_STORAGE_KEY);
            if (stored) {
                const usage = JSON.parse(stored) as Record<string, { usageCount: number; rateLimitedUntil: number | null }>;
                this.keys.forEach(keyInfo => {
                    const keyHash = this.hashKey(keyInfo.key);
                    if (usage[keyHash]) {
                        keyInfo.usageCount = usage[keyHash].usageCount || 0;
                        // Clear expired rate limits
                        const until = usage[keyHash].rateLimitedUntil;
                        if (until && until > Date.now()) {
                            keyInfo.rateLimitedUntil = until;
                        }
                    }
                });
            }
        } catch (e) {
            console.warn('Failed to load API key usage:', e);
        }
    }

    /**
     * Save usage data to localStorage
     */
    private saveUsageToStorage(): void {
        try {
            const usage: Record<string, { usageCount: number; rateLimitedUntil: number | null }> = {};
            this.keys.forEach(keyInfo => {
                const keyHash = this.hashKey(keyInfo.key);
                usage[keyHash] = {
                    usageCount: keyInfo.usageCount,
                    rateLimitedUntil: keyInfo.rateLimitedUntil,
                };
            });
            localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(usage));
        } catch (e) {
            console.warn('Failed to save API key usage:', e);
        }
    }

    /**
     * Create a simple hash of the key for storage (privacy)
     */
    private hashKey(key: string): string {
        let hash = 0;
        for (let i = 0; i < key.length; i++) {
            hash = ((hash << 5) - hash) + key.charCodeAt(i);
            hash = hash & hash;
        }
        return `k_${Math.abs(hash).toString(16)}`;
    }

    /**
     * Get the current active API key
     */
    getCurrentKey(): string | null {
        const available = this.getAvailableKey();
        return available?.key || null;
    }

    /**
     * Get a GoogleGenAI client with the current key
     */
    getClient(): GoogleGenAI {
        const key = this.getCurrentKey();
        if (!key) {
            throw new Error('APIキーが設定されていません。設定画面でAPIキーを入力してください。');
        }

        // Reuse cached client if available
        if (this.clientCache.has(key)) {
            return this.clientCache.get(key)!;
        }

        const client = new GoogleGenAI({ apiKey: key });
        this.clientCache.set(key, client);
        return client;
    }

    /**
     * Get the next available (non-rate-limited) key
     */
    private getAvailableKey(): ApiKeyInfo | null {
        if (this.keys.length === 0) return null;

        const now = Date.now();

        // First, try the current key
        const currentKey = this.keys[this.currentKeyIndex];
        if (currentKey && (!currentKey.rateLimitedUntil || currentKey.rateLimitedUntil <= now)) {
            return currentKey;
        }

        // Find any available key
        for (let i = 0; i < this.keys.length; i++) {
            const keyInfo = this.keys[i];
            if (!keyInfo.rateLimitedUntil || keyInfo.rateLimitedUntil <= now) {
                this.currentKeyIndex = i;
                this.updateActiveStatus();
                console.info(`[ApiKeyRotation] Switched to ${keyInfo.id}`);
                this.notifyListeners();
                return keyInfo;
            }
        }

        // All keys are rate limited, return the one that will be available soonest
        const sorted = [...this.keys].sort((a, b) =>
            (a.rateLimitedUntil || 0) - (b.rateLimitedUntil || 0)
        );
        return sorted[0] || null;
    }

    /**
     * Record a successful API call
     */
    recordUsage(): void {
        const currentKey = this.keys[this.currentKeyIndex];
        if (currentKey) {
            currentKey.usageCount++;
            currentKey.lastUsedAt = Date.now();
            this.saveUsageToStorage();
            this.notifyListeners();
        }
    }

    /**
     * Handle a rate limit error - mark current key and rotate
     */
    handleRateLimit(retryAfterMs?: number): void {
        const currentKey = this.keys[this.currentKeyIndex];
        if (!currentKey) return;

        const cooldown = retryAfterMs || RATE_LIMIT_COOLDOWN;
        currentKey.rateLimitedUntil = Date.now() + cooldown;

        console.warn(`[ApiKeyRotation] ${currentKey.id} rate limited for ${cooldown}ms`);

        // Try to rotate to next key
        const nextIndex = (this.currentKeyIndex + 1) % this.keys.length;
        if (nextIndex !== this.currentKeyIndex) {
            this.currentKeyIndex = nextIndex;
            this.updateActiveStatus();
            console.info(`[ApiKeyRotation] Rotated to ${this.keys[nextIndex].id}`);
        }

        this.saveUsageToStorage();
        this.notifyListeners();
    }

    /**
     * Update active status for all keys
     */
    private updateActiveStatus(): void {
        this.keys.forEach((key, index) => {
            key.isActive = index === this.currentKeyIndex;
        });
    }

    /**
     * Get current rate limit status for UI display
     */
    getStatus(): RateLimitStatus {
        const now = Date.now();
        const availableKeys = this.keys.filter(k => !k.rateLimitedUntil || k.rateLimitedUntil <= now);
        const currentKey = this.keys[this.currentKeyIndex];

        // Estimate usage percentage based on usage count
        const totalUsage = this.keys.reduce((sum, k) => sum + k.usageCount, 0);
        const maxUsage = this.keys.length * USAGE_THRESHOLD_PER_KEY;
        const usagePercentage = Math.min(100, (totalUsage / maxUsage) * 100);

        // Find earliest reset time among rate-limited keys
        const rateLimitedKeys = this.keys.filter(k => k.rateLimitedUntil && k.rateLimitedUntil > now);
        const earliestReset = rateLimitedKeys.length > 0
            ? Math.min(...rateLimitedKeys.map(k => k.rateLimitedUntil!))
            : null;

        return {
            currentKeyId: currentKey?.id || 'none',
            totalKeys: this.keys.length,
            availableKeys: availableKeys.length,
            usagePercentage,
            estimatedResetTime: earliestReset,
            isRateLimited: availableKeys.length === 0,
        };
    }

    /**
     * Subscribe to status changes
     */
    subscribe(listener: (status: RateLimitStatus) => void): () => void {
        this.listeners.add(listener);
        // Immediately notify with current status
        listener(this.getStatus());

        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Notify all listeners of status change
     */
    private notifyListeners(): void {
        const status = this.getStatus();
        this.listeners.forEach(listener => listener(status));
    }

    /**
     * Add a new API key
     */
    addKey(key: string): boolean {
        if (!key?.startsWith('AIza')) {
            console.warn('[ApiKeyRotation] Invalid API key format');
            return false;
        }

        // Check for duplicates
        if (this.keys.some(k => k.key === key)) {
            console.warn('[ApiKeyRotation] Key already exists');
            return false;
        }

        this.keys.push({
            key,
            id: `key_${this.keys.length + 1}`,
            usageCount: 0,
            lastUsedAt: 0,
            rateLimitedUntil: null,
            isActive: false,
        });

        // Save to localStorage
        try {
            const storedKeys = this.keys.map(k => k.key);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(storedKeys));
        } catch (e) {
            console.warn('Failed to save API keys:', e);
        }

        this.notifyListeners();
        console.info(`[ApiKeyRotation] Added new key, total: ${this.keys.length}`);
        return true;
    }

    /**
     * Remove an API key by ID
     */
    removeKey(keyId: string): boolean {
        const index = this.keys.findIndex(k => k.id === keyId);
        if (index === -1) return false;

        this.keys.splice(index, 1);

        // Adjust current index if needed
        if (this.currentKeyIndex >= this.keys.length) {
            this.currentKeyIndex = Math.max(0, this.keys.length - 1);
        }
        this.updateActiveStatus();

        // Save to localStorage
        try {
            const storedKeys = this.keys.map(k => k.key);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(storedKeys));
        } catch (e) {
            console.warn('Failed to save API keys:', e);
        }

        this.notifyListeners();
        return true;
    }

    /**
     * Get list of key IDs (for UI display, not exposing actual keys)
     */
    getKeyList(): { id: string; isActive: boolean; isRateLimited: boolean; usageCount: number }[] {
        const now = Date.now();
        return this.keys.map(k => ({
            id: k.id,
            isActive: k.isActive,
            isRateLimited: k.rateLimitedUntil !== null && k.rateLimitedUntil > now,
            usageCount: k.usageCount,
        }));
    }

    /**
     * Reset all usage data
     */
    resetUsage(): void {
        this.keys.forEach(k => {
            k.usageCount = 0;
            k.rateLimitedUntil = null;
        });
        this.saveUsageToStorage();
        this.notifyListeners();
    }

    /**
     * Check if we have any valid API keys
     */
    hasValidKey(): boolean {
        return this.keys.length > 0;
    }
}

// Singleton instance
export const apiKeyRotation = new ApiKeyRotationService();
