/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Inline the image assets (card back 9KB, logo 85KB) so the single-file build stays self-contained.
  build: { assetsInlineLimit: 128 * 1024 },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
