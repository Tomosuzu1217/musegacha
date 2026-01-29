/**
 * ElevenLabs Service
 * クローンボイス用のElevenLabs API連携サービス
 */

import { CloneVoice } from '../types';

// --- Configuration ---
const STORAGE_KEYS = {
    ELEVEN_LABS_API_KEY: 'eleven_labs_api_key',
    CLONE_VOICES: 'clone_voices',
};

const ELEVEN_LABS_API_BASE = 'https://api.elevenlabs.io/v1';

// --- API Key Management ---

/**
 * APIキーを保存
 */
export const saveApiKey = (apiKey: string): void => {
    try {
        localStorage.setItem(STORAGE_KEYS.ELEVEN_LABS_API_KEY, apiKey);
    } catch (e) {
        console.error('Failed to save ElevenLabs API key:', e);
    }
};

/**
 * APIキーを取得
 */
export const getApiKey = (): string | null => {
    try {
        return localStorage.getItem(STORAGE_KEYS.ELEVEN_LABS_API_KEY);
    } catch (e) {
        console.error('Failed to get ElevenLabs API key:', e);
        return null;
    }
};

/**
 * APIキーを削除
 */
export const removeApiKey = (): void => {
    try {
        localStorage.removeItem(STORAGE_KEYS.ELEVEN_LABS_API_KEY);
    } catch (e) {
        console.error('Failed to remove ElevenLabs API key:', e);
    }
};

/**
 * APIキーを検証（実際にAPIを呼び出して確認）
 */
export const validateApiKey = async (apiKey?: string): Promise<{
    valid: boolean;
    plan?: string;
    error?: string;
}> => {
    const key = apiKey || getApiKey();
    if (!key) {
        return { valid: false, error: 'APIキーが設定されていません' };
    }

    try {
        const response = await fetch(`${ELEVEN_LABS_API_BASE}/user/subscription`, {
            headers: {
                'xi-api-key': key,
            },
        });

        if (!response.ok) {
            if (response.status === 401) {
                return { valid: false, error: 'APIキーが無効です' };
            }
            return { valid: false, error: `APIエラー: ${response.status}` };
        }

        const data = await response.json();
        return {
            valid: true,
            plan: data.tier || 'unknown',
        };
    } catch (error) {
        console.error('ElevenLabs API validation error:', error);
        return { valid: false, error: 'APIへの接続に失敗しました' };
    }
};

// --- Clone Voice Management ---

/**
 * 保存済みクローンボイスリストを取得
 */
export const getCloneVoices = (): CloneVoice[] => {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.CLONE_VOICES);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.error('Failed to get clone voices:', e);
        return [];
    }
};

/**
 * クローンボイスを保存
 */
export const saveCloneVoice = (voice: CloneVoice): void => {
    try {
        const voices = getCloneVoices();
        const existing = voices.findIndex(v => v.id === voice.id);
        if (existing >= 0) {
            voices[existing] = voice;
        } else {
            voices.push(voice);
        }
        localStorage.setItem(STORAGE_KEYS.CLONE_VOICES, JSON.stringify(voices));
    } catch (e) {
        console.error('Failed to save clone voice:', e);
    }
};

/**
 * クローンボイスを削除（ローカルのみ）
 */
export const removeCloneVoice = (voiceId: string): void => {
    try {
        const voices = getCloneVoices().filter(v => v.id !== voiceId);
        localStorage.setItem(STORAGE_KEYS.CLONE_VOICES, JSON.stringify(voices));
    } catch (e) {
        console.error('Failed to remove clone voice:', e);
    }
};

// --- Voice Cloning API ---

/**
 * クローンボイスを作成
 */
export const createCloneVoice = async (
    name: string,
    audioBlob: Blob
): Promise<{ voiceId: string; success: boolean; error?: string }> => {
    const apiKey = getApiKey();
    if (!apiKey) {
        return { voiceId: '', success: false, error: 'APIキーが設定されていません' };
    }

    try {
        const formData = new FormData();
        formData.append('name', name);
        formData.append('files', audioBlob, 'voice_sample.webm');
        formData.append('description', `Clone voice created from ${name}`);

        const response = await fetch(`${ELEVEN_LABS_API_BASE}/voices/add`, {
            method: 'POST',
            headers: {
                'xi-api-key': apiKey,
            },
            body: formData,
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMessage = errorData.detail?.message || `APIエラー: ${response.status}`;

            // 商用プランの確認
            if (response.status === 403) {
                return {
                    voiceId: '',
                    success: false,
                    error: 'クローンボイスには有料プラン（Starter以上）が必要です',
                };
            }

            return { voiceId: '', success: false, error: errorMessage };
        }

        const data = await response.json();
        const voiceId = data.voice_id;

        // ローカルに保存
        const cloneVoice: CloneVoice = {
            id: `clone_${Date.now()}`,
            name,
            elevenLabsVoiceId: voiceId,
            createdAt: Date.now(),
        };
        saveCloneVoice(cloneVoice);

        return { voiceId, success: true };
    } catch (error) {
        console.error('Failed to create clone voice:', error);
        return { voiceId: '', success: false, error: 'クローンボイスの作成に失敗しました' };
    }
};

/**
 * クローンボイスで音声を生成
 */
export const generateSpeech = async (
    text: string,
    voiceId: string
): Promise<Uint8Array | null> => {
    const apiKey = getApiKey();
    if (!apiKey) {
        console.error('ElevenLabs API key not set');
        return null;
    }

    try {
        const response = await fetch(`${ELEVEN_LABS_API_BASE}/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'xi-api-key': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text,
                model_id: 'eleven_multilingual_v2',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                },
            }),
        });

        if (!response.ok) {
            console.error('ElevenLabs TTS error:', response.status);
            return null;
        }

        const arrayBuffer = await response.arrayBuffer();
        return new Uint8Array(arrayBuffer);
    } catch (error) {
        console.error('Failed to generate speech:', error);
        return null;
    }
};

/**
 * ElevenLabsからクローンボイスを削除
 */
export const deleteCloneVoiceFromApi = async (voiceId: string): Promise<boolean> => {
    const apiKey = getApiKey();
    if (!apiKey) {
        return false;
    }

    try {
        const response = await fetch(`${ELEVEN_LABS_API_BASE}/voices/${voiceId}`, {
            method: 'DELETE',
            headers: {
                'xi-api-key': apiKey,
            },
        });

        return response.ok;
    } catch (error) {
        console.error('Failed to delete clone voice:', error);
        return false;
    }
};

// --- Export Service Object ---

export const elevenLabsService = {
    // API Key
    saveApiKey,
    getApiKey,
    removeApiKey,
    validateApiKey,

    // Clone Voice Management
    getCloneVoices,
    saveCloneVoice,
    removeCloneVoice,
    createCloneVoice,
    deleteCloneVoiceFromApi,

    // Speech Generation
    generateSpeech,
};

export default elevenLabsService;
