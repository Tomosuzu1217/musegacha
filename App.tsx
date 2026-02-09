
import { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { QuestionCard } from './components/QuestionCard';
import { Editor } from './components/Editor';
import { QuestionManager } from './components/QuestionManager';
import { HistoryViewer } from './components/HistoryViewer';
import { ApiKeyModal } from './components/ApiKeyModal';
import { ConsultChat } from './components/ConsultChat';
import { CollabSession } from './components/CollabSession';
import { storageService } from './services/storageService';
import { apiKeyRotation } from './services/apiKeyRotation';
import { Question, FilterState, PRESET_TAGS } from './types';
import { useI18n } from './services/i18n';

// @ts-ignore - Defined in vite.config.ts
declare const __GEMINI_API_KEY__: string;

const App: React.FC = () => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'gacha' | 'consult' | 'manage' | 'history' | 'collab'>('gacha');
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [noQuestionsAvailable, setNoQuestionsAvailable] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);

  // API Key State
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);

  // Filters
  const [filters, setFilters] = useState<FilterState>({ tag: null, difficulty: null });
  const [showFilters, setShowFilters] = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  useEffect(() => {
    checkApiKey();
  }, []);

  const checkApiKey = async () => {
    // 1. 環境変数にAPIキーが設定されている場合、モーダルをスキップ
    if (typeof __GEMINI_API_KEY__ !== 'undefined' && __GEMINI_API_KEY__ && __GEMINI_API_KEY__.startsWith('AIza')) {
      setHasApiKey(true);
      setIsApiKeyModalOpen(false);
      return;
    }

    // 2. AI Studio経由の場合
    if ((window as any).aistudio) {
      try {
        const hasSelected = await (window as any).aistudio.hasSelectedApiKey();
        if (hasSelected) {
          setHasApiKey(true);
          setIsApiKeyModalOpen(false);
          return;
        }
      } catch (e) {
        console.warn("AI Studio key check failed", e);
      }
    }

    // 3. APIキーローテーションサービスにキーがある場合
    if (apiKeyRotation.hasValidKey()) {
      setHasApiKey(true);
      setIsApiKeyModalOpen(false);
      return;
    }

    // 4. LocalStorageにAPIキーがある場合（後方互換）
    const key = storageService.getApiKey();
    if (key) {
      setHasApiKey(true);
      setIsApiKeyModalOpen(false);
    } else {
      setHasApiKey(false);
      setIsApiKeyModalOpen(true);
    }
  };

  const handleApiKeySaved = () => {
    // APIキーが保存された後、直接状態を更新してモーダルを閉じる
    setHasApiKey(true);
    setIsApiKeyModalOpen(false);
  };

  const spinGacha = () => {
    if (isSpinning) return;
    setIsSpinning(true);
    setNoQuestionsAvailable(false);
    setIsEditing(false);

    const allQuestions = storageService.getQuestions();
    const history = storageService.getRotationHistory();

    let candidates = allQuestions.filter(q => {
      if (filters.difficulty && q.difficulty !== filters.difficulty) return false;
      if (filters.tag && !q.tags.includes(filters.tag)) return false;
      if (showFavoritesOnly && !q.isFavorite) return false;
      return true;
    });

    if (candidates.length === 0) {
      setNoQuestionsAvailable(true);
      setCurrentQuestion(null);
      setIsSpinning(false);
      return;
    }

    const freshCandidates = candidates.filter(q => !history.includes(q.id));
    const pool = freshCandidates.length > 0 ? freshCandidates : candidates;

    // Weighted selection: consultation-derived questions get 3x weight
    const CONSULT_WEIGHT = 3;
    let totalWeight = 0;
    for (const q of pool) {
      totalWeight += q.source.startsWith('consult-') ? CONSULT_WEIGHT : 1;
    }
    let roll = Math.random() * totalWeight;
    let random = pool[0];
    for (const q of pool) {
      roll -= q.source.startsWith('consult-') ? CONSULT_WEIGHT : 1;
      if (roll <= 0) { random = q; break; }
    }
    setCurrentQuestion(random);
    setTimeout(() => setIsSpinning(false), 300);

    // Log the spin
    storageService.addActivityLog({
      type: 'gacha_spin',
      detail: random.text.slice(0, 50),
      metadata: { source: random.source },
    });
  };

  const startWriting = () => {
    if (currentQuestion) {
      setIsEditing(true);
    }
  };

  const handleEditorClose = () => {
    setIsEditing(false);
    setCurrentQuestion(null);
  };

  const clearFilters = () => {
    setFilters({ tag: null, difficulty: null });
    setShowFavoritesOnly(false);
  };

  const handleToggleFavorite = (id: string) => {
    storageService.toggleFavorite(id);
    if (currentQuestion && currentQuestion.id === id) {
      setCurrentQuestion({ ...currentQuestion, isFavorite: !currentQuestion.isFavorite });
    }
  };

  const hasActiveFilters = !!filters.tag || !!filters.difficulty || showFavoritesOnly;

  return (
    <>
      <Layout activeTab={activeTab} onTabChange={setActiveTab}>
        {/* API Key Indicator (Mobile Friendly) */}
        {!hasApiKey && (
          <div className="fixed top-16 right-4 z-50">
            <button
              onClick={() => setIsApiKeyModalOpen(true)}
              className="w-10 h-10 rounded-full bg-red-600 text-white flex items-center justify-center animate-pulse shadow-lg glow-red text-lg font-bold"
            >
              !
            </button>
          </div>
        )}

        {activeTab === 'gacha' && (
          <div className="w-full h-full flex flex-col">
            {!isEditing ? (
              <div className="flex flex-col flex-1">

                {/* Mobile Filter Toggle */}
                {!currentQuestion && (
                  <div className="mb-4 animate-spring-fade-up">
                    <button
                      onClick={() => setShowFilters(!showFilters)}
                      className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-400 border border-white/10 px-3 py-2 rounded-full glass-dark hover-glow btn-spring"
                    >
                      <span className={`w-2 h-2 rounded-full transition-colors ${hasActiveFilters ? 'bg-purple-500 shadow-[0_0_6px_rgba(139,92,246,0.5)]' : 'bg-gray-600'}`}></span>
                      {showFilters ? t('gacha.hide_filters') : t('gacha.filter_options')}
                    </button>

                    {showFilters && (
                      <div className="mt-4 p-4 card-cinematic rounded-xl space-y-4 animate-spring-snappy">
                        <div>
                          <label className="text-[10px] uppercase font-bold text-gray-400 block mb-2">{t('filter.difficulty')}</label>
                          <div className="flex gap-2">
                            {['light', 'normal', 'heavy'].map(d => (
                              <button
                                key={d}
                                onClick={() => setFilters(prev => ({ ...prev, difficulty: prev.difficulty === d ? null : d as any }))}
                                className={`flex-1 py-2.5 text-[10px] uppercase font-bold border rounded-lg btn-spring ${filters.difficulty === d ? 'bg-purple-600 text-white border-purple-600 shadow-md shadow-purple-500/30' : 'bg-transparent border-white/10 text-gray-400 hover:border-white/20'}`}
                              >
                                {d}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] uppercase font-bold text-gray-400 block mb-2">{t('filter.topic')}</label>
                          <div className="flex flex-wrap gap-2">
                            {PRESET_TAGS.map(t => (
                              <button
                                key={t}
                                onClick={() => setFilters(prev => ({ ...prev, tag: prev.tag === t ? null : t }))}
                                className={`px-3 py-1.5 text-[10px] uppercase font-bold border rounded-full btn-spring ${filters.tag === t ? 'bg-purple-600/30 text-purple-300 border-purple-500/50' : 'bg-transparent border-white/10 text-gray-400 hover:border-white/20'}`}
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="pt-2 flex justify-between items-center">
                          <button
                            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                            className={`px-3 py-1.5 text-[10px] uppercase font-bold border rounded-full btn-spring ${showFavoritesOnly ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/50' : 'bg-transparent border-white/10 text-gray-400 hover:border-white/20'}`}
                          >
                            ★ {t('gacha.favorites_only')}
                          </button>
                          <button onClick={clearFilters} className="text-[10px] font-bold text-red-400 underline btn-spring">{t('filter.reset')}</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Main Stage */}
                <div className="flex-1 flex flex-col justify-center relative min-h-0">
                  {currentQuestion ? (
                    <div className="w-full h-full flex flex-col pb-20 animate-spring-in">

                      {/* Question Card Area */}
                      <div className="flex-1 flex items-center justify-center py-2">
                        <QuestionCard question={currentQuestion} onToggleFavorite={handleToggleFavorite} />
                      </div>

                      {/* Action Buttons */}
                      <div className="flex flex-col gap-3 w-full mt-auto backdrop-blur-sm pt-4">
                        <button
                          onClick={startWriting}
                          className="w-full py-4 btn-neon font-display font-bold text-lg uppercase tracking-widest btn-spring rounded-xl shadow-xl animate-glow-breathe"
                        >
                          {t('gacha.start')}
                        </button>
                        <button
                          onClick={spinGacha}
                          disabled={isSpinning}
                          className="w-full py-3 bg-white/5 text-gray-400 border border-white/10 font-mono text-xs uppercase tracking-widest hover:bg-white/10 btn-spring rounded-lg disabled:opacity-50"
                        >
                          {t('gacha.skip')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center flex-1 py-12">
                      {noQuestionsAvailable ? (
                        <div className="border border-amber-500/30 p-8 bg-amber-900/20 rounded-xl card-cinematic text-center w-full animate-spring-snappy">
                          <p className="font-bold uppercase mb-2 text-xl font-display text-white">{t('gacha.no_matches')}</p>
                          <button onClick={clearFilters} className="text-xs font-bold underline p-2 text-amber-400 btn-spring">
                            {t('gacha.reset_filters')}
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center w-full animate-spring-fade-up">
                          <div className="w-24 h-24 border-2 border-purple-500/50 rounded-full flex items-center justify-center mb-6 animate-[spin_12s_linear_infinite] shadow-[0_0_20px_rgba(139,92,246,0.3)]">
                            <span className="font-display font-bold text-4xl text-purple-300">?</span>
                          </div>
                          <h2 className="text-5xl font-bold font-display tracking-tighter mb-4 text-center gradient-text-neon">
                            MUSE<br />GACHA
                          </h2>
                          <p className="font-mono text-xs text-gray-500 mb-10 text-center max-w-[220px]">
                            {t('gacha.tap_to_spin')}
                          </p>
                          <button
                            onClick={spinGacha}
                            disabled={isSpinning}
                            className="w-full max-w-xs py-5 btn-neon text-lg font-bold font-display uppercase tracking-widest rounded-xl shadow-xl btn-spring animate-glow-breathe disabled:opacity-50"
                          >
                            {t('gacha.spin')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              // Editor takes full screen (z-[60] to cover bottom nav z-50)
              <div className="fixed inset-0 z-[60] bg-[#1c1c3a] flex flex-col">
                <Editor question={currentQuestion!} onClose={handleEditorClose} />
              </div>
            )}
          </div>
        )}

        {activeTab === 'consult' && <ConsultChat />}
        {activeTab === 'collab' && <CollabSession />}
        {activeTab === 'manage' && <QuestionManager />}
        {activeTab === 'history' && <HistoryViewer />}
      </Layout>

      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        onSave={handleApiKeySaved}
        onClose={() => setIsApiKeyModalOpen(false)}
        canDismiss={hasApiKey}
      />
    </>
  );
};

export default App;
