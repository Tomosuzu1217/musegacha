import React from 'react';
import { Question } from '../types';

interface QuestionCardProps {
  question: Question;
  onToggleFavorite?: (id: string) => void;
}

export const QuestionCard: React.FC<QuestionCardProps> = ({ question, onToggleFavorite }) => {
  return (
    <div className="w-full py-10 px-6 flex flex-col items-center text-center card-spring group relative overflow-hidden card-cinematic rounded-xl border border-white/5 animate-spring-fade-up">

      {/* Favorite star */}
      {onToggleFavorite && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(question.id); }}
          className="absolute top-3 left-3 btn-spring text-xl z-10"
          title="Toggle Favorite"
        >
          <span className={question.isFavorite ? 'text-yellow-400 drop-shadow-[0_0_6px_rgba(250,204,21,0.5)]' : 'text-gray-600 hover:text-gray-400'}>
            {question.isFavorite ? '★' : '☆'}
          </span>
        </button>
      )}

      {/* Background Decor */}
      <div className="absolute top-2 right-3 opacity-30">
         <span className="font-mono text-[9px] text-gray-600">ID.{question.id.slice(0, 4)}</span>
      </div>

      <div className="flex flex-col items-center gap-3 mb-6 w-full animate-spring-fade-up stagger-1">
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-gray-500 w-full justify-center border-b border-white/5 pb-2">
           <span>
             Lv.{question.difficulty}
           </span>
           <span className="w-1 h-1 bg-gray-600 rounded-full"></span>
           <span className="truncate max-w-[120px]">
             {question.source}
           </span>
        </div>

        <div className="flex flex-wrap gap-1.5 justify-center">
          {question.tags.map(tag => (
            <span key={tag} className="px-2 py-0.5 text-[9px] font-bold uppercase chip-dark rounded-sm btn-spring">
              #{tag}
            </span>
          ))}
        </div>
      </div>

      <h2 className="text-2xl sm:text-3xl font-bold leading-normal tracking-tight font-display w-full break-words text-balance text-white animate-spring-fade-up stagger-2">
        {question.text}
      </h2>
    </div>
  );
};
