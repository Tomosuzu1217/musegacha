
import { GoogleGenAI, Type, Modality } from '@google/genai';
import { Question, OutputFormat, Difficulty, Character, NewspaperContent, NoteArticleContent, ChatMessage, CharacterComment } from '../types';
import { storageService } from './storageService';
import { apiKeyRotation } from './apiKeyRotation';

// @ts-ignore - Defined in vite.config.ts
declare const __GEMINI_API_KEY__: string;

// --- Constants ---
const CONFIG = {
  TTS: {
    CACHE_MAX_SIZE: 100,
    ADAPTIVE_DELAY_MIN: 1000, // 400->1000 (緩和)
    ADAPTIVE_DELAY_MAX: 2000,
    ADAPTIVE_DELAY_INITIAL: 1000, // 600->1000 (緩和)
    MAX_CONCURRENT: 1, // 3->1 (直列実行に変更)
    MAX_CHUNK_SIZE: 200,
    MIN_CHUNK_SIZE: 50,
  },
  SCRIPT: {
    CACHE_MAX_SIZE: 50,
    CACHE_TTL: 30 * 60 * 1000, // 30分
    MAX_CONCURRENT: 2, // 同時スクリプト生成数
  },
  API: {
    MIN_INTERVAL: 500,
    MAX_RETRIES: 3, // 2->3 (リトライ増加)
    RETRY_DELAY_MAX: 10000, // 3000->10000 (最大10秒待機許可)
  },
  INDEXEDDB: {
    DB_NAME: 'musegacha-tts-cache',
    STORE_NAME: 'audio-cache',
    VERSION: 1,
    MAX_AGE: 7 * 24 * 60 * 60 * 1000,
    MAX_ENTRIES: 200,
  },
  AUDIO: {
    CHUNK_SIZE: 10000,
    SAMPLE_RATE: 24000,
  },
};

// --- Logger Utility ---
const LOG_LEVEL = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const currentLogLevel = LOG_LEVEL.INFO;

// Sanitize error messages to prevent API key leakage
const sanitizeForLog = (error: any): string => {
  if (!error) return '';
  const message = error?.message || String(error);
  // Remove API key or sensitive data from error messages
  return message
    .replace(/AIza[A-Za-z0-9_-]+/g, '[API_KEY_REDACTED]')
    .replace(/key=.*?(&|$)/g, 'key=[REDACTED]$1')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
    .replace(/authorization:.*$/gim, 'authorization: [REDACTED]')
    .replace(/x-goog-api-key:.*$/gim, 'x-goog-api-key: [REDACTED]');
};

export const logger = {
  debug: (msg: string, data?: any) => {
    if (currentLogLevel <= LOG_LEVEL.DEBUG) {
      const safeData = data instanceof Error ? sanitizeForLog(data) : data;
      console.log(`[DEBUG] ${msg}`, safeData !== undefined ? safeData : '');
    }
  },
  info: (msg: string, data?: any) => {
    if (currentLogLevel <= LOG_LEVEL.INFO) {
      const safeData = data instanceof Error ? sanitizeForLog(data) : data;
      console.log(`[INFO] ${msg}`, safeData !== undefined ? safeData : '');
    }
  },
  warn: (msg: string, error?: any) => {
    if (currentLogLevel <= LOG_LEVEL.WARN) {
      console.warn(`[WARN] ${msg}`, sanitizeForLog(error));
    }
  },
  error: (msg: string, error?: any) => {
    if (currentLogLevel <= LOG_LEVEL.ERROR) {
      console.error(`[ERROR] ${msg}`, sanitizeForLog(error));
    }
  },
};

// --- Error Handling Utility ---
export interface ApiError {
  code: string;
  userMessage: string;
  technicalMessage: string;
  retryable: boolean;
}

export const classifyApiError = (error: any): ApiError => {
  const msg = error?.message || String(error);

  // レート制限
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    // Automatically rotate to next API key
    apiKeyRotation.handleRateLimit();
    const status = apiKeyRotation.getStatus();
    const keyInfo = status.availableKeys > 0
      ? `別のAPIキーに切り替えました (${status.availableKeys}/${status.totalKeys} 利用可能)`
      : 'すべてのAPIキーがレート制限中です';
    return {
      code: 'RATE_LIMIT',
      userMessage: `APIレート制限に達しました。${keyInfo}`,
      technicalMessage: msg,
      retryable: status.availableKeys > 0,
    };
  }

  // 認証エラー
  if (msg.includes('401') || msg.includes('UNAUTHENTICATED') || msg.includes('API key')) {
    return {
      code: 'INVALID_KEY',
      userMessage: 'APIキーが無効です。設定画面でAPIキーを確認してください。',
      technicalMessage: msg,
      retryable: false,
    };
  }

  // ネットワークエラー
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ENOTFOUND')) {
    return {
      code: 'NETWORK_ERROR',
      userMessage: 'ネットワーク接続を確認してください。',
      technicalMessage: msg,
      retryable: true,
    };
  }

  // クォータ超過
  if (msg.includes('QUOTA_EXCEEDED') || msg.includes('quota')) {
    return {
      code: 'QUOTA_EXCEEDED',
      userMessage: 'API使用量の上限に達しました。明日再試行してください。',
      technicalMessage: msg,
      retryable: false,
    };
  }

  // サーバーエラー
  if (msg.includes('500') || msg.includes('503') || msg.includes('INTERNAL')) {
    return {
      code: 'SERVER_ERROR',
      userMessage: 'サーバーが一時的に利用できません。しばらく待ってから再試行してください。',
      technicalMessage: msg,
      retryable: true,
    };
  }

  // 不明なエラー
  return {
    code: 'UNKNOWN',
    userMessage: 'エラーが発生しました。しばらく待ってから再試行してください。',
    technicalMessage: msg,
    retryable: true,
  };
};

// --- Network Utility ---
export const isOnline = (): boolean => {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
};

export const makeApiCallWithRetry = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = CONFIG.API.MAX_RETRIES
): Promise<T> => {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      if (!isOnline()) {
        throw new Error('No internet connection');
      }
      const result = await fn();
      // Record successful API usage for rate limit tracking
      apiKeyRotation.recordUsage();
      return result;
    } catch (error: any) {
      const classified = classifyApiError(error);

      if (!classified.retryable || i >= maxRetries) {
        throw error;
      }

      const delay = Math.min(Math.pow(2, i) * 1000, CONFIG.API.RETRY_DELAY_MAX);
      logger.warn(`API call failed, retrying in ${delay}ms... (attempt ${i + 1}/${maxRetries})`, error);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Max retries exceeded');
};

// --- Security Utilities ---

// Rate limiting for API calls
const rateLimiter = {
  lastCallTime: 0,
  minInterval: 500, // Minimum 500ms between calls
  canCall: function (): boolean {
    const now = Date.now();
    if (now - this.lastCallTime >= this.minInterval) {
      this.lastCallTime = now;
      return true;
    }
    return false;
  },
  waitForNext: async function (): Promise<void> {
    const now = Date.now();
    const waitTime = Math.max(0, this.minInterval - (now - this.lastCallTime));
    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    this.lastCallTime = Date.now();
  }
};

// Sanitize error messages to prevent information leakage
const sanitizeErrorMessage = (error: any): string => {
  const message = error?.message || String(error);
  // Remove API key or sensitive data from error messages
  const sanitized = message
    .replace(/AIza[A-Za-z0-9_-]+/g, '[API_KEY_REDACTED]')
    .replace(/key=.*?(&|$)/g, 'key=[REDACTED]$1')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]');
  return sanitized;
};

// Validate and sanitize user input for prompts
const sanitizePromptInput = (input: string): string => {
  if (typeof input !== 'string') return '';
  // Remove potential prompt injection patterns
  return input
    .replace(/\[INST\]/gi, '')
    .replace(/\[\/INST\]/gi, '')
    .replace(/<<SYS>>/gi, '')
    .replace(/<<\/SYS>>/gi, '')
    .replace(/<\|im_start\|>/gi, '')
    .replace(/<\|im_end\|>/gi, '')
    .slice(0, 10000); // Limit input length
};

const getClient = () => {
  // Use the API key rotation service for multi-key support
  return apiKeyRotation.getClient();
};

// --- TTS with Web Speech API fallback ---

