// vite.config.js
import { defineConfig } from 'vite';
import react             from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // Permitir acceso desde la red local (IP)
    proxy: {
      '/api': {
        target:       'http://localhost:4000',
        changeOrigin: true,
        secure:       false,
      },
      '/upload-assets': {
        target:       'http://localhost:4000',
        changeOrigin: true,
        secure:       false,
      },
    },
  },
  build: {
    outDir:          'dist',
    sourcemap:        false,
    rollupOptions: {
      output: {
        manualChunks: {
          react:  ['react', 'react-dom'],
          router: ['react-router-dom'],
        },
      },
    },
  },
  define: {
    // Evita warnings de proceso en browser
    'process.env': {},
  },
});
