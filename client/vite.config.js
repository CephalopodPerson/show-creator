import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH lets the same code be served from the site root (stable) or from a
// sub-path (beta at /beta/). Vite rewrites asset URLs to match, and the client
// reads it back via import.meta.env.BASE_URL in src/api.js.
//   stable:  npm run build
//   beta:    BASE_PATH=/beta/ npm run build
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    proxy: {
      '/api':   'http://localhost:3000',
      '/shows': 'http://localhost:3000',
    },
  },
});
