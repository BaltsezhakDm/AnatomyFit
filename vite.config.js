import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/AnatomyFit/',
  plugins: [
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [],
      manifest: {
        name: 'AnatomyFit — Аналитика Прогрессии Нагрузок',
        short_name: 'AnatomyFit',
        description: 'Анатомический дневник тренировок с автоматическими советами по прогрессии нагрузки',
        start_url: '/AnatomyFit/',
        scope: '/AnatomyFit/',
        display: 'standalone',
        background_color: '#09090b',
        theme_color: '#10b981',
        icons: []
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html}'],
        runtimeCaching: []
      }
    })
  ]
});
