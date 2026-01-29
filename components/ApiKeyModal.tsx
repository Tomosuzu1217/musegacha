
import React, { useState, useEffect } from 'react';
import { storageService } from '../services/storageService';
import { getTTSMode, setTTSMode } from '../services/geminiService';
import { apiKeyRotation } from '../services/apiKeyRotation';

interface ApiKeyModalProps {
  isOpen: boolean;
  onSave: () => void;
  onClose: () => void;
  canDismiss: boolean;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onSave, onClose, canDismiss }) => {
  const [newApiKey, setNewApiKey] = useState('');
  const [isPlatformEnv, setIsPlatformEnv] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [ttsMode, setLocalTTSMode] = useState<'gemini' | 'webspeech' | 'auto'>('auto');
  const [keyList, setKeyList] = useState<{ id: string; isActive: boolean; isRateLimited: boolean; usageCount: number; maskedKey: string }[]>([]);

  // Refresh key list
  const refreshKeyList = () => {
    const keys = apiKeyRotation.getKeyList();
    // Add masked key display
    setKeyList(keys.map((k, i) => ({
      ...k,
      maskedKey: `APIキー ${i + 1}`
    })));
  };

  useEffect(() => {
    // Load existing key for backward compatibility
    const currentKey = storageService.getApiKey();
    if (currentKey && !apiKeyRotation.hasValidKey()) {
      apiKeyRotation.addKey(currentKey);
    }

    refreshKeyList();
    setLocalTTSMode(getTTSMode());

    if ((window as any).aistudio) {
      setIsPlatformEnv(true);
    }
  }, [isOpen]);

  const handleTTSModeChange = (mode: 'gemini' | 'webspeech' | 'auto') => {
    setLocalTTSMode(mode);
    setTTSMode(mode);
  };

  const handleAddKey = () => {
    if (!newApiKey.trim()) return;
    const key = newApiKey.trim();

    if (!key.startsWith('AIza') || key.length !== 39) {
      alert('有効なGemini APIキーを入力してください（AIzaで始まる39文字）');
      return;
    }

    const added = apiKeyRotation.addKey(key);
    if (added) {
      // Also set in storageService for backward compatibility
      if (!storageService.getApiKey()) {
        storageService.setApiKey(key);
      }
      setNewApiKey('');
      refreshKeyList();
    } else {
      alert('このキーは既に登録されています');
    }
  };

  const handleRemoveKey = (keyId: string) => {
    if (keyList.length <= 1) {
      alert('最低1つのAPIキーが必要です');
      return;
    }

    apiKeyRotation.removeKey(keyId);
    refreshKeyList();
  };

  const handleSave = () => {
    if (!apiKeyRotation.hasValidKey() && !newApiKey.trim()) {
      alert('少なくとも1つのAPIキーを入力してください');
      return;
    }

    // If there's a pending key, add it
    if (newApiKey.trim()) {
      handleAddKey();
    }

    if (apiKeyRotation.hasValidKey()) {
      onSave();
    }
  };

  const handlePlatformSelect = async () => {
    setIsSelecting(true);
    try {
      await (window as any).aistudio.openSelectKey();
      onSave();
    } catch (e: any) {
      console.error("Key selection failed", e);
      setIsSelecting(false);

      const msg = e.message || e.toString();
      if (msg.includes("Requested entity was not found")) {
        alert("プロジェクトの選択に失敗しました。もう一度お試しください。");
      } else {
        alert("APIキーの選択がキャンセルされたか、失敗しました。");
      }
    }
  };

  if (!isOpen) return null;
  if (isSelecting) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-white border border-black w-full max-w-lg p-8 animate-in fade-in zoom-in duration-200 shadow-[8px_8px_0px_0px_rgba(255,255,255,0.2)] max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold font-display uppercase tracking-tight mb-4">システム設定</h2>

        <div className="space-y-6">
          {/* API Keys Section */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-2">
              Gemini APIキー（複数登録可）
            </label>

            {/* Existing Keys List */}
            {keyList.length > 0 && (
              <div className="mb-3 space-y-2">
                {keyList.map((keyInfo) => (
                  <div
                    key={keyInfo.id}
                    className={`flex items-center justify-between p-2 border ${keyInfo.isActive
                        ? 'border-green-500 bg-green-50'
                        : keyInfo.isRateLimited
                          ? 'border-red-300 bg-red-50'
                          : 'border-gray-200'
                      }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${keyInfo.isActive
                          ? 'bg-green-500'
                          : keyInfo.isRateLimited
                            ? 'bg-red-400'
                            : 'bg-gray-300'
                        }`} />
                      <span className="font-mono text-sm">{keyInfo.maskedKey}</span>
                      {keyInfo.isActive && (
                        <span className="text-[10px] text-green-600 font-bold">使用中</span>
                      )}
                      {keyInfo.isRateLimited && (
                        <span className="text-[10px] text-red-500">制限中</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400">
                        {keyInfo.usageCount}回使用
                      </span>
                      <button
                        onClick={() => handleRemoveKey(keyInfo.id)}
                        className="text-red-400 hover:text-red-600 p-1 text-xs"
                        title="削除"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add New Key Input */}
            <div className="flex gap-2">
              <input
                type="password"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder="AIzaSy... (新しいキーを追加)"
                className="flex-1 border border-black p-3 font-mono text-sm outline-none focus:bg-gray-100 transition-colors"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleAddKey();
                  }
                }}
              />
              <button
                onClick={handleAddKey}
                disabled={!newApiKey.trim()}
                className="px-4 py-2 bg-gray-100 border border-black font-bold text-xs hover:bg-gray-200 disabled:opacity-50"
              >
                追加
              </button>
            </div>

            <p className="font-mono text-[10px] text-gray-400 mt-2">
              複数のキーを登録すると、レート制限時に自動で切り替わります
            </p>
          </div>

          {/* TTS Mode Section */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest mb-2">音声合成モード (TTS)</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleTTSModeChange('auto')}
                className={`flex-1 py-2 px-3 text-xs font-mono border transition-colors ${ttsMode === 'auto'
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-black border-gray-300 hover:border-black'
                  }`}
              >
                自動
              </button>
              <button
                type="button"
                onClick={() => handleTTSModeChange('webspeech')}
                className={`flex-1 py-2 px-3 text-xs font-mono border transition-colors ${ttsMode === 'webspeech'
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-black border-gray-300 hover:border-black'
                  }`}
              >
                ブラウザ音声
              </button>
              <button
                type="button"
                onClick={() => handleTTSModeChange('gemini')}
                className={`flex-1 py-2 px-3 text-xs font-mono border transition-colors ${ttsMode === 'gemini'
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-black border-gray-300 hover:border-black'
                  }`}
              >
                Gemini TTS
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              {ttsMode === 'auto' && '自動: Gemini TTS優先、制限時はブラウザ音声に切替'}
              {ttsMode === 'webspeech' && 'ブラウザ音声: 無料・無制限（品質は端末依存）'}
              {ttsMode === 'gemini' && 'Gemini TTS: 高品質（1日10回制限あり）'}
            </p>
          </div>

          {/* Footer Actions */}
          <div className="flex justify-between items-center pt-4 border-t border-gray-100">
            {isPlatformEnv ? (
              <button
                onClick={handlePlatformSelect}
                className="text-[10px] font-mono underline text-gray-400 hover:text-blue-600 flex items-center gap-1"
              >
                <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
                Google Cloud Projectから選択する
              </button>
            ) : (
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono underline hover:text-gray-500"
              >
                キーを取得 (aistudio) →
              </a>
            )}

            <div className="flex gap-4">
              {canDismiss && (
                <button
                  onClick={onClose}
                  className="px-4 py-2 font-mono text-xs uppercase tracking-widest hover:underline"
                >
                  キャンセル
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={!apiKeyRotation.hasValidKey() && !newApiKey.trim()}
                className="px-6 py-2 bg-black text-white font-bold uppercase text-xs tracking-widest hover:bg-gray-800 disabled:opacity-50"
              >
                設定を保存
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
