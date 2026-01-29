
import { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { QuestionCard } from './components/QuestionCard';
import { Editor } from './components/Editor';
import { QuestionManager } from './components/QuestionManager';
import { HistoryViewer } from './components/HistoryViewer';
import { ApiKeyModal } from './components/ApiKeyModal';
import { ConsultChat } from './components/ConsultChat';
import { storageService } from './services/storageService';
import { Question, FilterState, PRESET_TAGS } from './types';

// @ts-ignore - Defined in vite.config.ts
declare const __GEMINI_API_KEY__: string;

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'gacha' | 'consult' | 'manage' | 'history'>('gacha');
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [noQuestionsAvailable, setNoQuestionsAvailable] = useState(false);

  // API Key State
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);

  // Filters
  const [filters, setFilters] = useState<FilterState>({ tag: null, difficulty: null });
  const [showFilters, setShowFilters] = useState(false);

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

    // 3. LocalStorageにAPIキーがある場合
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
    setNoQuestionsAvailable(false);
    setIsEditing(false);

    const allQuestions = storageService.getQuestions();
    const history = storageService.getRotationHistory();

    let candidates = allQuestions.filter(q => {
      if (filters.difficulty && q.difficulty !== filters.difficulty) return false;
      if (filters.tag && !q.tags.includes(filters.tag)) return false;
      return true;
    });

    if (candidates.length === 0) {
      setNoQuestionsAvailable(true);
      setCurrentQuestion(null);
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
  };

  const hasActiveFilters = !!filters.tag || !!filters.difficulty;

  return (
    <>
      <Layout activeTab={activeTab} onTabChange={setActiveTab}>
        {/* API Key Indicator (Mobile Friendly) */}
        {!hasApiKey && (
          <div className="fixed top-16 right-4 z-50">
            <button
              onClick={() => setIsApiKeyModalOpen(true)}
              className="w-8 h-8 rounded-full bg-red-600 text-white flex items-center justify-center animate-pulse shadow-lg"
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
                  <div className="mb-4">
                    <button
                      onClick={() => setShowFilters(!showFilters)}
                      className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-500 border border-gray-200 px-3 py-2 rounded-full"
                    >
                      <span className={`w-2 h-2 rounded-full ${hasActiveFilters ? 'bg-black' : 'bg-gray-300'}`}></span>
                      {showFilters ? 'Hide Filters' : 'Filter Options'}
                    </button>

                    {showFilters && (
                      <div className="mt-4 p-4 bg-gray-50 rounded-lg space-y-4 animate-in slide-in-from-top-2">
                        <div>
                          <label className="text-[10px] uppercase font-bold text-gray-400 block mb-2">Difficulty</label>
                          <div className="flex gap-2">
                            {['light', 'normal', 'heavy'].map(d => (
                              <button
                                key={d}
                                onClick={() => setFilters(prev => ({ ...prev, difficulty: prev.difficulty === d ? null : d as any }))}
                                className={`flex-1 py-2 text-[10px] uppercase font-bold border ${filters.difficulty === d ? 'bg-black text-white border-black' : 'bg-white border-gray-300 text-gray-500'}`}
                              >
                                {d}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] uppercase font-bold text-gray-400 block mb-2">Topic</label>
                          <div className="flex flex-wrap gap-2">
                            {PRESET_TAGS.map(t => (
                              <button
                                key={t}
                                onClick={() => setFilters(prev => ({ ...prev, tag: prev.tag === t ? null : t }))}
                                className={`px-3 py-1 text-[10px] uppercase font-bold border rounded-full ${filters.tag === t ? 'bg-black text-white border-black' : 'bg-white border-gray-300 text-gray-500'}`}
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="pt-2 text-right">
                          <button onClick={clearFilters} className="text-[10px] font-bold text-red-500 underline">RESET ALL</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Main Stage */}
                <div className="flex-1 flex flex-col justify-center relative min-h-0">
                  {currentQuestion ? (
                    <div className="w-full h-full flex flex-col animate-in fade-in zoom-in duration-300 pb-20">

                      {/* Question Card Area */}
                      <div className="flex-1 flex items-center justify-center py-2">
                        <QuestionCard question={currentQuestion} />
                      </div>

                      {/* Action Buttons */}
                      <div className="flex flex-col gap-3 w-full mt-auto bg-white/50 backdrop-blur-sm pt-4">
                        <button
                          onClick={startWriting}
                          className="w-full py-4 bg-black text-white font-display font-bold text-lg uppercase tracking-widest hover:bg-gray-900 shadow-xl active:scale-[0.98] transition-all rounded-lg"
                        >
                          Start Session
                        </button>
                        <button
                          onClick={spinGacha}
                          className="w-full py-3 bg-white text-gray-500 border border-gray-200 font-mono text-xs uppercase tracking-widest hover:bg-gray-50 active:scale-[0.98] transition-all rounded-lg"
                        >
                          Skip / Next
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center flex-1 py-12">
                      {noQuestionsAvailable ? (
                        <div className="border border-black p-8 bg-yellow-50 rounded-lg text-center w-full">
                          <p className="font-bold uppercase mb-2 text-xl font-display">No Matches</p>
                          <button onClick={clearFilters} className="text-xs font-bold underline p-2">
                            Reset Filters
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center w-full">
                          <div className="w-20 h-20 border-2 border-black rounded-full flex items-center justify-center mb-6 animate-[spin_12s_linear_infinite]">
                            <span className="font-display font-bold text-3xl">?</span>
                          </div>
                          <h2 className="text-4xl font-bold font-display tracking-tighter mb-4 text-center">
                            MUSE<br />GACHA
                          </h2>
                          <p className="font-mono text-xs text-gray-500 mb-8 text-center max-w-[200px]">
                            Tap below to spin.
                          </p>
                          <button
                            onClick={spinGacha}
                            className="w-full max-w-xs py-5 bg-black text-white text-lg font-bold font-display uppercase tracking-widest rounded-lg shadow-xl active:scale-95 transition-all"
                          >
                            SPIN
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              // Editor takes full screen
              <div className="fixed inset-0 z-50 bg-white flex flex-col">
                <Editor question={currentQuestion} onClose={handleEditorClose} />
              </div>
            )}
          </div>
        )}

        {activeTab === 'consult' && <ConsultChat />}
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
