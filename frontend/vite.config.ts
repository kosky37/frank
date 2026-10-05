import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
    proxy: {
      // Dev: API z `dotnet run` (Frank.Api, launchSettings http).
      '/api': 'http://localhost:5203',
    },
  },
});
