
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Character, CharacterExpressions, ChatMessage, Question, SpeakerRole, UserVoiceType, CharacterProfile, SavedConversation, SessionEndResult } from '../types';
import { generateScriptSection, generateSpeech, generateSpeechParallel, speakWithWebSpeech, getTTSMode, ParallelTTSTask, logger } from '../services/geminiService';
import { storageService } from '../services/storageService';
import { sanitizeVoiceInput, sanitizeText, checkRateLimit } from '../services/securityService';
import { BackgroundEffects, VideoContainer } from './BackgroundEffects';
import { getOptimizedAudioConstraints } from '../services/audioProcessingService';
import { userVoiceService } from '../services/userVoiceService';
import UserVoiceSettings from './UserVoiceSettings';

// 入力制限設定
const INPUT_CONFIG = {
  MAX_USER_INPUT_LENGTH: 1000,
  MAX_VOICE_INPUT_LENGTH: 500,
  SUBMIT_RATE_LIMIT: 5, // 1分あたりの最大送信回数
};

interface DebateSessionProps {
  question: Question;
  userAvatar: string;
  hostAvatar: string;
  guestAvatar: string;
  onSessionEnd: (result: SessionEndResult) => void;
  isRecording?: boolean;
  stageTheme?: string; // Playing画面の背景テーマクラス
}

