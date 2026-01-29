import { useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithGoogle, User } from '../services/authService';
import { migrateLocalStorageIfNeeded } from '../services/migrationService';
import { storageService } from '../services/storageService';

interface AuthGateProps {
  children: React.ReactNode;
}

export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'migrating' | 'ready'>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        setAuthState('migrating');
        try {
          await migrateLocalStorageIfNeeded(firebaseUser.uid);
          await storageService.initializeFromFirestore(firebaseUser.uid);
          setAuthState('ready');
        } catch (e) {
          console.error('Initialization failed:', e);
          setError('データの読み込みに失敗しました。ページを再読み込みしてください。');
          setAuthState('signed-out');
        }
      } else {
        setUser(null);
        storageService.resetCache();
        setAuthState('signed-out');
      }
    });
    return unsub;
  }, []);

  const handleSignIn = async () => {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e: any) {
      if (e.code !== 'auth/popup-closed-by-user') {
        setError('サインインに失敗しました。もう一度お試しください。');
      }
    }
  };

  if (authState === 'loading') {
    return (
      <div className="min-h-[100dvh] bg-white flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-2 border-black rounded-full flex items-center justify-center mb-4 animate-[spin_2s_linear_infinite]">
          <span className="font-display font-bold text-xl">?</span>
        </div>
        <p className="font-mono text-xs text-gray-400 uppercase">Loading...</p>
      </div>
    );
  }

  if (authState === 'migrating') {
    return (
      <div className="min-h-[100dvh] bg-white flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-2 border-black rounded-full flex items-center justify-center mb-4 animate-pulse">
          <span className="font-display font-bold text-xl">M</span>
        </div>
        <p className="font-mono text-xs text-gray-400 uppercase">Syncing data...</p>
      </div>
    );
  }

  if (authState === 'signed-out') {
    return (
      <div className="min-h-[100dvh] bg-white flex flex-col items-center justify-center px-6">
        <div className="w-20 h-20 border-2 border-black rounded-full flex items-center justify-center mb-6">
          <span className="font-display font-bold text-3xl">?</span>
        </div>
        <h1 className="text-4xl font-bold font-display tracking-tighter mb-2 text-center">
          MUSE<br />GACHA
        </h1>
        <p className="font-mono text-xs text-gray-500 mb-8 text-center max-w-[250px]">
          知的思考壁打ちシステム
        </p>

        <button
          onClick={handleSignIn}
          className="w-full max-w-xs py-4 bg-black text-white font-display font-bold text-sm uppercase tracking-widest rounded-lg shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Sign in with Google
        </button>

        {error && (
          <p className="mt-4 text-red-600 text-xs text-center">{error}</p>
        )}

        <p className="mt-12 font-mono text-[10px] text-gray-300 text-center">
          Googleアカウントでデータを同期
        </p>
      </div>
    );
  }

  // authState === 'ready'
  return <>{children}</>;
};
