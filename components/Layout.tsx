import React from 'react';
import { RateLimitIndicator } from './RateLimitIndicator';
import { getCurrentUser, signOut } from '../services/authService';
import { BackgroundEffects } from './BackgroundEffects';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  onTabChange: (tab: 'gacha' | 'consult' | 'manage' | 'history') => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, activeTab, onTabChange }) => {
  const tabs = [
    { id: 'gacha', label: 'GACHA', icon: '🎲' },
    { id: 'consult', label: 'CONSULT', icon: '💬' },
    { id: 'manage', label: 'MANAGE', icon: '⚙️' },
    { id: 'history', label: 'HISTORY', icon: '📜' },
  ] as const;

  return (
    <div className="min-h-[100dvh] bg-[#0a0a14] text-[#e2e2e8] flex flex-col relative selection:bg-purple-500 selection:text-white pb-[env(safe-area-inset-bottom)]">
      <BackgroundEffects />

      {/* Header (Minimal for Mobile) */}
      <header className="sticky top-0 left-0 w-full glass-dark z-40 border-b border-white/5">
        <div className="w-full px-4 h-14 flex items-center justify-between max-w-lg mx-auto md:max-w-7xl">
          <h1 className="text-xl font-bold tracking-tighter flex items-center gap-2 font-display uppercase gradient-text-neon">
            MuseGacha
            <span className="text-[9px] bg-purple-600/30 text-purple-300 px-1.5 py-0.5 ml-1 font-mono rounded-sm border border-purple-500/30">APP</span>
          </h1>
          <div className="flex items-center gap-2 ml-auto">
            <RateLimitIndicator />
            {(() => {
              const user = getCurrentUser();
              if (!user) return null;
              return (
                <button
                  onClick={() => { if (confirm('サインアウトしますか？')) signOut(); }}
                  className="flex items-center gap-1.5 p-1 rounded-full hover:bg-white/10 transition-colors"
                  title={user.displayName || 'Sign out'}
                >
                  {user.photoURL ? (
                    <img src={user.photoURL} alt="" className="w-7 h-7 rounded-full border border-white/20" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs font-bold">
                      {(user.displayName || 'U')[0]}
                    </div>
                  )}
                </button>
              );
            })()}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-lg mx-auto md:max-w-7xl px-4 py-6 mb-20 md:mb-0 relative z-10 overflow-x-hidden">
        {children}
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 w-full glass-dark border-t border-white/5 z-50 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_30px_rgba(0,0,0,0.5)]">
        <div className="flex justify-around items-center h-16 max-w-lg mx-auto">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-all active:scale-95 ${isActive ? 'text-white' : 'text-gray-600'
                  }`}
              >
                <span className={`text-2xl transition-transform duration-300 ${isActive ? '-translate-y-1' : ''}`}>
                  {tab.icon}
                </span>
                <span className={`text-[9px] font-bold uppercase tracking-widest ${isActive ? 'opacity-100' : 'opacity-50'}`}>
                  {tab.label}
                </span>
                {isActive && (
                  <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(139,92,246,0.6)]"></span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Desktop Footer (Hidden on Mobile usually, but kept for larger screens) */}
      <footer className="hidden md:block w-full border-t border-white/5 py-8 glass-dark z-10 mt-auto">
        <div className="max-w-7xl mx-auto px-6 flex justify-between items-end">
          <div className="font-display font-bold text-6xl opacity-5 select-none pointer-events-none">
            MUSE
          </div>
          <div className="text-xs font-mono text-gray-600 uppercase">
            知的思考壁打ちシステム <br />
            © {new Date().getFullYear()}
          </div>
        </div>
      </footer>
    </div>
  );
};