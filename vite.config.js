import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  root: path.join(__dirname, 'public'),
  publicDir: false,
  build: {
    outDir: path.join(__dirname, 'dist'),
    emptyOutDir: true,
    // Avoid bundling images from /img/ into assets; they are copied to dist/img by scripts/copy-img-to-dist.cjs
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: path.join(__dirname, 'public', 'index.html'),
        profile: path.join(__dirname, 'public', 'profile.html'),
        admin: path.join(__dirname, 'public', 'admin.html'),
        'admin-login': path.join(__dirname, 'public', 'admin-login.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/profile': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  preview: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/profile': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
};
