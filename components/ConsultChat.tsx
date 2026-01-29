
import { useState, useEffect, useRef, useCallback } from 'react';
import { ConsultSession, ConsultMessage, Question, UserInterestProfile } from '../types';
import { storageService } from '../services/storageService';
import { generateConsultResponse, generateQuestionsFromConsultation } from '../services/geminiService';

export const ConsultChat: React.FC = () => {
  const [view, setView] = useState<'list' | 'chat'>('list');
  const [sessions, setSessions] = useState<ConsultSession[]>([]);
  const [activeSession, setActiveSession] = useState<ConsultSession | null>(null);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [generatedCount, setGeneratedCount] = useState(0);
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  const [profile, setProfile] = useState<UserInterestProfile | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadSessions = useCallback(() => {
    setSessions(storageService.getConsultSessions());
  }, []);

  const refreshProfile = useCallback(() => {
    setProfile(storageService.getUserProfile());
  }, []);

  useEffect(() => {
    loadSessions();
    refreshProfile();
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

  const handleManualGenerate = async () => {
    if (!activeSession || activeSession.messages.length < 2 || isProcessing || isGeneratingQuestions) return;
    if (activeSession.generatedQuestionIds.length > 0) return;

    setIsGeneratingQuestions(true);
    try {
      const updated = await generateAndSaveQuestions(activeSession);
      setActiveSession(updated);
      storageService.saveConsultSession(updated);
      refreshProfile();
    } catch (error) {
      console.error('Manual question generation error:', error);
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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold font-display tracking-tighter">CONSULT</h2>
            <p className="text-[10px] font-mono text-gray-400 uppercase mt-1">
              Share your thoughts, get personalized questions
            </p>
          </div>
          <button
            onClick={startNewSession}
            className="px-4 py-2 bg-black text-white text-xs font-bold uppercase tracking-widest rounded-lg active:scale-95 transition-all"
          >
            + NEW
          </button>
        </div>

        {/* Session List */}
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 border-2 border-gray-200 rounded-full flex items-center justify-center mb-4">
              <span className="text-2xl opacity-30">?</span>
            </div>
            <p className="text-sm text-gray-400 font-mono mb-2">No consultations yet</p>
            <p className="text-xs text-gray-300 max-w-[250px]">
              Tap "+ NEW" to start sharing what's on your mind. AI will create personalized questions from your concerns.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map(session => {
              const firstUserMsg = session.messages.find(m => m.role === 'user');
              const preview = firstUserMsg?.text.slice(0, 60) || 'New session';
              return (
                <button
                  key={session.id}
                  onClick={() => openSession(session)}
                  className="w-full text-left p-4 border border-gray-200 rounded-lg hover:border-black transition-colors group"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate font-medium">{preview}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[10px] font-mono text-gray-400">
                          {formatTime(session.updatedAt)}
                        </span>
                        <span className="text-[10px] font-mono text-gray-300">
                          {session.messages.length} msgs
                        </span>
                        {session.generatedQuestionIds.length > 0 && (
                          <span className="text-[10px] font-mono text-green-600 font-bold">
                            {session.generatedQuestionIds.length} Q generated
                          </span>
                        )}
                      </div>
                      {session.themes.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {session.themes.slice(0, 4).map((theme, i) => (
                            <span key={i} className="text-[9px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full font-mono">
                              {theme}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={(e) => handleDeleteSession(e, session.id)}
                      className="text-gray-300 hover:text-red-500 transition-colors ml-2 p-1 opacity-0 group-hover:opacity-100"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Profile Summary */}
        {(() => {
          const profile = storageService.getUserProfile();
          if (profile.totalConsultations === 0) return null;
          const topThemes = Object.entries(profile.themes)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5);
          return (
            <div className="mt-8 pt-6 border-t border-gray-100">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">YOUR PROFILE</p>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <p className="text-lg font-bold font-display">{profile.totalConsultations}</p>
                  <p className="text-[9px] text-gray-400 font-mono uppercase">Consults</p>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <p className="text-lg font-bold font-display">{profile.totalQuestionsGenerated}</p>
                  <p className="text-[9px] text-gray-400 font-mono uppercase">Questions</p>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded-lg">
                  <p className="text-lg font-bold font-display">{profile.totalSessionsCompleted}</p>
                  <p className="text-[9px] text-gray-400 font-mono uppercase">Sessions</p>
                </div>
              </div>
              {topThemes.length > 0 && (
                <div>
                  <p className="text-[9px] font-mono text-gray-400 mb-2">TOP THEMES</p>
                  <div className="space-y-1">
                    {topThemes.map(([theme, count]) => (
                      <div key={theme} className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-black rounded-full"
                            style={{ width: `${Math.min(100, (count / topThemes[0][1]) * 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-mono text-gray-500 w-24 text-right truncate">{theme}</span>
                        <span className="text-[10px] font-mono text-gray-300 w-6 text-right">{count}</span>
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
  return (
    <div className="flex flex-col h-[calc(100dvh-12rem)]">
      {/* Chat Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-gray-100 mb-4 flex-shrink-0">
        <button
          onClick={handleBack}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h3 className="text-sm font-bold font-display uppercase tracking-wider">CONSULT</h3>
          {activeSession && activeSession.themes.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {activeSession.themes.slice(0, 3).map((theme, i) => (
                <span key={i} className="text-[9px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full font-mono">
                  {theme}
                </span>
              ))}
            </div>
          )}
        </div>
        {/* Generate Questions Button */}
        {activeSession && activeSession.messages.length >= 2 && activeSession.generatedQuestionIds.length === 0 && (
          <button
            onClick={handleManualGenerate}
            disabled={isProcessing || isGeneratingQuestions}
            className="px-3 py-1.5 bg-black text-white text-[10px] font-bold uppercase tracking-wider rounded-lg disabled:opacity-30 active:scale-95 transition-all"
          >
            {isGeneratingQuestions ? 'Generating...' : 'Generate Q'}
          </button>
        )}
        {generatedCount > 0 && (
          <span className="px-2 py-1 bg-green-100 text-green-700 text-[10px] font-bold rounded-full font-mono">
            {generatedCount}Q
          </span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 pb-4">
        {activeSession?.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-gray-400 mb-2">What's on your mind?</p>
            <p className="text-xs text-gray-300 max-w-[280px]">
              Share any concerns, thoughts, or situations you'd like to explore. The AI will listen and create personalized discussion topics from your conversation.
            </p>
          </div>
        )}

        {activeSession?.messages.map(msg => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] px-4 py-3 rounded-2xl ${
                msg.role === 'user'
                  ? 'bg-black text-white rounded-br-sm'
                  : 'bg-gray-50 text-gray-800 border border-gray-100 rounded-bl-sm'
              }`}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
              <p className={`text-[9px] mt-1 ${msg.role === 'user' ? 'text-gray-400' : 'text-gray-300'} font-mono`}>
                {formatTime(msg.timestamp)}
              </p>
            </div>
          </div>
        ))}

        {isProcessing && (
          <div className="flex justify-start">
            <div className="bg-gray-50 border border-gray-100 px-4 py-3 rounded-2xl rounded-bl-sm">
              <div className="flex gap-1.5">
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              {isGeneratingQuestions && (
                <p className="text-[10px] text-gray-400 mt-2 font-mono">Generating questions...</p>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0 pt-3 border-t border-gray-100">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your thoughts..."
            rows={1}
            className="flex-1 resize-none border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-black transition-colors"
            style={{ maxHeight: '120px', minHeight: '44px' }}
            disabled={isProcessing}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isProcessing}
            className="p-3 bg-black text-white rounded-xl disabled:opacity-20 active:scale-95 transition-all flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};
