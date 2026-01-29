import React from 'react';
import { Question } from '../types';

interface QuestionCardProps {
  question: Question;
}

export const QuestionCard: React.FC<QuestionCardProps> = ({ question }) => {
  return (
    <div className="-mx-4 w-[calc(100%+2rem)] border-y border-black/10 py-10 px-6 flex flex-col items-center text-center transition-all animate-in fade-in slide-in-from-bottom-4 duration-500 group relative overflow-hidden bg-white shadow-sm">
      
      {/* Background Decor */}
      <div className="absolute top-2 right-3 opacity-30">
         <span className="font-mono text-[9px] text-gray-400">ID.{question.id.slice(0, 4)}</span>
      </div>

      <div className="flex flex-col items-center gap-3 mb-6 w-full">
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-gray-400 w-full justify-center border-b border-gray-100 pb-2">
           <span>
             Lv.{question.difficulty}
           </span>
           <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
           <span className="truncate max-w-[120px]">
             {question.source}
           </span>
        </div>
        
        <div className="flex flex-wrap gap-1.5 justify-center">
          {question.tags.map(tag => (
            <span key={tag} className="px-2 py-0.5 text-[9px] font-bold uppercase bg-gray-100 text-gray-600 rounded-sm">
              #{tag}
            </span>
          ))}
        </div>
      </div>
      
      <h2 className="text-2xl sm:text-3xl font-bold leading-normal tracking-tight font-display w-full break-words text-balance">
        {question.text}
      </h2>
    </div>
  );
};