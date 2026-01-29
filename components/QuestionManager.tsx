
import React, { useState, useEffect } from 'react';
import { Question, Difficulty, PRESET_TAGS, PersonaConfig, CharacterProfile } from '../types';
import { storageService } from '../services/storageService';
import { generateQuestions, extractQuestionsFromUrl, classifyApiError } from '../services/geminiService';
import { ImageSelector } from './ImageSelector';

const VOICE_OPTIONS = [
  { value: 'Kore', label: 'Kore (女性 / 落ち着き)' },
  { value: 'Fenrir', label: 'Fenrir (男性 / 深み)' },
  { value: 'Puck', label: 'Puck (男性 / 軽快)' },
  { value: 'Charon', label: 'Charon (男性 / 威厳)' },
  { value: 'Zephyr', label: 'Zephyr (女性 / 穏やか)' },
  { value: 'Aoede', label: 'Aoede (女性 / 優雅)' },
];

const TABS = [
  { id: 'manual', label: '手動追加' },
  { id: 'ai', label: 'AI生成' },
  { id: 'url', label: 'URL読込' },
  { id: 'personas', label: 'キャラ設定' }
] as const;

export const QuestionManager: React.FC = () => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeTab, setActiveTab] = useState<typeof TABS[number]['id']>('manual');
  
  // Manual Form State
  const [newText, setNewText] = useState('');
  const [newSource, setNewSource] = useState('');
  const [newDifficulty, setNewDifficulty] = useState<Difficulty>('normal');
  const [newTags, setNewTags] = useState<string[]>([]);

  // AI Gen State
  const [aiTopic, setAiTopic] = useState('');
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // URL Import State
  const [targetUrl, setTargetUrl] = useState('');
  const [isUrlExtracting, setIsUrlExtracting] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  // Persona State
  const [personaConfig, setPersonaConfig] = useState<PersonaConfig>({ moderatorId: '', commentatorId: '' });
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [editingChar, setEditingChar] = useState<CharacterProfile | null>(null); // If null, list mode. If set, edit mode.
  const [isEditingNew, setIsEditingNew] = useState(false);

  useEffect(() => {
    loadQuestions();
    loadPersonaData();
  }, []);

  const loadQuestions = () => {
    setQuestions(storageService.getQuestions());
  };

  const loadPersonaData = () => {
      setPersonaConfig(storageService.getPersonaConfig());
      setCharacters(storageService.getCharacterProfiles());
  };

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;

    const q: Question = {
      id: crypto.randomUUID(),
      text: newText,
      source: newSource || 'Self',
      tags: newTags.length > 0 ? newTags : ['General'],
      difficulty: newDifficulty,
      createdAt: Date.now(),
    };

    storageService.addQuestion(q);
    loadQuestions();
    
    setNewText('');
    setNewSource('');
    setNewTags([]);
    setNewDifficulty('normal');
  };

  const handleAiGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiTopic.trim()) return;

    setIsAiGenerating(true);
    setAiError(null);

    try {
      const generatedData = await generateQuestions(aiTopic);
      saveGeneratedQuestions(generatedData, aiTopic);
      setAiTopic('');
    } catch (err: any) {
      const classified = classifyApiError(err);
      setAiError(classified.userMessage);
    } finally {
      setIsAiGenerating(false);
    }
  };

  const handleUrlExtract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUrl.trim()) return;

    setIsUrlExtracting(true);
    setUrlError(null);

    // URL検証
    if (!isValidHttpUrl(targetUrl)) {
      setUrlError('有効なHTTP/HTTPS URLを入力してください。');
      setIsUrlExtracting(false);
      return;
    }

    try {
      const extractedData = await extractQuestionsFromUrl(targetUrl);
      saveGeneratedQuestions(extractedData, 'URL Import');
      setTargetUrl('');
    } catch (err: any) {
      const classified = classifyApiError(err);
      setUrlError(classified.userMessage);
    } finally {
      setIsUrlExtracting(false);
    }
  };

  // URL検証ユーティリティ
  const isValidHttpUrl = (str: string): boolean => {
    try {
      const url = new URL(str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const saveGeneratedQuestions = (data: Partial<Question>[], defaultTag: string) => {
    const newQuestions: Question[] = data.map(d => ({
      id: crypto.randomUUID(),
      text: d.text || 'Untitled Question',
      source: d.source || 'AI',
      tags: d.tags && d.tags.length > 0 ? d.tags : [defaultTag],
      difficulty: (d.difficulty as Difficulty) || 'normal',
      createdAt: Date.now()
    }));

    storageService.addQuestionsBatch(newQuestions);
    loadQuestions();
  };

  const handleDelete = (id: string) => {
    if (confirm('この質問を削除しますか？')) {
      storageService.deleteQuestion(id);
      loadQuestions();
    }
  };

  const toggleTag = (tag: string) => {
    if (newTags.includes(tag)) {
      setNewTags(newTags.filter(t => t !== tag));
    } else {
      setNewTags([...newTags, tag]);
    }
  };

  // --- Character Logic ---

  const handleSaveConfig = () => {
    storageService.savePersonaConfig(personaConfig);
    alert('配役を保存しました。');
  };

  const startEditCharacter = (char?: CharacterProfile) => {
      if (char) {
          setEditingChar({...char});
          setIsEditingNew(false);
      } else {
          setEditingChar({
              id: crypto.randomUUID(),
              name: '',
              avatarUrl: '',
              voiceName: 'Kore',
              persona: '',
              pitch: 1.0,
          });
          setIsEditingNew(true);
      }
  };

  const saveCharacter = () => {
      if (!editingChar || !editingChar.name) return;
      storageService.saveCharacterProfile(editingChar);
      loadPersonaData();
      setEditingChar(null);
  };

  const deleteCharacter = (id: string) => {
      if (confirm('本当にこのキャラクターを削除しますか？')) {
          storageService.deleteCharacterProfile(id);
          loadPersonaData();
      }
  };

  // 質問エクスポート機能
  const exportQuestions = (format: 'json' | 'csv') => {
    if (questions.length === 0) {
      alert('エクスポートする質問がありません。');
      return;
    }

    if (format === 'json') {
      const data = JSON.stringify(questions, null, 2);
      downloadBlob(new Blob([data], { type: 'application/json' }), `questions-${Date.now()}.json`);
    } else {
      const header = 'text,source,difficulty,tags\n';
      const csv = questions.map(q =>
        `"${q.text.replace(/"/g, '""')}","${q.source}","${q.difficulty}","${q.tags.join(';')}"`
      ).join('\n');
      downloadBlob(new Blob([header + csv], { type: 'text/csv' }), `questions-${Date.now()}.csv`);
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      
      {/* Tab Switcher */}
      <div className="flex w-full border-b border-gray-200 overflow-x-auto no-scrollbar snap-x">
        {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as any)}
              className={`flex-none px-6 py-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-colors whitespace-nowrap snap-start ${
                activeTab === t.id ? 'border-black text-black' : 'border-transparent text-gray-400'
              }`}
            >
              {t.label}
            </button>
        ))}
      </div>

      <div className="px-1">
      {activeTab === 'manual' && (
        <div className="bg-white border border-black p-6 rounded-lg shadow-sm">
          <form onSubmit={handleManualAdd} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider mb-2">質問 (Question)</label>
              <textarea
                required
                rows={3}
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                className="w-full bg-white border border-gray-200 p-3 outline-none focus:border-black rounded-sm text-black"
                placeholder="質問を入力してください..."
              />
            </div>
            {/* ... other manual fields ... */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider mb-2">出典 (Source)</label>
                <input
                  type="text"
                  value={newSource}
                  onChange={(e) => setNewSource(e.target.value)}
                  className="w-full bg-white border border-gray-200 p-2 text-sm rounded-sm text-black"
                  placeholder="例: 自己内省, 本のタイトル"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider mb-2">難易度 (Level)</label>
                <select
                  value={newDifficulty}
                  onChange={(e) => setNewDifficulty(e.target.value as Difficulty)}
                  className="w-full bg-white border border-gray-200 p-2 text-sm rounded-sm text-black"
                >
                  <option value="light">軽い (Light)</option>
                  <option value="normal">普通 (Normal)</option>
                  <option value="heavy">重い (Heavy)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider mb-2">タグ (Tags)</label>
              <div className="flex flex-wrap gap-2">
                {PRESET_TAGS.map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`px-3 py-1 text-[9px] uppercase font-bold border rounded-full transition-all ${
                      newTags.includes(tag)
                        ? 'bg-black text-white border-black'
                        : 'bg-white text-gray-400 border-gray-200'
                  }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-black text-white py-4 font-bold uppercase tracking-widest rounded-lg shadow-md active:scale-95 transition-all"
            >
              質問を追加
            </button>
          </form>
        </div>
      )}

      {activeTab === 'ai' && (
        <div className="border border-black p-6 bg-gray-50 rounded-lg shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-bold font-display uppercase">Generate by AI</h2>
            <p className="text-xs text-gray-500">トピックを入力して5つの質問を生成します。</p>
          </div>

          <form onSubmit={handleAiGenerate} className="space-y-4">
            <input
              type="text"
              required
              value={aiTopic}
              onChange={(e) => setAiTopic(e.target.value)}
              className="w-full bg-white border border-gray-300 p-3 rounded-sm text-black"
              placeholder="トピック (例: リモートワークの課題)"
            />
            
            <button
              type="submit"
              disabled={isAiGenerating}
              className="w-full bg-black text-white py-4 font-bold uppercase tracking-widest rounded-lg disabled:opacity-50"
            >
              {isAiGenerating ? '生成中...' : '生成する'}
            </button>
            {aiError && <p className="text-red-600 text-xs">{aiError}</p>}
          </form>
        </div>
      )}

      {activeTab === 'url' && (
        <div className="border border-black p-6 bg-gray-50 rounded-lg shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-bold font-display uppercase">Import from URL</h2>
            <p className="text-xs text-gray-500">記事のURLから質問を抽出・生成します。</p>
          </div>

          <form onSubmit={handleUrlExtract} className="space-y-4">
            <input
              type="url"
              required
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              className="w-full bg-white border border-gray-300 p-3 rounded-sm text-black"
              placeholder="https://example.com/article (例: ブログ記事のURL)"
            />
            
            <button
              type="submit"
              disabled={isUrlExtracting}
              className="w-full bg-black text-white py-4 font-bold uppercase tracking-widest rounded-lg disabled:opacity-50"
            >
              {isUrlExtracting ? '解析中...' : '抽出する'}
            </button>
            {urlError && <p className="text-red-600 text-xs">{urlError}</p>}
          </form>
        </div>
      )}

      {activeTab === 'personas' && (
          <div className="space-y-8">
               {/* 1. CASTING SECTION */}
               <div className="p-6 bg-white border-2 border-black rounded-xl shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)]">
                   <h3 className="font-display font-bold text-xl mb-4 flex items-center gap-2">
                       <span className="bg-black text-white px-2 text-sm py-0.5">ROLE</span>
                       配役設定 (CASTING)
                   </h3>
                   <div className="space-y-4">
                       <div>
                           <label className="block text-[10px] font-bold uppercase tracking-wider mb-2 text-gray-500">
                               司会・進行役 (MODERATOR)
                           </label>
                           <select 
                             value={personaConfig.moderatorId}
                             onChange={e => setPersonaConfig(prev => ({...prev, moderatorId: e.target.value}))}
                             className="w-full p-3 bg-white border border-gray-300 rounded-lg text-black font-bold focus:border-black outline-none"
                           >
                               {characters.map(c => (
                                   <option key={c.id} value={c.id}>{c.name}</option>
                               ))}
                           </select>
                       </div>
                       <div>
                           <label className="block text-[10px] font-bold uppercase tracking-wider mb-2 text-gray-500">
                               コメンテーター (GUEST)
                           </label>
                           <select 
                             value={personaConfig.commentatorId}
                             onChange={e => setPersonaConfig(prev => ({...prev, commentatorId: e.target.value}))}
                             className="w-full p-3 bg-white border border-gray-300 rounded-lg text-black font-bold focus:border-black outline-none"
                           >
                               {characters.map(c => (
                                   <option key={c.id} value={c.id}>{c.name}</option>
                               ))}
                           </select>
                       </div>
                   </div>
                   <button 
                     onClick={handleSaveConfig}
                     className="mt-6 w-full py-3 bg-black text-white font-bold uppercase tracking-widest rounded-lg hover:bg-gray-800 transition-colors"
                   >
                     配役を保存
                   </button>
               </div>

               {/* 2. LIBRARY SECTION */}
               <div className="border-t border-gray-200 pt-8">
                   <div className="flex justify-between items-end mb-6">
                       <h3 className="font-display font-bold text-xl uppercase tracking-tight">キャラクターリスト</h3>
                       <button 
                         onClick={() => startEditCharacter()}
                         className="text-xs font-bold uppercase bg-black text-white px-4 py-2 rounded-full hover:scale-105 transition-transform"
                       >
                         + 新規作成
                       </button>
                   </div>

                   {editingChar ? (
                       <div className="bg-white border border-gray-200 p-6 rounded-xl animate-in fade-in slide-in-from-bottom-4">
                           <div className="flex justify-between items-center mb-6">
                               <h4 className="font-bold text-lg">{isEditingNew ? '新規キャラクター作成' : 'キャラクター編集'}</h4>
                               <button onClick={() => setEditingChar(null)} className="text-xs underline text-gray-500">キャンセル</button>
                           </div>

                           <div className="space-y-5">
                               {/* Image */}
                               <ImageSelector 
                                 label="アバター画像"
                                 currentImage={editingChar.avatarUrl}
                                 defaultImage=""
                                 onSelect={(url) => setEditingChar({...editingChar, avatarUrl: url})}
                               />

                               {/* Name & Voice */}
                               <div className="grid grid-cols-2 gap-4">
                                   <div>
                                       <label className="block text-[10px] font-bold uppercase tracking-wider mb-2">名前</label>
                                       <input 
                                         type="text" 
                                         value={editingChar.name}
                                         onChange={e => setEditingChar({...editingChar, name: e.target.value})}
                                         className="w-full border border-gray-300 p-2 rounded-md bg-white text-black"
                                         placeholder="例: ソクラテス"
                                       />
                                   </div>
                                   <div>
                                       <label className="block text-[10px] font-bold uppercase tracking-wider mb-2">声質</label>
                                       <select
                                         value={editingChar.voiceName}
                                         onChange={e => setEditingChar({...editingChar, voiceName: e.target.value})}
                                         className="w-full border border-gray-300 p-2 rounded-md bg-white text-black text-xs"
                                       >
                                           {VOICE_OPTIONS.map(v => (
                                             <option key={v.value} value={v.value}>{v.label}</option>
                                           ))}
                                       </select>
                                   </div>
                               </div>
                               
                               {/* Pitch (Voice Height) */}
                               <div>
                                   <div className="flex justify-between items-center mb-2">
                                     <label className="text-[10px] font-bold uppercase tracking-wider">
                                       声の高さ・速度 (Pitch): {editingChar.pitch?.toFixed(1) || '1.0'}
                                     </label>
                                     <span className="text-[9px] text-gray-400">1.2以上でアニメ声に近づきます</span>
                                   </div>
                                   <input
                                      type="range"
                                      min="0.5"
                                      max="2.0"
                                      step="0.1"
                                      value={editingChar.pitch || 1.0}
                                      onChange={(e) => setEditingChar({...editingChar, pitch: parseFloat(e.target.value)})}
                                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-black"
                                   />
                                   <div className="flex justify-between text-[9px] text-gray-400 mt-1 font-mono">
                                      <span>Low (Slow)</span>
                                      <span>Normal</span>
                                      <span>High (Fast)</span>
                                   </div>
                               </div>

                               {/* Persona */}
                               <div>
                                   <label className="block text-[10px] font-bold uppercase tracking-wider mb-2">性格・振る舞い (プロンプト)</label>
                                   <textarea 
                                     rows={4}
                                     value={editingChar.persona}
                                     onChange={e => setEditingChar({...editingChar, persona: e.target.value})}
                                     className="w-full border border-gray-300 p-3 rounded-md bg-white text-black text-sm leading-relaxed"
                                     placeholder="このキャラクターの性格、口調、振る舞いなどを記述してください..."
                                   />
                               </div>

                               <div className="flex justify-end gap-3 pt-4">
                                   {!isEditingNew && !editingChar.isDefault && (
                                       <button 
                                         onClick={() => deleteCharacter(editingChar.id)}
                                         className="px-4 py-2 text-red-600 text-xs font-bold uppercase"
                                       >
                                         削除
                                       </button>
                                   )}
                                   <button 
                                     onClick={saveCharacter}
                                     disabled={!editingChar.name}
                                     className="px-6 py-2 bg-black text-white font-bold rounded-lg disabled:opacity-50"
                                   >
                                     保存
                                   </button>
                               </div>
                           </div>
                       </div>
                   ) : (
                       <div className="grid grid-cols-1 gap-3">
                           {characters.map(char => (
                               <div key={char.id} onClick={() => startEditCharacter(char)} className="flex items-center gap-4 p-3 bg-white border border-gray-100 rounded-lg hover:border-black cursor-pointer transition-colors shadow-sm group">
                                   <div className="w-12 h-12 rounded-full overflow-hidden border border-gray-200 bg-gray-100 shrink-0">
                                       {char.avatarUrl ? <img src={char.avatarUrl} className="w-full h-full object-cover"/> : null}
                                   </div>
                                   <div className="flex-1 min-w-0">
                                       <h4 className="font-bold text-sm truncate">{char.name}</h4>
                                       <p className="text-xs text-gray-500 truncate">{char.persona}</p>
                                   </div>
                                   <div className="text-[10px] font-bold text-gray-400 group-hover:text-black">
                                       編集 →
                                   </div>
                               </div>
                           ))}
                       </div>
                   )}
               </div>
          </div>
      )}
      </div>

      {activeTab !== 'personas' && (
      <div className="mt-8">
        <div className="flex justify-between items-center mb-4 px-2">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">
            Database ({questions.length})
          </h2>
          {questions.length > 0 && (
            <div className="flex gap-2">
              <button
                onClick={() => exportQuestions('json')}
                className="text-[10px] font-bold uppercase bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-full transition-colors"
              >
                JSON
              </button>
              <button
                onClick={() => exportQuestions('csv')}
                className="text-[10px] font-bold uppercase bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-full transition-colors"
              >
                CSV
              </button>
            </div>
          )}
        </div>
        {/* Question List ... */}
        <div className="space-y-3">
          {questions.map((q) => (
            <div key={q.id} className="bg-white p-4 border border-gray-200 rounded-lg shadow-sm flex flex-col gap-2">
              <p className="font-medium text-sm leading-snug">{q.text}</p>
              <div className="flex justify-between items-center mt-1">
                <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-gray-400">
                  <span className="bg-gray-100 px-1 rounded">{q.difficulty}</span>
                  <span>{q.source}</span>
                </div>
                <button
                  onClick={() => handleDelete(q.id)}
                  className="text-red-500 text-[10px] uppercase font-bold"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  );
};
