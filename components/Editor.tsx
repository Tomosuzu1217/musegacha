
import React, { useState, useRef, useEffect } from 'react';
import { Question, Answer, NewspaperContent, NoteArticleContent, CharacterProfile, CharacterComment, SessionEndResult } from '../types';
import { generateNewspaperContent, generateCharacterComments, generateNoteArticle, CharacterInfo } from '../services/geminiService';
import Markdown from 'react-markdown';
import { storageService } from '../services/storageService';
import { DebateSession } from './DebateSession';
import { ImageSelector } from './ImageSelector';
import html2canvas from 'html2canvas';

interface EditorProps {
  question: Question;
  onClose: () => void;
}

// Defaults
const DEFAULT_USER = '/avatars/zenzen.jpg';

// Styles
const THEMES = [
  { id: 'paper', name: 'Paper', bg: 'bg-[#f4f1ea]', text: 'text-gray-900', border: 'border-gray-300' },
  { id: 'mono', name: 'Mono', bg: 'bg-white', text: 'text-black', border: 'border-black' },
  { id: 'night', name: 'Night', bg: 'bg-zinc-900', text: 'text-gray-100', border: 'border-gray-700' },
  { id: 'blue', name: 'Blueprint', bg: 'bg-blue-50', text: 'text-blue-900', border: 'border-blue-200' },
];

const FONTS = [
  { id: 'mincho', name: 'Mincho', class: 'font-serif' }, // Shippori Mincho via Google Fonts
  { id: 'gothic', name: 'Gothic', class: 'font-sans' }, // Zen Kaku Gothic
  { id: 'hand', name: 'Hand', class: 'font-[Yomogi]' }, // Yomogi
];

// Stage Background Themes for Playing View
const STAGE_THEMES = [
  { id: 'dark', name: 'Dark Studio', className: 'bg-debate-dark', preview: 'linear-gradient(135deg, #0f0f23, #1a1a2e, #16213e)' },
  { id: 'neon', name: 'Neon Glow', className: 'bg-gradient-to-br from-purple-900 via-slate-900 to-blue-900', preview: 'linear-gradient(135deg, #581c87, #0f172a, #1e3a8a)' },
  { id: 'galaxy', name: 'Galaxy', className: 'bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-900', preview: 'linear-gradient(180deg, #020617, #1e1b4b, #0f172a)' },
  { id: 'paper', name: 'Paper', className: 'bg-gradient-to-br from-amber-50 to-orange-50', preview: 'linear-gradient(135deg, #fffbeb, #fff7ed)' },
  { id: 'minimal', name: 'Minimal', className: 'bg-white', preview: 'linear-gradient(135deg, #ffffff, #f3f4f6)' },
  // 新規ステージ
  { id: 'sunset', name: 'Sunset Beach', className: 'bg-gradient-to-br from-orange-400 via-rose-500 to-purple-600', preview: 'linear-gradient(135deg, #fb923c, #f43f5e, #9333ea)' },
  { id: 'forest', name: 'Mystic Forest', className: 'bg-gradient-to-b from-emerald-900 via-green-800 to-teal-900', preview: 'linear-gradient(180deg, #064e3b, #166534, #134e4a)' },
  { id: 'cyber', name: 'Cyberpunk', className: 'bg-gradient-to-br from-fuchsia-600 via-violet-900 to-cyan-500', preview: 'linear-gradient(135deg, #c026d3, #4c1d95, #06b6d4)' },
  { id: 'cafe', name: 'Cozy Cafe', className: 'bg-gradient-to-br from-amber-800 via-orange-900 to-stone-800', preview: 'linear-gradient(135deg, #92400e, #7c2d12, #44403c)' },
];