export const DebateSession: React.FC<DebateSessionProps> = ({ question, userAvatar, hostAvatar, guestAvatar, onSessionEnd, isRecording, stageTheme }) => {
  // Mode: 
  // 'setup': Character selection before starting
  // 'scripting': Creating the script interactively
  // 'editing': Edit/confirm audio for each message
  // 'loading': Pre-generating all audio files
  // 'playing': Acting it out seamlessly
  // 'complete': Show save options
  const [mode, setMode] = useState<'setup' | 'scripting' | 'editing' | 'loading' | 'playing' | 'complete'>('setup');

  // Character Selection State
  const [availableCharacters, setAvailableCharacters] = useState<CharacterProfile[]>([]);
  const [selectedModeratorId, setSelectedModeratorId] = useState<string | null>(null);
  const [selectedCommentatorId, setSelectedCommentatorId] = useState<string | null>(null);
  const [characterSelectionMode, setCharacterSelectionMode] = useState<'auto' | 'random' | 'manual'>('auto');

  // Scripting State
  const [scriptMessages, setScriptMessages] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [turnCount, setTurnCount] = useState(0); // Count user turns (max 2)
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [scriptGenerationFailed, setScriptGenerationFailed] = useState(false); // 生成失敗フラグ

  // Voice Input State
  const [isListening, setIsListening] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0); // 録音時間（秒）
  const [savedRecordings, setSavedRecordings] = useState<{ id: string, blob: Blob, timestamp: number, messageId?: string, duration?: number }[]>([]);
  const pendingRecordingRef = useRef<Blob | null>(null); // 次のメッセージに紐付ける録音
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Editing State (音声編集画面用)
  const [editingAudioData, setEditingAudioData] = useState<Map<string, { pronunciation: string; audioData: Uint8Array | null; isGenerating: boolean; status: 'pending' | 'ready' | 'webspeech' }>>(new Map());
  const [editingRecordingId, setEditingRecordingId] = useState<string | null>(null); // マイク録音中のメッセージID

  // Video Recording State (動画生成用)
  const [generatedVideoBlob, setGeneratedVideoBlob] = useState<Blob | null>(null);
  const [isVideoMode, setIsVideoMode] = useState(false); // 動画録画モード（UIを隠す）

  // User Voice Settings Modal
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [userVoiceType, setUserVoiceType] = useState<UserVoiceType>('gemini_tts');

  // Loading State
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('');

  // Playing State
  const [currentMessageIndex, setCurrentMessageIndex] = useState(-1);
  const [currentSpeaker, setCurrentSpeaker] = useState<SpeakerRole | null>(null);
  const [prevSpeaker, setPrevSpeaker] = useState<SpeakerRole | null>(null); // 前の話者
  const [countdown, setCountdown] = useState<number | null>(null);

  // BGM-style ambient background animation
  const [bgmVariant, setBgmVariant] = useState(0);
  const bgmVariants = ['ripples', 'streams', 'aura', 'particles', 'rings', 'waves'];
  const bgmIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Nature-themed ambient animation (テーマに応じた自然アニメーション)
  const [natureVariant, setNatureVariant] = useState<string>('water');
  const natureVariants = ['water', 'fractal', 'petals', 'leaves', 'snow', 'galaxy', 'clouds', 'aurora', 'fire'];

  // テーマに応じた自然アニメーションを選択
  const selectNatureAnimation = (questionText: string): string => {
    const text = questionText.toLowerCase();

    // キーワードマッピング
    const themeKeywords: { [key: string]: string[] } = {
      water: ['海', '川', '水', '流れ', '泳', '波', '涙', '雨', '湖', '潮', '船', '魚', '深'],
      fractal: ['成長', '発展', '進化', '分岐', '選択', 'キャリア', '人生', '道', '未来', '可能性', '挑戦', '樹', '木'],
      petals: ['愛', '恋', '美', '花', '春', '桜', '結婚', '出会い', 'ロマンス', '感情', '心', '優しさ', '女性'],
      leaves: ['自然', '環境', 'エコ', '緑', '森', '植物', '健康', '癒し', 'リラックス', '休息', '平和'],
      snow: ['冬', '寒', '静', '純粋', '孤独', '終わり', '別れ', '清', '白', '凍', '北'],
      galaxy: ['宇宙', '夢', '目標', '希望', '未知', '冒険', '発見', 'AI', 'テクノロジー', '科学', '哲学', '存在', '意味', '真理'],
      clouds: ['空', '自由', '旅', '変化', '移動', '転職', '引越', '飛', '鳥', '風'],
      aurora: ['神秘', '奇跡', '芸術', 'クリエイティブ', 'デザイン', '表現', '感性', 'インスピレーション', '創造'],
      fire: ['情熱', '怒り', '熱', 'モチベーション', 'エネルギー', '戦', '競争', 'スポーツ', '勝', '負', '努力', '根性']
    };

    // スコアリング
    let bestTheme = 'water';
    let maxScore = 0;

    for (const [theme, keywords] of Object.entries(themeKeywords)) {
      const score = keywords.filter(kw => text.includes(kw)).length;
      if (score > maxScore) {
        maxScore = score;
        bestTheme = theme;
      }
    }

    // スコアが0の場合はランダムに選択
    if (maxScore === 0) {
      const randomThemes = ['water', 'galaxy', 'leaves', 'clouds'];
      bestTheme = randomThemes[Math.floor(Math.random() * randomThemes.length)];
    }

    return bestTheme;
  };

  // Refs
  const charactersRef = useRef<Character[]>([]);
  const scriptRef = useRef<ChatMessage[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map()); // Cache for pre-loaded audio
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set()); // メモリリーク対策: 全アクティブソースを追跡

  // 録画用のRefs
  const recordingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const recordingStreamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const masterRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const avatarImagesRef = useRef<Map<string, HTMLImageElement>>(new Map()); // Canvas描画用画像キャッシュ
  const recordingAnimationFrameRef = useRef<number | null>(null);

  // プリフェッチ用のRef
  const prefetchQueueRef = useRef<Map<string, Promise<Uint8Array | null>>>(new Map());
  const prefetchedDataRef = useRef<Map<string, Uint8Array>>(new Map());

  // 自動スクロール用のRef
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // レースコンディション防止用のRef
  const abortControllerRef = useRef<AbortController | null>(null);
  const isSubmittingRef = useRef<boolean>(false);

  useEffect(() => {
    // Load available characters for selection
    const loadCharacters = () => {
      const allProfiles = storageService.getCharacterProfiles();
      setAvailableCharacters(allProfiles);

      // Auto-select characters based on topic (question text)
      const questionText = question.text.toLowerCase();

      // Topic-based character matching
      const topicKeywords: { [key: string]: string[] } = {
        'char_kenta': ['エンジニア', 'テック', 'IT', 'プログラミング', 'AI', '技術'],
        'char_misaki': ['メンタル', '心理', '悩み', '人間関係', '感情', 'カウンセリング'],
        'char_ryuichi': ['ビジネス', '経営', 'キャリア', '仕事', '起業', '転職'],
        'char_hiroshi': ['教育', '学習', '成長', '人生', '経験'],
        'char_sage': ['哲学', '本質', '意味', '真理', '人生'],
        'char_luna': ['占い', '運勢', 'スピリチュアル', '直感'],
        'char_takeshi': ['武道', '精神', '心', '修行', '集中'],
        'char_taro': ['スポーツ', '体力', '健康', 'トレーニング', '努力'],
        'char_emma': ['国際', '文化', '海外', '留学', '言語'],
        'char_ayaka': ['SNS', 'トレンド', '若者', 'インフルエンサー'],
        'char_sakura': ['創作', '物語', '感性', '芸術', '表現'],
        'char_kenji': ['料理', '食', '人情', '下町'],
        'char_haruka': ['事実', '真実', 'ジャーナリズム', '調査'],
        'char_yuki': ['就活', '将来', '不安', '学生'],
        'char_muse': ['アート', 'クリエイティブ', 'デザイン', '感性'],
        'char_spark': ['未来', 'テクノロジー', '新しい', 'トレンド'],
      };

      // Find best matching characters
      let bestModerator: string | null = null;
      let bestCommentator: string | null = null;
      let maxScore = 0;

      for (const [charId, keywords] of Object.entries(topicKeywords)) {
        const score = keywords.filter(kw => questionText.includes(kw)).length;
        if (score > maxScore) {
          maxScore = score;
          bestCommentator = bestModerator;
          bestModerator = charId;
        } else if (score > 0 && !bestCommentator) {
          bestCommentator = charId;
        }
      }

      // Fallback to random if no match
      if (!bestModerator || !bestCommentator) {
        const shuffled = [...allProfiles].sort(() => Math.random() - 0.5);
        bestModerator = bestModerator || shuffled[0]?.id || 'char_default_host';
        bestCommentator = bestCommentator || shuffled[1]?.id || 'char_default_guest';
      }

      // Ensure different characters
      if (bestModerator === bestCommentator) {
        const others = allProfiles.filter(p => p.id !== bestModerator);
        bestCommentator = others[0]?.id || 'char_default_guest';
      }

      setSelectedModeratorId(bestModerator);
      setSelectedCommentatorId(bestCommentator);
    };

    loadCharacters();
  }, [question.text]);

  // Start session with selected characters
  const startSessionWithCharacters = async () => {
    if (!selectedModeratorId || !selectedCommentatorId) return;

    const hostProfile = storageService.getCharacterProfile(selectedModeratorId);
    const guestProfile = storageService.getCharacterProfile(selectedCommentatorId);

    const moderator: Character = {
      id: 'moderator',
      name: hostProfile?.name || 'Aoi',
      avatarUrl: hostProfile?.avatarUrl || hostAvatar,
      voiceName: hostProfile?.voiceName || 'Kore',
      persona: hostProfile?.persona || 'Cool and intellectual moderator.',
      pitch: hostProfile?.pitch ?? 1.0
    };

    const commentator: Character = {
      id: 'commentator',
      name: guestProfile?.name || 'Kai',
      avatarUrl: guestProfile?.avatarUrl || guestAvatar,
      voiceName: guestProfile?.voiceName || 'Fenrir',
      persona: guestProfile?.persona || 'Critical and insightful commentator.',
      pitch: guestProfile?.pitch ?? 1.0
    };

    const userVoiceConfig = userVoiceService.loadConfig();
    setUserVoiceType(userVoiceConfig.type);

    const user: Character = {
      id: 'user',
      name: 'ZENZEN',
      avatarUrl: userAvatar,
      voiceName: userVoiceConfig.geminiVoiceName || 'Charon',
      persona: `【性格】知的好奇心旺盛で、深く考えることを好む思索家。自分の考えを持ちつつも、他者の意見に耳を傾ける柔軟性がある。
【口調】落ち着いたダンディな話し方。「〜だな」「〜かもしれない」思慮深い語尾。
【特徴的なフレーズ】「なるほど、確かに」「そういう見方もあるか」「本質的には〜」
【話し方】低めの落ち着いた声で、ゆっくり丁寧に話す。`,
      pitch: 0.95
    };

    charactersRef.current = [moderator, user, commentator];

    // Switch to scripting mode and generate intro
    setMode('scripting');
    setIsGeneratingScript(true);
    setScriptGenerationFailed(false);
    try {
      const intro = await generateScriptSection('intro', [], charactersRef.current, question.text);
      setScriptMessages(intro);
      scriptRef.current = intro;
      setIsGeneratingScript(false);
      prefetchAudio(intro);
    } catch (error) {
      console.warn('Intro generation failed:', error);
      setIsGeneratingScript(false);
      setScriptGenerationFailed(true);
    }
  };

  // Randomize character selection
  const randomizeCharacters = () => {
    const shuffled = [...availableCharacters].sort(() => Math.random() - 0.5);
    setSelectedModeratorId(shuffled[0]?.id || null);
    setSelectedCommentatorId(shuffled[1]?.id || null);
    setCharacterSelectionMode('random');
  };

  useEffect(() => {

    return () => {
      // メモリリーク対策: 全てのアクティブソースを停止
      activeSourcesRef.current.forEach(src => {
        try { src.stop(); } catch { /* already stopped */ }
      });
      activeSourcesRef.current.clear();

      if (activeSourceRef.current) {
        try { activeSourceRef.current.stop(); } catch { /* already stopped */ }
      }
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch { /* already closed */ }
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* already stopped */ }
      }

      // 録画のクリーンアップ
      if (recordingAnimationFrameRef.current) {
        cancelAnimationFrame(recordingAnimationFrameRef.current);
      }
      if (masterRecorderRef.current && masterRecorderRef.current.state === 'recording') {
        masterRecorderRef.current.stop();
      }
      recordingStreamDestRef.current = null;
      avatarImagesRef.current.clear();

      // 進行中のリクエストを中断
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      // Web Speech APIのイベントリスナーをクリア
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.onvoiceschanged = null;
      }

      // MediaRecorderを停止
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch { /* already stopped */ }
      }

      // AudioBufferをクリア
      audioBuffersRef.current.clear();
      prefetchedDataRef.current.clear();
      prefetchQueueRef.current.clear();

      // フラグをリセット
      isSubmittingRef.current = false;

      // BGMアニメーションの停止
      if (bgmIntervalRef.current) {
        clearInterval(bgmIntervalRef.current);
        bgmIntervalRef.current = null;
      }
    };
  }, []);

  // BGM背景アニメーションのランダム切り替え + 自然アニメーションのテーマ設定
  useEffect(() => {
    if (mode === 'playing') {
      // 初期バリエーションをランダムに設定
      setBgmVariant(Math.floor(Math.random() * bgmVariants.length));

      // テーマに応じた自然アニメーションを設定
      const selectedNature = selectNatureAnimation(question.text);
      setNatureVariant(selectedNature);

      // 15-25秒ごとにランダムに切り替え
      bgmIntervalRef.current = setInterval(() => {
        setBgmVariant(prev => {
          let next = Math.floor(Math.random() * bgmVariants.length);
          // 同じバリエーションを避ける
          while (next === prev && bgmVariants.length > 1) {
            next = Math.floor(Math.random() * bgmVariants.length);
          }
          return next;
        });
      }, 15000 + Math.random() * 10000);

      return () => {
        if (bgmIntervalRef.current) {
          clearInterval(bgmIntervalRef.current);
          bgmIntervalRef.current = null;
        }
      };
    }
  }, [mode, bgmVariants.length]);

  // 自動スクロール
  useEffect(() => {
    if (mode === 'scripting' && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [scriptMessages, mode]);

  // --- プリフェッチ（先読み）音声生成 ---
  const prefetchAudio = useCallback(async (messages: ChatMessage[]) => {
    const ttsMode = getTTSMode();
    if (ttsMode === 'webspeech') return; // Web Speech APIモードではプリフェッチ不要

    for (const msg of messages) {
      if (msg.role === 'user') continue; // ユーザーは録音を使用

      const char = charactersRef.current.find(c => c.id === msg.role);
      if (!char || !msg.text) continue;

      const cacheKey = `${msg.id}_prefetch`;

      // 既にキューにあるかチェック
      if (prefetchQueueRef.current.has(cacheKey)) continue;
      if (prefetchedDataRef.current.has(msg.id)) continue;

      // バックグラウンドで音声生成を開始
      const promise = generateSpeech(msg.text, char.voiceName)
        .then(data => {
          if (data) {
            prefetchedDataRef.current.set(msg.id, data);
          }
          prefetchQueueRef.current.delete(cacheKey);
          return data;
        })
        .catch(e => {
          console.warn('Prefetch failed for', msg.id, e);
          prefetchQueueRef.current.delete(cacheKey);
          return null;
        });

      prefetchQueueRef.current.set(cacheKey, promise);
    }
  }, []);

  // --- Voice Input Logic with Recording ---
  const toggleMic = async () => {
    if (isListening) {
      // 待ち受け中の場合は停止
      recognitionRef.current?.stop();
      setIsListening(false);

      // 録音も停止
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      return;
    }

    const { webkitSpeechRecognition, SpeechRecognition } = window as any;
    const Recognition = SpeechRecognition || webkitSpeechRecognition;

    if (!Recognition) {
      alert("お使いのブラウザは音声入力をサポートしていません。");
      return;
    }

    // マイク許可をリクエストし、録音を開始（高品質設定）
    try {
      const audioConstraints = getOptimizedAudioConstraints();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });

      // MediaRecorderで録音（高品質コーデックを優先）
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      const startTime = Date.now();

      // 録音時間のタイマー開始
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        // タイマー停止
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        const duration = Math.floor((Date.now() - startTime) / 1000);
        setRecordingTime(0);

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (audioBlob.size > 0) {
          // 録音を保留し、次のユーザーメッセージ送信時に紐付ける
          pendingRecordingRef.current = audioBlob;
          setSavedRecordings(prev => [...prev, {
            id: crypto.randomUUID(),
            blob: audioBlob,
            timestamp: Date.now(),
            duration
          }]);
        }
        // ストリームを停止
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecordingVoice(true);
    } catch (err) {
      console.error("マイクアクセスエラー:", err);
      alert("マイクへのアクセスが許可されませんでした。");
      return;
    }

    // 音声認識の設定
    const recognition = new Recognition();
    recognition.lang = 'ja-JP';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = true; // 継続的に聴く

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event: any) => {
      const rawText = event.results[event.results.length - 1][0].transcript;
      // 音声入力をサニタイズして長さ制限を適用
      const sanitizedText = sanitizeVoiceInput(rawText, INPUT_CONFIG.MAX_VOICE_INPUT_LENGTH);
      if (sanitizedText) {
        setUserInput(prev => {
          const combined = prev + (prev ? ' ' : '') + sanitizedText;
          // 全体の長さも制限
          return combined.slice(0, INPUT_CONFIG.MAX_USER_INPUT_LENGTH);
        });
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech error", event.error);
      if (event.error !== 'no-speech') {
        setIsListening(false);
        setIsRecordingVoice(false);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setIsRecordingVoice(false);
      // 録音も停止
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  // 録音データをダウンロード
  const downloadRecording = (recording: { id: string, blob: Blob, timestamp: number }) => {
    const url = URL.createObjectURL(recording.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recording_${new Date(recording.timestamp).toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // --- 1. Scripting Phase Logic ---

  const handleUserSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    // レースコンディション防止: 既に送信中なら無視
    if (isSubmittingRef.current || isGeneratingScript) {
      logger.debug('Submission blocked: already in progress');
      return;
    }

    const trimmedInput = userInput.trim();
    if (!trimmedInput) return;

    // レート制限チェック
    if (!checkRateLimit('user_submit', INPUT_CONFIG.SUBMIT_RATE_LIMIT, 60000)) {
      logger.warn('Rate limit exceeded for user submissions');
      alert('送信頻度が高すぎます。少し待ってから再試行してください。');
      return;
    }

    // 入力をサニタイズ
    const sanitizedInput = sanitizeText(trimmedInput).slice(0, INPUT_CONFIG.MAX_USER_INPUT_LENGTH);
    if (!sanitizedInput) return;

    // 送信中フラグを立てる
    isSubmittingRef.current = true;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const msgId = crypto.randomUUID();
      const userMsg: ChatMessage = {
        id: msgId,
        role: 'user',
        text: sanitizedInput,
        timestamp: Date.now()
      };

      // 保留中の録音があれば、このメッセージに紐付け
      if (pendingRecordingRef.current) {
        setSavedRecordings(prev => {
          const updated = [...prev];
          // 最新の録音にmessageIdを紐付け
          if (updated.length > 0) {
            updated[updated.length - 1] = { ...updated[updated.length - 1], messageId: msgId };
          }
          return updated;
        });
        pendingRecordingRef.current = null;
      }

      const newHistory = [...scriptMessages, userMsg];
      setScriptMessages(newHistory);
      setUserInput('');
      setIsGeneratingScript(true);

      // 中断チェック
      if (controller.signal.aborted) {
        logger.debug('Submission aborted');
        return;
      }

      let nextParts: ChatMessage[] = [];

      if (turnCount < 1) {
        // Discussion Phase
        nextParts = await generateScriptSection('discussion', newHistory, charactersRef.current, question.text, userMsg.text);
        setTurnCount(prev => prev + 1);
      } else {
        // Conclusion Phase
        nextParts = await generateScriptSection('conclusion', newHistory, charactersRef.current, question.text, userMsg.text);
        setTurnCount(prev => prev + 1); // Mark as done
      }

      // 中断チェック
      if (controller.signal.aborted) {
        logger.debug('Submission aborted after generation');
        return;
      }

      setScriptMessages(prev => [...prev, ...nextParts]);
      scriptRef.current = [...newHistory, ...nextParts];

      // 新しいスクリプトの音声をプリフェッチ
      prefetchAudio(nextParts);
    } catch (error) {
      logger.error('User submission failed', error);
      setScriptGenerationFailed(true);
    } finally {
      setIsGeneratingScript(false);
      isSubmittingRef.current = false;
      abortControllerRef.current = null;
    }
  };

  // --- 2. Loading Phase Logic (Pre-buffering) ---

  // ヘルパー: Blob から AudioBuffer にデコード
  const decodeBlobToAudioBuffer = async (blob: Blob, ctx: AudioContext): Promise<AudioBuffer | null> => {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      return audioBuffer;
    } catch (e) {
      console.error('Failed to decode user recording:', e);
      return null;
    }
  };

  // --- 音声編集モード初期化 ---
  const initializeEditingMode = () => {
    // 各メッセージの音声編集データを初期化
    const audioData = new Map<string, { pronunciation: string; audioData: Uint8Array | null; isGenerating: boolean; status: 'pending' | 'ready' | 'webspeech' }>();

    for (const msg of scriptRef.current) {
      const prefetchedData = prefetchedDataRef.current.get(msg.id);
      const userRecording = savedRecordings.find(r => r.messageId === msg.id);

      let status: 'pending' | 'ready' | 'webspeech' = 'pending';
      let audioBytes: Uint8Array | null = null;

      if (msg.role === 'user' && userRecording) {
        status = 'ready';
      } else if (prefetchedData) {
        status = 'ready';
        audioBytes = prefetchedData;
      } else if (getTTSMode() === 'webspeech') {
        status = 'webspeech';
      }

      audioData.set(msg.id, {
        pronunciation: msg.text,
        audioData: audioBytes,
        isGenerating: false,
        status
      });
    }

    setEditingAudioData(audioData);
    setMode('editing');
  };

  // --- 単一メッセージの音声再生成 ---
  const regenerateAudioForMessage = async (msgId: string, newPronunciation?: string) => {
    const msg = scriptRef.current.find(m => m.id === msgId);
    if (!msg) return;

    const audioInfo = editingAudioData.get(msgId);
    if (!audioInfo) return;

    const textToGenerate = newPronunciation || audioInfo.pronunciation;

    // 進捗状態を更新
    setEditingAudioData(prev => {
      const next = new Map(prev);
      next.set(msgId, { ...audioInfo, pronunciation: textToGenerate, isGenerating: true });
      return next;
    });

    try {
      const char = charactersRef.current.find(c => c.id === msg.role);
      const voiceName = char?.voiceName || 'Kore';

      const audioBytes = await generateSpeech(textToGenerate, voiceName);

      if (audioBytes) {
        // プリフェッチデータを更新
        prefetchedDataRef.current.set(msgId, audioBytes);

        setEditingAudioData(prev => {
          const next = new Map(prev);
          next.set(msgId, {
            pronunciation: textToGenerate,
            audioData: audioBytes,
            isGenerating: false,
            status: 'ready'
          });
          return next;
        });
      } else {
        // Web Speech APIにフォールバック
        setEditingAudioData(prev => {
          const next = new Map(prev);
          next.set(msgId, {
            pronunciation: textToGenerate,
            audioData: null,
            isGenerating: false,
            status: 'webspeech'
          });
          return next;
        });
      }
    } catch (error) {
      console.error('Audio regeneration failed:', error);
      setEditingAudioData(prev => {
        const next = new Map(prev);
        next.set(msgId, { ...audioInfo, isGenerating: false, status: 'webspeech' });
        return next;
      });
    }
  };

  // ユーザー音声をGemini TTSで再生成（ダンディーな声）
  const regenerateUserAudioWithGemini = async (msgId: string) => {
    const msg = scriptRef.current.find(m => m.id === msgId);
    if (!msg || msg.role !== 'user') return;

    const audioInfo = editingAudioData.get(msgId);
    if (!audioInfo) return;

    const textToGenerate = audioInfo.pronunciation || msg.text;

    // 進捗状態を更新
    setEditingAudioData(prev => {
      const next = new Map(prev);
      next.set(msgId, { ...audioInfo, pronunciation: textToGenerate, isGenerating: true });
      return next;
    });

    try {
      // ダンディーな声として "Charon" または "Fenrir" を使用
      const userChar = charactersRef.current.find(c => c.id === 'user');
      const voiceName = userChar?.voiceName || 'Charon';

      const audioBytes = await generateSpeech(textToGenerate, voiceName);

      if (audioBytes) {
        // プリフェッチデータを更新
        prefetchedDataRef.current.set(msgId, audioBytes);

        // 録音データとして保存（Blobに変換）
        const audioBlob = new Blob([audioBytes], { type: 'audio/mpeg' });
        setSavedRecordings(prev => {
          const filtered = prev.filter(r => r.messageId !== msgId);
          return [...filtered, {
            id: crypto.randomUUID(),
            messageId: msgId,
            blob: audioBlob,
            timestamp: Date.now(),
            duration: 0,
          }];
        });

        setEditingAudioData(prev => {
          const next = new Map(prev);
          next.set(msgId, {
            pronunciation: textToGenerate,
            audioData: audioBytes,
            isGenerating: false,
            status: 'ready'
          });
          return next;
        });
      } else {
        setEditingAudioData(prev => {
          const next = new Map(prev);
          next.set(msgId, {
            pronunciation: textToGenerate,
            audioData: null,
            isGenerating: false,
            status: 'webspeech'
          });
          return next;
        });
      }
    } catch (error) {
      console.error('User audio regeneration with Gemini failed:', error);
      setEditingAudioData(prev => {
        const next = new Map(prev);
        next.set(msgId, { ...audioInfo, isGenerating: false, status: 'webspeech' });
        return next;
      });
    }
  };

  // --- 音声プレビュー再生 ---
  const playAudioPreview = async (msgId: string) => {
    const audioInfo = editingAudioData.get(msgId);
    const msg = scriptRef.current.find(m => m.id === msgId);
    if (!msg) return;

    // ユーザー録音がある場合
    if (msg.role === 'user') {
      const userRecording = savedRecordings.find(r => r.messageId === msgId);
      if (userRecording) {
        // 直接再生
        const url = URL.createObjectURL(userRecording.blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        audio.play();
        return;
      }
    }

    // AudioContextの初期化
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    } else if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    // Gemini TTSデータがある場合
    if (audioInfo?.audioData) {
      const buffer = await decodePcmToAudioBuffer(audioInfo.audioData, audioContextRef.current);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);
      source.start(0);
      return;
    }

    // Web Speech APIを使用
    const char = charactersRef.current.find(c => c.id === msg.role);
    await speakWithWebSpeech(audioInfo?.pronunciation || msg.text, char?.voiceName || 'Kore', char?.pitch || 1.0, 1.0);
  };

  // --- 編集画面でのユーザー音声録音 ---
  const startEditingRecording = async (msgId: string) => {
    try {
      const audioConstraints = getOptimizedAudioConstraints();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });

        // 既存の録音を更新または新規追加
        setSavedRecordings(prev => {
          const existing = prev.find(r => r.messageId === msgId);
          if (existing) {
            return prev.map(r => r.messageId === msgId ? { ...r, blob, timestamp: Date.now() } : r);
          }
          return [...prev, { id: crypto.randomUUID(), blob, timestamp: Date.now(), messageId: msgId }];
        });

        // ステータスを更新
        setEditingAudioData(prev => {
          const next = new Map(prev);
          const current = prev.get(msgId);
          if (current) {
            next.set(msgId, { ...current, status: 'ready' });
          }
          return next;
        });

        setEditingRecordingId(null);
      };

      setEditingRecordingId(msgId);
      recorder.start();

      // 10秒後に自動停止
      setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }, 10000);

      // 録音オブジェクトを保存して停止できるように
      mediaRecorderRef.current = recorder;
    } catch (error) {
      console.error('Recording failed:', error);
      setEditingRecordingId(null);
    }
  };

  const stopEditingRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const startLoadingAudio = async () => {
    setMode('loading');
    setLoadingProgress(0);

    // 画像のプリロード（録画用＋表情切り替え用）
    charactersRef.current.forEach(char => {
      // デフォルトアバター
      const img = new Image();
      img.src = char.avatarUrl;
      img.crossOrigin = "anonymous"; // CORS対応
      avatarImagesRef.current.set(char.id, img);

      // 表情画像のプリロード（瞬間切り替え用）
      if (char.expressions) {
        const emotions: (keyof CharacterExpressions)[] = ['neutral', 'positive', 'negative', 'surprised', 'angry', 'sad'];
        emotions.forEach(emotion => {
          const expressionUrl = char.expressions?.[emotion];
          if (expressionUrl && expressionUrl !== char.avatarUrl) {
            const expressionImg = new Image();
            expressionImg.src = expressionUrl;
            expressionImg.crossOrigin = "anonymous";
            avatarImagesRef.current.set(`${char.id}-${emotion}`, expressionImg);
          }
        });
      }
    });

    // Initialize AudioContext (must be done on user gesture)
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    } else if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    const ctx = audioContextRef.current!;

    // 録音用DestinationNodeの作成
    if (!recordingStreamDestRef.current) {
      recordingStreamDestRef.current = ctx.createMediaStreamDestination();
    }

    const messages = scriptRef.current;
    const total = messages.length;
    const ttsMode = getTTSMode();

    // Web Speech APIモードの場合は事前読み込みをスキップ
    if (ttsMode === 'webspeech') {
      setLoadingStatus('Web Speech APIモード: 準備完了');
      setLoadingProgress(100);
      setTimeout(() => startPlayback(), 300);
      return;
    }

    // Step 1: ユーザー録音を先に処理（高速）
    setLoadingStatus('録音データを処理中...');
    const userMessages = messages.filter(msg => msg.role === 'user');
    for (const msg of userMessages) {
      const userRecording = savedRecordings.find(r => r.messageId === msg.id);
      if (userRecording) {
        const audioBuffer = await decodeBlobToAudioBuffer(userRecording.blob, ctx);
        if (audioBuffer) {
          audioBuffersRef.current.set(msg.id, audioBuffer);
        }
      }
    }

    // Step 2: プリフェッチ済みデータを適用
    setLoadingStatus('プリフェッチデータを確認中...');
    let prefetchedCount = 0;
    for (const [msgId, pcmData] of prefetchedDataRef.current) {
      if (!audioBuffersRef.current.has(msgId)) {
        try {
          const audioBuffer = await decodePcmToAudioBuffer(pcmData, ctx);
          audioBuffersRef.current.set(msgId, audioBuffer);
          prefetchedCount++;
        } catch (e) {
          console.warn('Failed to decode prefetched audio for', msgId, e);
        }
      }
    }
    if (prefetchedCount > 0) {
      console.info(`Prefetched audio applied: ${prefetchedCount} items`);
    }

    // Step 3: 残りのTTS生成タスクを準備（並列処理）
    const ttsTasks: ParallelTTSTask[] = [];
    for (const msg of messages) {
      if (msg.role !== 'user' && !audioBuffersRef.current.has(msg.id)) {
        const char = charactersRef.current.find(c => c.id === msg.role);
        if (char && msg.text) {
          ttsTasks.push({
            id: msg.id,
            text: msg.text,
            voiceName: char.voiceName
          });
        }
      }
    }

    // Step 4: 残りを並列音声生成
    if (ttsTasks.length > 0) {
      setLoadingStatus('音声を並列生成中...');
    }
    const startTime = Date.now();

    const ttsResults = await generateSpeechParallel(ttsTasks, (completed, ttTotal, currentId) => {
      const baseProgress = userMessages.length + prefetchedCount;
      const overallProgress = Math.round(((baseProgress + completed) / total) * 100);
      setLoadingProgress(overallProgress);

      const currentTask = ttsTasks.find(t => t.id === currentId);
      if (currentTask) {
        const char = charactersRef.current.find(c => c.voiceName === currentTask.voiceName);
        setLoadingStatus(`${char?.name || 'Actor'}: ${completed}/${ttTotal} 完了`);
      }
    });

    // Step 5: 結果をAudioBufferに変換
    setLoadingStatus('音声データを準備中...');
    let successCount = 0;
    for (const [msgId, pcmData] of ttsResults) {
      if (pcmData) {
        try {
          const audioBuffer = await decodePcmToAudioBuffer(pcmData, ctx);
          audioBuffersRef.current.set(msgId, audioBuffer);
          successCount++;
        } catch (e) {
          console.warn('Failed to decode audio for', msgId, e);
        }
      }
    }

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.info(`Parallel TTS completed: ${successCount}/${ttsTasks.length} in ${elapsedTime}s`);

    setLoadingProgress(100);
    setLoadingStatus("Ready to perform!");
    setTimeout(() => {
      startPlayback();
    }, 500);
  };

  // PCM→AudioBuffer変換（最適化版：チャンク処理でメインスレッドをブロックしない）
  const decodePcmToAudioBuffer = async (pcmData: Uint8Array, ctx: AudioContext): Promise<AudioBuffer> => {
    // Clean up PCM data if odd length
    let safeBytes = pcmData;
    if (pcmData.length % 2 !== 0) safeBytes = pcmData.subarray(0, pcmData.length - 1);

    const int16Data = new Int16Array(safeBytes.buffer, safeBytes.byteOffset, safeBytes.byteLength / 2);
    const float32Data = new Float32Array(int16Data.length);

    // 大きなデータの場合はチャンク処理
    const CHUNK_SIZE = 10000;
    if (int16Data.length > CHUNK_SIZE) {
      // requestIdleCallbackを使用して非ブロッキング処理
      await processInChunks(int16Data, float32Data, CHUNK_SIZE);
    } else {
      // 小さいデータは直接処理
      for (let i = 0; i < int16Data.length; i++) {
        float32Data[i] = int16Data[i] / 32768.0;
      }
    }

    const buffer = ctx.createBuffer(1, float32Data.length, 24000); // 24kHz is default for Gemini TTS
    buffer.copyToChannel(float32Data, 0);
    return buffer;
  };

  // チャンク処理ユーティリティ（メインスレッドをブロックしない）
  const processInChunks = (int16Data: Int16Array, float32Data: Float32Array, chunkSize: number): Promise<void> => {
    return new Promise((resolve) => {
      let offset = 0;

      const processChunk = (deadline?: IdleDeadline) => {
        const timeRemaining = deadline ? deadline.timeRemaining() : 16;
        const startTime = performance.now();

        while (offset < int16Data.length && (performance.now() - startTime) < timeRemaining) {
          const end = Math.min(offset + chunkSize, int16Data.length);
          for (let i = offset; i < end; i++) {
            float32Data[i] = int16Data[i] / 32768.0;
          }
          offset = end;
        }

        if (offset < int16Data.length) {
          // まだ処理が残っている場合は次のアイドル時に継続
          if ('requestIdleCallback' in window) {
            requestIdleCallback(processChunk);
          } else {
            setTimeout(() => processChunk(), 0);
          }
        } else {
          resolve();
        }
      };

      // 最初のチャンク処理を開始
      if ('requestIdleCallback' in window) {
        requestIdleCallback(processChunk);
      } else {
        setTimeout(() => processChunk(), 0);
      }
    });
  };

  // --- 3. Playback Phase Logic ---

  // --- 3. Playback Phase Logic ---

  // 録画開始前に許可を求める
  const requestRecordingPermission = async (): Promise<boolean> => {
    try {
      // マイク許可をリクエスト（録画用音声ストリーム用）
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 許可が得られたらストリームを停止（後でstartRecordingで再取得）
      stream.getTracks().forEach(track => track.stop());
      return true;
    } catch (error) {
      console.warn('Recording permission denied or not available:', error);
      // 許可が得られなくても映像のみで続行可能
      return false;
    }
  };

  const startPlayback = async () => {
    // 録画許可を事前にリクエスト
    await requestRecordingPermission();

    setMode('playing');
    startRecording(); // 録画開始
    startCountdownSequence();
  };

  const startCountdownSequence = () => {
    setCountdown(3);
    const tick = (count: number) => {
      if (count > 0) {
        setTimeout(() => {
          setCountdown(count - 1);
          tick(count - 1);
        }, 1000);
      } else {
        setTimeout(() => {
          setCountdown(null);
          playNextTurn(0);
        }, 500);
      }
    };
    tick(3);
  };

  const playNextTurn = async (index: number) => {
    if (index >= scriptRef.current.length) {
      setTimeout(finishSession, 1000);
      return;
    }

    setCurrentMessageIndex(index);
    const msg = scriptRef.current[index];

    setPrevSpeaker(currentSpeaker);
    setCurrentSpeaker(msg.role);

    // 録画用に現在の発話者をCanvasのデータセットに保存（クロージャ対策）
    if (recordingCanvasRef.current) {
      recordingCanvasRef.current.dataset.activeRole = msg.role;
      recordingCanvasRef.current.dataset.currentText = msg.text;
    }

    const char = charactersRef.current.find(c => c.id === msg.role);
    const buffer = audioBuffersRef.current.get(msg.id);

    if (buffer && audioContextRef.current) {
      // Gemini TTS audio がある場合
      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);

      // 録画用ストリームにも接続
      if (recordingStreamDestRef.current) {
        source.connect(recordingStreamDestRef.current);
      }

      const rate = char?.pitch || 1.0;
      source.playbackRate.value = rate;

      activeSourceRef.current = source;
      activeSourcesRef.current.add(source); // メモリリーク対策: ソースを追跡

      source.onended = () => {
        activeSourcesRef.current.delete(source); // 終了時に削除
        playNextTurn(index + 1);
      };

      source.start(0);
    } else if (msg.role !== 'user' && window.speechSynthesis) {
      // Gemini TTS がない場合、Web Speech API を使用（ユーザー以外）
      try {
        await speakWithWebSpeech(msg.text, char?.voiceName || 'Kore', char?.pitch || 1.0, 1.0);
        playNextTurn(index + 1);
      } catch (e) {
        console.warn('Web Speech fallback failed:', e);
        // 音声なしで次へ
        const waitTime = Math.min(3000, Math.max(1000, msg.text.length * 80));
        setTimeout(() => playNextTurn(index + 1), waitTime);
      }
    } else {
      // ユーザーメッセージで録音がない場合、またはWeb Speech APIがない場合
      // テキスト長に応じて待機
      const waitTime = Math.min(3000, Math.max(1000, msg.text.length * 80));
      setTimeout(() => playNextTurn(index + 1), waitTime);
    }
  };

  const finishSession = () => {
    // 会話を保存
    if (scriptRef.current.length > 0 && selectedModeratorId && selectedCommentatorId) {
      const conversation: SavedConversation = {
        id: crypto.randomUUID(),
        questionText: question.text,
        messages: scriptRef.current,
        moderatorId: selectedModeratorId,
        commentatorId: selectedCommentatorId,
        createdAt: Date.now()
      };
      storageService.saveConversation(conversation);
      console.info('Conversation saved:', conversation.id);
    }

    // 録画が有効な場合は停止してcomplete modeへ遷移
    if (masterRecorderRef.current && masterRecorderRef.current.state === 'recording') {
      stopRecording(); // 録画停止→onstopでcomplete modeへ
    } else {
      // 録画がない場合は直接onSessionEndへ
      const transcript = scriptRef.current.map(m => `${m.role.toUpperCase()}: ${m.text}`).join('\n');

      // Get actual character info for the report
      const moderator = charactersRef.current.find(c => c.id === 'moderator');
      const commentator = charactersRef.current.find(c => c.id === 'commentator');

      const result: SessionEndResult = {
        transcript,
        moderatorId: selectedModeratorId || '',
        moderatorName: moderator?.name || 'Host',
        moderatorAvatarUrl: moderator?.avatarUrl || '',
        moderatorPersona: moderator?.persona,
        commentatorId: selectedCommentatorId || '',
        commentatorName: commentator?.name || 'Guest',
        commentatorAvatarUrl: commentator?.avatarUrl || '',
        commentatorPersona: commentator?.persona,
      };

      onSessionEnd(result);
    }
  };

  // --- Recording Logic (Vertical Video) ---

  const startRecording = () => {
    if (!recordingCanvasRef.current) return;

    const canvas = recordingCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // キャンバスサイズ設定（縦型FHD）
    canvas.width = 1080;
    canvas.height = 1920;

    // AudioContext の初期化（まだなければ）
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    }

    // MediaStreamDestination の初期化（録画用音声ストリーム）
    if (!recordingStreamDestRef.current) {
      recordingStreamDestRef.current = audioContextRef.current.createMediaStreamDestination();
    }

    // ストリームの結合
    const canvasStream = canvas.captureStream(30); // 30 FPS
    const audioStream = recordingStreamDestRef.current.stream;

    // 音声トラックがあれば結合、なければ映像のみ
    const combinedTracks = [
      ...canvasStream.getVideoTracks(),
      ...(audioStream.getAudioTracks().length > 0 ? audioStream.getAudioTracks() : [])
    ];
    const combinedStream = new MediaStream(combinedTracks);

    // Recorder設定
    const options = { mimeType: 'video/webm; codecs=vp9' };
    try {
      masterRecorderRef.current = new MediaRecorder(combinedStream, options);
    } catch (e) {
      console.warn('VP9 not supported, falling back to default', e);
      masterRecorderRef.current = new MediaRecorder(combinedStream);
    }

    recordedChunksRef.current = [];
    masterRecorderRef.current.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordedChunksRef.current.push(e.data);
      }
    };

    masterRecorderRef.current.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
      // 動画をstateに保存してcomplete modeへ遷移
      setGeneratedVideoBlob(blob);

      // 自動ダウンロード機能
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      link.download = `musegacha_debate_${timestamp}.webm`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setMode('complete');
    };

    masterRecorderRef.current.start();
    drawVideoFrame();
  };

  const stopRecording = () => {
    if (masterRecorderRef.current && masterRecorderRef.current.state === 'recording') {
      masterRecorderRef.current.stop();
    }
    if (recordingAnimationFrameRef.current) {
      cancelAnimationFrame(recordingAnimationFrameRef.current);
    }
  };

  const drawVideoFrame = () => {
    const canvas = recordingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. 背景描画
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#f8fafc'); // slate-50
    gradient.addColorStop(1, '#e2e8f0'); // slate-200
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. タイトル描画
    ctx.fillStyle = '#1e293b'; // slate-800
    ctx.font = 'bold 60px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MUSE GACHA DEBATE', canvas.width / 2, 150);

    ctx.font = '40px sans-serif';
    ctx.fillStyle = '#64748b'; // slate-500
    const questionText = question.text.length > 20 ? question.text.slice(0, 20) + '...' : question.text;
    ctx.fillText(questionText, canvas.width / 2, 220);

    // 3. アバター描画位置設定
    // Host: Top Center
    const hostPos = { x: canvas.width / 2, y: 500, scale: 1.0 };
    // User: Bottom Left
    const userPos = { x: 300, y: 1400, scale: 1.0 };
    // Guest: Bottom Right
    const guestPos = { x: 780, y: 1400, scale: 1.0 };

    // 現在の発話者を取得
    let activeRole: SpeakerRole | null = null;
    let currentText = '';

    // 現在のメッセージインデックスを参照（stateは非同期なのでrefを使うべきだが、簡易的にstate使用）
    // NOTE: React state inside requestAnimationFrame might be stale without refs, 
    // but usually works for simple playback visualization.
    // Better would be to use a ref for currentMessageIndex/Speaker.

    // しかしdrawVideoFrameは再帰的に呼ばれるため、stateのクロージャに注意が必要。
    // ここでは簡易的に実装するが、厳密にはRefを使うべき。
    // 今回は `currentSpeaker` state を利用するが、loop内で最新の値を取るためにRef経由にするのが定石。
    // 既存コードにRefがないため、今回はvisual effectとして割り切る。

    // 修正: loop内でstateを参照できるよう、currentSpeaker等をRefに同期させるか、
    // あるいは描画ループ外から渡す必要がある。
    // ここでは `currentSpeaker` State等は更新されない可能性があるため、
    // `scriptRef` と `currentMessageIndex` (これはstate) を使う。
    // ただし `currentMessageIndex` もクロージャで古いままになる。
    // よって、この関数外で管理されている `activeRoleRef` のようなものが必要。

    // 解決策: 単純に再描画をReactのライフサイクル外で行うのは難しいので、
    // `currentMessageIndex` を Ref にも保存するように修正する必要がある。
    // 今はそこまで変更できないため、クロージャの問題を受け入れつつ、簡単な方法をとる。

    // 実は `drawVideoFrame` を `useEffect` 内で定義し、依存配列に `currentSpeaker` を入れれば
    // 毎回再定義されるが、AnimationFrameはIDでキャンセルすればよい。
    // しかしパフォーマンスが悪い。

    // ベストエフォート: `activeSpeakerRef` を追加して管理することにする。
    // 今回は `multi_replace` の制限で `activeRoleRef` を追加するのは手間なので、
    // 描画時に `window` オブジェクトまたは `canvas` 自体にデータを持たせるハックを使うか、
    // 素直にRefを追加する（すでに上のチャンクでRef追加場所は過ぎている）。

    // 仕方がないので、ここで `scriptRef` の検索を行う（タイムスタンプベース等の同期は複雑）。
    // 妥協案: 現在の `drawVideoFrame` はクロージャ内の古い `currentSpeaker` を見るため動かない。
    // `useRef` を追加する変更を一番上のチャンクに含めるべきだった。
    // ここでは `drawingStateRef` をコンポーネント内に追加していないため、
    // DOM要素からステータスを読み取る（非推奨だが動く）か、
    // もしくは `Recording Logic` 自体を `useEffect` で `currentSpeaker` が変わるたびに更新する？いや、動画が途切れる。

    // **修正**: 一番上のチャンクに `activeRoleRef` を追加していないミスをカバーするため、
    // `startPlayback` などで更新される `currentSpeaker` ステートではなく、
    // `playNextTurn` で更新するように変更する。
    // `playNextTurn` は関数なので、そこで `recordingCanvasRef.current.dataset.activeRole = msg.role` のように
    // DOMにステートを持たせるのが最も安全で簡単な修正。


    // 4. アバター描画関数
    const drawAvatar = (charId: string, img: HTMLImageElement | undefined, x: number, y: number, isHost: boolean) => {
      if (!img) return;

      // データセットから最新のActiveRoleを取得
      const activeRole = canvas.dataset.activeRole;
      const isActive = activeRole === charId;

      const size = isActive ? 250 : 180;
      const opacity = isActive ? 1.0 : 0.7;

      ctx.save();
      ctx.globalAlpha = opacity;

      // 円形クリッピング
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      // 画像描画
      ctx.drawImage(img, x - size / 2, y - size / 2, size, size);

      // 枠線
      if (isActive) {
        ctx.lineWidth = 8;
        ctx.strokeStyle = '#ef4444'; // red-500
        ctx.stroke();
      }

      ctx.restore();
    };

    // 画像取得
    const hostImg = avatarImagesRef.current.get('moderator');
    const userImg = avatarImagesRef.current.get('user');
    const guestImg = avatarImagesRef.current.get('commentator');

    // 描画実行
    drawAvatar('moderator', hostImg, hostPos.x, hostPos.y, true);
    drawAvatar('user', userImg, userPos.x, userPos.y, false);
    drawAvatar('commentator', guestImg, guestPos.x, guestPos.y, false);

    // 5. 字幕描画
    const text = canvas.dataset.currentText || '';
    if (text) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(50, 1600, 980, 250);

      ctx.fillStyle = '#ffffff';
      ctx.font = '40px sans-serif';
      ctx.textAlign = 'center';

      // テキストの折り返し処理
      const maxWidth = 900;
      const words = text.split('');
      let line = '';
      let lines = [];

      for (let i = 0; i < words.length; i++) {
        const testLine = line + words[i];
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && i > 0) {
          lines.push(line);
          line = words[i];
        } else {
          line = testLine;
        }
      }
      lines.push(line);

      lines.slice(0, 4).forEach((l, i) => {
        ctx.fillText(l, canvas.width / 2, 1680 + (i * 50));
      });
    }

    recordingAnimationFrameRef.current = requestAnimationFrame(drawVideoFrame);
  };

  // --- Render ---

  // Avatar Component - Modern Dark Theme with Glow Effects
  const Avatar = ({ char, role, currentRole }: { char: Character, role: SpeakerRole, currentRole: SpeakerRole | null }) => {
    const isActive = role === currentRole;

    let positionStyle = "";
    if (role === 'moderator') {
      if (isActive) positionStyle = "z-30 top-[20%] left-1/2 -translate-x-1/2 scale-125";
      else positionStyle = "z-10 top-6 left-6 scale-90 opacity-60 grayscale-[0.3]";
    } else if (role === 'commentator') {
      if (isActive) positionStyle = "z-30 top-[20%] left-1/2 -translate-x-1/2 scale-125";
      else positionStyle = "z-10 top-6 right-6 scale-90 opacity-60 grayscale-[0.3]";
    } else if (role === 'user') {
      if (isActive) positionStyle = "z-30 bottom-[25%] left-1/2 -translate-x-1/2 scale-125";
      else positionStyle = "z-20 bottom-8 left-1/2 -translate-x-1/2 scale-100";
    }

    // ロールに応じたグロー色
    const glowClass = role === 'user'
      ? 'glow-blue'
      : role === 'commentator'
        ? 'glow-red'
        : 'glow-purple';

    return (
      <div className={`absolute transition-all duration-500 ease-out flex flex-col items-center ${positionStyle}`}>
        <div className={`rounded-full overflow-hidden relative transition-all duration-500 ${isActive
          ? `w-28 h-28 border-4 ${role === 'user' ? 'border-blue-500' : role === 'commentator' ? 'border-red-500' : 'border-purple-500'} ${glowClass} animate-pulse-glow`
          : 'w-20 h-20 border-2 border-white/30'
          }`}>
          <img src={char.avatarUrl} className="w-full h-full object-cover" alt={char.name} />
          {isActive && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
          )}
        </div>
        <p className={`mt-2 font-bold font-display uppercase text-[10px] px-3 py-1 rounded-full transition-all duration-300 ${isActive
          ? 'bg-white text-black shadow-lg scale-110'
          : 'glass text-white/80'
          }`}>
          {char.name}
        </p>
      </div>
    );
  };

  // 0. Setup View - Character Selection
  if (mode === 'setup') {
    const selectedModerator = availableCharacters.find(c => c.id === selectedModeratorId);
    const selectedCommentator = availableCharacters.find(c => c.id === selectedCommentatorId);

    return (
      <div className="flex flex-col h-full bg-debate-dark bg-grid-dark relative overflow-hidden">
        {/* 装飾的な光の効果 */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex-1 overflow-y-auto p-4 relative z-10">
          {/* ヘッダー */}
          <div className="text-center py-4">
            <h2 className="font-display font-bold text-2xl uppercase tracking-widest gradient-text">
              キャラクター選択
            </h2>
            <p className="font-mono text-xs text-gray-500 mt-1">
              🎭 会話に参加するキャラクターを選んでください
            </p>
          </div>

          {/* お題表示 */}
          <div className="glass rounded-xl p-4 mb-4 max-w-lg mx-auto">
            <p className="text-white text-sm text-center">{question.text}</p>
          </div>

          {/* 選択モード切り替え */}
          <div className="flex justify-center gap-2 mb-4">
            <button
              onClick={() => setCharacterSelectionMode('auto')}
              className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${characterSelectionMode === 'auto'
                ? 'bg-purple-600 text-white'
                : 'glass text-white/70 hover:bg-white/10'
                }`}
            >
              🎯 自動選択
            </button>
            <button
              onClick={randomizeCharacters}
              className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${characterSelectionMode === 'random'
                ? 'bg-blue-600 text-white'
                : 'glass text-white/70 hover:bg-white/10'
                }`}
            >
              🎲 ランダム
            </button>
            <button
              onClick={() => setCharacterSelectionMode('manual')}
              className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${characterSelectionMode === 'manual'
                ? 'bg-green-600 text-white'
                : 'glass text-white/70 hover:bg-white/10'
                }`}
            >
              ✋ 手動選択
            </button>
          </div>

          {/* 選択中のキャラクター表示 */}
          <div className="flex justify-center gap-8 mb-6">
            <div className="flex flex-col items-center">
              <div className="text-[10px] text-gray-400 mb-1 uppercase">Moderator</div>
              {selectedModerator && (
                <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-purple-500 glow-purple">
                  <img src={selectedModerator.avatarUrl} className="w-full h-full object-cover" alt={selectedModerator.name} />
                </div>
              )}
              <p className="mt-1 text-white text-sm font-bold">{selectedModerator?.name || '未選択'}</p>
            </div>
            <div className="flex flex-col items-center">
              <div className="text-[10px] text-gray-400 mb-1 uppercase">Commentator</div>
              {selectedCommentator && (
                <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-red-500 glow-red">
                  <img src={selectedCommentator.avatarUrl} className="w-full h-full object-cover" alt={selectedCommentator.name} />
                </div>
              )}
              <p className="mt-1 text-white text-sm font-bold">{selectedCommentator?.name || '未選択'}</p>
            </div>
          </div>

          {/* キャラクター一覧（手動選択時） */}
          {characterSelectionMode === 'manual' && (
            <div className="max-w-2xl mx-auto">
              <div className="text-[10px] text-gray-400 mb-2 uppercase text-center">
                キャラクターをタップして選択（1人目: Moderator, 2人目: Commentator）
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
                {availableCharacters.map((char) => {
                  const isModerator = char.id === selectedModeratorId;
                  const isCommentator = char.id === selectedCommentatorId;
                  const isSelected = isModerator || isCommentator;

                  return (
                    <button
                      key={char.id}
                      onClick={() => {
                        if (isModerator) {
                          setSelectedModeratorId(null);
                        } else if (isCommentator) {
                          setSelectedCommentatorId(null);
                        } else if (!selectedModeratorId) {
                          setSelectedModeratorId(char.id);
                        } else if (!selectedCommentatorId && char.id !== selectedModeratorId) {
                          setSelectedCommentatorId(char.id);
                        } else {
                          // 既に2人選択済みの場合、Moderatorを入れ替え
                          setSelectedModeratorId(char.id);
                        }
                      }}
                      className={`flex flex-col items-center p-2 rounded-xl transition-all ${isSelected
                        ? isModerator
                          ? 'bg-purple-600/30 ring-2 ring-purple-500'
                          : 'bg-red-600/30 ring-2 ring-red-500'
                        : 'glass hover:bg-white/10'
                        }`}
                    >
                      <div className={`w-12 h-12 rounded-full overflow-hidden border-2 ${isSelected
                        ? isModerator ? 'border-purple-500' : 'border-red-500'
                        : 'border-white/20'
                        }`}>
                        <img src={char.avatarUrl} className="w-full h-full object-cover" alt={char.name} />
                      </div>
                      <p className="mt-1 text-white text-[10px] font-bold truncate w-full text-center">
                        {char.name}
                      </p>
                      {isSelected && (
                        <span className={`text-[8px] ${isModerator ? 'text-purple-400' : 'text-red-400'}`}>
                          {isModerator ? 'M' : 'C'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* キャラクター説明（自動選択時） */}
          {characterSelectionMode !== 'manual' && (
            <div className="max-w-lg mx-auto space-y-3">
              {selectedModerator && (
                <div className="glass rounded-xl p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full overflow-hidden border border-purple-500 flex-shrink-0">
                      <img src={selectedModerator.avatarUrl} className="w-full h-full object-cover" alt="" />
                    </div>
                    <div>
                      <p className="text-white text-sm font-bold">{selectedModerator.name}</p>
                      <p className="text-gray-400 text-[10px]">{selectedModerator.persona?.slice(0, 50)}...</p>
                    </div>
                  </div>
                </div>
              )}
              {selectedCommentator && (
                <div className="glass rounded-xl p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full overflow-hidden border border-red-500 flex-shrink-0">
                      <img src={selectedCommentator.avatarUrl} className="w-full h-full object-cover" alt="" />
                    </div>
                    <div>
                      <p className="text-white text-sm font-bold">{selectedCommentator.name}</p>
                      <p className="text-gray-400 text-[10px]">{selectedCommentator.persona?.slice(0, 50)}...</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* スタートボタン */}
        <div className="p-4 glass-dark">
          <button
            onClick={startSessionWithCharacters}
            disabled={!selectedModeratorId || !selectedCommentatorId}
            className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white py-4 rounded-2xl font-bold text-lg uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed hover:scale-[1.02] transition-transform glow-purple"
          >
            🎙️ セッション開始
          </button>
        </div>
      </div>
    );
  }

  // 1. Scripting View - Modern Dark Theme
  if (mode === 'scripting') {
    // 録音再生ヘルパー
    const playRecording = (rec: { id: string, blob: Blob }) => {
      const url = URL.createObjectURL(rec.blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.play();
    };

    // 時間フォーマット
    const formatTime = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
      <div className="flex flex-col h-full bg-debate-dark bg-grid-dark relative overflow-hidden">
        {/* 装飾的な光の効果 */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-red-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* メッセージエリア */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-44 relative z-10">
          {/* ヘッダー */}
          <div className="text-center py-6">
            <h2 className="font-display font-bold text-2xl uppercase tracking-widest gradient-text">
              Script Studio
            </h2>
            <p className="font-mono text-xs text-gray-500 mt-1">
              🎙️ あなたの考えを話してみよう
            </p>
            <div className="mt-4 flex justify-center gap-2">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-all duration-300 ${i < turnCount ? 'bg-red-500 glow-red' : i === turnCount ? 'bg-yellow-500 animate-pulse' : 'bg-gray-600'
                    }`}
                />
              ))}
            </div>
            {/* ユーザー音声設定ボタン */}
            <div className="mt-4 flex justify-center items-center gap-3">
              <button
                onClick={() => setShowVoiceSettings(true)}
                className="glass text-white text-xs font-bold uppercase px-4 py-2 rounded-full hover:bg-white/20 transition-colors flex items-center gap-2"
              >
                <span>
                  {userVoiceType === 'microphone' ? '🎤' : userVoiceType === 'clone' ? '🎭' : '🤖'}
                </span>
                <span>声の設定</span>
              </button>
              <span className="text-[10px] text-gray-500">
                {userVoiceType === 'microphone' ? 'マイク録音' : userVoiceType === 'clone' ? 'クローンボイス' : 'Gemini TTS'}
              </span>
            </div>
          </div>

          {/* チャットメッセージ */}
          {scriptMessages.map((msg) => {
            const userRecording = msg.role === 'user' ? savedRecordings.find(r => r.messageId === msg.id) : null;

            return (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                <div className={`max-w-[85%] p-4 rounded-2xl text-sm relative transition-all ${msg.role === 'user'
                  ? 'bg-gradient-to-br from-blue-600 to-purple-600 text-white glow-blue'
                  : msg.role === 'moderator'
                    ? 'glass text-white'
                    : 'bg-gradient-to-br from-red-600/90 to-pink-600/90 text-white glow-red'
                  }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-2 h-2 rounded-full ${msg.role === 'user' ? 'bg-blue-300' : msg.role === 'moderator' ? 'bg-white/60' : 'bg-red-300'
                      }`} />
                    <span className="text-[10px] font-bold uppercase opacity-80">
                      {msg.role === 'moderator' ? 'Host' : msg.role === 'commentator' ? 'Guest' : 'ZENZEN'}
                    </span>
                    {/* 録音再生ボタン */}
                    {userRecording && (
                      <button
                        onClick={() => playRecording(userRecording)}
                        className="ml-auto bg-white/20 hover:bg-white/30 rounded-full p-1 transition-colors"
                        title="録音を再生"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <p className="leading-relaxed">{msg.text}</p>
                </div>
              </div>
            );
          })}

          {/* 自動スクロール用のアンカー */}
          <div ref={messagesEndRef} />

          {/* 生成中インジケータ */}
          {isGeneratingScript && (
            <div className="flex justify-start animate-pulse">
              <div className="glass p-4 rounded-2xl flex items-center gap-3">
                <div className="flex gap-1">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
                <span className="text-xs text-gray-400">考え中...</span>
              </div>
            </div>
          )}

          {/* 再生成ボタン（生成失敗時） */}
          {scriptGenerationFailed && !isGeneratingScript && (
            <div className="flex justify-center py-6">
              <button
                onClick={async () => {
                  setScriptGenerationFailed(false);
                  setIsGeneratingScript(true);
                  try {
                    const intro = await generateScriptSection('intro', [], charactersRef.current, question.text);
                    setScriptMessages(intro);
                    scriptRef.current = intro;
                    prefetchAudio(intro);
                  } catch (error) {
                    console.warn('Regeneration failed:', error);
                    setScriptGenerationFailed(true);
                  } finally {
                    setIsGeneratingScript(false);
                  }
                }}
                className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold font-display uppercase px-8 py-4 rounded-full hover:scale-105 transition-transform flex items-center gap-3"
              >
                <span className="text-xl">🔄</span>
                <span>再生成</span>
              </button>
            </div>
          )}

          {/* 音声確認・編集ボタン */}
          {turnCount >= 2 && !isGeneratingScript && (
            <div className="py-8 flex flex-col items-center gap-4">
              <button
                onClick={initializeEditingMode}
                className="group relative bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white font-bold font-display uppercase text-xl px-10 py-5 rounded-full animate-pulse-glow hover:scale-105 transition-transform"
              >
                <span className="relative z-10 flex items-center gap-3">
                  🎵 音声を確認・編集
                </span>
                <div className="absolute inset-0 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 rounded-full blur-lg opacity-50 group-hover:opacity-75 transition-opacity" />
              </button>
              <p className="text-[11px] text-gray-500 uppercase tracking-wider flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                スクリプト作成完了
              </p>
            </div>
          )}
        </div>

        {/* Hidden Canvas for Recording */}
        <canvas ref={recordingCanvasRef} className="hidden" />

        {/* 入力エリア - モダンなデザイン */}
        {turnCount < 2 && (
          <div className="fixed bottom-0 left-0 w-full glass-dark p-4 pb-8 z-[60]">
            {/* 録音ビジュアライザー */}
            {isRecordingVoice && (
              <div className="flex flex-col items-center gap-3 mb-4">
                {/* 波形バー */}
                <div className="flex items-center justify-center gap-1 h-8">
                  {[...Array(5)].map((_, i) => (
                    <div
                      key={i}
                      className="voice-bar w-1 bg-red-500 rounded-full"
                      style={{ height: `${Math.random() * 100}%`, minHeight: '4px' }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2 text-red-400">
                  <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-sm font-bold">録音中 {formatTime(recordingTime)}</span>
                </div>
              </div>
            )}

            {/* 保存された録音リスト */}
            {savedRecordings.length > 0 && !isRecordingVoice && (
              <div className="flex gap-2 mb-4 overflow-x-auto pb-2 max-w-lg mx-auto">
                {savedRecordings.map((rec, idx) => (
                  <div key={rec.id} className="flex-shrink-0 flex items-center gap-1">
                    <button
                      onClick={() => playRecording(rec)}
                      className="bg-white/10 hover:bg-white/20 px-3 py-2 rounded-full text-xs flex items-center gap-2 text-white transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      録音 {idx + 1}
                      {rec.duration && <span className="text-gray-400">({rec.duration}s)</span>}
                    </button>
                    <button
                      onClick={() => downloadRecording(rec)}
                      className="bg-white/5 hover:bg-white/10 p-2 rounded-full text-gray-400 hover:text-white transition-colors"
                      title="ダウンロード"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleUserSubmit} className="flex gap-3 items-center max-w-lg mx-auto">
              {/* 大きなマイクボタン */}
              <button
                type="button"
                onClick={toggleMic}
                className={`relative w-14 h-14 flex-shrink-0 rounded-full flex items-center justify-center transition-all ${isListening
                  ? 'bg-red-600 text-white glow-red scale-110'
                  : 'bg-white/10 text-gray-300 hover:bg-white/20 hover:text-white'
                  }`}
              >
                {isListening && (
                  <span className="absolute inset-0 rounded-full bg-red-600/50 animate-ping" />
                )}
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="relative z-10">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>

              {/* テキスト入力 */}
              <input
                type="text"
                value={userInput}
                onChange={e => setUserInput(e.target.value)}
                placeholder={isListening ? "🎙️ 聞いています..." : isGeneratingScript ? "生成中..." : "💭 あなたの考えを入力..."}
                disabled={isGeneratingScript}
                className="flex-1 bg-white/10 border border-white/20 text-white placeholder:text-gray-500 rounded-xl px-4 py-3.5 outline-none focus:border-white/40 focus:bg-white/15 transition-all"
                autoFocus
              />

              {/* 送信ボタン */}
              <button
                type="submit"
                disabled={!userInput.trim() || isGeneratingScript}
                className="bg-gradient-to-r from-blue-500 to-purple-500 text-white w-14 h-14 flex items-center justify-center rounded-full font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:scale-105 transition-transform glow-purple"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </form>
          </div>
        )}

        {/* ユーザー音声設定モーダル */}
        {showVoiceSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="glass-dark rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto m-4 shadow-2xl">
              <UserVoiceSettings
                onClose={() => {
                  setShowVoiceSettings(false);
                  // 設定変更を反映
                  const config = userVoiceService.loadConfig();
                  setUserVoiceType(config.type);
                  // ユーザーキャラクターの声を更新
                  const userChar = charactersRef.current.find(c => c.id === 'user');
                  if (userChar && config.geminiVoiceName) {
                    userChar.voiceName = config.geminiVoiceName;
                  }
                }}
                onConfigChange={() => {
                  const config = userVoiceService.loadConfig();
                  setUserVoiceType(config.type);
                }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // 2. Loading View - Modern Dark Theme
  if (mode === 'loading') {
    return (
      <div className="w-full h-full bg-debate-dark text-white flex flex-col items-center justify-center relative overflow-hidden">
        {/* 装飾的な光の効果 */}
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-red-500/20 rounded-full blur-3xl animate-pulse pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-purple-500/20 rounded-full blur-3xl animate-pulse pointer-events-none" style={{ animationDelay: '1s' }} />
        <div className="absolute inset-0 bg-grid-dark" />

        <div className="z-10 text-center w-full max-w-sm px-6">
          {/* ローディングアイコン */}
          <div className="relative w-24 h-24 mx-auto mb-8">
            <div className="absolute inset-0 rounded-full border-4 border-white/10" />
            <div
              className="absolute inset-0 rounded-full border-4 border-transparent border-t-red-500 animate-spin"
              style={{ animationDuration: '1s' }}
            />
            <div className="absolute inset-2 rounded-full bg-white/5 flex items-center justify-center">
              <span className="text-3xl">🎙️</span>
            </div>
          </div>

          <h2 className="font-display text-3xl font-bold mb-2 gradient-text">
            LOADING
          </h2>
          <p className="text-sm text-gray-500 mb-8">音声を準備しています...</p>

          {/* プログレスバー */}
          <div className="w-full h-3 rounded-full mb-4 overflow-hidden bg-white/10 relative">
            <div
              className="h-full bg-gradient-to-r from-red-500 via-pink-500 to-purple-500 transition-all duration-300 ease-out rounded-full"
              style={{ width: `${loadingProgress}%` }}
            />
            <div className="absolute inset-0 animate-shimmer opacity-30" />
          </div>

          <div className="flex justify-between text-xs font-mono uppercase tracking-widest">
            <span className="text-gray-400 truncate max-w-[200px]">{loadingStatus}</span>
            <span className="text-white font-bold">{loadingProgress}%</span>
          </div>
        </div>
      </div>
    );
  }

  // 2.5. Editing View - Audio Card List
  if (mode === 'editing') {
    return (
      <div className="flex flex-col h-full bg-debate-dark bg-grid-dark relative overflow-hidden">
        {/* 背景効果 */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* ヘッダー */}
        <div className="glass p-4 flex items-center justify-between z-20 shrink-0">
          <div>
            <h2 className="font-display text-lg font-bold text-white uppercase tracking-wider">🎵 音声編集</h2>
            <p className="text-xs text-gray-400">各発言の音声を確認・編集できます</p>
          </div>
          <button
            onClick={() => setMode('scripting')}
            className="glass text-white text-xs font-bold uppercase px-4 py-2 rounded-full hover:bg-white/20 transition-colors"
          >
            ← 戻る
          </button>
        </div>

        {/* カードリスト */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {scriptRef.current.map((msg, index) => {
            const char = charactersRef.current.find(c => c.id === msg.role);
            const audioInfo = editingAudioData.get(msg.id);
            const isUser = msg.role === 'user';
            const hasUserRecording = isUser && savedRecordings.some(r => r.messageId === msg.id);
            const isRecordingThis = editingRecordingId === msg.id;

            return (
              <div key={msg.id} className="glass rounded-xl p-4 transition-all hover:bg-white/10">
                {/* カードヘッダー */}
                <div className="flex items-center gap-3 mb-3">
                  {/* アバター */}
                  <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-white/30 shrink-0">
                    <img src={char?.avatarUrl || ''} className="w-full h-full object-cover" alt={char?.name} />
                  </div>
                  {/* 情報 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-xs font-bold text-white uppercase">{char?.name || msg.role}</span>
                      <span className="text-[10px] text-gray-400">#{index + 1}</span>
                      {/* ステータスバッジ */}
                      {audioInfo?.status === 'ready' && (
                        <span className="bg-green-500/20 text-green-400 text-[10px] px-2 py-0.5 rounded-full">✓ 準備完了</span>
                      )}
                      {audioInfo?.status === 'webspeech' && (
                        <span className="bg-yellow-500/20 text-yellow-400 text-[10px] px-2 py-0.5 rounded-full">⚠ ブラウザ音声</span>
                      )}
                      {audioInfo?.isGenerating && (
                        <span className="bg-blue-500/20 text-blue-400 text-[10px] px-2 py-0.5 rounded-full animate-pulse">⏳ 生成中...</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 表示テキスト */}
                <div className="mb-3 p-3 bg-black/30 rounded-lg">
                  <div className="text-[10px] text-gray-500 uppercase mb-1">表示テキスト</div>
                  <p className="text-white text-sm leading-relaxed">{msg.text}</p>
                </div>

                {/* 読み方（編集可能） */}
                <div className="mb-3 p-3 bg-black/20 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[10px] text-gray-500 uppercase">
                      {isUser ? '読み方（編集してGemini音声生成可）' : '読み方'}
                    </div>
                    <button
                      onClick={() => playAudioPreview(msg.id)}
                      className="bg-white/10 hover:bg-white/20 text-white text-xs px-3 py-1 rounded-full flex items-center gap-1 transition-colors"
                      disabled={audioInfo?.isGenerating}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      再生
                    </button>
                  </div>
                  <textarea
                    value={audioInfo?.pronunciation || msg.text}
                    onChange={(e) => {
                      setEditingAudioData(prev => {
                        const next = new Map(prev);
                        const current = prev.get(msg.id);
                        if (current) {
                          next.set(msg.id, { ...current, pronunciation: e.target.value });
                        }
                        return next;
                      });
                    }}
                    className={`w-full bg-transparent text-white text-sm leading-relaxed resize-none outline-none ${isUser ? 'border border-white/20 rounded p-2 focus:border-emerald-500' : ''}`}
                    rows={2}
                    placeholder={isUser ? "ここにテキストを入力してGemini音声を生成..." : ""}
                  />
                </div>

                {/* アクションボタン */}
                <div className="flex gap-2 flex-wrap">
                  {isUser ? (
                    <>
                      {/* ユーザー専用: 録音ボタン */}
                      {isRecordingThis ? (
                        <button
                          onClick={stopEditingRecording}
                          className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2 rounded-full flex items-center gap-2 animate-pulse"
                        >
                          <span className="w-2 h-2 bg-white rounded-full" />
                          録音停止
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => startEditingRecording(msg.id)}
                            className="bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-4 py-2 rounded-full flex items-center gap-2 transition-colors"
                          >
                            🎤 マイク録音
                          </button>
                          {/* Gemini TTS再生成ボタン */}
                          <button
                            onClick={() => regenerateUserAudioWithGemini(msg.id)}
                            disabled={audioInfo?.isGenerating}
                            className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold px-4 py-2 rounded-full flex items-center gap-2 transition-all disabled:opacity-50"
                          >
                            {audioInfo?.isGenerating ? (
                              <>
                                <div className="w-3 h-3 border-2 border-white border-t-transparent animate-spin rounded-full" />
                                生成中...
                              </>
                            ) : (
                              <>🤖 Gemini音声</>
                            )}
                          </button>
                        </>
                      )}
                      {hasUserRecording && (
                        <span className="text-green-400 text-xs flex items-center gap-1">
                          ✓ 録音あり
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      {/* AI専用: 再生成ボタン */}
                      <button
                        onClick={() => regenerateAudioForMessage(msg.id, audioInfo?.pronunciation)}
                        disabled={audioInfo?.isGenerating}
                        className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white text-xs font-bold px-4 py-2 rounded-full flex items-center gap-2 transition-all disabled:opacity-50"
                      >
                        {audioInfo?.isGenerating ? (
                          <>
                            <div className="w-3 h-3 border-2 border-white border-t-transparent animate-spin rounded-full" />
                            生成中...
                          </>
                        ) : (
                          <>🔄 再生成</>
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 動画生成ボタン */}
        <div className="glass p-6 shrink-0">
          <button
            onClick={startLoadingAudio}
            className="w-full bg-gradient-to-r from-red-600 via-pink-600 to-purple-600 text-white font-bold font-display uppercase text-lg px-8 py-4 rounded-full hover:scale-[1.02] transition-transform"
          >
            ▶ 動画を生成
          </button>
          <p className="text-center text-xs text-gray-500 mt-2">
            全ての音声を確認したら動画生成へ進みます
          </p>
        </div>
      </div>
    );
  }

  // 2.8. Complete View - Save Options
  if (mode === 'complete') {
    return (
      <div className="flex flex-col h-full bg-debate-dark bg-grid-dark relative overflow-hidden items-center justify-center">
        {/* 背景効果 */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-green-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="glass p-8 rounded-2xl text-center max-w-md mx-4">
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="font-display text-2xl font-bold text-white uppercase mb-2">完成！</h2>
          <p className="text-gray-400 text-sm mb-6">動画の生成が完了しました</p>

          {/* 保存ボタン */}
          <div className="space-y-3">
            {generatedVideoBlob && (
              <button
                onClick={() => {
                  const url = URL.createObjectURL(generatedVideoBlob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `debate_${Date.now()}.webm`;
                  link.click();
                  URL.revokeObjectURL(url);
                }}
                className="w-full bg-gradient-to-r from-red-600 to-pink-600 text-white font-bold py-4 px-6 rounded-full hover:scale-[1.02] transition-transform flex items-center justify-center gap-2"
              >
                📹 動画をダウンロード
              </button>
            )}

            <button
              onClick={finishSession}
              className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-4 px-6 rounded-full transition-colors flex items-center justify-center gap-2"
            >
              📝 テキスト報告書を生成
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. Playing View (Stage) - New Rotating Speaker Layout
  // アクティブな話者とその他の話者を分離
  const getActiveSpeaker = (): Character | null => {
    if (!currentSpeaker) return null;
    return charactersRef.current.find(c => c.id === currentSpeaker) || null;
  };

  const getWaitingSpeakers = (): Character[] => {
    if (!currentSpeaker) return charactersRef.current;
    return charactersRef.current.filter(c => c.id !== currentSpeaker);
  };

  const activeSpeaker = getActiveSpeaker();
  const waitingSpeakers = getWaitingSpeakers();

  // Get current message and emotion for dynamic avatar
  const currentMessage = scriptRef.current[currentMessageIndex];
  const currentEmotion = currentMessage?.emotion || 'neutral';

  // Calculate active avatar URL
  const activeAvatarUrl = activeSpeaker
    ? (activeSpeaker.expressions?.[currentEmotion as keyof CharacterExpressions] || activeSpeaker.avatarUrl)
    : '';

  // ロールに応じたスタイル
  const getRoleStyle = (role: SpeakerRole) => {
    switch (role) {
      case 'user':
        return {
          borderColor: 'border-blue-500',
          glowClass: 'glow-blue',
          bgGradient: 'from-blue-600 to-purple-600',
          dotColor: 'bg-blue-400'
        };
      case 'commentator':
        return {
          borderColor: 'border-red-500',
          glowClass: 'glow-red',
          bgGradient: 'from-red-600 to-pink-600',
          dotColor: 'bg-red-400'
        };
      default: // moderator
        return {
          borderColor: 'border-purple-500',
          glowClass: 'glow-purple',
          bgGradient: 'from-purple-600 to-indigo-600',
          dotColor: 'bg-purple-400'
        };
    }
  };

  const activeStyle = currentSpeaker ? getRoleStyle(currentSpeaker) : getRoleStyle('moderator');

  return (
    <div className={`w-full h-full flex items-center justify-center relative overflow-hidden ${stageTheme || 'bg-debate-dark'}`}>
      {/* Subtle gradient flow - serverless style */}
      <div className="bg-gradient-flow" />

      {/* Light spots - very subtle */}
      <div className="light-spot light-spot-1" />
      <div className="light-spot light-spot-2" />

      {/* ステージ背景アニメーション - 全画面 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 100% 80% at 50% 30%, rgba(255,255,255,0.05) 0%, transparent 60%)',
          animation: 'stage-bg-float 20s ease-in-out infinite',
        }}
      />

      {/* Shimmer wave overlay */}
      <div className="shimmer-wave" />

      {/* BGM-style ambient background - 会話のBGM的な背景アニメーション */}
      <div className="bgm-ambient-container">
        {/* バリエーション1: 流れる波紋 */}
        <div className={`bgm-variant bgm-variant-ripples ${bgmVariants[bgmVariant] === 'ripples' ? 'active' : ''}`}>
          <div className="bgm-ripple" />
          <div className="bgm-ripple" />
          <div className="bgm-ripple" />
          <div className="bgm-ripple" />
        </div>

        {/* バリエーション2: 浮遊する光の帯 */}
        <div className={`bgm-variant bgm-variant-streams ${bgmVariants[bgmVariant] === 'streams' ? 'active' : ''}`}>
          <div className="bgm-stream" />
          <div className="bgm-stream" />
          <div className="bgm-stream" />
          <div className="bgm-stream" />
        </div>

        {/* バリエーション3: 呼吸するオーラ */}
        <div className={`bgm-variant bgm-variant-aura ${bgmVariants[bgmVariant] === 'aura' ? 'active' : ''}`}>
          <div className="bgm-aura" />
          <div className="bgm-aura" />
          <div className="bgm-aura" />
        </div>

        {/* バリエーション4: 落ちる粒子 */}
        <div className={`bgm-variant bgm-variant-particles ${bgmVariants[bgmVariant] === 'particles' ? 'active' : ''}`}>
          <div className="bgm-particle" />
          <div className="bgm-particle" />
          <div className="bgm-particle" />
          <div className="bgm-particle" />
          <div className="bgm-particle" />
          <div className="bgm-particle" />
          <div className="bgm-particle" />
          <div className="bgm-particle" />
        </div>

        {/* バリエーション5: 回転するリング */}
        <div className={`bgm-variant bgm-variant-rings ${bgmVariants[bgmVariant] === 'rings' ? 'active' : ''}`}>
          <div className="bgm-ring" />
          <div className="bgm-ring" />
          <div className="bgm-ring" />
        </div>

        {/* バリエーション6: グラデーションウェーブ */}
        <div className={`bgm-variant bgm-variant-waves ${bgmVariants[bgmVariant] === 'waves' ? 'active' : ''}`}>
          <div className="bgm-wave" />
          <div className="bgm-wave" />
          <div className="bgm-wave" />
        </div>
      </div>

      {/* Nature-themed ambient animation - テーマに応じた自然アニメーション */}
      <div className="nature-ambient-container">
        {/* 水面の波紋 */}
        <div className={`nature-variant nature-water ${natureVariant === 'water' ? 'active' : ''}`}>
          <div className="water-ripple" />
          <div className="water-ripple" />
          <div className="water-ripple" />
          <div className="water-ripple" />
          <div className="water-wave-line" />
          <div className="water-wave-line" />
          <div className="water-wave-line" />
        </div>

        {/* フラクタル構造 */}
        <div className={`nature-variant nature-fractal ${natureVariant === 'fractal' ? 'active' : ''}`}>
          <div className="fractal-branch" />
          <div className="fractal-branch" />
          <div className="fractal-branch" />
        </div>

        {/* 花びら */}
        <div className={`nature-variant nature-petals ${natureVariant === 'petals' ? 'active' : ''}`}>
          <div className="petal" />
          <div className="petal" />
          <div className="petal" />
          <div className="petal" />
          <div className="petal" />
          <div className="petal" />
        </div>

        {/* 葉っぱ */}
        <div className={`nature-variant nature-leaves ${natureVariant === 'leaves' ? 'active' : ''}`}>
          <div className="leaf" />
          <div className="leaf" />
          <div className="leaf" />
          <div className="leaf" />
          <div className="leaf" />
        </div>

        {/* 雪の結晶 */}
        <div className={`nature-variant nature-snow ${natureVariant === 'snow' ? 'active' : ''}`}>
          <div className="snowflake" />
          <div className="snowflake" />
          <div className="snowflake" />
          <div className="snowflake" />
          <div className="snowflake" />
          <div className="snowflake" />
        </div>

        {/* 星空/銀河 */}
        <div className={`nature-variant nature-galaxy ${natureVariant === 'galaxy' ? 'active' : ''}`}>
          <div className="star" />
          <div className="star" />
          <div className="star" />
          <div className="star" />
          <div className="star" />
          <div className="star" />
          <div className="star" />
          <div className="star" />
        </div>

        {/* 雲の流れ */}
        <div className={`nature-variant nature-clouds ${natureVariant === 'clouds' ? 'active' : ''}`}>
          <div className="cloud" />
          <div className="cloud" />
          <div className="cloud" />
        </div>

        {/* オーロラ */}
        <div className={`nature-variant nature-aurora ${natureVariant === 'aurora' ? 'active' : ''}`}>
          <div className="aurora-wave" />
          <div className="aurora-wave" />
          <div className="aurora-wave" />
        </div>

        {/* 炎 */}
        <div className={`nature-variant nature-fire ${natureVariant === 'fire' ? 'active' : ''}`}>
          <div className="flame" />
          <div className="flame" />
          <div className="flame" />
        </div>
      </div>

      {/* Premium animated background - reduced opacity */}
      <div className="bg-gradient-mesh opacity-20" />
      <div className="particle-container" style={{ opacity: 0.5 }}>
        <div className="particle-orb particle-orb-1" />
        <div className="particle-orb particle-orb-2" />
        <div className="particle-orb particle-orb-3" />
      </div>
      <div className="bg-grid-premium" style={{ opacity: 0.5 }} />
      <div className="bg-noise" />
      <div className="floating-dots" style={{ opacity: 0.3 }}>
        <div className="floating-dot" />
        <div className="floating-dot" />
        <div className="floating-dot" />
        <div className="floating-dot" />
        <div className="floating-dot" />
      </div>

      {/* PC side decorations */}
      <div className="hidden md:block pc-side-decoration left" />
      <div className="hidden md:block pc-side-decoration right" />

      {/* 9:16 video container for smartphone-style content */}
      <div className="video-container-9-16 relative">
        <div className="video-glow-border" />
        <div
          id="debate-stage"
          className={`w-full h-full relative overflow-hidden flex flex-col transition-all bg-black/20 backdrop-blur-sm ${isRecording ? 'ring-4 ring-red-500 ring-inset' : ''}`}
        >
          {/* ステージ背景アニメーション */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse 80% 50% at 50% 30%, rgba(255,255,255,0.1) 0%, transparent 50%)',
              animation: 'stage-bg-float 15s ease-in-out infinite',
            }}
          />
          {/* 装飾的な背景効果 */}
          <div className="absolute inset-0 bg-grid-dark pointer-events-none opacity-50" />

          {/* 幾何学模様パターン */}
          <div className="pattern-hexagon" />

          {/* 星屑エフェクト */}
          <div className="sparkle-container" style={{ opacity: 0.15 }}>
            <div className="sparkle" />
            <div className="sparkle" />
            <div className="sparkle" />
            <div className="sparkle" />
            <div className="sparkle" />
            <div className="sparkle" />
          </div>

          {/* 流れる光のライン */}
          <div className="absolute inset-0 pointer-events-none" style={{ opacity: 0.1 }}>
            <div className="flowing-light-line" />
            <div className="flowing-light-line" />
            <div className="flowing-light-line" />
          </div>

          {/* コーナー装飾 */}
          <div className="corner-deco top-left" />
          <div className="corner-deco top-right" />
          <div className="corner-deco bottom-left" />
          <div className="corner-deco bottom-right" />

          {/* 回転する軌道線（装飾） */}
          <div className="absolute top-[20%] left-1/2 -translate-x-1/2 w-[200px] h-[200px] md:w-[260px] md:h-[260px] pointer-events-none">
            <div className="absolute inset-0 border-2 border-white/10 rounded-full animate-spin" style={{ animationDuration: '30s' }} />
            <div className="absolute inset-6 border border-white/5 rounded-full animate-spin" style={{ animationDuration: '20s', animationDirection: 'reverse' }} />
          </div>

          {/* Header */}
          <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
            {isRecording && (
              <span className="flex items-center gap-1 bg-red-600 text-white px-2 py-1 rounded-full text-xs font-bold">
                <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                REC
              </span>
            )}
            <button
              onClick={finishSession}
              className="glass text-white text-[10px] font-bold uppercase px-4 py-2 rounded-full hover:bg-white/20 transition-colors"
            >
              Skip
            </button>
          </div>

          {/* Countdown */}
          {countdown !== null && (
            <div className="absolute inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center backdrop-blur-md">
              <div className="relative">
                <div className="text-9xl font-display font-bold gradient-text animate-pulse">
                  {countdown === 0 ? 'GO!' : countdown}
                </div>
                {countdown > 0 && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-40 h-40 rounded-full border-4 border-red-500/50 animate-ping" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Main Content Area - 参照画像レイアウト */}
          <div className="flex-1 flex flex-col items-center justify-between pt-12 pb-8 px-4 relative z-10 safe-top">

            {/* 軌道リング（装飾） - 話者の背景 */}
            <div className="absolute top-[15%] left-1/2 -translate-x-1/2 pointer-events-none">
              <div className="w-[200px] h-[200px] md:w-[260px] md:h-[260px] border-2 border-white/10 rounded-full" />
              <div className="absolute inset-4 border border-white/5 rounded-full" />
            </div>

            {/* 話者 - 上部中央（大きく表示） - 瞬間表情切り替え */}
            <div className="flex flex-col items-center relative z-20">
              {activeSpeaker && (
                <div
                  className="flex flex-col items-center animate-in fade-in zoom-in duration-500"
                  key={`active-${activeSpeaker.id}`}
                >
                  {/* 大きな円形アバター - 表情スタック（瞬間切り替え）- サイズ拡大 */}
                  <div className={`relative w-36 h-36 md:w-44 md:h-44 rounded-full overflow-hidden border-4 ${activeStyle.borderColor} ${activeStyle.glowClass} animate-pulse-glow`}>
                    {/* アバターを囲む回転リング */}
                    <div className="avatar-ring-glow" />
                    {/* Expression Stack - すべての表情を重ねて配置、opacity切り替えで瞬間表示 */}
                    <div className="expression-stack">
                      {/* デフォルト（neutral）表情 */}
                      <div className={`expression-layer ${currentEmotion === 'neutral' || !activeSpeaker.expressions ? 'active' : ''}`}>
                        <img
                          src={activeSpeaker.avatarUrl}
                          className="w-full h-full object-cover"
                          alt={`${activeSpeaker.name} - neutral`}
                        />
                      </div>
                      {/* 各表情をプリロードして重ねて配置 */}
                      {activeSpeaker.expressions && (
                        <>
                          <div className={`expression-layer ${currentEmotion === 'positive' ? 'active' : ''}`}>
                            <img
                              src={activeSpeaker.expressions.positive || activeSpeaker.avatarUrl}
                              className="w-full h-full object-cover"
                              alt={`${activeSpeaker.name} - positive`}
                            />
                          </div>
                          <div className={`expression-layer ${currentEmotion === 'negative' ? 'active' : ''}`}>
                            <img
                              src={activeSpeaker.expressions.negative || activeSpeaker.avatarUrl}
                              className="w-full h-full object-cover"
                              alt={`${activeSpeaker.name} - negative`}
                            />
                          </div>
                        </>
                      )}
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
                  </div>
                  {/* 名前ラベル */}
                  <div className="mt-3 bg-white text-black px-4 py-1.5 rounded-full font-bold font-display uppercase text-sm shadow-lg">
                    {activeSpeaker.name}
                  </div>
                </div>
              )}
            </div>

            {/* 話す内容 - 中央 */}
            <div className="w-full max-w-md px-4 flex-shrink-0">
              {currentSpeaker && scriptRef.current[currentMessageIndex] && (
                <div className={`p-5 rounded-2xl shadow-2xl animate-in fade-in slide-in-from-top-2 duration-300 relative bg-gradient-to-br ${activeStyle.bgGradient} text-white`}>
                  {/* 上向きの三角形（吹き出し的な装飾） */}
                  <div className={`absolute -top-3 left-1/2 -translate-x-1/2 w-0 h-0 border-l-8 border-r-8 border-b-8 border-transparent border-b-current`}
                    style={{ borderBottomColor: currentSpeaker === 'moderator' ? '#9333ea' : currentSpeaker === 'user' ? '#2563eb' : '#dc2626' }} />

                  {/* テキスト */}
                  <p className="font-medium text-base md:text-lg leading-relaxed whitespace-pre-wrap text-center">
                    {scriptRef.current[currentMessageIndex].text}
                  </p>
                </div>
              )}
            </div>

            {/* 待機者 - 下部（スワップアニメーション） */}
            <div className="flex justify-center items-end relative pb-4 min-h-[120px]">
              {/* 軌道リング（装飾） */}
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[280px] h-[80px] pointer-events-none opacity-30">
                <div className="absolute inset-0 border border-white/20 rounded-full" style={{ transform: 'scaleY(0.3)' }} />
              </div>

              {/* 待機者リスト - アニメーション改善 */}
              <div className="flex justify-center items-end gap-8 md:gap-12">
                {waitingSpeakers.map((char, index) => {
                  // アニメーション遅延を追加
                  const animDelay = index * 100;

                  return (
                    <div
                      key={char.id}
                      className="flex flex-col items-center shrink-0 animate-in fade-in slide-in-from-bottom-4 duration-500"
                      style={{
                        animationDelay: `${animDelay}ms`,
                        opacity: 0.7,
                        filter: 'grayscale(0.2)',
                      }}
                    >
                      {/* 円形アバター - サイズ拡大で潰れ防止 */}
                      <div className="w-16 h-16 md:w-20 md:h-20 min-w-[64px] min-h-[64px] md:min-w-[80px] md:min-h-[80px] rounded-full overflow-hidden border-2 border-white/40 shadow-lg shrink-0 aspect-square">
                        <img
                          src={char.avatarUrl}
                          className="w-full h-full object-cover"
                          alt={char.name}
                        />
                      </div>
                      {/* 名前ラベル */}
                      <div className="mt-2 glass text-white/70 px-3 py-1 rounded-full text-[10px] font-bold font-display uppercase whitespace-nowrap">
                        {char.name}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
