import React, { useRef, useEffect, useState } from 'react';
import { RateLimitIndicator } from './RateLimitIndicator';
import { getCurrentUser, signOut } from '../services/authService';
import { BackgroundEffects } from './BackgroundEffects';
import { useI18n } from '../services/i18n';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  onTabChange: (tab: 'gacha' | 'consult' | 'manage' | 'history' | 'collab') => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, activeTab, onTabChange }) => {
  const { locale, setLocale, t } = useI18n();

  const tabs = [
    { id: 'gacha', label: t('tab.gacha'), icon: '🎲' },
    { id: 'consult', label: t('tab.consult'), icon: '💬' },
    { id: 'collab', label: 'Collab', icon: '👥' },
    { id: 'manage', label: t('tab.manage'), icon: '⚙️' },
    { id: 'history', label: t('tab.history'), icon: '📜' },
  ] as const;

  const navRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  // Theme mode
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>(() =>
    (localStorage.getItem('musegacha_theme_mode') as 'dark' | 'light') || 'dark'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
    localStorage.setItem('musegacha_theme_mode', themeMode);
  }, [themeMode]);

  // PWA install prompt
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  // Update tab indicator position with spring animation
  useEffect(() => {
    if (!navRef.current) return;
    const activeIndex = tabs.findIndex(t => t.id === activeTab);
    const buttons = navRef.current.querySelectorAll('button');
    if (buttons[activeIndex]) {
      const btn = buttons[activeIndex] as HTMLElement;
      setIndicatorStyle({
        left: btn.offsetLeft + btn.offsetWidth * 0.2,
        width: btn.offsetWidth * 0.6,
      });
    }
  }, [activeTab]);

  return (
    <div className="min-h-[100dvh] bg-[#1c1c3a] text-[#e8e8f0] flex flex-col relative selection:bg-purple-500 selection:text-white pb-[env(safe-area-inset-bottom)]">
      <BackgroundEffects />

      {/* Header (Minimal for Mobile) */}
      <header className="sticky top-0 left-0 w-full glass-dark z-40 border-b border-white/5">
        <div className="w-full px-4 h-14 flex items-center justify-between max-w-lg mx-auto md:max-w-7xl">
          <h1 className="text-xl font-bold tracking-tighter flex items-center gap-2 font-display uppercase gradient-text-neon">
            MuseGacha
            <span className="text-[10px] bg-purple-600/30 text-purple-300 px-1.5 py-0.5 ml-1 font-mono rounded-sm border border-purple-500/30">APP</span>
          </h1>
          <div className="flex items-center gap-1.5 ml-auto">
            {/* Offline indicator */}
            {isOffline && (
              <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-full animate-pulse">
                {t('common.offline')}
              </span>
            )}

            {/* PWA Install */}
            {deferredPrompt && (
              <button
                onClick={handleInstall}
                className="text-[10px] font-mono text-purple-300 bg-purple-500/10 border border-purple-500/20 px-2 py-1.5 rounded-full btn-spring"
              >
                {t('common.install')}
              </button>
            )}

            {/* Language toggle */}
            <button
              onClick={() => setLocale(locale === 'ja' ? 'en' : 'ja')}
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 btn-spring text-[11px] font-bold font-mono"
              title="Toggle Language"
            >
              {locale === 'ja' ? 'EN' : 'JP'}
            </button>

            {/* Theme toggle */}
            <button
              onClick={() => setThemeMode(prev => prev === 'dark' ? 'light' : 'dark')}
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 btn-spring"
              title={themeMode === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              <span className="text-base">{themeMode === 'dark' ? '☀️' : '🌙'}</span>
            </button>

            <RateLimitIndicator />
            {(() => {
              const user = getCurrentUser();
              if (!user) return null;
              return (
                <button
                  onClick={() => { if (confirm(t('auth.sign_out'))) signOut(); }}
                  className="flex items-center gap-1.5 p-1 rounded-full hover:bg-white/10 btn-spring"
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
      <main className="flex-1 w-full max-w-lg mx-auto md:max-w-7xl px-4 py-6 pb-20 relative z-10 overflow-x-hidden flex flex-col">
        <div key={activeTab} className="animate-tab-in flex-1 min-h-0">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="bottom-nav fixed bottom-0 left-0 w-full border-t border-white/10 z-50">
        <div ref={navRef} className="flex justify-around items-center h-16 max-w-lg mx-auto md:max-w-7xl relative">
          {/* Animated tab indicator */}
          <div
            className="tab-indicator"
            style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
          />
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`flex flex-col items-center justify-center w-full h-full space-y-1 btn-spring ${isActive ? 'text-white' : 'text-gray-400'
                  }`}
              >
                <span className={`text-2xl transition-transform duration-300 ${isActive ? '-translate-y-1 drop-shadow-[0_0_8px_rgba(255,255,255,0.3)] scale-110' : 'scale-100'}`}>
                  {tab.icon}
                </span>
                <span className={`text-[10px] font-bold uppercase tracking-widest transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-50'}`}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Desktop Footer */}
      <footer className="hidden md:block w-full border-t border-white/5 py-8 glass-dark z-10 mt-auto">
        <div className="max-w-7xl mx-auto px-6 flex justify-between items-end">
          <div className="font-display font-bold text-6xl opacity-5 select-none pointer-events-none">
            MUSE
          </div>
          <div className="text-xs font-mono text-gray-600 uppercase">
            {t('app.subtitle')} <br />
            © {new Date().getFullYear()}
          </div>
        </div>
      </footer>
    </div>
  );
};