// TTSキャッシュ（同じテキストの再生成を防ぐ）- サイズ制限付き
const TTS_CACHE_MAX_SIZE = 100; // 50→100に拡大
const ttsCache = new Map<string, Uint8Array>();

// キャッシュキーのハッシュ化（プライバシー保護）
const hashCacheKey = async (key: string): Promise<string> => {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(key);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // フォールバック: 単純なハッシュ
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return 'fallback_' + Math.abs(hash).toString(16);
  }
};

// キャッシュキーのマッピング（メモリ内のみ、プレーンテキストキー → ハッシュキー）
const cacheKeyMap = new Map<string, string>();

const getHashedKey = async (plainKey: string): Promise<string> => {
  const cached = cacheKeyMap.get(plainKey);
  if (cached) return cached;

  const hashed = await hashCacheKey(plainKey);
  cacheKeyMap.set(plainKey, hashed);
  return hashed;
};

const addToTTSCache = (key: string, value: Uint8Array): void => {
  // LRU-like: oldest entries removed first
  if (ttsCache.size >= TTS_CACHE_MAX_SIZE) {
    const firstKey = ttsCache.keys().next().value;
    if (firstKey) ttsCache.delete(firstKey);
  }
  ttsCache.set(key, value);

  // IndexedDBにはハッシュ化されたキーで保存（非同期）
  getHashedKey(key).then(hashedKey => {
    saveTTSToIndexedDB(hashedKey, value).catch(() => { });
  }).catch(() => { });
};

// --- IndexedDB永続キャッシュ ---
const INDEXEDDB_CONFIG = {
  dbName: 'musegacha-tts-cache',
  storeName: 'audio-cache',
  version: 1,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7日間保持
  maxEntries: 200, // 最大200エントリ
};

let dbInstance: IDBDatabase | null = null;

// IndexedDBを開く
const openTTSDatabase = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(INDEXEDDB_CONFIG.dbName, INDEXEDDB_CONFIG.version);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(INDEXEDDB_CONFIG.storeName)) {
        const store = db.createObjectStore(INDEXEDDB_CONFIG.storeName, { keyPath: 'key' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
};

// IndexedDBにTTSデータを保存
const saveTTSToIndexedDB = async (key: string, data: Uint8Array): Promise<void> => {
  try {
    const db = await openTTSDatabase();
    const transaction = db.transaction(INDEXEDDB_CONFIG.storeName, 'readwrite');
    const store = transaction.objectStore(INDEXEDDB_CONFIG.storeName);

    const entry = {
      key,
      data: Array.from(data), // Uint8Arrayは直接保存できないのでArrayに変換
      timestamp: Date.now(),
    };

    store.put(entry);

    // 古いエントリを削除（非同期で実行）
    cleanupOldTTSEntries().catch(() => { });
  } catch (e) {
    logger.warn('Failed to save TTS to IndexedDB', e);
  }
};

// IndexedDBからTTSデータを取得
const getTTSFromIndexedDB = async (key: string): Promise<Uint8Array | null> => {
  try {
    const db = await openTTSDatabase();
    const transaction = db.transaction(INDEXEDDB_CONFIG.storeName, 'readonly');
    const store = transaction.objectStore(INDEXEDDB_CONFIG.storeName);

    return new Promise((resolve) => {
      const request = store.get(key);

      request.onsuccess = () => {
        const entry = request.result;
        if (entry && Date.now() - entry.timestamp < INDEXEDDB_CONFIG.maxAge) {
          resolve(new Uint8Array(entry.data));
        } else {
          resolve(null);
        }
      };

      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
};

// 古いエントリをクリーンアップ
const cleanupOldTTSEntries = async (): Promise<void> => {
  try {
    const db = await openTTSDatabase();
    const transaction = db.transaction(INDEXEDDB_CONFIG.storeName, 'readwrite');
    const store = transaction.objectStore(INDEXEDDB_CONFIG.storeName);
    const index = store.index('timestamp');

    const cutoffTime = Date.now() - INDEXEDDB_CONFIG.maxAge;

    // 期限切れエントリを削除
    const expiredRequest = index.openCursor(IDBKeyRange.upperBound(cutoffTime));
    expiredRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    // エントリ数が多すぎる場合は古い順に削除
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      if (countRequest.result > INDEXEDDB_CONFIG.maxEntries) {
        const deleteCount = countRequest.result - INDEXEDDB_CONFIG.maxEntries;
        const oldestRequest = index.openCursor();
        let deleted = 0;
        oldestRequest.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (cursor && deleted < deleteCount) {
            cursor.delete();
            deleted++;
            cursor.continue();
          }
        };
      }
    };
  } catch (e) {
    logger.warn('Failed to cleanup TTS cache', e);
  }
};

// 起動時にIndexedDBからメモリキャッシュを復元
export const initializeTTSCache = async (): Promise<number> => {
  try {
    const db = await openTTSDatabase();
    const transaction = db.transaction(INDEXEDDB_CONFIG.storeName, 'readonly');
    const store = transaction.objectStore(INDEXEDDB_CONFIG.storeName);

    return new Promise((resolve) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const entries = request.result || [];
        const now = Date.now();
        let restoredCount = 0;

        for (const entry of entries) {
          if (now - entry.timestamp < INDEXEDDB_CONFIG.maxAge) {
            ttsCache.set(entry.key, new Uint8Array(entry.data));
            restoredCount++;
          }
        }

        console.info(`TTS cache initialized: ${restoredCount} entries restored from IndexedDB`);
        resolve(restoredCount);
      };
      request.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
};

// --- 並列音声生成のための設定 ---
const PARALLEL_TTS_CONFIG = {
  maxConcurrent: 1, // 同時実行数 (3->1)
  minIntervalMs: 1000, // 最小間隔 (600->1000)
  lastCallTimes: [] as number[],
  // アダプティブレート制限
  adaptiveDelay: 1000, // 初期値 (600->1000)
  consecutiveSuccesses: 0,
  consecutiveFailures: 0,
};

// アダプティブレート制限の調整
const adjustAdaptiveDelay = (success: boolean) => {
  if (success) {
    PARALLEL_TTS_CONFIG.consecutiveSuccesses++;
    PARALLEL_TTS_CONFIG.consecutiveFailures = 0;
    // 3回連続成功で待機時間を減少（最小400ms）
    if (PARALLEL_TTS_CONFIG.consecutiveSuccesses >= 3) {
      PARALLEL_TTS_CONFIG.adaptiveDelay = Math.max(400, PARALLEL_TTS_CONFIG.adaptiveDelay - 50);
      PARALLEL_TTS_CONFIG.consecutiveSuccesses = 0;
    }
  } else {
    PARALLEL_TTS_CONFIG.consecutiveFailures++;
    PARALLEL_TTS_CONFIG.consecutiveSuccesses = 0;
    // 失敗時は待機時間を増加（最大2000ms）
    PARALLEL_TTS_CONFIG.adaptiveDelay = Math.min(2000, PARALLEL_TTS_CONFIG.adaptiveDelay + 200);
  }
};

// レースコンディション防止用のミューテックス
let parallelSlotMutex: Promise<void> = Promise.resolve();

// 並列処理用のレート制限付き待機（アダプティブ）- ミューテックスで保護
const waitForParallelSlot = async (): Promise<void> => {
  // ミューテックスで排他制御
  const currentMutex = parallelSlotMutex;
  let releaseMutex: () => void;
  parallelSlotMutex = new Promise(resolve => {
    releaseMutex = resolve;
  });

  await currentMutex;

  try {
    const now = Date.now();
    const adaptiveInterval = PARALLEL_TTS_CONFIG.adaptiveDelay;

    // 古い呼び出し時刻を削除（アダプティブ間隔を使用）
    PARALLEL_TTS_CONFIG.lastCallTimes = PARALLEL_TTS_CONFIG.lastCallTimes.filter(
      t => now - t < adaptiveInterval
    );

    // 同時実行数に達している場合は待機
    if (PARALLEL_TTS_CONFIG.lastCallTimes.length >= PARALLEL_TTS_CONFIG.maxConcurrent) {
      const oldestCall = Math.min(...PARALLEL_TTS_CONFIG.lastCallTimes);
      const waitTime = adaptiveInterval - (now - oldestCall);
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      PARALLEL_TTS_CONFIG.lastCallTimes = PARALLEL_TTS_CONFIG.lastCallTimes.filter(
        t => Date.now() - t < adaptiveInterval
      );
    }

    PARALLEL_TTS_CONFIG.lastCallTimes.push(Date.now());
  } finally {
    // ミューテックスを解放
    releaseMutex!();
  }
};

// Web Speech API フォールバック用の設定
const VOICE_MAPPING: Record<string, { lang: string; voiceKeywords: string[] }> = {
  'Kore': { lang: 'ja-JP', voiceKeywords: ['Google', 'Haruka', 'Microsoft', 'Sayaka'] },
  'Fenrir': { lang: 'ja-JP', voiceKeywords: ['Google', 'Ichiro', 'Microsoft', 'Kenji'] },
  'Charon': { lang: 'ja-JP', voiceKeywords: ['Google', 'Takumi', 'Microsoft', 'Naoki'] },
  'Aoede': { lang: 'ja-JP', voiceKeywords: ['Google', 'Mizuki', 'Microsoft', 'Ayumi'] },
  'Puck': { lang: 'ja-JP', voiceKeywords: ['Google', 'Mizuki', 'Microsoft', 'Nanami'] },
};

// Web Speech APIで音声を取得
const getWebSpeechVoice = (voiceName: string): SpeechSynthesisVoice | null => {
  const voices = window.speechSynthesis.getVoices();
  const config = VOICE_MAPPING[voiceName] || { lang: 'ja-JP', voiceKeywords: ['Google', 'Microsoft'] };

  // 優先順位で音声を探す
  for (const keyword of config.voiceKeywords) {
    const voice = voices.find(v => v.lang.startsWith(config.lang.split('-')[0]) && v.name.includes(keyword));
    if (voice) return voice;
  }

  // 言語だけで探す
  const langVoice = voices.find(v => v.lang.startsWith(config.lang.split('-')[0]));
  if (langVoice) return langVoice;

  // 最終フォールバック
  return voices[0] || null;
};

// Web Speech API でテキストを読み上げ（AudioBufferを返さないがプレイバック時に使用）
export const speakWithWebSpeech = (text: string, voiceName: string, pitch = 1.0, rate = 1.0): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      reject(new Error('Web Speech API not supported'));
      return;
    }

    // 音声リストが空の場合は待機
    const trySpeak = () => {
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = getWebSpeechVoice(voiceName);

      if (voice) {
        utterance.voice = voice;
      }
      utterance.lang = 'ja-JP';
      utterance.pitch = pitch;
      utterance.rate = rate;

      utterance.onend = () => resolve();
      utterance.onerror = (e) => {
        logger.warn('Web Speech error', e);
        resolve(); // エラーでも続行
      };

      window.speechSynthesis.speak(utterance);
    };

    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = trySpeak;
    } else {
      trySpeak();
    }
  });
};

