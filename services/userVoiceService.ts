/**
 * User Voice Service
 * ユーザー音声オプションを管理するサービス
 * - マイク録音
 * - Gemini TTS
 * - ElevenLabsクローンボイス
 */

import { UserVoiceType, UserVoiceConfig, RecordedVoiceData } from '../types';

// --- Configuration ---
const STORAGE_KEYS = {
    USER_VOICE_CONFIG: 'user_voice_config',
    ELEVEN_LABS_API_KEY: 'eleven_labs_api_key',
    CLONE_VOICES: 'clone_voices',
};

const DEFAULT_CONFIG: UserVoiceConfig = {
    type: 'gemini_tts',
    geminiVoiceName: 'Kore',
};

// --- State ---
let currentConfig: UserVoiceConfig = DEFAULT_CONFIG;
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let recordingStream: MediaStream | null = null;

// --- Configuration Management ---

/**
 * ユーザー音声設定を読み込み
 */
export const loadUserVoiceConfig = (): UserVoiceConfig => {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.USER_VOICE_CONFIG);
        if (stored) {
            currentConfig = JSON.parse(stored);
        }
    } catch (e) {
        console.warn('Failed to load user voice config:', e);
    }
    return currentConfig;
};

/**
 * ユーザー音声設定を保存
 */
export const saveUserVoiceConfig = (config: UserVoiceConfig): void => {
    currentConfig = config;
    try {
        localStorage.setItem(STORAGE_KEYS.USER_VOICE_CONFIG, JSON.stringify(config));
    } catch (e) {
        console.warn('Failed to save user voice config:', e);
    }
};

/**
 * 現在の音声タイプを取得
 */
export const getUserVoiceType = (): UserVoiceType => {
    return currentConfig.type;
};

/**
 * 音声タイプを設定
 */
export const setUserVoiceType = (type: UserVoiceType): void => {
    currentConfig.type = type;
    saveUserVoiceConfig(currentConfig);
};

/**
 * Gemini TTSの声を設定
 */
export const setGeminiVoiceName = (voiceName: string): void => {
    currentConfig.geminiVoiceName = voiceName;
    saveUserVoiceConfig(currentConfig);
};

/**
 * クローンボイスIDを設定
 */
export const setCloneVoiceId = (voiceId: string): void => {
    currentConfig.cloneVoiceId = voiceId;
    saveUserVoiceConfig(currentConfig);
};

// --- Microphone Recording ---

/**
 * マイク録音を開始
 */
export const startMicrophoneRecording = async (): Promise<void> => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        throw new Error('Already recording');
    }

    audioChunks = [];

    try {
        recordingStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            }
        });

        mediaRecorder = new MediaRecorder(recordingStream, {
            mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm',
        });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.start(100); // 100msごとにデータを取得
        console.info('Microphone recording started');
    } catch (error) {
        console.error('Failed to start recording:', error);
        throw new Error('マイクへのアクセスに失敗しました。ブラウザの設定を確認してください。');
    }
};

/**
 * マイク録音を停止してBlobを返す
 */
export const stopMicrophoneRecording = async (): Promise<RecordedVoiceData> => {
    return new Promise((resolve, reject) => {
        if (!mediaRecorder || mediaRecorder.state !== 'recording') {
            reject(new Error('Not recording'));
            return;
        }

        const startTime = Date.now();

        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const duration = (Date.now() - startTime) / 1000;

            // ストリームをクリーンアップ
            if (recordingStream) {
                recordingStream.getTracks().forEach(track => track.stop());
                recordingStream = null;
            }

            resolve({
                msgId: `rec_${Date.now()}`,
                audioBlob,
                duration,
                timestamp: Date.now(),
            });

            console.info(`Recording stopped: ${duration.toFixed(1)}s`);
        };

        mediaRecorder.stop();
    });
};

/**
 * 録音中かどうか
 */
export const isRecording = (): boolean => {
    return mediaRecorder?.state === 'recording';
};

/**
 * 録音をキャンセル
 */
export const cancelRecording = (): void => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    if (recordingStream) {
        recordingStream.getTracks().forEach(track => track.stop());
        recordingStream = null;
    }
    audioChunks = [];
    console.info('Recording cancelled');
};

// --- Audio Playback ---

/**
 * Blobを再生
 */
export const playAudioBlob = async (blob: Blob): Promise<void> => {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);

        audio.onended = () => {
            URL.revokeObjectURL(url);
            resolve();
        };

        audio.onerror = (e) => {
            URL.revokeObjectURL(url);
            reject(e);
        };

        audio.play().catch(reject);
    });
};

// --- Gemini TTS Integration ---

// 利用可能なGemini TTS音声リスト
export const GEMINI_VOICE_OPTIONS = [
    { id: 'Kore', name: 'コレ（女性・落ち着いた）' },
    { id: 'Fenrir', name: 'フェンリル（男性・低音）' },
    { id: 'Aoede', name: 'アオエデ（女性・明るい）' },
    { id: 'Charon', name: 'カロン（男性・深み）' },
    { id: 'Puck', name: 'パック（中性的・軽やか）' },
] as const;

// --- Export Service Object ---

export const userVoiceService = {
    // Configuration
    loadConfig: loadUserVoiceConfig,
    saveConfig: saveUserVoiceConfig,
    getVoiceType: getUserVoiceType,
    setVoiceType: setUserVoiceType,
    setGeminiVoiceName,
    setCloneVoiceId,

    // Recording
    startRecording: startMicrophoneRecording,
    stopRecording: stopMicrophoneRecording,
    isRecording,
    cancelRecording,

    // Playback
    playAudioBlob,

    // Constants
    GEMINI_VOICE_OPTIONS,
};

export default userVoiceService;
