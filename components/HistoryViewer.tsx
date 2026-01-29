import React, { useState, useEffect } from 'react';
import { Answer } from '../types';
import { storageService } from '../services/storageService';

export const HistoryViewer: React.FC = () => {
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [selectedAnswer, setSelectedAnswer] = useState<Answer | null>(null);

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
      <div className="animate-in slide-in-from-right duration-300">
        <button
          onClick={() => setSelectedAnswer(null)}
          className="mb-8 font-mono text-xs uppercase tracking-widest hover:underline flex items-center gap-2"
        >
          ← 一覧に戻る
        </button>
        <div className="border border-black bg-white min-h-[50vh]">
          <div className="p-8 border-b border-black bg-gray-50">
            <div className="flex justify-between items-start mb-4">
               <h2 className="text-2xl font-display font-bold leading-tight max-w-2xl">{selectedAnswer.questionText}</h2>
               <div className="text-right">
                  <div className="font-mono text-xs uppercase tracking-widest text-gray-500">{formatDate(selectedAnswer.createdAt)}</div>
                  <div className="font-bold text-xs uppercase mt-1 px-2 py-0.5 bg-black text-white inline-block">{selectedAnswer.format}</div>
               </div>
            </div>
          </div>
          <div className="p-8 md:p-12 prose prose-slate max-w-none prose-headings:font-display prose-p:font-body">
            <pre className="whitespace-pre-wrap font-body text-base leading-relaxed text-black bg-transparent border-none p-0">
              {selectedAnswer.final}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-500">
      <h2 className="text-sm font-bold uppercase tracking-widest mb-6 border-b border-black pb-2">
        アーカイブ
      </h2>
      
      {answers.length === 0 ? (
        <div className="py-24 text-center border border-black border-dashed">
          <p className="font-mono text-gray-400">記録データなし</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {answers.map((ans) => (
            <div 
              key={ans.id}
              onClick={() => setSelectedAnswer(ans)}
              className="border border-black p-6 hover:bg-black hover:text-white transition-all cursor-pointer group h-full flex flex-col justify-between"
            >
              <div>
                <div className="flex justify-between items-center mb-4 opacity-50 text-[10px] font-mono uppercase">
                   <span>{formatDate(ans.createdAt)}</span>
                   <span>{ans.format}</span>
                </div>
                <h3 className="font-display font-bold text-lg mb-4 leading-snug line-clamp-3 group-hover:underline decoration-1 underline-offset-4">
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
    </div>
  );
};