// --- テキスト分割ユーティリティ ---
const TEXT_SPLIT_CONFIG = {
  maxChunkSize: 200, // 1チャンクの最大文字数
  minChunkSize: 50,  // 最小文字数（これ以下は分割しない）
  splitPatterns: [
    /([。！？\n])/,  // 句点、感嘆符、疑問符、改行
    /(、)/,          // 読点
    /(\s)/,          // 空白
  ],
};

// テキストを適切な位置で分割
const splitTextForTTS = (text: string): string[] => {
  if (text.length <= TEXT_SPLIT_CONFIG.maxChunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= TEXT_SPLIT_CONFIG.maxChunkSize) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = -1;

    // 最大サイズ以内で最適な分割位置を探す
    for (const pattern of TEXT_SPLIT_CONFIG.splitPatterns) {
      const searchArea = remaining.slice(0, TEXT_SPLIT_CONFIG.maxChunkSize);
      const matches = [...searchArea.matchAll(new RegExp(pattern, 'g'))];

      if (matches.length > 0) {
        // 最後のマッチ位置を使用
        const lastMatch = matches[matches.length - 1];
        splitIndex = lastMatch.index! + lastMatch[0].length;
        break;
      }
    }

    // 分割位置が見つからない場合は最大サイズで強制分割
    if (splitIndex <= 0 || splitIndex < TEXT_SPLIT_CONFIG.minChunkSize) {
      splitIndex = TEXT_SPLIT_CONFIG.maxChunkSize;
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks.filter(c => c.length > 0);
};

// 分割テキストの音声を生成して結合
export const generateSpeechWithSplit = async (
  text: string,
  voiceName: string
): Promise<Uint8Array | null> => {
  const ttsMode = getTTSMode();
  if (ttsMode === 'webspeech') return null;

  // 短いテキストは通常の生成
  if (text.length <= TEXT_SPLIT_CONFIG.maxChunkSize) {
    return generateSpeech(text, voiceName);
  }

  // テキストを分割
  const chunks = splitTextForTTS(text);
  if (chunks.length === 1) {
    return generateSpeech(chunks[0], voiceName);
  }

  console.info(`Splitting long text (${text.length} chars) into ${chunks.length} chunks`);

  // 並列生成（順序を保持）
  const results: (Uint8Array | null)[] = [];
  const promises = chunks.map(async (chunk, index) => {
    const data = await generateSpeech(chunk, voiceName);
    return { index, data };
  });

  const settled = await Promise.allSettled(promises);
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value.data) {
      results[result.value.index] = result.value.data;
    }
  }

  // 結果を結合
  const validResults = results.filter((r): r is Uint8Array => r !== null);
  if (validResults.length === 0) return null;

  // すべてのチャンクが成功した場合のみ結合
  if (validResults.length === chunks.length) {
    const totalLength = validResults.reduce((sum, arr) => sum + arr.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of validResults) {
      combined.set(arr, offset);
      offset += arr.length;
    }
    return combined;
  }

  // 一部失敗した場合は最初のチャンクを返す
  return validResults[0] || null;
};

// ヘルパー: リトライ待機時間を取得
const getRetryDelay = (error: any): number => {
  try {
    const errorStr = error.message || String(error);
    const match = errorStr.match(/retryDelay.*?(\d+)/);
    if (match) return parseInt(match[1], 10) * 1000 + 500;
  } catch { }
  return 20000;
};

// ヘルパー: 指定ミリ秒待機
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// TTS設定を取得（LocalStorageから）
export const getTTSMode = (): 'gemini' | 'webspeech' | 'auto' => {
  try {
    const mode = localStorage.getItem('tts_mode');
    if (mode === 'gemini' || mode === 'webspeech' || mode === 'auto') {
      return mode;
    }
  } catch { }
  return 'auto'; // デフォルトはauto（Gemini失敗時にWebSpeech）
};

export const setTTSMode = (mode: 'gemini' | 'webspeech' | 'auto') => {
  localStorage.setItem('tts_mode', mode);
};

