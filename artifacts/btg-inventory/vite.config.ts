import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const rawPort = process.env.PORT ?? "5173";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  envDir: path.resolve(import.meta.dirname, "..", ".."),
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: [
        "dutelog-mark-32.png",
        "dutelog-mark-64.png",
        "dutelog-mark-180.png",
      ],
      manifest: {
        id: "/",
        name: "Dutelog | Operacao BTG",
        short_name: "Dutelog BTG",
        description:
          "Operacao de estoque, inventario e armazenagem da Dutelog para o BTG Pactual.",
        lang: "pt-BR",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#FAFAF8",
        theme_color: "#FAFAF8",
        categories: ["business", "productivity"],
        icons: [
          {
            src: "/dutelog-pwa-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/dutelog-pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // Bump cache when WMS routing fixes ship so stale SW shells don't keep old chunks.
        cacheId: "dutelog-btg-v20260730-shell",
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // Pré-cacheia SÓ o shell. O globPattern anterior ("**/*.js") baixava
        // todos os chunks de rota na instalação — inclusive o WMS inteiro para
        // um usuário do portal — desfazendo o code-splitting.
        globPatterns: [
          "index.html",
          "manifest.webmanifest",
          "registerSW.js",
          "assets/shell-*.js",
          "assets/*.css",
          "*.{png,svg,ico,woff2}",
        ],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Nomes com hash são imutáveis: CacheFirst dá offline para
            // qualquer rota já visitada, sem baixar o que nunca foi aberto.
            urlPattern: ({ url, sameOrigin }) =>
              Boolean(sameOrigin) && url.pathname.startsWith("/assets/"),
            handler: "CacheFirst",
            options: {
              cacheName: "dute-route-chunks",
              expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(
        import.meta.dirname,
        "..",
        "..",
        "attached_assets",
      ),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Prefixo determinístico: o precache do PWA mira só o shell.
        entryFileNames: "assets/shell-app-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          // Precisa vir primeiro. clsx/tailwind-merge/cva são usados pelo
          // shell (lib/utils.ts -> cn()) E pelo recharts; sem casa própria o
          // Rollup os funde no chunk do recharts e a entrada passa a importar
          // todos os gráficos em qualquer página, inclusive o login.
          if (
            /[\\/]node_modules[\\/](clsx|tailwind-merge|class-variance-authority)[\\/]/.test(
              id,
            )
          )
            return "shell-style-utils";

          if (id.includes("@firebase/firestore") || id.includes("firebase/firestore"))
            return "shell-firebase-data";
          if (id.includes("@firebase/storage") || id.includes("firebase/storage"))
            return "firebase-storage";
          if (id.includes("@firebase/") || id.includes("firebase/"))
            return "shell-firebase-core";

          // Sem prefixo shell-: gráficos são só do dashboard e não devem ser
          // pré-cacheados nem pré-carregados para o portal do cliente.
          if (id.includes("recharts") || id.includes("d3-")) return "recharts";

          if (id.includes("@tanstack")) return "shell-tanstack";
          if (id.includes("@radix-ui")) return "shell-radix";
          if (id.includes("react-dom") || id.includes("/react/"))
            return "shell-react";
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
