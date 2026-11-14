import { execSync } from "child_process";
import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

import { folhasDepoisDaAbertura } from "./src/lib/abertura-no-build";
import { pluginDoMapaDasTelas } from "./src/lib/telas-no-aparelho-no-build";

const rawPort = process.env.PORT ?? "5173";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

/**
 * Commit do build, exibido em Configuração > Sistema. A tag da imagem do
 * Cloud Run é timestamp; é isto que diz qual código está no ar. "+local"
 * marca build feito com alterações não commitadas.
 */
function gitBuildCommit() {
  try {
    const commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    const dirty = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    return dirty ? `${commit}+local` : commit;
  } catch {
    return "";
  }
}

/**
 * No build, a folha do app sai do <head> e vai para logo antes do #root: a
 * abertura (index.html) pinta sem esperar por ela (src/lib/abertura-no-build.ts).
 */
function folhaDepoisDaAbertura(): Plugin {
  return {
    name: "dute-folha-depois-da-abertura",
    apply: "build",
    transformIndexHtml: { order: "post", handler: folhasDepoisDaAbertura },
  };
}

const buildCommit = gitBuildCommit();

export default defineConfig({
  base: basePath,
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  envDir: path.resolve(import.meta.dirname, "..", ".."),
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
    folhaDepoisDaAbertura(),
    // Os arquivos de cada tela, para a equipe guardá-las no aparelho sem
    // importá-las (src/lib/telas-no-aparelho.ts). Fica fora do precache.
    pluginDoMapaDasTelas({
      src: path.resolve(import.meta.dirname, "src"),
      versao: buildCommit || "desconhecida",
      nome: "telas-no-aparelho.json",
    }),
    VitePWA({
      registerType: "autoUpdate",
      // Com defer, o registro do service worker não para a leitura do HTML: a
      // abertura pinta antes (carregamento v2, parte 9).
      injectRegister: "script-defer",
      includeAssets: [
        "dutelog-mark-32.png",
        "dutelog-mark-64.png",
        "dutelog-mark-180.png",
      ],
      manifest: {
        id: "/",
        name: "Dutelog",
        short_name: "Dutelog",
        description:
          "Sistema da Dutelog para armazenagem, pedidos, estoque e faturamento.",
        lang: "pt-BR",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // O preto da abertura (index.html): a abertura do Android emenda
        // nela sem clarão (carregamento v2, decisão P4 de 12/11/2026).
        background_color: "#161616",
        theme_color: "#161616",
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
            // Para a equipe, as telas que ela abre entram aqui logo depois
            // de entrar (lib/telas-no-aparelho.ts): cabem as de uma versão
            // inteira, com folga para a anterior sair aos poucos.
            urlPattern: ({ url, sameOrigin }) =>
              Boolean(sameOrigin) && url.pathname.startsWith("/assets/"),
            handler: "CacheFirst",
            options: {
              cacheName: "dute-route-chunks",
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // As fontes do Google (index.html, por preload) ficam no
            // aparelho: sem sinal, as telas abrem com a Manrope.
            urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "dute-fontes-folhas",
              expiration: { maxEntries: 4 },
            },
          },
          {
            urlPattern: ({ url }) => url.origin === "https://fonts.gstatic.com",
            handler: "CacheFirst",
            options: {
              cacheName: "dute-fontes",
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
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
          // React e Radix precisam da mesma ordem de inicialização. Separá-los
          // pode criar shell-radix -> shell-react -> shell-radix no build,
          // fazendo a aplicação falhar antes de montar a tela de login.
          if (id.includes("@radix-ui")) return "shell-react";
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