// Gemini TTS APIを呼び出し（内部用）
const callGeminiTTS = async (text: string, voiceName: string): Promise<Uint8Array | null> => {
  // Sanitize text input (limit length, remove control chars)
  const safeText = text
    .slice(0, 1000) // TTS text limit
    .replace(/[\x00-\x1F\x7F]/g, ''); // Remove control characters

  if (!safeText.trim()) return null;

  const ai = getClient();
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [{ parts: [{ text: safeText }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName }
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    return null;
  }

  const binaryString = atob(base64Audio);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

export const generateSpeech = async (text: string, voiceName: string, retryCount = 0): Promise<Uint8Array | null> => {
  const MAX_RETRIES_AUTO = 3; // autoモードのリトライ回数
  const MAX_RETRIES_GEMINI = 20; // geminiモードは長く待機（最大約30分）

  if (!text || text.trim().length === 0) return null;

  // 句読点のみのテキストはスキップ
  if (/^[…\.\-\s　、。！？!?・]+$/.test(text)) {
    return null;
  }

  const hasSpeakableContent = /[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text);
  if (!hasSpeakableContent) {
    return null;
  }

  // キャッシュ確認（メモリ）
  const cacheKey = `${text}_${voiceName}`;
  if (ttsCache.has(cacheKey)) {
    return ttsCache.get(cacheKey)!;
  }

  // IndexedDBキャッシュを確認
  const indexedDBData = await getTTSFromIndexedDB(cacheKey);
  if (indexedDBData) {
    ttsCache.set(cacheKey, indexedDBData); // メモリキャッシュにも追加
    return indexedDBData;
  }

  const ttsMode = getTTSMode();

  // WebSpeechモードの場合はnullを返す（再生時にspeakWithWebSpeechを使う）
  if (ttsMode === 'webspeech') {
    return null; // nullを返すとDebateSessionでWeb Speech APIを使用
  }

  // Geminiモードまたはautoモードの最大リトライ回数を決定
  const maxRetries = ttsMode === 'gemini' ? MAX_RETRIES_GEMINI : MAX_RETRIES_AUTO;

  // Geminiモードまたはautoモード
  try {
    // 並列処理用のスロット待機
    await waitForParallelSlot();

    const bytes = await callGeminiTTS(text, voiceName);
    if (bytes) {
      addToTTSCache(cacheKey, bytes);
      adjustAdaptiveDelay(true); // 成功時にアダプティブ調整
      apiKeyRotation.recordUsage(); // 成功時に使用量を記録
      return bytes;
    }
    adjustAdaptiveDelay(false); // 結果がnullの場合も失敗扱い
    return null;
  } catch (error: any) {
    const errorStr = error.message || String(error);

    // 429エラー（レート制限）の場合
    if (errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED')) {
      adjustAdaptiveDelay(false); // レート制限時はアダプティブ調整

      // APIキーローテーションを実行
      apiKeyRotation.handleRateLimit();
      const status = apiKeyRotation.getStatus();

      logger.warn(`TTS Rate limit hit on key. Available keys: ${status.availableKeys}/${status.totalKeys}`);

      if (retryCount < maxRetries) {
        // 利用可能なキーがある場合は短い待機でリトライ
        if (status.availableKeys > 0) {
          const shortDelay = 500 + (retryCount * 500); // 0.5s, 1s, 1.5s
          logger.info(`Rotated to new key. Retrying in ${shortDelay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
          await sleep(shortDelay);
          return generateSpeech(text, voiceName, retryCount + 1);
        }

        // 全キーがレート制限中の場合
        if (ttsMode === 'gemini') {
          // Geminiモード: 長めに待機して必ずリトライ（指数バックオフ、最大60秒）
          const baseDelay = 5000; // 5秒から開始
          const exponentialDelay = Math.min(baseDelay * Math.pow(1.5, retryCount), 60000);
          const retryDelay = getRetryDelay(error);
          const delay = Math.max(retryDelay, exponentialDelay);

          logger.warn(`[Gemini Mode] All keys rate limited. Waiting ${delay / 1000}s before retry... (attempt ${retryCount + 1}/${maxRetries})`);
          console.info(`音声生成待機中... (${Math.round(delay / 1000)}秒後に再試行 - ${retryCount + 1}/${maxRetries})`);
          await sleep(delay);
          return generateSpeech(text, voiceName, retryCount + 1);
        } else {
          // autoモード: 短い指数バックオフ
          const exponentialDelay = 2000 * Math.pow(2, retryCount);
          const retryDelay = getRetryDelay(error);
          const delay = Math.min(Math.max(retryDelay, exponentialDelay), CONFIG.API.RETRY_DELAY_MAX);

          logger.warn(`All keys rate limited. Waiting ${delay / 1000}s... (attempt ${retryCount + 1}/${maxRetries})`);
          await sleep(delay);
          return generateSpeech(text, voiceName, retryCount + 1);
        }
      }

      // リトライ上限に達した場合
      if (ttsMode === 'gemini') {
        // Geminiモード: さらに長く待機して再試行（60秒待機後にリトライカウントをリセット）
        logger.warn('[Gemini Mode] Max retries reached. Waiting 60s then resetting retry count...');
        console.info('Gemini TTS: レート制限継続中。60秒後に再試行します...');
        await sleep(60000);
        return generateSpeech(text, voiceName, 0); // リトライカウントをリセット
      } else {
        // autoモード: Web Speech APIにフォールバック
        console.info('Gemini TTS rate limited after all retries. Falling back to Web Speech API.');
        return null;
      }
    }

    adjustAdaptiveDelay(false); // その他のエラーもアダプティブ調整
    logger.warn('TTS Generation failed:', error);

    // Geminiモードでの一般エラー: リトライ
    if (ttsMode === 'gemini' && retryCount < maxRetries) {
      const delay = 2000 * Math.pow(1.5, retryCount);
      logger.info(`[Gemini Mode] Retrying after error in ${delay}ms...`);
      await sleep(delay);
      return generateSpeech(text, voiceName, retryCount + 1);
    }

    return null;
  }
};

// 並列音声生成（複数テキストを同時に処理）
export interface ParallelTTSTask {
  id: string;
  text: string;
  voiceName: string;
}

export interface ParallelTTSResult {
  id: string;
  data: Uint8Array | null;
  error?: string;
}

export const generateSpeechParallel = async (
  tasks: ParallelTTSTask[],
  onProgress?: (completed: number, total: number, currentId: string) => void
): Promise<Map<string, Uint8Array | null>> => {
  const results = new Map<string, Uint8Array | null>();
  const ttsMode = getTTSMode();

  // WebSpeechモードの場合は全てnull
  if (ttsMode === 'webspeech') {
    tasks.forEach(task => results.set(task.id, null));
    return results;
  }

  // キャッシュ済みのタスクを分離
  const cachedTasks: ParallelTTSTask[] = [];
  const pendingTasks: ParallelTTSTask[] = [];

  for (const task of tasks) {
    const cacheKey = `${task.text}_${task.voiceName}`;
    if (ttsCache.has(cacheKey)) {
      results.set(task.id, ttsCache.get(cacheKey)!);
      cachedTasks.push(task);
    } else {
      pendingTasks.push(task);
    }
  }

  // 進捗報告（キャッシュ済み分）
  let completed = cachedTasks.length;
  if (onProgress && cachedTasks.length > 0) {
    onProgress(completed, tasks.length, 'cached');
  }

  // 並列処理（制限付き）- 長いテキストは分割生成
  const processBatch = async (batch: ParallelTTSTask[]) => {
    const promises = batch.map(async (task) => {
      try {
        // 長いテキストは分割生成を使用
        const data = task.text.length > TEXT_SPLIT_CONFIG.maxChunkSize
          ? await generateSpeechWithSplit(task.text, task.voiceName)
          : await generateSpeech(task.text, task.voiceName);
        results.set(task.id, data);
        completed++;
        if (onProgress) {
          onProgress(completed, tasks.length, task.id);
        }
        return { id: task.id, data };
      } catch (error: any) {
        results.set(task.id, null);
        completed++;
        if (onProgress) {
          onProgress(completed, tasks.length, task.id);
        }
        return { id: task.id, data: null, error: error.message };
      }
    });

    return Promise.allSettled(promises);
  };

  // バッチ処理（maxConcurrent件ずつ）
  const batchSize = PARALLEL_TTS_CONFIG.maxConcurrent;
  for (let i = 0; i < pendingTasks.length; i += batchSize) {
    const batch = pendingTasks.slice(i, i + batchSize);
    await processBatch(batch);
  }

  return results;
};

// --- Script Generation Logic ---

type ScriptPhase = 'intro' | 'discussion' | 'conclusion';

// スクリプトキャッシュ（同じ条件での再生成を防ぐ）
interface ScriptCacheEntry {
  messages: ChatMessage[];
  timestamp: number;
}
const scriptCache = new Map<string, ScriptCacheEntry>();

const getScriptCacheKey = (
  phase: ScriptPhase,
  question: string,
  userInput?: string
): string => {
  return `${phase}_${question}_${userInput || ''}`;
};

const getFromScriptCache = (key: string): ChatMessage[] | null => {
  const entry = scriptCache.get(key);
  if (entry && Date.now() - entry.timestamp < CONFIG.SCRIPT.CACHE_TTL) {
    logger.debug('Script cache hit', { key });
    return entry.messages;
  }
  return null;
};

const addToScriptCache = (key: string, messages: ChatMessage[]): void => {
  // LRU: 古いエントリを削除
  if (scriptCache.size >= CONFIG.SCRIPT.CACHE_MAX_SIZE) {
    const oldestKey = scriptCache.keys().next().value;
    if (oldestKey) scriptCache.delete(oldestKey);
  }
  scriptCache.set(key, { messages, timestamp: Date.now() });
};

// 並列スクリプト生成用のレート制限
const scriptRateLimiter = {
  lastCallTimes: [] as number[],
  waitForSlot: async function (): Promise<void> {
    const now = Date.now();
    const interval = CONFIG.API.MIN_INTERVAL;

    // 古い呼び出し時刻を削除
    this.lastCallTimes = this.lastCallTimes.filter(t => now - t < interval);

    // 同時実行数に達している場合は待機
    if (this.lastCallTimes.length >= CONFIG.SCRIPT.MAX_CONCURRENT) {
      const oldestCall = Math.min(...this.lastCallTimes);
      const waitTime = interval - (now - oldestCall);
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      this.lastCallTimes = this.lastCallTimes.filter(t => Date.now() - t < interval);
    }

    this.lastCallTimes.push(Date.now());
  }
};

// 並列スクリプト生成タスク
export interface ParallelScriptTask {
  id: string;
  phase: ScriptPhase;
  history: ChatMessage[];
  characters: Character[];
  question: string;
  userLastInput?: string;
}

// 並列スクリプト生成
export const generateScriptsParallel = async (
  tasks: ParallelScriptTask[],
  onProgress?: (completed: number, total: number, currentId: string) => void
): Promise<Map<string, ChatMessage[]>> => {
  const results = new Map<string, ChatMessage[]>();
  let completed = 0;

  // キャッシュチェック
  const pendingTasks: ParallelScriptTask[] = [];
  for (const task of tasks) {
    const cacheKey = getScriptCacheKey(task.phase, task.question, task.userLastInput);
    const cached = getFromScriptCache(cacheKey);
    if (cached) {
      results.set(task.id, cached);
      completed++;
      if (onProgress) onProgress(completed, tasks.length, task.id);
    } else {
      pendingTasks.push(task);
    }
  }

  // 並列処理（制限付き）
  const processBatch = async (batch: ParallelScriptTask[]) => {
    const promises = batch.map(async (task) => {
      try {
        await scriptRateLimiter.waitForSlot();
        const messages = await generateScriptSection(
          task.phase,
          task.history,
          task.characters,
          task.question,
          task.userLastInput
        );
        results.set(task.id, messages);
        completed++;
        if (onProgress) onProgress(completed, tasks.length, task.id);
        return { id: task.id, messages };
      } catch (error: any) {
        logger.error('Parallel script generation failed', error);
        results.set(task.id, []);
        completed++;
        if (onProgress) onProgress(completed, tasks.length, task.id);
        return { id: task.id, messages: [] };
      }
    });

    return Promise.allSettled(promises);
  };

  // バッチ処理
  const batchSize = CONFIG.SCRIPT.MAX_CONCURRENT;
  for (let i = 0; i < pendingTasks.length; i += batchSize) {
    const batch = pendingTasks.slice(i, i + batchSize);
    await processBatch(batch);
  }

  return results;
};

// スクリプト生成と音声生成を同時に実行
export const generateScriptWithAudio = async (
  phase: ScriptPhase,
  history: ChatMessage[],
  characters: Character[],
  question: string,
  userLastInput?: string,
  onScriptReady?: (messages: ChatMessage[]) => void
): Promise<{ messages: ChatMessage[]; audioData: Map<string, Uint8Array | null> }> => {
  // スクリプト生成
  const messages = await generateScriptSection(phase, history, characters, question, userLastInput);

  // スクリプトが準備できたことを通知
  if (onScriptReady) {
    onScriptReady(messages);
  }

  // 音声生成を並列で開始
  const ttsTasks: ParallelTTSTask[] = messages.map(msg => {
    const character = characters.find(c => c.id === msg.role);
    return {
      id: msg.id,
      text: msg.text,
      voiceName: character?.voiceName || 'Kore'
    };
  });

  const audioData = await generateSpeechParallel(ttsTasks);

  return { messages, audioData };
};

const ROLE_DEFINITIONS = {
  MODERATOR: "【役割: 進行役】中立的な立場から議論を整理し、ユーザー（主人公）の本音や思考の深層を引き出す鋭い問いを投げかける。自分の意見は控えめに、相手の話を広げることに徹する。",
  COMMENTATOR: "【役割: コメンテーター】独自の世界観と批判的思考を持ち、常識を疑う視点、皮肉、あるいは逆説的な意見を提示して議論を撹拌する。予定調和を壊すトリックスター。"
};

export const generateScriptSection = async (
  phase: ScriptPhase,
  history: ChatMessage[],
  characters: Character[],
  question: string,
  userLastInput?: string,
  retryCount = 0,
  maxRetries = 5
): Promise<ChatMessage[]> => {
  // introフェーズのみキャッシュを確認（discussion/conclusionはユーザー入力依存）
  if (phase === 'intro') {
    const cacheKey = getScriptCacheKey(phase, question);
    const cached = getFromScriptCache(cacheKey);
    if (cached) {
      logger.info('Using cached intro script');
      return cached;
    }
  }

  // Rate limiting
  await rateLimiter.waitForNext();

  const ai = getClient();

  const moderator = characters.find(c => c.id === 'moderator')!;
  const commentator = characters.find(c => c.id === 'commentator')!;

  // Sanitize user inputs
  const safeQuestion = sanitizePromptInput(question);
  const safeUserInput = userLastInput ? sanitizePromptInput(userLastInput) : '';
  const safeModeratorName = sanitizePromptInput(moderator.name);
  const safeCommentatorName = sanitizePromptInput(commentator.name);
  const safeModeratorPersona = sanitizePromptInput(moderator.persona);
  const safeCommentatorPersona = sanitizePromptInput(commentator.persona);

  const systemInstruction = `
    あなたは「${safeQuestion}」というテーマの対話劇の脚本家です。
    以下の登場人物になりきって脚本を書いてください。

    【登場人物1: ${safeModeratorName}】
    - 性格: ${safeModeratorPersona}
    - 今回の役割: ${ROLE_DEFINITIONS.MODERATOR}

    【登場人物2: ${safeCommentatorName}】
    - 性格: ${safeCommentatorPersona}
    - 今回の役割: ${ROLE_DEFINITIONS.COMMENTATOR}

    【ルール】
    - 出力はJSON配列形式です。
    - **各発言は必ず140文字以内の日本語にしてください。** 長すぎる発言は禁止です。
    - 会話のテンポを最重視してください。
    - ユーザー（You）の発言は既に入力されているため、それに対するリアクションと、議論の深掘りを行ってください。
    - 名前タグ（Host:など）は本文に入れないでください。
    - emotionフィールドには "neutral", "positive", "negative" のいずれかを指定し、発言内容に合った感情を入れてください。
  `;

  let prompt = "";

  if (phase === 'intro') {
    prompt = `
        テーマ「${safeQuestion}」について、討論を開始するための導入スクリプトを作成してください。

        構成:
        1. ${safeModeratorName}: テーマの紹介と簡単な挨拶。
        2. ${safeCommentatorName}: テーマに対する鋭い第一印象や皮肉。
        3. ${safeModeratorName}: ユーザー(主人公)に対して、どう思うか問いかける言葉。

        JSON Schema: Array<{ role: "moderator" | "commentator", text: string, emotion: "neutral" | "positive" | "negative" }>
      `;
  } else if (phase === 'discussion') {
    const context = history.slice(-5).map(m => `${m.role}: ${sanitizePromptInput(m.text)}`).join("\n");
    prompt = `
        直近の会話ログ:
        ${context}

        ユーザーの最新の発言: "${safeUserInput}"

        このユーザーの発言を受けて、議論を盛り上げるスクリプトを作成してください。

        構成:
        1. ${safeCommentatorName}: ユーザーの意見に対する批判、または逆説的な視点からのコメント。
        2. ${safeModeratorName}: 議論を整理し、さらに深い視点へ誘導する発言。
        3. ${safeCommentatorName}: (任意) 短い合いの手。
        4. ${safeModeratorName}: 次の視点についてユーザーに問いかける言葉。

        JSON Schema: Array<{ role: "moderator" | "commentator", text: string, emotion: "neutral" | "positive" | "negative" }>
      `;
  } else if (phase === 'conclusion') {
    const context = history.map(m => `${m.role}: ${sanitizePromptInput(m.text)}`).join("\n");
    prompt = `
        これまでの議論ログ:
        ${context}

        ユーザーの最新の発言: "${safeUserInput}"

        議論を総括し、番組を終了させるスクリプトを作成してください。

        構成:
        1. ${safeModeratorName}: ユーザーの意見を受け止めつつ、今日の議論の核心を突くまとめ。
        2. ${safeCommentatorName}: 最後に残るような、含蓄のある捨て台詞や教訓。
        3. ${safeModeratorName}: 番組の締めの挨拶。

        JSON Schema: Array<{ role: "moderator" | "commentator", text: string, emotion: "neutral" | "positive" | "negative" }>
       `;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              role: { type: Type.STRING, enum: ['moderator', 'commentator'] },
              text: { type: Type.STRING },
              emotion: { type: Type.STRING, enum: ['neutral', 'positive', 'negative'] }
            }
          }
        }
      }
    });

    const raw = response.text || "[]";

    // Safe JSON parse with validation
    let parsed: { role: string, text: string, emotion?: string }[];
    try {
      parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        logger.warn("Script response is not an array");
        return [];
      }
    } catch (parseError) {
      logger.error("Script JSON parse failed", parseError);
      return [];
    }

    // Validate and sanitize each message
    const messages = parsed
      .filter(p => p && typeof p.role === 'string' && typeof p.text === 'string')
      .filter(p => ['moderator', 'commentator'].includes(p.role))
      .map(p => ({
        id: crypto.randomUUID(),
        role: p.role as 'moderator' | 'commentator',
        text: p.text.slice(0, 500), // Limit text length
        timestamp: Date.now(),
        emotion: (p.emotion && ['neutral', 'positive', 'negative'].includes(p.emotion))
          ? p.emotion as 'neutral' | 'positive' | 'negative'
          : 'neutral'
      }));

    // introフェーズをキャッシュに保存
    if (phase === 'intro' && messages.length > 0) {
      const cacheKey = getScriptCacheKey(phase, question);
      addToScriptCache(cacheKey, messages);
      logger.debug('Cached intro script');
    }

    return messages;

  } catch (e: any) {
    const errorStr = sanitizeErrorMessage(e);
    const statusCode = e?.status || e?.response?.status || (errorStr.includes('429') ? 429 : errorStr.includes('503') ? 503 : 0);

    // 429 (Rate Limited) or 503 (Service Unavailable) - リトライ
    if ((statusCode === 429 || statusCode === 503) && retryCount < maxRetries) {
      // retryDelayをパース（デフォルト35秒）
      let waitTime = 35000;
      const retryMatch = errorStr.match(/retry.*?(\d+(?:\.\d+)?)\s*s/i);
      if (retryMatch) {
        waitTime = Math.ceil(parseFloat(retryMatch[1]) * 1000) + 1000; // 余裕を持って+1秒
      }

      logger.warn(`Script generation rate limited (${statusCode}). Retry ${retryCount + 1}/${maxRetries} in ${Math.ceil(waitTime / 1000)}s`);

      await new Promise(resolve => setTimeout(resolve, waitTime));

      return generateScriptSection(phase, history, characters, question, userLastInput, retryCount + 1, maxRetries);
    }

    logger.error("Script generation failed:", errorStr);
    throw e; // エラーを上に伝播（再生成ボタン表示のため）
  }
};


// --- Newspaper Generation ---

export const generateNewspaperContent = async (
  question: string,
  transcript: string,
  retryCount = 0
): Promise<NewspaperContent> => {
  // Rate limiting
  await rateLimiter.waitForNext();

  const MAX_RETRIES = 3;
  const MODELS = ['gemini-2.5-flash', 'gemini-1.5-flash']; // 利用可能なモデル

  const ai = getClient();

  // Sanitize inputs
  const safeQuestion = sanitizePromptInput(question);
  const safeTranscript = sanitizePromptInput(transcript);

  const prompt = `
  あなたは「神の声」として、人間たちの議論を高みから俯瞰する存在です。
  皮肉とユーモアを交えながらも、深い洞察で議論の本質を見抜き、読者の心に響く言葉で語りかけてください。

  テーマ: "${safeQuestion}"

  議論ログ:
  ${safeTranscript}

  【神の声としての語り口】

  1. **headline（タイトル）**:
     - 議論の核心を突く、思わず唸るようなタイトル（20文字以内）
     - 皮肉やパラドックスを含む、記憶に残るフレーズ
     - 例: 「正解を探す者は、問いを見失う」「愚者が笑い、賢者が学んだ夜」

  2. **lead（リード文）**:
     - 神の視点から議論を見下ろした一言（40〜60文字）
     - 少し皮肉を込めつつも、愛情を感じる俯瞰的なコメント
     - 例: 「人間たちはまた、答えのない問いに挑んでいた。」

  3. **body（本文）**:
     **「神の声」として、第三者視点で全員の意見を統括し、面白く語る（500〜600文字程度）**

     - **俯瞰的な視点**: 「彼らは〜」「人間たちは〜」のように、議論を外から眺める語り口
     - **全員の意見を公平に拾う**: 司会者、ゲスト、ユーザーそれぞれの主張を要約し、それぞれの視点の価値を認める
     - **皮肉とユーモア**: 人間の矛盾や愚かさを愛情を込めて指摘する。辛辣すぎず、クスッと笑える程度に
     - **印象的なフレーズの引用**: 「」で議論中の発言を引用し、「なるほど、これは真理かもしれない」などとコメント
     - **意外な気づき**: 議論の参加者たちが気づいていない、より深い洞察や逆説的な真実を提示
     - **温かい結び**: 最後は人間への愛情と希望を込めた言葉で締める

     **文体の例**:
     「彼らは『${safeQuestion}』という問いの前で、それぞれの武器を振りかざした。
     司会者は〜と主張し、ゲストは〜と反論した。そしてユーザーは〜という視点を持ち込んだ。
     面白いのは、〜という点だ。彼らは気づいていないかもしれないが、〜。
     結局のところ、この議論が教えてくれるのは〜ということだろう。
     人間よ、迷い続けなさい。その迷いこそが、君たちを人間たらしめているのだから。」

  出力スキーマ (JSON):
  - headline: 文字列
  - lead: 文字列
  - body: 文字列（改行コードを含む長文）
  `;

  const modelIndex = Math.min(retryCount, MODELS.length - 1);
  const model = MODELS[modelIndex];

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            headline: { type: Type.STRING },
            lead: { type: Type.STRING },
            body: { type: Type.STRING },
          }
        }
      }
    });

    const rawText = response.text || '{}';
    const jsonText = rawText.replace(/```json\n?|```/g, '').trim();

    try {
      const parsed = JSON.parse(jsonText);
      if (parsed.body) {
        parsed.body = parsed.body.replace(/\[.*?\]/g, '');
      }
      return parsed;
    } catch (e) {
      logger.error("JSON Parse Error", e);
      // フォールバック: 神の声スタイル
      const shortQuestion = safeQuestion.length > 15 ? safeQuestion.slice(0, 15) + '…' : safeQuestion;
      return {
        headline: `迷える者たちの問答`,
        lead: `人間たちはまた、「${shortQuestion}」という問いに挑んでいた。`,
        body: `彼らは「${safeQuestion}」という問いの前で、それぞれの武器を振りかざした。\n\n司会者は冷静に議論を導き、ゲストは独自の視点で切り込み、そしてユーザーは自らの経験を語った。面白いのは、彼らが互いの言葉に耳を傾けながらも、それぞれが違う景色を見ていたということだ。\n\n結局のところ、この議論が教えてくれるのは、「正解」よりも「問い続けること」の価値だろう。人間よ、迷い続けなさい。その迷いこそが、君たちを人間たらしめているのだから。`
      };
    }
  } catch (error: any) {
    const errorStr = error.message || String(error);

    // 429エラーの場合はリトライ
    if (errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED')) {
      if (retryCount < MAX_RETRIES) {
        const delay = getRetryDelay(error);
        logger.warn(`Article gen rate limit hit. Retrying with ${MODELS[Math.min(retryCount + 1, MODELS.length - 1)]} in ${delay / 1000}s... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        return generateNewspaperContent(question, transcript, retryCount + 1);
      }
    }

    logger.error("Article generation failed", error);
    // フォールバック: 神の声スタイル
    const shortQuestion = safeQuestion.length > 15 ? safeQuestion.slice(0, 15) + '…' : safeQuestion;
    return {
      headline: `迷える者たちの問答`,
      lead: `人間たちはまた、「${shortQuestion}」という問いに挑んでいた。`,
      body: `彼らは「${safeQuestion}」という問いの前で、それぞれの武器を振りかざした。\n\n司会者は冷静に議論を導き、ゲストは独自の視点で切り込み、そしてユーザーは自らの経験を語った。面白いのは、彼らが互いの言葉に耳を傾けながらも、それぞれが違う景色を見ていたということだ。\n\n結局のところ、この議論が教えてくれるのは、「正解」よりも「問い続けること」の価値だろう。人間よ、迷い続けなさい。その迷いこそが、君たちを人間たらしめているのだから。`
    };
  }
};

// --- Note Article Generation ---

export const generateNoteArticle = async (
  question: string,
  transcript: string,
  retryCount = 0
): Promise<NoteArticleContent> => {
  // Rate limiting
  await rateLimiter.waitForNext();

  const MAX_RETRIES = 3;
  const MODELS = ['gemini-2.5-flash', 'gemini-1.5-flash'];

  const ai = getClient();

  // Sanitize inputs
  const safeQuestion = sanitizePromptInput(question);
  const safeTranscript = sanitizePromptInput(transcript);

  const prompt = `
あなたはnote.comで数万人のフォロワーを持つ人気ライターです。
以下のディスカッション内容を基に、note.comに投稿するための長文ブログ記事を執筆してください。

テーマ: 「${safeQuestion}」

ディスカッション内容:
${safeTranscript}

【絶対に守る執筆ルール】

1. **一人称「僕」または「私」の語り口**: 読者に直接語りかけるように書く。「〜ではないでしょうか」「〜と思います」など、柔らかい断定を使う
2. **知的かつ親しみやすいトーン**: データや論理で分析しつつも、温かみと共感を忘れない文体
3. **比喩と具体的シーンを多用**: 冒頭は必ず「印象的な日常のシーン描写」から始める。抽象的な議論を身近な体験で読者に感じさせる
4. **短い段落**: 1段落は2〜3文。長い段落は絶対に作らない。改行を多めに入れて、スマホでも読みやすくする
5. **太字での強調**: 特に重要なフレーズや結論を**太字**にする。1セクションに2〜3箇所
6. **実践的なアドバイス**: 「明日からこうしてみてください」のような、読者がすぐに行動できる具体策を含める
7. **反論と例外の提示**: 自分の主張に対して「とはいえ」「一方で」と反例を正直に示し、信頼性を高める
8. **読者への問いかけで締める**: 最後のセクションは必ず読者への質問で終わる。「あなたはどう思いますか？」のような問いかけ

【記事構成 - 6〜7セクション】

各セクションには**創造的で比喩的なタイトル**をつけてください。
単なる「まとめ」「考察」ではなく、内容を暗示する独創的なタイトル。
例: 「玄関の重力係数」「混ぜるな、危険」「小さな実験」「撤退ラインを決めておく」

構成ガイド:
- セクション1（序章）: 印象的な日常シーンの描写から始まり、テーマへの問いかけへと導く（500〜700文字）
- セクション2: テーマに対する「仮説」や「分類」を提示。ディスカッションの意見を引用しながら構造化する（500〜800文字）
- セクション3〜4: 複数の視点からの分析・考察。ディスカッション参加者の異なる意見を紹介し、それぞれの価値を認める（各500〜800文字）
- セクション5: 実践的なアドバイスや具体的なアクションステップ（400〜600文字）
- セクション6: 反例・例外処理・注意点。「この方法が使えない場合」を正直に述べる（300〜500文字）
- セクション7（まとめ）: 全体を温かく締めくくり、読者への問いかけで終わる（300〜500文字）

【重要な制約】
- 記事全体で**4000〜5000文字**になるようにしてください
- ディスカッションの**具体的な発言・キーワード・意見**を必ず盛り込んでください。一般論だけの記事にしないこと
- セクション本文ではMarkdown記法（**太字**）を使用してください
- 各セクション本文は改行（\\n）で段落を分けてください
- 「note.comの記事っぽさ」を意識してください：読みやすさ、共感、知的好奇心の刺激

出力形式 (JSON):
{
  "title": "記事タイトル（25〜50文字、読者の興味を引くもの）",
  "sections": [
    { "title": "セクションタイトル", "body": "セクション本文（Markdown）" },
    ...
  ]
}
  `;

  const modelIndex = Math.min(retryCount, MODELS.length - 1);
  const model = MODELS[modelIndex];

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            sections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  body: { type: Type.STRING },
                }
              }
            }
          }
        }
      }
    });

    const rawText = response.text || '{}';
    const jsonText = rawText.replace(/```json\n?|```/g, '').trim();

    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed.title || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
        throw new Error('Invalid note article structure');
      }
      // Clean bracket artifacts from body text
      for (const section of parsed.sections) {
        if (section.body) {
          section.body = section.body.replace(/\[.*?\]/g, '');
        }
      }
      return parsed;
    } catch (e) {
      logger.error("Note article JSON Parse Error", e);
      const shortQuestion = safeQuestion.length > 20 ? safeQuestion.slice(0, 20) + '…' : safeQuestion;
      return {
        title: `「${shortQuestion}」について考えたこと`,
        sections: [
          { title: '序章', body: `「${safeQuestion}」というテーマについて、ディスカッションを通じて深く考える機会がありました。\n\n僕たちは日常の中で、この問いに何度も直面しているはずです。でも、立ち止まって考えることは意外と少ない。` },
          { title: '議論から見えたもの', body: `今回のディスカッションでは、それぞれが異なる角度からこのテーマに切り込みました。\n\n**興味深かったのは、誰一人として同じ答えを持っていなかった**ということです。これは一見バラバラに見えますが、実はこのテーマの本質を表しているのかもしれません。` },
          { title: 'まとめ', body: `結局のところ、「${safeQuestion}」に対する唯一の正解はないのかもしれません。\n\nしかし、こうして考え続けること自体に価値がある。**問いを持ち続ける限り、僕たちは前に進んでいる**のだと思います。\n\nあなたはこのテーマについて、どう思いますか？` }
        ]
      };
    }
  } catch (error: any) {
    const errorStr = error.message || String(error);

    if (errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED')) {
      if (retryCount < MAX_RETRIES) {
        const delay = getRetryDelay(error);
        logger.warn(`Note article gen rate limit. Retrying with ${MODELS[Math.min(retryCount + 1, MODELS.length - 1)]} in ${delay / 1000}s... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        return generateNoteArticle(question, transcript, retryCount + 1);
      }
    }

    logger.error("Note article generation failed", error);
    const shortQuestion = safeQuestion.length > 20 ? safeQuestion.slice(0, 20) + '…' : safeQuestion;
    return {
      title: `「${shortQuestion}」について考えたこと`,
      sections: [
        { title: '序章', body: `「${safeQuestion}」というテーマについて考えました。\n\n僕たちの日常に潜むこの問いは、一見シンプルに見えて、実は深い。` },
        { title: 'まとめ', body: `議論を通じて多くの学びがありました。\n\n**答えよりも、問い続けることの価値**。それがこのディスカッションが教えてくれたことかもしれません。\n\nあなたはどう思いますか？` }
      ]
    };
  }
};

// --- Character Comments Generation ---

export interface CharacterInfo {
  name: string;
  avatarUrl: string;
  role: 'host' | 'guest' | 'user';
  persona?: string; // キャラクターの性格・特徴
}

export const generateCharacterComments = async (
  question: string,
  transcript: string,
  characters: CharacterInfo[],
  retryCount = 0
): Promise<CharacterComment[]> => {
  // Rate limiting
  await rateLimiter.waitForNext();

  const MAX_RETRIES = 2;
  const MODELS = ['gemini-2.5-flash', 'gemini-1.5-flash'];

  const ai = getClient();

  // Sanitize inputs
  const safeQuestion = sanitizePromptInput(question);
  const safeTranscript = sanitizePromptInput(transcript);

  // キャラクター情報を性格付きで文字列化
  const characterDescriptions = characters.map(c => {
    const roleLabel = c.role === 'host' ? '司会者' : c.role === 'guest' ? 'ゲスト' : 'あなた（ユーザー）';
    const personaInfo = c.persona ? `性格: ${c.persona}` : '';
    return `- **${c.name}**（${roleLabel}）${personaInfo ? `\n  ${personaInfo}` : ''}`;
  }).join('\n');

  const prompt = `
  あなたは卓越した脚本家です。ディスカッション終了後の「感想タイム」を演出してください。
  各キャラクターが**自分らしい言葉で、議論の中で特に印象に残った部分**について一言述べます。

  テーマ: "${safeQuestion}"

  参加者（性格情報付き）:
  ${characterDescriptions}

  ディスカッション内容:
  ${safeTranscript}

  【絶対に守るべきルール - 必ず全て従うこと】

  1. **議論の具体的な内容を必ず引用または言及する（最重要）**
     - 議論ログに実際に登場したキーワード、フレーズ、発言を必ず含める
     - 「〜という意見が出たけど」「〜って言葉が刺さった」「さっきの〜という話」のように具体的に言及
     - 「良い議論だった」「勉強になった」「考えさせられた」のような**曖昧で一般的な感想は絶対禁止**
     - 3人とも異なる部分に言及すること（同じ内容に言及しない）

  2. **キャラクターの性格と口調を徹底的に反映**
     - 性格情報に基づいた独自の視点と口調で話す
     - 皮肉屋なら皮肉を込めて、熱いキャラなら熱く、冷静なキャラは分析的に
     - 各キャラの口調や視点が明確に異なること

  3. **3人がそれぞれ違う角度からコメント**
     - 司会者: 議論全体を俯瞰した振り返り（特に印象的だった対立点や結論に言及）
     - ゲスト: 最も印象的だった発言や瞬間への率直なリアクション
     - ユーザー: 議論を通じて得た具体的な気づきや、考えが変わった点

  4. **長さ**: 25〜50文字の自然な一言

  5. **フォーマット**:
     - カギカッコ不要
     - 句読点は最後に1つだけ

  出力スキーマ (JSON配列):
  [
    { "name": "キャラ名", "comment": "議論の具体的内容（キーワード・フレーズ）に言及した独自の感想" },
    ...
  ]
  `;

  const modelIndex = Math.min(retryCount, MODELS.length - 1);
  const model = MODELS[modelIndex];

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              comment: { type: Type.STRING },
            }
          }
        }
      }
    });

    const rawText = response.text || '[]';
    const jsonText = rawText.replace(/```json\n?|```/g, '').trim();

    try {
      const parsed = JSON.parse(jsonText) as { name: string; comment: string }[];

      // キャラクター情報とマージ
      return characters.map((char, index) => {
        const matching = parsed.find(p => p.name === char.name) || parsed[index];
        // フォールバックコメントを役割別に設定
        const fallbackComments: { [key: string]: string } = {
          'host': `「${safeQuestion.slice(0, 10)}」について深い議論ができた。`,
          'guest': `この議論で新しい視点が見えてきたな。`,
          'user': `自分の考えを整理できた気がする。`
        };
        return {
          name: char.name,
          avatarUrl: char.avatarUrl,
          comment: matching?.comment || fallbackComments[char.role] || 'この議論は意義深かった。'
        };
      });
    } catch (e) {
      logger.error("Character comments JSON Parse Error", e);
      return characters.map((char) => {
        const fallbackComments: { [key: string]: string } = {
          'host': `「${safeQuestion.slice(0, 10)}」という問いは奥が深い。`,
          'guest': `この議論で気づきがあった。`,
          'user': `もっと深掘りしたいテーマだ。`
        };
        return {
          name: char.name,
          avatarUrl: char.avatarUrl,
          comment: fallbackComments[char.role] || 'この議論は意義深かった。'
        };
      });
    }
  } catch (error: any) {
    const errorStr = error.message || String(error);

    // 429エラーの場合はリトライ
    if (errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED')) {
      if (retryCount < MAX_RETRIES) {
        const delay = getRetryDelay(error);
        logger.warn(`Character comments rate limit hit. Retrying in ${delay / 1000}s...`);
        await sleep(delay);
        return generateCharacterComments(question, transcript, characters, retryCount + 1);
      }
    }

    logger.error("Character comments generation failed", error);
    return characters.map((char) => {
      const fallbackComments: { [key: string]: string } = {
        'host': `「${safeQuestion.slice(0, 10)}」という問いは奥が深い。`,
        'guest': `この議論で気づきがあった。`,
        'user': `もっと深掘りしたいテーマだ。`
      };
      return {
        name: char.name,
        avatarUrl: char.avatarUrl,
        comment: fallbackComments[char.role] || 'この議論は意義深かった。'
      };
    });
  }
};

// --- Helpers (Legacy) ---
export const generateDraft = async (q: Question, f: OutputFormat) => { return ""; };
export const generateQuestions = async (topic: string): Promise<Partial<Question>[]> => {
  await rateLimiter.waitForNext();
  const ai = getClient();
  const safeTopic = sanitizePromptInput(topic);

  const prompt = `
    あなたは「問いの錬金術師」です。人間の心を揺さぶり、思考を刺激する質問を生成してください。
    トピック「${safeTopic}」に関連する、議論したくなる質問を**10個**生成してください。

    【質問のタイプをバランスよく混ぜる】
    1. **逆説的な問い** (2個): 常識を覆す、「え、そうなの？」と思わせる質問
       例: 「努力は本当に報われるのか？報われない努力に価値はないのか？」

    2. **二項対立の問い** (2個): AかBかで意見が分かれる、議論が白熱する質問
       例: 「才能と努力、最終的に勝つのはどちらか？」

    3. **自己省察の問い** (2個): 自分自身を見つめ直す、内省を促す質問
       例: 「あなたが最後に『本気で』何かに取り組んだのはいつ？」

    4. **未来予測の問い** (2個): 将来について考えさせる、想像力を刺激する質問
       例: 「10年後、今の仕事は存在しているか？」

    5. **哲学的な問い** (2個): 深く考えさせる、答えのない本質的な質問
       例: 「幸せを追求することは、幸せを遠ざけることになるのか？」

    【質問の特徴】
    - 思わず誰かと議論したくなる
    - 簡単には答えが出ない
    - 個人的な経験や価値観が反映される
    - SNSでバズりそうな「刺さる」表現
    - 40〜80文字程度の適度な長さ

    【出典の種類】
    - X (Twitter): 炎上しそうな鋭い問い
    - Yahoo知恵袋: 素朴だが深い悩み
    - Reddit: 海外で議論されそうな普遍的テーマ
    - 哲学フォーラム: 本質を問う抽象的な質問
    - ビジネスメディア: キャリアや仕事に関する問い
    - 心理学コミュニティ: 人間関係や自己理解の問い

    出力形式: JSON配列
    スキーマ:
    [{
      "text": "質問本文（40〜80文字）",
      "source": "想定される出典",
      "difficulty": "light" | "normal" | "heavy",
      "tags": ["タグ1", "タグ2"]
    }]
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              source: { type: Type.STRING },
              difficulty: { type: Type.STRING, enum: ['light', 'normal', 'heavy'] },
              tags: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
          }
        }
      }
    });

    const raw = response.text || "[]";
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    logger.error("Generate questions failed", e);
    return [];
  }
};

