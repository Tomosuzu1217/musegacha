
export type Difficulty = 'light' | 'normal' | 'heavy';

export type OutputFormat = 'note' | 'x' | 'blog' | 'instagram';

export interface Question {
  id: string;
  text: string;
  source: string;
  tags: string[];
  difficulty: Difficulty;
  createdAt: number;
  lastUsedAt?: number;
}

export interface Answer {
  id: string;
  questionId: string;
  questionText: string;
  draft: string;
  final: string;
  format: OutputFormat;
  createdAt: number;
}

export interface FilterState {
  tag: string | null;
  difficulty: Difficulty | null;
}

// Conversation Types
export type SpeakerRole = 'user' | 'moderator' | 'commentator';

export interface CharacterExpressions {
  neutral: string;
  positive: string;
  negative: string;
  surprised: string;
  angry: string;
  sad: string;
}

export interface Character {
  id: SpeakerRole;
  name: string;
  avatarUrl: string; // Base64 or URL (fallback for neutral)
  voiceName: string; // For TTS
  persona: string;
  pitch?: number; // Playback rate (1.0 = normal, >1.0 = higher/faster)
  // Extended Profile
  gender?: string;
  age?: string;
  background?: string;
  expressions?: CharacterExpressions;
  currentEmotion?: 'neutral' | 'positive' | 'negative';
}

// Persisted Character Definition
export interface CharacterProfile {
  id: string;
  name: string;
  avatarUrl: string;
  voiceName: string;
  persona: string;
  pitch?: number;
  isDefault?: boolean;
  // Extended Profile
  gender?: string;
  age?: string;
  background?: string;
  expressions?: CharacterExpressions;
}

export interface ChatMessage {
  id: string;
  role: SpeakerRole;
  text: string;
  timestamp: number;
  emotion?: 'neutral' | 'positive' | 'negative';
}

// キャラクターの一言感想
export interface CharacterComment {
  name: string;
  avatarUrl: string;
  comment: string;
}

export interface NewspaperContent {
  headline: string;
  lead: string;
  body: string; // Markdown
  comments?: CharacterComment[]; // 3人の一言感想
}

// Note記事のセクション
export interface NoteArticleSection {
  title: string;   // セクションタイトル (e.g., "序章", "仮説")
  body: string;    // セクション本文 (Markdown対応)
}

// Note記事の全体構造
export interface NoteArticleContent {
  title: string;                  // 記事タイトル
  sections: NoteArticleSection[]; // セクション配列 (5-7 sections)
}

export interface StoredImage {
  id: string;
  dataUrl: string;
  createdAt: number;
}

// Custom Persona Config (References CharacterProfile IDs)
export interface PersonaConfig {
  moderatorId: string;
  commentatorId: string;
}

// 保存された会話セッション
export interface SavedConversation {
  id: string;
  questionText: string;
  messages: ChatMessage[];
  moderatorId: string;
  commentatorId: string;
  createdAt: number;
}

// --- User Voice Options ---

// ユーザー音声タイプ
export type UserVoiceType = 'microphone' | 'gemini_tts' | 'clone';

// ユーザー音声設定
export interface UserVoiceConfig {
  type: UserVoiceType;
  cloneVoiceId?: string;  // クローン使用時のみ
  geminiVoiceName?: string;  // Gemini TTS使用時（デフォルト: 'Kore'）
}

// 録音済み音声データ
export interface RecordedVoiceData {
  msgId: string;
  audioBlob: Blob;
  duration: number;
  timestamp: number;
}

// クローンボイス定義
export interface CloneVoice {
  id: string;
  name: string;
  elevenLabsVoiceId: string;
  createdAt: number;
  lastUsedAt?: number;
}

// Session End Result (for passing character info back to Editor)
export interface SessionEndResult {
  transcript: string;
  moderatorId: string;
  moderatorName: string;
  moderatorAvatarUrl: string;
  moderatorPersona?: string;
  commentatorId: string;
  commentatorName: string;
  commentatorAvatarUrl: string;
  commentatorPersona?: string;
}

// --- Consultation Chat Types ---

export interface ConsultMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export interface ConsultSession {
  id: string;
  messages: ConsultMessage[];
  generatedQuestionIds: string[];
  themes: string[];
  summary?: string;
  createdAt: number;
  updatedAt: number;
}

// --- User Interest Profile ---

export interface UserInterestProfile {
  themes: Record<string, number>;
  recentConcerns: string[];
  totalConsultations: number;
  totalQuestionsGenerated: number;
  totalSessionsCompleted: number;
  lastUpdatedAt: number;
}

// --- Core Insights (Self-Discovery) ---

export interface CoreInsights {
  coreValues: string[];
  patterns: string[];
  growthAreas: string[];
  narrative: string;
  generatedAt: number;
  basedOnSessions: number;
}

// --- Activity Log ---

export type ActivityType = 'consultation' | 'question_generated' | 'session_completed' | 'gacha_spin';

export interface ActivityLogEntry {
  id: string;
  type: ActivityType;
  detail: string;
  metadata?: Record<string, string | number>;
  timestamp: number;
}

// Sample tags for suggestions
export const PRESET_TAGS = [
  '意思決定',
  '仕事',
  '人間関係',
  '習慣',
  'キャリア',
  'メンタル',
  '学習',
  'ライフハック'
];

// --- Browser API Type Extensions ---

// Speech Recognition types
export interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

export interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

export interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

export interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

export interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onerror: ((this: SpeechRecognition, ev: Event) => any) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
}

export interface SpeechRecognitionConstructor {
  new(): SpeechRecognition;
}

// Window extensions for cross-browser compatibility
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    webkitAudioContext?: typeof AudioContext;
  }
}
