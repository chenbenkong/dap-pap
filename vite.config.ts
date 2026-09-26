import { defineConfig } from 'vite';

// GitHub Pages 项目站点：https://<user>.github.io/dap-pap/
// 本地开发 / 自定义域名部署时可改为 '/'
export default defineConfig({
  base: '/dap-pap/',
  build: {
    target: 'es2019',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // three.js 独立分包：应用代码迭代时浏览器仍命中 three 的长期缓存
        manualChunks: { three: ['three'] },
      },
    },
  },
});