export const Editor: React.FC<EditorProps> = ({ question, onClose }) => {
  const [mode, setMode] = useState<'setup' | 'debate' | 'article'>('setup');

  // Characters State
  const [userAvatar, setUserAvatar] = useState<string>(DEFAULT_USER);
  const [availableCharacters, setAvailableCharacters] = useState<CharacterProfile[]>([]);
  const [selectedHostId, setSelectedHostId] = useState<string>('');
  const [selectedGuestId, setSelectedGuestId] = useState<string>('');

  // Display helpers
  const hostChar = availableCharacters.find(c => c.id === selectedHostId);
  const guestChar = availableCharacters.find(c => c.id === selectedGuestId);

  const [articleData, setArticleData] = useState<NewspaperContent | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0); // 進捗率（0-100%）
  const [generationStatus, setGenerationStatus] = useState(''); // 現在の処理段階

  // Note Article State
  const [noteArticleData, setNoteArticleData] = useState<NoteArticleContent | null>(null);
  const [isGeneratingNote, setIsGeneratingNote] = useState(false);
  const [noteGenerationError, setNoteGenerationError] = useState<string | null>(null);
  const [articleTab, setArticleTab] = useState<'newspaper' | 'note'>('newspaper');
  const [sessionResult, setSessionResult] = useState<SessionEndResult | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // Stage Theme Selection
  const [selectedStageTheme, setSelectedStageTheme] = useState(() => {
    const savedId = localStorage.getItem('preferred_stage_theme');
    return STAGE_THEMES.find(t => t.id === savedId) || STAGE_THEMES[0];
  });

  const handleStageThemeChange = (theme: typeof STAGE_THEMES[number]) => {
    setSelectedStageTheme(theme);
    localStorage.setItem('preferred_stage_theme', theme.id);
  };

  // Card Customization (永続化対応)
  const [selectedTheme, setSelectedTheme] = useState(() => {
    const savedThemeId = localStorage.getItem('preferred_theme');
    return THEMES.find(t => t.id === savedThemeId) || THEMES[0];
  });
  const [selectedFont, setSelectedFont] = useState(() => {
    const savedFontId = localStorage.getItem('preferred_font');
    return FONTS.find(f => f.id === savedFontId) || FONTS[0];
  });
  const cardRef = useRef<HTMLDivElement>(null);

  // テーマ・フォント選択の永続化
  const handleThemeChange = (theme: typeof THEMES[number]) => {
    setSelectedTheme(theme);
    localStorage.setItem('preferred_theme', theme.id);
  };

  const handleFontChange = (font: typeof FONTS[number]) => {
    setSelectedFont(font);
    localStorage.setItem('preferred_font', font.id);
  };

  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sourceStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number>(0);

  useEffect(() => {
    // Load configured characters
    const allChars = storageService.getCharacterProfiles();
    setAvailableCharacters(allChars);

    const config = storageService.getPersonaConfig();

    // Validate IDs exist, otherwise fallback to defaults/first available
    const validHostId = allChars.find(c => c.id === config.moderatorId)?.id || allChars[0]?.id || '';
    const validGuestId = allChars.find(c => c.id === config.commentatorId)?.id || allChars[1]?.id || '';

    setSelectedHostId(validHostId);
    setSelectedGuestId(validGuestId);

    return () => stopRecordingLogic();
  }, []);

  // Update storage when selection changes so DebateSession picks it up
  const handleHostChange = (id: string) => {
    setSelectedHostId(id);
    const currentConfig = storageService.getPersonaConfig();
    storageService.savePersonaConfig({ ...currentConfig, moderatorId: id });
  };

  const handleGuestChange = (id: string) => {
    setSelectedGuestId(id);
    const currentConfig = storageService.getPersonaConfig();
    storageService.savePersonaConfig({ ...currentConfig, commentatorId: id });
  };

  const toggleRecording = async () => {
    if (isRecording) stopRecording();
    else await startRecording();
  };

  const startRecording = async () => {
    try {
      if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        alert("iPhoneでの画面収録は、ブラウザの制限により動作しない場合があります。\n画面収録を開始すると、放送の許可を求められます。");
      } else {
        alert("【録画の手順】\n1. 次の画面で「現在のタブ」または「画面全体」を選択してください。");
      }

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser', frameRate: 30 },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      sourceStreamRef.current = displayStream;

      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: true }
        });
        micStreamRef.current = micStream;
      } catch (e) {
        console.warn("Mic access denied");
      }

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      audioContextRef.current = audioCtx;
      const dest = audioCtx.createMediaStreamDestination();

      if (displayStream.getAudioTracks().length > 0) {
        const sysSource = audioCtx.createMediaStreamSource(displayStream);
        sysSource.connect(dest);
      }
      if (micStream && micStream.getAudioTracks().length > 0) {
        const micSource = audioCtx.createMediaStreamSource(micStream);
        micSource.connect(dest);
      }

      const canvas = document.createElement('canvas');
      canvas.width = 405;
      canvas.height = 720;
      canvasRef.current = canvas;
      const ctx = canvas.getContext('2d');

      const video = document.createElement('video');
      video.srcObject = displayStream;
      video.muted = true;
      video.play();

      const draw = () => {
        if (!ctx || video.paused || video.ended) return;
        const stageElement = document.getElementById('debate-stage');

        if (stageElement) {
          const rect = stageElement.getBoundingClientRect();
          ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, 0, 0, canvas.width, canvas.height);
        } else {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        animationFrameRef.current = requestAnimationFrame(draw);
      };
      video.onloadedmetadata = () => draw();

      const canvasStream = canvas.captureStream(30);
      if (dest.stream.getAudioTracks().length > 0) {
        dest.stream.getAudioTracks().forEach(track => canvasStream.addTrack(track));
      } else {
        displayStream.getAudioTracks().forEach(track => canvasStream.addTrack(track));
      }

      const recorder = new MediaRecorder(canvasStream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 2500000
      });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        saveVideo();
        cleanupRecording();
      };

      recorder.start();
      setIsRecording(true);

      displayStream.getVideoTracks()[0].onended = () => {
        if (recorder.state !== 'inactive') recorder.stop();
      };
    } catch (err: any) {
      console.warn('Rec failed', err);
      cleanupRecording();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const stopRecordingLogic = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    cleanupRecording();
  };

  const cleanupRecording = () => {
    if (sourceStreamRef.current) {
      sourceStreamRef.current.getTracks().forEach(t => t.stop());
      sourceStreamRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    setIsRecording(false);
  };

  const saveVideo = () => {
    if (chunksRef.current.length === 0) return;
    const blob = new Blob(chunksRef.current, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `musegacha-reel-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const [isSavingImage, setIsSavingImage] = useState(false);

  const handleQED = async () => {
    if (!cardRef.current || isSavingImage) return;
    setIsSavingImage(true);
    try {
      const canvas = await html2canvas(cardRef.current, {
        scale: 2, // High resolution
        useCORS: true,
        backgroundColor: null
      });

      const image = canvas.toDataURL("image/png");
      const link = document.createElement('a');
      link.href = image;
      link.download = `MUSE-QED-${Date.now()}.png`;
      link.click();
    } catch (e) {
      console.error("Image capture failed", e);
      alert("画像の保存に失敗しました。");
    } finally {
      setIsSavingImage(false);
    }
  };

  const handleSessionEnd = async (result: SessionEndResult) => {
    if (isRecording) stopRecording();
    setMode('article');
    setSessionResult(result); // Store for lazy note article generation
    setIsGenerating(true);
    setGenerationProgress(0);
    setGenerationStatus('セッション内容を分析中...');

    try {
      // 進捗20%: 分析開始
      setGenerationProgress(20);
      setGenerationStatus('レポートを生成中...');

      // Use character info from the actual debate session
      const characterInfos: CharacterInfo[] = [
        { name: result.moderatorName, avatarUrl: result.moderatorAvatarUrl, role: 'host', persona: result.moderatorPersona },
        { name: result.commentatorName, avatarUrl: result.commentatorAvatarUrl, role: 'guest', persona: result.commentatorPersona },
        { name: 'ZENZEN', avatarUrl: userAvatar, role: 'user', persona: '発言者本人。個人的な気づきや学びを述べる。' },
      ];

      // 進捗50%: 記事生成
      setGenerationProgress(50);
      const content = await generateNewspaperContent(question.text, result.transcript);

      // 進捗80%: コメント生成
      setGenerationProgress(80);
      setGenerationStatus('キャラクターの感想を生成中...');
      const comments = await generateCharacterComments(question.text, result.transcript, characterInfos);

      // 感想をcontentに追加
      const contentWithComments: NewspaperContent = {
        ...content,
        comments,
      };
      setArticleData(contentWithComments);

      // 進捗100%: 完了
      setGenerationProgress(100);
      setGenerationStatus('完了');

      const answer: Answer = {
        id: crypto.randomUUID(),
        questionId: question.id,
        questionText: question.text,
        draft: result.transcript,
        final: content.body,
        format: 'blog',
        createdAt: Date.now(),
      };
      storageService.saveAnswer(answer);
      storageService.markAsUsed(question.id);

    } catch (e) {
      console.error(e);
      setGenerationStatus('エラーが発生しました');
      alert('記事生成に失敗しました');
    } finally {
      setIsGenerating(false);
    }
  };

  // Note Article Lazy Generation
  const handleGenerateNoteArticle = async () => {
    if (!sessionResult || noteArticleData || isGeneratingNote) return;

    setIsGeneratingNote(true);
    setNoteGenerationError(null);

    try {
      const content = await generateNoteArticle(question.text, sessionResult.transcript);
      setNoteArticleData(content);
    } catch (e) {
      console.error('Note article generation failed:', e);
      setNoteGenerationError('note記事の生成に失敗しました。再試行してください。');
    } finally {
      setIsGeneratingNote(false);
    }
  };

  const handleTabSwitch = (tab: 'newspaper' | 'note') => {
    setArticleTab(tab);
    if (tab === 'note' && !noteArticleData && !isGeneratingNote) {
      handleGenerateNoteArticle();
    }
  };

  const handleCopyNoteArticle = async () => {
    if (!noteArticleData) return;

    let fullText = `# ${noteArticleData.title}\n\n`;
    for (const section of noteArticleData.sections) {
      fullText += `## ${section.title}\n\n${section.body}\n\n`;
    }

    try {
      await navigator.clipboard.writeText(fullText);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (e) {
      console.error('Copy failed:', e);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-white relative">

      {/* Condensed Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-black bg-white z-50 shrink-0">
        <div className="font-mono text-[10px] uppercase text-gray-500 truncate max-w-[60%]">
          {question.text}
        </div>

        <div className="flex items-center gap-3">
          {mode === 'debate' && (
            <button
              onClick={toggleRecording}
              className={`w-8 h-8 rounded-full flex items-center justify-center border transition-all ${isRecording
                ? 'bg-red-600 border-red-600 animate-pulse'
                : 'bg-white text-black border-black'
                }`}
            >
              <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-white' : 'bg-red-600'}`}></div>
            </button>
          )}
          <button onClick={onClose} className="px-3 py-1 bg-black text-white text-xs font-bold uppercase rounded-sm">Close</button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 relative overflow-hidden flex flex-col bg-gray-50">

        {mode === 'setup' && (
          <div className="absolute inset-0 flex flex-col overflow-hidden">
            {/* 背景プレビュー（ぼかし+アニメーション） */}
            <div
              className="absolute inset-0 transition-all duration-700 ease-out"
              style={{
                background: selectedStageTheme.preview,
                filter: 'blur(20px)',
                opacity: 0.6,
                transform: 'scale(1.1)',
                animation: 'stage-bg-float 20s ease-in-out infinite',
              }}
            />
            {/* オーバーレイ */}
            <div className="absolute inset-0 bg-gradient-to-b from-white/80 via-white/60 to-white/80" />

            {/* コンテンツ */}
            <div className="relative z-10 flex-1 overflow-y-auto pb-20" style={{ WebkitOverflowScrolling: 'touch' }}>
              <div className="p-6 text-center">
                <h3 className="font-display text-2xl font-bold uppercase mb-2">ステージ選択</h3>
                <p className="font-mono text-xs text-gray-600">
                  セッションの背景テーマを選んでください
                </p>
              </div>

              <div className="px-4 flex-1">
                {/* STAGE THEME SELECTION - 拡大版 */}
                <div className="grid grid-cols-3 gap-3">
                  {STAGE_THEMES.map(theme => (
                    <button
                      key={theme.id}
                      onClick={() => handleStageThemeChange(theme)}
                      className={`flex flex-col items-center p-3 rounded-xl border-2 transition-all ${selectedStageTheme.id === theme.id
                        ? 'border-black shadow-xl scale-105 bg-white/90'
                        : 'border-white/50 hover:border-gray-300 bg-white/70 hover:bg-white/80'
                        }`}
                    >
                      {/* プレビュー */}
                      <div
                        className="w-full aspect-video rounded-lg border border-gray-200 overflow-hidden relative"
                        style={{ background: theme.preview }}
                      >
                        {/* ステージシルエット */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <div className="w-6 h-6 rounded-full bg-white/40 border-2 border-white/60 shadow-lg" />
                          <div className="w-10 h-2 mt-1.5 rounded-full bg-white/30" />
                        </div>
                        {/* 選択マーク */}
                        {selectedStageTheme.id === theme.id && (
                          <div className="absolute top-1 right-1 w-5 h-5 bg-black rounded-full flex items-center justify-center">
                            <span className="text-white text-xs">✓</span>
                          </div>
                        )}
                      </div>
                      {/* テーマ名 */}
                      <span className={`text-xs font-medium mt-2 truncate w-full text-center ${selectedStageTheme.id === theme.id ? 'text-black font-bold' : 'text-gray-600'
                        }`}>
                        {theme.name}
                      </span>
                    </button>
                  ))}
                </div>

                {/* プレビュー表示エリア */}
                <div className="mt-6 p-4 rounded-2xl bg-white/80 border border-gray-200 shadow-lg backdrop-blur-sm">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">プレビュー</div>
                  <div
                    className="w-full aspect-video rounded-xl overflow-hidden relative shadow-inner"
                    style={{ background: selectedStageTheme.preview }}
                  >
                    {/* アニメーション効果 */}
                    <div
                      className="absolute inset-0"
                      style={{
                        background: 'radial-gradient(circle at 30% 50%, rgba(255,255,255,0.15) 0%, transparent 50%)',
                        animation: 'stage-glow-pulse 4s ease-in-out infinite',
                      }}
                    />
                    {/* ステージイメージ */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="flex gap-4 items-end">
                        <div className="flex flex-col items-center">
                          <div className="w-10 h-10 rounded-full bg-white/30 border-2 border-white/50" />
                          <div className="w-12 h-1.5 mt-2 rounded bg-white/20" />
                        </div>
                        <div className="flex flex-col items-center">
                          <div className="w-14 h-14 rounded-full bg-white/40 border-2 border-white/60 shadow-lg" />
                          <div className="w-16 h-2 mt-2 rounded bg-white/30" />
                        </div>
                        <div className="flex flex-col items-center">
                          <div className="w-10 h-10 rounded-full bg-white/30 border-2 border-white/50" />
                          <div className="w-12 h-1.5 mt-2 rounded bg-white/20" />
                        </div>
                      </div>
                    </div>
                    {/* ステージ名オーバーレイ */}
                    <div className="absolute bottom-2 left-0 right-0 text-center">
                      <span className="px-3 py-1 bg-black/50 rounded-full text-white text-xs font-medium backdrop-blur-sm">
                        {selectedStageTheme.name}
                      </span>
                    </div>
                  </div>
                </div>

                <p className="text-center text-xs text-gray-500 mt-4">
                  ※ キャラクターは次の画面で選択できます
                </p>
              </div>

              <div className="p-6 mt-auto">
                <button
                  onClick={() => setMode('debate')}
                  className="w-full py-5 bg-black text-white font-display font-bold text-lg uppercase tracking-widest shadow-lg rounded-lg active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  <span>次へ</span>
                  <span className="text-xl">→</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {mode === 'debate' && (
          <DebateSession
            question={question}
            userAvatar={userAvatar}
            hostAvatar={hostChar?.avatarUrl || ''}
            guestAvatar={guestChar?.avatarUrl || ''}
            onSessionEnd={handleSessionEnd}
            isRecording={isRecording}
            stageTheme={selectedStageTheme.className}
          />
        )}

        {mode === 'article' && (
          <div className="flex-1 overflow-y-auto bg-gray-100 flex flex-col">
            {isGenerating ? (
              <div className="h-full flex flex-col items-center justify-center px-6">
                {/* 進捗円形表示 */}
                <div className="relative w-24 h-24 mb-6">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                    <path
                      className="text-gray-200"
                      strokeDasharray="100, 100"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    />
                    <path
                      className="text-black transition-all duration-500 ease-out"
                      strokeDasharray={`${generationProgress}, 100`}
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="font-display text-2xl font-bold">{generationProgress}%</span>
                  </div>
                </div>

                {/* ステータス */}
                <p className="font-display text-lg font-bold uppercase tracking-widest mb-2">
                  {generationStatus}
                </p>

                {/* 段階表示 */}
                <div className="flex items-center gap-2 mt-4">
                  <div className={`w-3 h-3 rounded-full ${generationProgress >= 20 ? 'bg-black' : 'bg-gray-300'}`} />
                  <div className={`w-8 h-0.5 ${generationProgress >= 50 ? 'bg-black' : 'bg-gray-300'}`} />
                  <div className={`w-3 h-3 rounded-full ${generationProgress >= 50 ? 'bg-black' : 'bg-gray-300'}`} />
                  <div className={`w-8 h-0.5 ${generationProgress >= 80 ? 'bg-black' : 'bg-gray-300'}`} />
                  <div className={`w-3 h-3 rounded-full ${generationProgress >= 80 ? 'bg-black' : 'bg-gray-300'}`} />
                  <div className={`w-8 h-0.5 ${generationProgress >= 100 ? 'bg-black' : 'bg-gray-300'}`} />
                  <div className={`w-3 h-3 rounded-full ${generationProgress >= 100 ? 'bg-black' : 'bg-gray-300'}`} />
                </div>
                <div className="flex gap-6 mt-2 text-[9px] uppercase font-bold text-gray-500">
                  <span>分析</span>
                  <span>生成</span>
                  <span>感想</span>
                  <span>完了</span>
                </div>
              </div>
            ) : articleData && (
              <div className="flex flex-col items-center p-4 min-h-full">

                {/* Tab Bar */}
                <div className="w-full max-w-sm mb-4 flex bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  <button
                    onClick={() => handleTabSwitch('newspaper')}
                    className={`flex-1 py-3 text-sm font-bold transition-colors ${
                      articleTab === 'newspaper'
                        ? 'bg-black text-white'
                        : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    新聞カード
                  </button>
                  <button
                    onClick={() => handleTabSwitch('note')}
                    className={`flex-1 py-3 text-sm font-bold transition-colors ${
                      articleTab === 'note'
                        ? 'bg-black text-white'
                        : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    note記事
                  </button>
                </div>

                {/* Newspaper Tab */}
                {articleTab === 'newspaper' && (
                  <>
                    {/* Customization Controls */}
                    <div className="w-full max-w-sm mb-6 bg-white p-3 rounded-lg shadow-sm border border-gray-200">
                      <div className="mb-3">
                        <label className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Background</label>
                        <div className="flex gap-2 overflow-x-auto no-scrollbar">
                          {THEMES.map(theme => (
                            <button
                              key={theme.id}
                              onClick={() => handleThemeChange(theme)}
                              className={`w-8 h-8 rounded-full border-2 flex-shrink-0 ${theme.bg} ${selectedTheme.id === theme.id ? 'border-black ring-1 ring-black' : 'border-transparent'}`}
                            />
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Font</label>
                        <div className="flex gap-2">
                          {FONTS.map(font => (
                            <button
                              key={font.id}
                              onClick={() => handleFontChange(font)}
                              className={`px-2 py-1 text-[10px] border rounded ${selectedFont.id === font.id ? 'bg-black text-white border-black' : 'bg-gray-50 text-gray-600 border-gray-200'}`}
                            >
                              {font.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Capture Card Area */}
                    <div className="w-full max-w-sm flex-1 flex items-center justify-center mb-6">
                      <div
                        ref={cardRef}
                        className={`w-full aspect-[4/5] ${selectedTheme.bg} ${selectedTheme.text} p-8 flex flex-col relative shadow-xl overflow-hidden`}
                        style={{
                          backgroundImage: selectedTheme.id === 'paper' ? `url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm-43-7c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm63 31c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM34 90c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm56-76c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM12 86c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm28-65c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm23-11c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-6 60c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm29 22c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zM32 63c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm57-13c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-9-21c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM60 91c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM35 41c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM12 60c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2z' fill='%23000000' fill-opacity='0.03' fill-rule='evenodd'/%3E%3C/svg%3E")` : undefined
                        }}
                      >
                        {/* Watermark/Grid overlay */}
                        <div className={`absolute inset-0 border-[16px] ${selectedTheme.border} opacity-50 pointer-events-none`}></div>

                        <div className="flex-1 flex flex-col justify-center">
                          <div className="mb-4 pb-3 border-b border-current opacity-80">
                            <h2 className={`${selectedFont.class} text-lg font-bold leading-tight mb-1`}>
                              {articleData.headline}
                            </h2>
                            <p className="font-mono text-[9px] uppercase opacity-60 tracking-widest">
                              {articleData.lead}
                            </p>
                          </div>

                          <p className={`${selectedFont.class} text-sm leading-7 whitespace-pre-wrap mb-4 opacity-90`}>
                            {articleData.body}
                          </p>

                          {/* 3人の感想セクション */}
                          {articleData.comments && articleData.comments.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-current/20 space-y-3">
                              {articleData.comments.map((comment, index) => (
                                <div key={index} className="flex items-start gap-3">
                                  <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-current/30 shrink-0 shadow-sm">
                                    {comment.avatarUrl ? (
                                      <img src={comment.avatarUrl} className="w-full h-full object-cover" alt={comment.name} />
                                    ) : (
                                      <div className="w-full h-full bg-current/10 flex items-center justify-center text-sm font-bold">
                                        {comment.name.charAt(0)}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <span className="text-[10px] font-bold opacity-80">{comment.name}</span>
                                    <p className="text-[10px] leading-snug opacity-70 mt-0.5">
                                      {comment.comment}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="mt-4 pt-3 flex justify-between items-end opacity-60 font-mono text-[9px]">
                          <div className="flex flex-col">
                            <span>MUSE</span>
                            <span>GACHA</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={handleQED}
                      disabled={isSavingImage}
                      className="w-full max-w-sm py-5 bg-black text-white font-display font-bold text-2xl uppercase tracking-widest shadow-xl rounded-lg active:scale-[0.98] transition-all hover:bg-gray-900 disabled:opacity-50"
                    >
                      {isSavingImage ? 'Saving...' : 'Save Image'}
                    </button>
                  </>
                )}

                {/* Note Article Tab */}
                {articleTab === 'note' && (
                  <div className="w-full max-w-2xl pb-8">
                    {isGeneratingNote ? (
                      <div className="flex flex-col items-center justify-center py-20">
                        <div className="w-12 h-12 border-4 border-gray-300 border-t-black rounded-full animate-spin mb-4" />
                        <p className="font-display text-sm font-bold uppercase tracking-widest text-gray-600">
                          note記事を生成中...
                        </p>
                        <p className="text-xs text-gray-400 mt-2">
                          4000〜5000文字の長文記事を生成しています
                        </p>
                      </div>
                    ) : noteGenerationError ? (
                      <div className="flex flex-col items-center justify-center py-20">
                        <p className="text-red-600 text-sm mb-4">{noteGenerationError}</p>
                        <button
                          onClick={() => { setNoteArticleData(null); handleGenerateNoteArticle(); }}
                          disabled={isGeneratingNote}
                          className="px-6 py-2 bg-black text-white text-sm font-bold rounded-lg hover:bg-gray-900 transition-colors disabled:opacity-50"
                        >
                          {isGeneratingNote ? '生成中...' : '再試行'}
                        </button>
                      </div>
                    ) : noteArticleData ? (
                      <>
                        <div className={`bg-white rounded-lg shadow-lg p-6 md:p-10 ${selectedFont.class}`}>
                          {/* Article Title */}
                          <h1 className="text-xl md:text-2xl font-bold leading-tight mb-6 pb-4 border-b border-gray-200">
                            {noteArticleData.title}
                          </h1>

                          {/* Sections */}
                          {noteArticleData.sections.map((section, index) => (
                            <div key={index} className="mb-8">
                              <h2 className="text-base md:text-lg font-bold mb-3 text-gray-800 flex items-center gap-2">
                                <span className="w-1 h-5 bg-black rounded-full inline-block flex-shrink-0" />
                                {section.title}
                              </h2>
                              <div className="prose prose-sm max-w-none prose-p:leading-relaxed prose-p:text-gray-700 prose-p:mb-3 prose-strong:text-black prose-strong:font-bold text-sm leading-7 text-gray-700">
                                <Markdown>{section.body}</Markdown>
                              </div>
                            </div>
                          ))}

                          {/* Footer */}
                          <div className="mt-8 pt-4 border-t border-gray-200 flex items-center justify-between">
                            <span className="font-mono text-[10px] uppercase text-gray-400">
                              MUSE GACHA - note記事
                            </span>
                            <span className="font-mono text-[10px] text-gray-400">
                              {noteArticleData.sections.reduce((sum, s) => sum + s.body.length, 0)}文字
                            </span>
                          </div>
                        </div>

                        {/* Copy Button */}
                        <button
                          onClick={handleCopyNoteArticle}
                          className={`w-full mt-6 py-4 font-display font-bold text-lg uppercase tracking-widest shadow-xl rounded-lg active:scale-[0.98] transition-all ${
                            copySuccess
                              ? 'bg-green-600 text-white'
                              : 'bg-black text-white hover:bg-gray-900'
                          }`}
                        >
                          {copySuccess ? 'Copied!' : 'Copy Text'}
                        </button>
                      </>
                    ) : null}
                  </div>
                )}

              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
