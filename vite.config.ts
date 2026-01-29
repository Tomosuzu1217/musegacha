import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: '/',
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

