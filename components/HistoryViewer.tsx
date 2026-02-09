import React, { useState, useEffect } from 'react';
import { Answer } from '../types';
import { storageService } from '../services/storageService';
import { ActivityLogView } from './ActivityLogView';

export const HistoryViewer: React.FC = () => {
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [selectedAnswer, setSelectedAnswer] = useState<Answer | null>(null);
  const [subTab, setSubTab] = useState<'archive' | 'activity'>('archive');
  const [shareSuccess, setShareSuccess] = useState(false);

  const handleShare = async (title: string, text: string) => {
    const shareData = { title: `MUSE GACHA - ${title}`, text: text.slice(0, 500) };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch {}
    } else {
      try {
        await navigator.clipboard.writeText(`${shareData.title}\n\n${text}`);
        setShareSuccess(true);
        setTimeout(() => setShareSuccess(false), 2000);
      } catch {}
    }
  };

  useEffect(() => {
    setAnswers(storageService.getAnswers());
  }, []);

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).replace(/\//g, '.');
  };

  if (selectedAnswer) {
    return (
      <div className="animate-spring-left">
        <button
          onClick={() => setSelectedAnswer(null)}
          className="mb-8 font-mono text-xs uppercase tracking-widest hover:underline flex items-center gap-2 btn-spring"
        >
          ← 一覧に戻る
        </button>
        <div className="card-cinematic rounded-xl min-h-[50vh]">
          <div className="p-8 border-b border-white/5 bg-white/5">
            <div className="flex justify-between items-start mb-4">
               <h2 className="text-2xl font-display font-bold leading-tight max-w-2xl">{selectedAnswer.questionText}</h2>
               <div className="text-right">
                  <div className="font-mono text-xs uppercase tracking-widest text-gray-500">{formatDate(selectedAnswer.createdAt)}</div>
                  <div className="font-bold text-xs uppercase mt-1 px-2 py-0.5 bg-purple-600/30 text-purple-300 border border-purple-500/30 inline-block">{selectedAnswer.format}</div>
               </div>
            </div>
          </div>
          <div className="p-8 md:p-12 prose prose-slate max-w-none prose-headings:font-display prose-p:font-body">
            <pre className="whitespace-pre-wrap font-body text-base leading-relaxed text-gray-200 bg-transparent border-none p-0">
              {selectedAnswer.final}
            </pre>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={() => handleShare(selectedAnswer.questionText, selectedAnswer.final)}
            className="flex-1 py-3 bg-white/5 text-gray-400 border border-white/10 font-mono text-xs uppercase tracking-widest hover:bg-white/10 btn-spring rounded-lg"
          >
            {shareSuccess ? 'Shared!' : 'Share'}
          </button>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(selectedAnswer.final);
                setShareSuccess(true);
                setTimeout(() => setShareSuccess(false), 2000);
              } catch {}
            }}
            className="flex-1 py-3 bg-white/5 text-gray-400 border border-white/10 font-mono text-xs uppercase tracking-widest hover:bg-white/10 btn-spring rounded-lg"
          >
            Copy Text
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-spring-fade-up">
      {/* Sub-tab Toggle */}
      <div className="flex gap-0 mb-6 border-b border-white/10">
        <button
          onClick={() => setSubTab('archive')}
          className={`flex-1 text-sm font-bold uppercase tracking-widest pb-2 border-b-2 transition-colors btn-spring ${
            subTab === 'archive' ? 'border-purple-500 text-white' : 'border-transparent text-gray-600 hover:text-gray-400'
          }`}
        >
          Archive
        </button>
        <button
          onClick={() => setSubTab('activity')}
          className={`flex-1 text-sm font-bold uppercase tracking-widest pb-2 border-b-2 transition-colors btn-spring ${
            subTab === 'activity' ? 'border-purple-500 text-white' : 'border-transparent text-gray-600 hover:text-gray-400'
          }`}
        >
          Activity
        </button>
      </div>

      {subTab === 'activity' ? (
        <ActivityLogView />
      ) : (
      <>
      {answers.length === 0 ? (
        <div className="py-24 text-center border border-white/10 border-dashed">
          <p className="font-mono text-gray-400">記録データなし</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {answers.map((ans) => (
            <div
              key={ans.id}
              onClick={() => setSelectedAnswer(ans)}
              className="card-cinematic rounded-xl p-6 hover:bg-white/5 hover:border-purple-500/30 hover-glow cursor-pointer group h-full flex flex-col justify-between card-spring animate-card-stagger"
            >
              <div>
                <div className="flex justify-between items-center mb-4 opacity-50 text-[10px] font-mono uppercase">
                   <span>{formatDate(ans.createdAt)}</span>
                   <span>{ans.format}</span>
                </div>
                <h3 className="font-display font-bold text-lg mb-4 leading-snug line-clamp-3 group-hover:underline decoration-purple-500 decoration-1 underline-offset-4">
                  {ans.questionText}
                </h3>
              </div>
              <div className="text-[10px] font-mono uppercase tracking-widest flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                記事を読む <span>→</span>
              </div>
            </div>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  );
};