import { defineConfig } from 'vite';

// base: './' —— 产物为纯静态相对路径，断网双击 dist/index.html 可玩
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    reportCompressedSize: false
  },
  server: {
    host: true
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
} as never);
