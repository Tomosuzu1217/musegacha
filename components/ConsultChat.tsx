
import { useState, useEffect, useRef, useCallback } from 'react';
import { ConsultSession, ConsultMessage, Question, UserInterestProfile, CoreInsights } from '../types';
import { storageService } from '../services/storageService';
import { generateConsultResponse, generateQuestionsFromConsultation, synthesizeCoreInsights } from '../services/geminiService';
import { LiveSession } from './LiveSession';

export const ConsultChat: React.FC = () => {
  const [view, setView] = useState<'list' | 'chat'>('list');
  const [sessions, setSessions] = useState<ConsultSession[]>([]);
  const [activeSession, setActiveSession] = useState<ConsultSession | null>(null);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserInterestProfile | null>(null);
  const [coreInsights, setCoreInsights] = useState<CoreInsights | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');

  const loadSessions = useCallback(() => {
    setSessions(storageService.getConsultSessions());
  }, []);

  const refreshProfile = useCallback(() => {
    setProfile(storageService.getUserProfile());
  }, []);

  useEffect(() => {
    loadSessions();
    refreshProfile();
    setCoreInsights(storageService.getCoreInsights());
  }, [loadSessions, refreshProfile]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages?.length]);

  const startNewSession = () => {
    const newSession: ConsultSession = {
      id: crypto.randomUUID(),
      messages: [],
      generatedQuestionIds: [],
      themes: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setActiveSession(newSession);
    setView('chat');
    setGeneratedCount(0);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const openSession = (session: ConsultSession) => {
    setActiveSession(session);
    setView('chat');
    setGeneratedCount(session.generatedQuestionIds.length);
  };

  const handleDeleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    storageService.deleteConsultSession(id);
    loadSessions();
  };

  const handleBack = () => {
    setView('list');
    setActiveSession(null);
    loadSessions();
  };

  // Shared: generate questions from a session and update storage/state
  const generateAndSaveQuestions = async (session: ConsultSession): Promise<ConsultSession> => {
    const summary = session.messages
      .filter(m => m.role === 'user')
      .map(m => m.text)
      .join(' ');

    const questions = await generateQuestionsFromConsultation(summary, session.themes, session.id);
    if (questions.length === 0) return session;

    const fullQuestions: Question[] = questions.map(q => ({
      id: crypto.randomUUID(),
      text: q.text || '',
      source: q.source || `consult-${session.id}`,
      tags: q.tags || session.themes,
      difficulty: (q.difficulty as Question['difficulty']) || 'normal',
      createdAt: Date.now(),
    }));

    storageService.addQuestionsBatch(fullQuestions);
    setGeneratedCount(fullQuestions.length);

    const notifyMsg: ConsultMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: `\u2728 ${fullQuestions.length}個のオリジナル質問を作成しました。GACHAタブで優先的に出題されます。`,
      timestamp: Date.now(),
    };

    const updated: ConsultSession = {
      ...session,
      messages: [...session.messages, notifyMsg],
      generatedQuestionIds: fullQuestions.map(q => q.id),
      updatedAt: Date.now(),
    };

    const currentProfile = storageService.getUserProfile();
    storageService.updateUserProfile({
      totalConsultations: currentProfile.totalConsultations + 1,
      totalQuestionsGenerated: currentProfile.totalQuestionsGenerated + fullQuestions.length,
      recentConcerns: [summary.slice(0, 200), ...currentProfile.recentConcerns].slice(0, 10),
    });

    storageService.addActivityLog({
      type: 'question_generated',
      detail: `${fullQuestions.length}個の質問を相談から生成`,
      metadata: { sessionId: session.id, count: fullQuestions.length },
    });

    return updated;
  };

  const handleAnalyzeCore = async () => {
    if (!profile || sessions.length < 2) return;
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const sessionData = sessions.slice(0, 8).map(s => ({
        themes: s.themes,
        messages: s.messages.map(m => ({ role: m.role, text: m.text })),
      }));
      const insights = await synthesizeCoreInsights(sessionData, profile);
      storageService.saveCoreInsights(insights);
      setCoreInsights(insights);
    } catch (e) {
      console.error('Core analysis failed', e);
      setAnalysisError('分析に失敗しました。もう一度お試しください。');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !activeSession || isProcessing) return;

    const userMsg: ConsultMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: input.trim(),
      timestamp: Date.now(),
    };

    const updatedSession: ConsultSession = {
      ...activeSession,
      messages: [...activeSession.messages, userMsg],
      updatedAt: Date.now(),
    };
    setActiveSession(updatedSession);
    setInput('');
    setIsProcessing(true);

    try {
      const result = await generateConsultResponse(
        userMsg.text,
        updatedSession.messages.map(m => ({ role: m.role, text: m.text })),
        profile || undefined
      );

      const assistantMsg: ConsultMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: result.reply,
        timestamp: Date.now(),
      };

      let sessionWithReply: ConsultSession = {
        ...updatedSession,
        messages: [...updatedSession.messages, assistantMsg],
        themes: [...new Set([...updatedSession.themes, ...result.themes])],
        updatedAt: Date.now(),
      };

      result.themes.forEach(theme => storageService.incrementTheme(theme));

      storageService.addActivityLog({
        type: 'consultation',
        detail: userMsg.text.slice(0, 100),
      });

      if (result.shouldGenerateQuestions && sessionWithReply.generatedQuestionIds.length === 0) {
        setIsGeneratingQuestions(true);
        sessionWithReply = await generateAndSaveQuestions(sessionWithReply);
        setIsGeneratingQuestions(false);
      }

      setActiveSession(sessionWithReply);
      storageService.saveConsultSession(sessionWithReply);
      loadSessions();
      refreshProfile();
    } catch (error) {
      console.error('Consultation error:', error);
      const errorMsg: ConsultMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: 'エラーが発生しました。もう一度お試しください。',
        timestamp: Date.now(),
      };
      setActiveSession({
        ...updatedSession,
        messages: [...updatedSession.messages, errorMsg],
        updatedAt: Date.now(),
      });
    } finally {
      setIsProcessing(false);
      setIsGeneratingQuestions(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleVoiceSessionEnd = () => {
    if (voiceTranscript.trim() && activeSession) {
      // Save voice transcript as a message
      const userMsg: ConsultMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        text: `[Voice Session Transcript]\n${voiceTranscript}`,
        timestamp: Date.now(),
      };
      const updated: ConsultSession = {
        ...activeSession,
        messages: [...activeSession.messages, userMsg],
        updatedAt: Date.now(),
      };
      setActiveSession(updated);
      storageService.saveConsultSession(updated);
    }
    setVoiceMode(false);
    setVoiceTranscript('');
  };

  const startVoiceSession = () => {
    if (!activeSession) {
      // Create a new session first
      const newSession: ConsultSession = {
        id: crypto.randomUUID(),
        messages: [],
        generatedQuestionIds: [],
        themes: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setActiveSession(newSession);
      setView('chat');
    }
    setVoiceMode(true);
    setVoiceTranscript('');
  };

  const handleManualGenerate = async () => {
    if (!activeSession || activeSession.messages.length < 2 || isProcessing || isGeneratingQuestions) return;
    if (activeSession.generatedQuestionIds.length > 0) return;

    setIsGeneratingQuestions(true);
    setGenerateError(null);
    try {
      const updated = await generateAndSaveQuestions(activeSession);
      setActiveSession(updated);
      storageService.saveConsultSession(updated);
      refreshProfile();
    } catch (error) {
      console.error('Manual question generation error:', error);
      setGenerateError('質問の生成に失敗しました。');
    } finally {
      setIsGeneratingQuestions(false);
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // --- List View ---
  if (view === 'list') {
    return (
      <div className="w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 animate-spring-fade-up">
          <div>
            <h2 className="text-2xl font-bold font-display tracking-tighter chat-section-line gradient-text">CONSULT</h2>
            <p className="text-[10px] font-mono text-gray-500 uppercase mt-3 tracking-wider">
              Share your thoughts, discover yourself
            </p>
          </div>
          <button
            onClick={startNewSession}
            className="chat-send-btn px-5 py-2.5 text-xs font-bold uppercase tracking-widest flex items-center gap-2 btn-spring"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            NEW
          </button>
        </div>

        {/* Session List */}
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center animate-spring-fade-up">
            <div className="chat-empty-icon w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-600/20 to-blue-600/20 border border-purple-500/20 flex items-center justify-center mb-6 shadow-lg shadow-purple-500/5 animate-glow-breathe">
              <svg className="w-8 h-8 text-purple-400/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-sm text-gray-300 font-medium mb-2">Start your first consultation</p>
            <p className="text-xs text-gray-500 max-w-[280px] leading-relaxed">
              Share what's on your mind. AI will listen and create personalized discussion topics from your conversation.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((session, idx) => {
              const firstUserMsg = session.messages.find(m => m.role === 'user');
              const preview = firstUserMsg?.text.slice(0, 60) || 'New session';
              return (
                <button
                  key={session.id}
                  onClick={() => openSession(session)}
                  className="session-card card-spring w-full text-left p-4 group animate-card-stagger"
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex gap-3 flex-1 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-600/25 to-blue-600/25 border border-white/5 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <svg className="w-4 h-4 text-purple-400/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-200 truncate font-medium leading-snug">{preview}</p>
                        <div className="flex items-center gap-2.5 mt-1.5">
                          <span className="text-[10px] font-mono text-gray-500">
                            {formatTime(session.updatedAt)}
                          </span>
                          <span className="w-1 h-1 rounded-full bg-gray-700"></span>
                          <span className="text-[10px] font-mono text-gray-500">
                            {session.messages.length} msgs
                          </span>
                          {session.generatedQuestionIds.length > 0 && (
                            <span className="chat-badge text-[9px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-md font-bold">
                              {session.generatedQuestionIds.length}Q
                            </span>
                          )}
                        </div>
                        {session.themes.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {session.themes.slice(0, 4).map((theme, i) => (
                              <span key={i} className="text-[9px] px-2 py-0.5 bg-white/[0.04] border border-white/[0.06] text-gray-400 rounded-md font-mono">
                                {theme}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDeleteSession(e, session.id)}
                      className="text-gray-700 hover:text-red-400 transition-all ml-2 p-1.5 rounded-lg hover:bg-red-500/10 opacity-0 group-hover:opacity-100"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Core Insights */}
        {profile && sessions.length >= 2 && (
          <div className="mt-10 pt-6 border-t border-white/[0.04]">
            <div className="flex items-center justify-between mb-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 chat-section-line">CORE ANALYSIS</p>
              <button
                onClick={handleAnalyzeCore}
                disabled={isAnalyzing}
                className="text-[10px] font-bold uppercase px-4 py-2 chat-send-btn rounded-full disabled:opacity-30 active:scale-95 transition-all"
              >
                {isAnalyzing ? '...' : coreInsights ? 'Re-analyze' : 'Discover Core'}
              </button>
            </div>

            {analysisError && (
              <div className="px-3 py-2 bg-red-900/15 border border-red-500/20 rounded-lg mb-3">
                <p className="text-red-400 text-xs">{analysisError}</p>
              </div>
            )}

            {coreInsights ? (
              <div className="space-y-5">
                <div className="p-5 card-cinematic card-spring rounded-2xl animate-spring-fade-up">
                  <p className="text-sm leading-relaxed text-gray-300">{coreInsights.narrative}</p>
                </div>

                <div>
                  <p className="text-[9px] font-bold font-mono text-gray-500 uppercase mb-3 tracking-wider">Core Values</p>
                  <div className="flex flex-wrap gap-2">
                    {coreInsights.coreValues.map((v, i) => (
                      <span key={i} className="px-3 py-1.5 bg-purple-600/15 text-purple-300 border border-purple-500/20 text-xs font-medium rounded-lg">{v}</span>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[9px] font-bold font-mono text-gray-500 uppercase mb-3 tracking-wider">Patterns</p>
                  <div className="space-y-2">
                    {coreInsights.patterns.map((p, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <span className="w-5 h-5 rounded-lg bg-gradient-to-br from-purple-600/20 to-blue-600/20 border border-white/5 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-[8px] font-bold text-purple-400">{i + 1}</span>
                        </span>
                        <p className="text-xs text-gray-400 leading-relaxed">{p}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[9px] font-bold font-mono text-gray-500 uppercase mb-3 tracking-wider">Growth Areas</p>
                  <div className="space-y-2">
                    {coreInsights.growthAreas.map((g, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <span className="text-emerald-500/60 text-xs mt-0.5">+</span>
                        <p className="text-xs text-gray-400 leading-relaxed">{g}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <p className="text-[9px] font-mono text-gray-600 text-right pt-2">
                  {new Date(coreInsights.generatedAt).toLocaleDateString()} / {coreInsights.basedOnSessions} sessions
                </p>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-xs text-gray-500">
                  相談を重ねるほど、あなたのコアが見えてきます
                </p>
              </div>
            )}
          </div>
        )}

        {/* Profile Summary */}
        {profile && profile.totalConsultations > 0 && (() => {
          const topThemes = Object.entries(profile.themes)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5);
          return (
            <div className="mt-8 pt-6 border-t border-white/[0.04]">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 mb-4 chat-section-line">STATS</p>
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="stat-card card-spring text-center p-4 animate-card-stagger stagger-1">
                  <p className="text-xl font-bold font-display gradient-text">{profile.totalConsultations}</p>
                  <p className="text-[9px] text-gray-500 font-mono uppercase mt-1">Consults</p>
                </div>
                <div className="stat-card card-spring text-center p-4 animate-card-stagger stagger-2">
                  <p className="text-xl font-bold font-display gradient-text">{profile.totalQuestionsGenerated}</p>
                  <p className="text-[9px] text-gray-500 font-mono uppercase mt-1">Questions</p>
                </div>
                <div className="stat-card card-spring text-center p-4 animate-card-stagger stagger-3">
                  <p className="text-xl font-bold font-display gradient-text">{profile.totalSessionsCompleted}</p>
                  <p className="text-[9px] text-gray-500 font-mono uppercase mt-1">Sessions</p>
                </div>
              </div>
              {topThemes.length > 0 && (
                <div>
                  <p className="text-[9px] font-mono text-gray-500 mb-3 tracking-wider">TOP THEMES</p>
                  <div className="space-y-2">
                    {topThemes.map(([theme, count]) => (
                      <div key={theme} className="flex items-center gap-3">
                        <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-purple-500/80 to-blue-500/80 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, (count / topThemes[0][1]) * 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-mono text-gray-500 w-24 text-right truncate">{theme}</span>
                        <span className="text-[10px] font-mono text-gray-400 w-6 text-right font-medium">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    );
  }

  // --- Chat View ---
  if (voiceMode && activeSession) {
    return (
      <div className="fixed inset-0 z-[60] bg-[#1c1c3a]">
        <LiveSession
          question={activeSession.themes[0] || 'Free conversation'}
          onTranscriptUpdate={(t) => setVoiceTranscript(t)}
          onSessionEnd={handleVoiceSessionEnd}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-12rem)]">
      {/* Chat Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-white/[0.04] mb-2 flex-shrink-0">
        <button
          onClick={handleBack}
          className="p-2.5 -ml-1 hover:bg-white/[0.06] rounded-xl transition-all active:scale-90"
        >
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="ai-avatar-ring w-8 h-8 rounded-full bg-gradient-to-br from-purple-600/30 to-blue-600/30 border border-purple-500/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold font-display uppercase tracking-wider text-gray-200">Consult</h3>
            {activeSession && activeSession.themes.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {activeSession.themes.slice(0, 3).map((theme, i) => (
                  <span key={i} className="text-[9px] px-2 py-0.5 bg-white/[0.04] border border-white/[0.06] text-gray-500 rounded-md font-mono">
                    {theme}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        {activeSession && activeSession.messages.length >= 2 && activeSession.generatedQuestionIds.length === 0 && (
          <button
            onClick={handleManualGenerate}
            disabled={isProcessing || isGeneratingQuestions}
            className="px-3 py-1.5 chat-send-btn text-[10px] font-bold uppercase tracking-wider disabled:opacity-30 active:scale-95"
          >
            {isGeneratingQuestions ? '...' : 'Gen Q'}
          </button>
        )}
        {generatedCount > 0 && (
          <span className="chat-badge px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold rounded-lg font-mono">
            {generatedCount}Q
          </span>
        )}
      </div>

      {generateError && (
        <div className="px-3 py-2 bg-red-900/10 border border-red-500/15 rounded-xl mb-2 chat-msg-system">
          <p className="text-red-400 text-xs">{generateError}</p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-20 pt-2 chat-scroll-area">
        {activeSession?.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center chat-msg-system">
            <div className="chat-empty-icon w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600/15 to-blue-600/15 border border-purple-500/10 flex items-center justify-center mb-5">
              <svg className="w-7 h-7 text-purple-400/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
            </div>
            <p className="text-sm text-gray-300 font-medium mb-2">What's on your mind?</p>
            <p className="text-xs text-gray-500 max-w-[280px] leading-relaxed">
              Share any concerns, thoughts, or situations you'd like to explore. AI will create personalized topics from your conversation.
            </p>
          </div>
        )}

        {activeSession?.messages.map((msg, idx) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end chat-msg-user' : 'justify-start chat-msg-ai'}`}
            style={{ animationDelay: `${Math.min(idx * 50, 300)}ms` }}
          >
            {msg.role !== 'user' && (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-600/25 to-blue-600/25 border border-purple-500/15 flex items-center justify-center flex-shrink-0 mr-2 mt-1">
                <svg className="w-3.5 h-3.5 text-purple-400/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
            )}
            <div
              className={`max-w-[80%] px-4 py-3 ${
                msg.role === 'user'
                  ? 'chat-bubble-user'
                  : 'chat-bubble-ai'
              }`}
            >
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
              <p className={`text-[9px] mt-2 ${msg.role === 'user' ? 'text-white/40' : 'text-gray-600'} font-mono`}>
                {formatTime(msg.timestamp)}
              </p>
            </div>
          </div>
        ))}

        {isProcessing && (
          <div className="flex justify-start chat-msg-ai">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-600/25 to-blue-600/25 border border-purple-500/15 flex items-center justify-center flex-shrink-0 mr-2 mt-1">
              <svg className="w-3.5 h-3.5 text-purple-400/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div className="chat-bubble-ai px-5 py-4">
              <div className="flex gap-2 items-center">
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
              </div>
              {isGeneratingQuestions && (
                <p className="text-[10px] text-purple-400/60 mt-2.5 font-mono tracking-wide">Generating questions...</p>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0 pt-3">
        <div className="chat-input-wrapper flex gap-2 items-end p-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Share your thoughts..."
            rows={1}
            className="chat-input-inner flex-1 resize-none px-3 py-2.5 text-sm leading-relaxed"
            style={{ maxHeight: '120px', minHeight: '40px' }}
            disabled={isProcessing}
          />
          <button
            onClick={startVoiceSession}
            disabled={isProcessing}
            className="p-2.5 flex-shrink-0 bg-white/5 text-gray-400 border border-white/10 rounded-xl hover:bg-white/10 btn-spring disabled:opacity-30"
            title="Voice Session"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-14 0m14 0a7 7 0 00-14 0m14 0v1a7 7 0 01-14 0v-1m7 8v4m-4 0h8" />
            </svg>
          </button>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isProcessing}
            className="chat-send-btn p-2.5 flex-shrink-0 btn-spring"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};
