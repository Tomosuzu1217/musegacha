/**
 * UserVoiceSettings Component
 * ユーザー音声オプションの設定UI
 */

import React, { useState, useEffect, useCallback } from 'react';
import { UserVoiceType, CloneVoice } from '../types';
import { userVoiceService, GEMINI_VOICE_OPTIONS } from '../services/userVoiceService';
import { elevenLabsService } from '../services/elevenLabsService';

interface UserVoiceSettingsProps {
    onClose?: () => void;
    onConfigChange?: () => void;
}

const UserVoiceSettings: React.FC<UserVoiceSettingsProps> = ({ onClose, onConfigChange }) => {
    // State
    const [voiceType, setVoiceType] = useState<UserVoiceType>('gemini_tts');
    const [geminiVoice, setGeminiVoice] = useState('Kore');
    const [cloneVoices, setCloneVoices] = useState<CloneVoice[]>([]);
    const [selectedCloneId, setSelectedCloneId] = useState<string>('');

    // ElevenLabs state
    const [elevenLabsApiKey, setElevenLabsApiKey] = useState('');
    const [apiKeyValid, setApiKeyValid] = useState<boolean | null>(null);
    const [apiPlan, setApiPlan] = useState<string>('');
    const [isValidating, setIsValidating] = useState(false);

    // Clone creation state
    const [isRecording, setIsRecording] = useState(false);
    const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const [newVoiceName, setNewVoiceName] = useState('');
    const [isCreatingClone, setIsCreatingClone] = useState(false);
    const [cloneError, setCloneError] = useState<string>('');

    // Load initial config
    useEffect(() => {
        const config = userVoiceService.loadConfig();
        setVoiceType(config.type);
        if (config.geminiVoiceName) setGeminiVoice(config.geminiVoiceName);
        if (config.cloneVoiceId) setSelectedCloneId(config.cloneVoiceId);

        // Load clone voices
        setCloneVoices(elevenLabsService.getCloneVoices());

        // Load API key (masked)
        const apiKey = elevenLabsService.getApiKey();
        if (apiKey) {
            setElevenLabsApiKey(apiKey);
            // Validate on load
            validateApiKey(apiKey);
        }
    }, []);

    // Validate API key
    const validateApiKey = useCallback(async (key: string) => {
        if (!key || key.length < 10) {
            setApiKeyValid(null);
            return;
        }

        setIsValidating(true);
        const result = await elevenLabsService.validateApiKey(key);
        setApiKeyValid(result.valid);
        setApiPlan(result.plan || '');
        setIsValidating(false);
    }, []);

    // Handle voice type change
    const handleVoiceTypeChange = (type: UserVoiceType) => {
        setVoiceType(type);
        userVoiceService.setVoiceType(type);
        onConfigChange?.();
    };

    // Handle Gemini voice change
    const handleGeminiVoiceChange = (voice: string) => {
        setGeminiVoice(voice);
        userVoiceService.setGeminiVoiceName(voice);
        onConfigChange?.();
    };

    // Handle clone voice selection
    const handleCloneSelect = (voiceId: string) => {
        setSelectedCloneId(voiceId);
        userVoiceService.setCloneVoiceId(voiceId);
        onConfigChange?.();
    };

    // Save API key
    const handleSaveApiKey = async () => {
        elevenLabsService.saveApiKey(elevenLabsApiKey);
        await validateApiKey(elevenLabsApiKey);
    };

    // Start recording for clone creation
    const handleStartRecording = async () => {
        try {
            setCloneError('');
            await userVoiceService.startRecording();
            setIsRecording(true);
            setRecordingBlob(null);
            setRecordingDuration(0);

            // Update duration every second
            const interval = setInterval(() => {
                setRecordingDuration(prev => prev + 1);
            }, 1000);

            // Store interval ID for cleanup
            (window as any).__voiceRecordingInterval = interval;
        } catch (error: any) {
            setCloneError(error.message || '録音を開始できませんでした');
        }
    };

    // Stop recording
    const handleStopRecording = async () => {
        try {
            const data = await userVoiceService.stopRecording();
            setRecordingBlob(data.audioBlob);
            setIsRecording(false);

            // Clear interval
            if ((window as any).__voiceRecordingInterval) {
                clearInterval((window as any).__voiceRecordingInterval);
            }
        } catch (error: any) {
            setCloneError(error.message || '録音を停止できませんでした');
            setIsRecording(false);
        }
    };

    // Preview recording
    const handlePreviewRecording = async () => {
        if (recordingBlob) {
            await userVoiceService.playAudioBlob(recordingBlob);
        }
    };

    // Create clone voice
    const handleCreateClone = async () => {
        if (!recordingBlob || !newVoiceName.trim()) {
            setCloneError('音声サンプルと名前を入力してください');
            return;
        }

        setIsCreatingClone(true);
        setCloneError('');

        const result = await elevenLabsService.createCloneVoice(newVoiceName.trim(), recordingBlob);

        if (result.success) {
            // Refresh clone voices list
            setCloneVoices(elevenLabsService.getCloneVoices());
            // Reset form
            setRecordingBlob(null);
            setRecordingDuration(0);
            setNewVoiceName('');
        } else {
            setCloneError(result.error || 'クローンボイスの作成に失敗しました');
        }

        setIsCreatingClone(false);
    };

    // Delete clone voice
    const handleDeleteClone = async (voice: CloneVoice) => {
        if (!confirm(`「${voice.name}」を削除しますか？`)) return;

        // Delete from API
        await elevenLabsService.deleteCloneVoiceFromApi(voice.elevenLabsVoiceId);
        // Delete locally
        elevenLabsService.removeCloneVoice(voice.id);
        // Refresh list
        setCloneVoices(elevenLabsService.getCloneVoices());

        if (selectedCloneId === voice.id) {
            setSelectedCloneId('');
        }
    };

    return (
        <div className="user-voice-settings">
            <div className="settings-header">
                <h2>🎙️ ユーザー音声設定</h2>
                {onClose && (
                    <button className="close-button" onClick={onClose}>✕</button>
                )}
            </div>

            {/* Voice Type Selection */}
            <section className="voice-type-section">
                <h3>音声タイプを選択</h3>
                <div className="voice-type-options">
                    {/* Microphone Option */}
                    <div
                        className={`voice-option ${voiceType === 'microphone' ? 'selected' : ''}`}
                        onClick={() => handleVoiceTypeChange('microphone')}
                    >
                        <div className="option-icon">🎤</div>
                        <div className="option-content">
                            <div className="option-title">マイク録音</div>
                            <div className="option-desc">自分の声を直接録音</div>
                            <div className="option-badge free">無料・商用OK</div>
                        </div>
                    </div>

                    {/* Gemini TTS Option */}
                    <div
                        className={`voice-option ${voiceType === 'gemini_tts' ? 'selected' : ''}`}
                        onClick={() => handleVoiceTypeChange('gemini_tts')}
                    >
                        <div className="option-icon">🤖</div>
                        <div className="option-content">
                            <div className="option-title">Gemini TTS</div>
                            <div className="option-desc">AI音声で自動生成</div>
                            <div className="option-badge free">無料・商用OK</div>
                        </div>
                    </div>

                    {/* Clone Voice Option */}
                    <div
                        className={`voice-option ${voiceType === 'clone' ? 'selected' : ''}`}
                        onClick={() => handleVoiceTypeChange('clone')}
                    >
                        <div className="option-icon">🎭</div>
                        <div className="option-content">
                            <div className="option-title">クローンボイス</div>
                            <div className="option-desc">自分の声をAIでクローン</div>
                            <div className="option-badge paid">ElevenLabs有料プラン</div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Gemini TTS Settings */}
            {voiceType === 'gemini_tts' && (
                <section className="gemini-settings">
                    <h3>Gemini TTS 設定</h3>
                    <label>
                        声の種類:
                        <select
                            value={geminiVoice}
                            onChange={(e) => handleGeminiVoiceChange(e.target.value)}
                        >
                            {GEMINI_VOICE_OPTIONS.map(v => (
                                <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                        </select>
                    </label>
                </section>
            )}

            {/* Clone Voice Settings */}
            {voiceType === 'clone' && (
                <section className="clone-settings">
                    <h3>ElevenLabs クローンボイス</h3>

                    {/* API Key Section */}
                    <div className="api-key-section">
                        <label>
                            APIキー:
                            <div className="api-key-input-group">
                                <input
                                    type="password"
                                    value={elevenLabsApiKey}
                                    onChange={(e) => setElevenLabsApiKey(e.target.value)}
                                    placeholder="ElevenLabs APIキー"
                                />
                                <button
                                    onClick={handleSaveApiKey}
                                    disabled={isValidating}
                                >
                                    {isValidating ? '検証中...' : '保存'}
                                </button>
                            </div>
                        </label>
                        {apiKeyValid === true && (
                            <div className="api-status valid">
                                ✅ 有効なAPIキー（プラン: {apiPlan}）
                            </div>
                        )}
                        {apiKeyValid === false && (
                            <div className="api-status invalid">
                                ❌ 無効なAPIキー
                            </div>
                        )}
                        <p className="api-note">
                            <a href="https://elevenlabs.io/" target="_blank" rel="noopener noreferrer">
                                ElevenLabs
                            </a>
                            でAPIキーを取得してください。商用利用にはStarterプラン以上が必要です。
                        </p>
                    </div>

                    {/* Saved Clone Voices */}
                    {cloneVoices.length > 0 && (
                        <div className="saved-clones">
                            <h4>保存済みクローンボイス</h4>
                            <div className="clone-list">
                                {cloneVoices.map(voice => (
                                    <div
                                        key={voice.id}
                                        className={`clone-item ${selectedCloneId === voice.id ? 'selected' : ''}`}
                                    >
                                        <label>
                                            <input
                                                type="radio"
                                                name="cloneVoice"
                                                checked={selectedCloneId === voice.id}
                                                onChange={() => handleCloneSelect(voice.id)}
                                            />
                                            {voice.name}
                                        </label>
                                        <button
                                            className="delete-btn"
                                            onClick={() => handleDeleteClone(voice)}
                                            title="削除"
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Create New Clone */}
                    {apiKeyValid && (
                        <div className="create-clone">
                            <h4>新規クローンボイス作成</h4>

                            {/* Recording Section */}
                            <div className="recording-section">
                                {!isRecording && !recordingBlob && (
                                    <button
                                        className="record-btn"
                                        onClick={handleStartRecording}
                                    >
                                        🎙️ 録音開始
                                    </button>
                                )}

                                {isRecording && (
                                    <div className="recording-active">
                                        <span className="recording-indicator">🔴 録音中 ({recordingDuration}秒)</span>
                                        <button onClick={handleStopRecording}>⏹️ 停止</button>
                                    </div>
                                )}

                                {recordingBlob && !isRecording && (
                                    <div className="recording-preview">
                                        <span>📁 録音完了 ({recordingDuration}秒)</span>
                                        <button onClick={handlePreviewRecording}>▶️ 試聴</button>
                                        <button onClick={handleStartRecording}>🔄 再録音</button>
                                    </div>
                                )}

                                <p className="recording-tip">
                                    ⏱️ 推奨: 30秒以上のクリアな音声
                                </p>
                            </div>

                            {/* Voice Name Input */}
                            <div className="voice-name-input">
                                <label>
                                    ボイス名:
                                    <input
                                        type="text"
                                        value={newVoiceName}
                                        onChange={(e) => setNewVoiceName(e.target.value)}
                                        placeholder="マイクローンボイス"
                                        maxLength={50}
                                    />
                                </label>
                            </div>

                            {/* Error Message */}
                            {cloneError && (
                                <div className="clone-error">{cloneError}</div>
                            )}

                            {/* Create Button */}
                            <button
                                className="create-clone-btn"
                                onClick={handleCreateClone}
                                disabled={!recordingBlob || !newVoiceName.trim() || isCreatingClone}
                            >
                                {isCreatingClone ? '作成中...' : '🎭 クローンボイスを作成'}
                            </button>
                        </div>
                    )}
                </section>
            )}

            {/* Microphone Info */}
            {voiceType === 'microphone' && (
                <section className="microphone-info">
                    <h3>マイク録音について</h3>
                    <p>
                        各メッセージに録音ボタンが表示されます。<br />
                        自分の声でセリフを吹き込むことができます。
                    </p>
                </section>
            )}

            <style>{`
        .user-voice-settings {
          padding: 20px;
          max-width: 600px;
          margin: 0 auto;
        }
        
        .settings-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        
        .settings-header h2 {
          margin: 0;
          font-size: 1.5rem;
        }
        
        .close-button {
          background: none;
          border: none;
          font-size: 1.5rem;
          cursor: pointer;
          opacity: 0.6;
        }
        
        .close-button:hover {
          opacity: 1;
        }
        
        .voice-type-section h3 {
          margin-bottom: 15px;
          font-size: 1.1rem;
        }
        
        .voice-type-options {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .voice-option {
          display: flex;
          align-items: center;
          gap: 15px;
          padding: 15px;
          border: 2px solid #e0e0e0;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .voice-option:hover {
          border-color: #a0a0a0;
          transform: translateY(-2px);
        }
        
        .voice-option.selected {
          border-color: #4a90d9;
          background: rgba(74, 144, 217, 0.08);
        }
        
        .option-icon {
          font-size: 2rem;
        }
        
        .option-content {
          flex: 1;
        }
        
        .option-title {
          font-weight: 600;
          font-size: 1.1rem;
          margin-bottom: 4px;
        }
        
        .option-desc {
          color: #666;
          font-size: 0.9rem;
          margin-bottom: 6px;
        }
        
        .option-badge {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 0.75rem;
          font-weight: 500;
        }
        
        .option-badge.free {
          background: #d4edda;
          color: #155724;
        }
        
        .option-badge.paid {
          background: #fff3cd;
          color: #856404;
        }
        
        section {
          margin-top: 25px;
          padding-top: 20px;
          border-top: 1px solid #eee;
        }
        
        section h3 {
          margin-bottom: 15px;
        }
        
        label {
          display: block;
          margin-bottom: 10px;
        }
        
        select, input[type="text"], input[type="password"] {
          width: 100%;
          padding: 10px;
          margin-top: 5px;
          border: 1px solid #ddd;
          border-radius: 8px;
          font-size: 1rem;
        }
        
        .api-key-input-group {
          display: flex;
          gap: 10px;
        }
        
        .api-key-input-group input {
          flex: 1;
        }
        
        .api-key-input-group button {
          padding: 10px 20px;
          background: #4a90d9;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
        }
        
        .api-key-input-group button:disabled {
          background: #ccc;
        }
        
        .api-status {
          margin-top: 8px;
          padding: 8px;
          border-radius: 6px;
          font-size: 0.9rem;
        }
        
        .api-status.valid {
          background: #d4edda;
          color: #155724;
        }
        
        .api-status.invalid {
          background: #f8d7da;
          color: #721c24;
        }
        
        .api-note {
          font-size: 0.85rem;
          color: #666;
          margin-top: 10px;
        }
        
        .api-note a {
          color: #4a90d9;
        }
        
        .saved-clones {
          margin-top: 20px;
        }
        
        .saved-clones h4 {
          margin-bottom: 10px;
        }
        
        .clone-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        
        .clone-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 15px;
          background: #f5f5f5;
          border-radius: 8px;
        }
        
        .clone-item.selected {
          background: rgba(74, 144, 217, 0.15);
        }
        
        .clone-item label {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 0;
          cursor: pointer;
        }
        
        .delete-btn {
          background: none;
          border: none;
          font-size: 1.2rem;
          cursor: pointer;
          opacity: 0.5;
        }
        
        .delete-btn:hover {
          opacity: 1;
        }
        
        .create-clone {
          margin-top: 25px;
          padding: 20px;
          background: #f9f9f9;
          border-radius: 12px;
        }
        
        .create-clone h4 {
          margin-bottom: 15px;
        }
        
        .recording-section {
          margin-bottom: 15px;
        }
        
        .record-btn, .create-clone-btn {
          width: 100%;
          padding: 12px;
          font-size: 1rem;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          background: #4a90d9;
          color: white;
        }
        
        .record-btn:hover, .create-clone-btn:hover:not(:disabled) {
          background: #3a7fc9;
        }
        
        .create-clone-btn:disabled {
          background: #ccc;
          cursor: not-allowed;
        }
        
        .recording-active, .recording-preview {
          display: flex;
          align-items: center;
          gap: 15px;
          padding: 10px;
          background: white;
          border-radius: 8px;
        }
        
        .recording-indicator {
          color: #dc3545;
          font-weight: 500;
        }
        
        .recording-tip {
          font-size: 0.85rem;
          color: #666;
          margin-top: 10px;
        }
        
        .voice-name-input {
          margin: 15px 0;
        }
        
        .clone-error {
          padding: 10px;
          background: #f8d7da;
          color: #721c24;
          border-radius: 8px;
          margin-bottom: 15px;
        }
        
        .microphone-info p {
          color: #666;
          line-height: 1.6;
        }
      `}</style>
        </div>
    );
};

export default UserVoiceSettings;
