import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // API_KEY removed from define to prevent leaking it to the browser.
  // It is now accessed only in the serverless function environment.
  server: {
    port: 3000
  }
});