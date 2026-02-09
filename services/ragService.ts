/**
 * RAG (Retrieval-Augmented Generation) Service
 * Searches past answers and consultation sessions for relevant context
 * Uses simple TF-IDF-like keyword matching (no vector DB needed)
 */

import { storageService } from './storageService';

interface RAGResult {
  text: string;
  score: number;
  source: 'answer' | 'consultation';
  id: string;
}

const tokenize = (text: string): string[] => {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(t => t.length > 1);
};

const computeRelevance = (query: string, document: string): number => {
  const queryTokens = tokenize(query);
  const docTokens = new Set(tokenize(document));
  if (queryTokens.length === 0 || docTokens.size === 0) return 0;

  let matchCount = 0;
  for (const qt of queryTokens) {
    if (docTokens.has(qt)) matchCount++;
  }

  return (matchCount / queryTokens.length) * (matchCount / Math.sqrt(docTokens.size));
};

export const searchRelevantContext = (query: string, limit = 3): RAGResult[] => {
  const results: RAGResult[] = [];

  // Search past answers
  try {
    const answers = storageService.getAnswers();
    for (const answer of answers) {
      const text = `${answer.questionText} ${answer.final}`;
      const score = computeRelevance(query, text);
      if (score > 0.01) {
        results.push({
          text: answer.final.slice(0, 500),
          score,
          source: 'answer',
          id: answer.id,
        });
      }
    }
  } catch { /* ignore */ }

  // Search past consultation sessions
  try {
    const sessions = storageService.getConsultSessions();
    for (const session of sessions) {
      const text = session.messages.map(m => m.text).join(' ');
      const score = computeRelevance(query, text);
      if (score > 0.01) {
        results.push({
          text: text.slice(0, 500),
          score,
          source: 'consultation',
          id: session.id,
        });
      }
    }
  } catch { /* ignore */ }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
};

export const buildRAGContext = (query: string): string => {
  const results = searchRelevantContext(query);
  if (results.length === 0) return '';

  return '\n\n【過去の関連コンテキスト】\n' +
    results.map((r, i) => `[${i + 1}] (${r.source}): ${r.text}`).join('\n\n');
};
