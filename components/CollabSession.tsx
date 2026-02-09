import React, { useState, useEffect, useRef } from 'react';
import { CollabRoom, CollabMessage } from '../types';
import { db } from '../services/firebaseConfig';
import { collection, doc, setDoc, getDocs, onSnapshot, query, orderBy, limit, addDoc, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';
import { auth } from '../services/firebaseConfig';

export const CollabSession: React.FC = () => {
  const [view, setView] = useState<'lobby' | 'room'>('lobby');
  const [rooms, setRooms] = useState<CollabRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<CollabRoom | null>(null);
  const [messages, setMessages] = useState<CollabMessage[]>([]);
  const [input, setInput] = useState('');
  const [newTopic, setNewTopic] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const currentUser = auth.currentUser;

  useEffect(() => {
    loadRooms();
    return () => {
      if (unsubscribeRef.current) unsubscribeRef.current();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const loadRooms = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'collabRooms'));
      const loadedRooms = snapshot.docs
        .map(d => d.data() as CollabRoom)
        .filter(r => r.status !== 'ended')
        .sort((a, b) => b.createdAt - a.createdAt);
      setRooms(loadedRooms);
    } catch (e) {
      console.error('Failed to load rooms', e);
    }
  };

  const createRoom = async () => {
    if (!newTopic.trim() || !currentUser) return;
    setIsCreating(true);
    try {
      const roomId = crypto.randomUUID();
      const room: CollabRoom = {
        id: roomId,
        topic: newTopic.trim(),
        hostUid: currentUser.uid,
        hostName: currentUser.displayName || 'Anonymous',
        participants: [{ uid: currentUser.uid, name: currentUser.displayName || 'Anonymous', avatarUrl: currentUser.photoURL || undefined }],
        status: 'active',
        createdAt: Date.now(),
      };
      await setDoc(doc(db, 'collabRooms', roomId), room);
      setNewTopic('');
      joinRoom(room);
    } catch (e) {
      console.error('Failed to create room', e);
    } finally {
      setIsCreating(false);
    }
  };

  const joinRoom = async (room: CollabRoom) => {
    if (!currentUser) return;

    // Add participant if not already in
    const isParticipant = room.participants.some(p => p.uid === currentUser.uid);
    if (!isParticipant) {
      try {
        await updateDoc(doc(db, 'collabRooms', room.id), {
          participants: arrayUnion({ uid: currentUser.uid, name: currentUser.displayName || 'Anonymous', avatarUrl: currentUser.photoURL || undefined }),
        });
      } catch (e) {
        console.error('Failed to join room', e);
      }
    }

    setActiveRoom(room);
    setView('room');

    // Subscribe to messages
    if (unsubscribeRef.current) unsubscribeRef.current();
    const messagesRef = collection(db, `collabRooms/${room.id}/messages`);
    const q = query(messagesRef, orderBy('timestamp', 'asc'), limit(200));
    unsubscribeRef.current = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(d => d.data() as CollabMessage);
      setMessages(msgs);
    });
  };

  const sendMessage = async () => {
    if (!input.trim() || !activeRoom || !currentUser) return;
    const msg: CollabMessage = {
      id: crypto.randomUUID(),
      roomId: activeRoom.id,
      uid: currentUser.uid,
      userName: currentUser.displayName || 'Anonymous',
      text: input.trim(),
      timestamp: Date.now(),
    };
    setInput('');
    try {
      await setDoc(doc(db, `collabRooms/${activeRoom.id}/messages`, msg.id), msg);
    } catch (e) {
      console.error('Failed to send message', e);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const leaveRoom = () => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    setActiveRoom(null);
    setMessages([]);
    setView('lobby');
    loadRooms();
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-spring-fade-up">
        <p className="text-sm text-gray-400 mb-2">Sign in to use Collab Mode</p>
        <p className="text-xs text-gray-500">Real-time collaborative writing sessions require authentication.</p>
      </div>
    );
  }

  // Room View
  if (view === 'room' && activeRoom) {
    return (
      <div className="flex flex-col h-[calc(100dvh-12rem)] animate-spring-fade-up">
        {/* Room Header */}
        <div className="flex items-center gap-3 pb-3 border-b border-white/[0.04] mb-2 flex-shrink-0">
          <button onClick={leaveRoom} className="p-2 -ml-1 hover:bg-white/[0.06] rounded-xl transition-all active:scale-90">
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold font-display truncate text-gray-200">{activeRoom.topic}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-[10px] font-mono text-gray-500">{activeRoom.participants.length} participants</span>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-3 pb-20 pt-2">
          {messages.map(msg => {
            const isMe = msg.uid === currentUser.uid;
            return (
              <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                {!isMe && (
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-600/25 to-cyan-600/25 border border-white/5 flex items-center justify-center flex-shrink-0 mr-2 mt-1">
                    <span className="text-[9px] font-bold text-blue-400">{msg.userName.charAt(0)}</span>
                  </div>
                )}
                <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl ${isMe ? 'bg-purple-600/20 text-gray-200 rounded-tr-sm' : 'bg-white/[0.06] text-gray-300 rounded-tl-sm'}`}>
                  {!isMe && <p className="text-[9px] font-bold text-gray-500 mb-1">{msg.userName}</p>}
                  <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  <p className={`text-[9px] mt-1.5 font-mono ${isMe ? 'text-purple-400/50' : 'text-gray-600'}`}>{formatTime(msg.timestamp)}</p>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="flex-shrink-0 pt-3">
          <div className="chat-input-wrapper flex gap-2 items-end p-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Write something..."
              rows={1}
              className="chat-input-inner flex-1 resize-none px-3 py-2.5 text-sm leading-relaxed"
              style={{ maxHeight: '120px', minHeight: '40px' }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="chat-send-btn p-2.5 flex-shrink-0 btn-spring"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Lobby View
  return (
    <div className="w-full animate-spring-fade-up">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold font-display tracking-tighter gradient-text">COLLAB</h2>
          <p className="text-[10px] font-mono text-gray-500 uppercase mt-2 tracking-wider">Real-time collaborative sessions</p>
        </div>
      </div>

      {/* Create Room */}
      <div className="mb-6 p-4 card-cinematic rounded-xl">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Create Room</p>
        <div className="flex gap-2">
          <input
            value={newTopic}
            onChange={(e) => setNewTopic(e.target.value)}
            placeholder="Enter a topic..."
            className="flex-1 px-3 py-2.5 input-dark text-sm rounded-lg"
            onKeyDown={(e) => e.key === 'Enter' && createRoom()}
          />
          <button
            onClick={createRoom}
            disabled={!newTopic.trim() || isCreating}
            className="chat-send-btn px-5 py-2.5 text-xs font-bold uppercase tracking-widest btn-spring disabled:opacity-30"
          >
            {isCreating ? '...' : 'Create'}
          </button>
        </div>
      </div>

      {/* Room List */}
      {rooms.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600/20 to-cyan-600/20 border border-white/5 flex items-center justify-center mb-5">
            <svg className="w-7 h-7 text-blue-400/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <p className="text-sm text-gray-300 font-medium mb-2">No active rooms</p>
          <p className="text-xs text-gray-500 max-w-[280px]">Create a room to start a collaborative writing session.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rooms.map((room, idx) => (
            <button
              key={room.id}
              onClick={() => joinRoom(room)}
              className="w-full text-left p-4 card-cinematic rounded-xl hover:bg-white/5 card-spring animate-card-stagger"
              style={{ animationDelay: `${idx * 60}ms` }}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200 font-medium truncate">{room.topic}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] font-mono text-gray-500">{room.hostName}</span>
                    <span className="w-1 h-1 rounded-full bg-gray-700" />
                    <span className="text-[10px] font-mono text-gray-500">{room.participants.length} joined</span>
                    <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                  </div>
                </div>
                <span className="text-[10px] font-mono text-gray-600">{new Date(room.createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
