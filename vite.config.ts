import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  // APIキーの存在確認のみ（値は露出させない）
  console.log('[Vite Config] GEMINI_API_KEY:', env.GEMINI_API_KEY ? 'SET' : 'NOT SET');
  console.log('[Vite Config] GEMINI_API_KEY_2:', env.GEMINI_API_KEY_2 ? 'SET' : 'NOT SET');
  console.log('[Vite Config] GEMINI_API_KEY_3:', env.GEMINI_API_KEY_3 ? 'SET' : 'NOT SET');

  return {
    base: './',
    server: {
      port: 3007,
      host: '0.0.0.0',
    },
    plugins: [react()],
    define: {
      '__GEMINI_API_KEY__': JSON.stringify(env.GEMINI_API_KEY || ''),
      '__GEMINI_API_KEY_2__': JSON.stringify(env.GEMINI_API_KEY_2 || ''),
      '__GEMINI_API_KEY_3__': JSON.stringify(env.GEMINI_API_KEY_3 || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});