export const extractQuestionsFromUrl = async (url: string): Promise<Partial<Question>[]> => {
  await rateLimiter.waitForNext();
  const ai = getClient();
  const safeUrl = sanitizePromptInput(url);

  const prompt = `
    あなたは「問いの錬金術師」です。URL「${safeUrl}」の記事や議論に関連する質問を**10個**生成してください。
    (実際にアクセスできない場合は、URLの文字列から内容を推測して生成してください)

    【質問のタイプをバランスよく混ぜる】
    1. **記事の主張への反論**: 「本当にそうか？」と疑問を投げかける
    2. **さらに深掘りする問い**: 記事が触れていない側面を探る
    3. **自分に置き換える問い**: 「もし自分だったら？」
    4. **逆説的な視点**: 常識を覆す問いかけ
    5. **未来への問い**: この問題は将来どうなるか？

    【質問の特徴】
    - 思わず誰かと議論したくなる
    - 簡単には答えが出ない
    - 40〜80文字程度の適度な長さ

    出力形式: JSON配列
    スキーマ:
    [{
      "text": "質問本文（40〜80文字）",
      "source": "URLからの抽出",
      "difficulty": "light" | "normal" | "heavy",
      "tags": ["タグ1", "タグ2"]
    }]
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              source: { type: Type.STRING },
              difficulty: { type: Type.STRING, enum: ['light', 'normal', 'heavy'] },
              tags: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
          }
        }
      }
    });

    const raw = response.text || "[]";
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    logger.error("Url extract failed", e);
    return [];
  }
};
export const generateNextTurn = async () => { return { speakerId: 'moderator', text: '' }; }; // Deprecated for script mode
