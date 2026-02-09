import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { storageService } from '../services/storageService';
import { apiKeyRotation } from '../services/apiKeyRotation';

interface LiveSessionProps {
  question: string;
  onTranscriptUpdate: (transcript: string) => void;
  onSessionEnd: () => void;
}

export const LiveSession: React.FC<LiveSessionProps> = ({ question, onTranscriptUpdate, onSessionEnd }) => {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error' | 'closed'>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [visualizerData, setVisualizerData] = useState<number[]>(new Array(5).fill(10));
  
  // Audio Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const currentSessionRef = useRef<any>(null);
  
  // Transcript State
  const transcriptRef = useRef<string>('');
  
  // Playback State
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  useEffect(() => {
    startSession();

    return () => {
      stopSession();
    };
  }, []);

  const startSession = async () => {
    try {
      const apiKey = apiKeyRotation.getCurrentKey() || storageService.getApiKey();
      if (!apiKey) throw new Error('API Key not found');

      const ai = new GoogleGenAI({ apiKey });

      // Init Audio Contexts
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass({ sampleRate: 24000 }); // Output sample rate
      audioContextRef.current = audioCtx;

      // Microphone Stream
      // Note: Live API input expects 16kHz usually, but let's handle resampling if needed or use matching context.
      // Here we create a separate context for input to match typical mic requirements if needed, 
      // but simpler is to use one context if sample rates align. Let's use separate for safety as per examples.
      const inputCtx = new AudioContextClass({ sampleRate: 16000 });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            setStatus('connected');
            
            // Setup Mic Stream
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              // Simple visualizer data from input
              updateVisualizer(inputData);

              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(processor);
            processor.connect(inputCtx.destination); // Required for script processor to run
            
            inputSourceRef.current = source;
            processorRef.current = processor;
          },
          onmessage: async (msg: LiveServerMessage) => {
            // Handle Transcription
            if (msg.serverContent?.modelTurn?.parts?.[0]?.text) {
                // Sometimes text comes in modelTurn for older protocols, but typically outputTranscription
            }
            
            if (msg.serverContent?.outputTranscription?.text) {
               const text = msg.serverContent.outputTranscription.text;
               transcriptRef.current += `AI: ${text}\n`;
               onTranscriptUpdate(transcriptRef.current);
            }
            
            if (msg.serverContent?.inputTranscription?.text) {
                const text = msg.serverContent.inputTranscription.text;
                transcriptRef.current += `User: ${text}\n`;
                onTranscriptUpdate(transcriptRef.current);
            }
            
            // Handle Audio Output
            const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
               await playAudioChunk(base64Audio, audioCtx);
            }

            // Handle Interruption
            if (msg.serverContent?.interrupted) {
                cancelAudioPlayback();
            }
          },
          onclose: () => {},
          onerror: (err) => {
            console.error('Session error', err);
            setStatus('error');
            setErrorMessage('Connection error occurred.');
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: `
            あなたは「MUSE（ミューズ）」と呼ばれる知的なインタビュアーです。
            ユーザーの目の前にいる「壁打ち相手」として振る舞ってください。
            
            今回のテーマ（問い）: "${question}"
            
            役割:
            1. まず最初に、この問いについてどう思うか、ユーザーに短く尋ねてください。
            2. ユーザーの回答を聞き、深掘りする質問を投げかけてください。
            3. 決して講義をしないでください。あくまでユーザーに話をさせ、思考を引き出すことが目的です。
            4. 友人のような、しかし知的なトーンで話してください。日本語で会話してください。
          `,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } 
          },
          inputAudioTranscription: { model: "gemini-2.5-flash-native-audio-preview-09-2025" },
          outputAudioTranscription: { model: "gemini-2.5-flash-native-audio-preview-09-2025" }
        }
      });
      
      currentSessionRef.current = sessionPromise;

    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setErrorMessage(err.message || 'Failed to start session');
    }
  };

  const stopSession = () => {
    if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
    }
    if (inputSourceRef.current) {
        inputSourceRef.current.disconnect();
        inputSourceRef.current = null;
    }
    if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
    }
    if (currentSessionRef.current) {
        // There isn't a direct "close" method on the promise, 
        // typically we just stop sending data and close context.
        // The API automatically times out or we can't explicitly close cleanly in the wrapper sometimes.
    }
    setStatus('closed');
  };

  const updateVisualizer = (data: Float32Array) => {
    // Simple RMS calc for visualizer
    let sum = 0;
    for(let i=0; i<data.length; i+=100) {
        sum += data[i] * data[i];
    }
    const rms = Math.sqrt(sum / (data.length/100));
    const height = Math.min(100, Math.max(10, rms * 500));
    
    // Shift and push
    setVisualizerData(prev => [...prev.slice(1), height]);
  };

  // Audio Utils
  function createPcmBlob(data: Float32Array): { data: string; mimeType: string } {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      int16[i] = data[i] * 32768;
    }
    
    // Manual Base64 Encode
    let binary = '';
    const bytes = new Uint8Array(int16.buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    
    return {
      data: btoa(binary),
      mimeType: 'audio/pcm;rate=16000',
    };
  }

  async function playAudioChunk(base64: string, ctx: AudioContext) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const dataInt16 = new Int16Array(bytes.buffer);
    const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < dataInt16.length; i++) {
        channelData[i] = dataInt16[i] / 32768.0;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    
    const currentTime = ctx.currentTime;
    // Schedule for gapless playback
    const startTime = Math.max(currentTime, nextStartTimeRef.current);
    source.start(startTime);
    nextStartTimeRef.current = startTime + buffer.duration;
    
    source.onended = () => {
        sourcesRef.current.delete(source);
    };
    sourcesRef.current.add(source);
  }

  function cancelAudioPlayback() {
     sourcesRef.current.forEach(s => s.stop());
     sourcesRef.current.clear();
     nextStartTimeRef.current = 0;
  }

  return (
    <div className="flex flex-col items-center justify-center h-full w-full bg-[#1c1c3a] text-white relative overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 bg-gradient-mesh opacity-40 pointer-events-none" />
        <div className="absolute inset-0 bg-grid-premium pointer-events-none" />
        <div className="absolute inset-0 bg-noise pointer-events-none" />

        <div className="z-10 flex flex-col items-center gap-10 animate-spring-fade-up">
            {/* Status badge */}
            <div className={`text-[10px] font-mono uppercase tracking-[0.3em] px-5 py-2.5 rounded-full backdrop-blur-md animate-spring-snappy ${
                status === 'connected' ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400' :
                status === 'error' ? 'bg-red-500/10 border border-red-500/25 text-red-400' : 'bg-white/5 border border-white/10 text-gray-500'
            }`}>
                <span className="flex items-center gap-2">
                  {status === 'connected' && <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>}
                  {status === 'connected' ? 'LIVE' : status.toUpperCase()}
                </span>
            </div>

            {/* Visualizer - enhanced with more bars and glow */}
            <div className="flex items-end gap-2 h-40 px-4">
                {visualizerData.map((h, i) => (
                    <div
                        key={i}
                        className="w-3 rounded-full"
                        style={{
                          height: `${h}%`,
                          background: `linear-gradient(to top, rgba(139, 92, 246, 0.9), rgba(59, 130, 246, 0.7), rgba(236, 72, 153, 0.5))`,
                          boxShadow: `0 0 ${h / 4}px rgba(139, 92, 246, 0.5), 0 0 ${h / 2}px rgba(139, 92, 246, 0.2)`,
                          opacity: 0.5 + (h / 120),
                          transition: 'height 0.08s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.1s ease',
                        }}
                    />
                ))}
            </div>

            <div className="text-center max-w-md px-6">
                <p className="font-display text-3xl font-bold mb-3 gradient-text tracking-tight">Listening</p>
                <p className="font-mono text-xs text-gray-500 tracking-wide">Speak naturally. The AI will respond.</p>
            </div>

            {errorMessage && (
                <div className="px-4 py-2 bg-red-900/10 border border-red-500/15 rounded-xl animate-spring-snappy">
                  <p className="text-red-400 font-mono text-xs">{errorMessage}</p>
                </div>
            )}

            <button
                onClick={onSessionEnd}
                className="mt-4 chat-send-btn px-10 py-4 font-bold uppercase tracking-[0.15em] text-sm btn-spring"
            >
                End Session
            </button>
        </div>
    </div>
  );
};