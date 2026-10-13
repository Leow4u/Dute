/*
 * Build da demonstração: o app de verdade com login, dados e Agent Dute
 * simulados, num único HTML que abre com dois cliques, sem servidor.
 *
 *   corepack pnpm --filter "@workspace/btg-inventory" run build:demo
 *   -> artifacts/btg-inventory/dist/demo/dutelog-demo.html (portal e operação Dutelog)
 *
 *   corepack pnpm --filter "@workspace/btg-inventory" run build:demo:cliente
 *   -> artifacts/btg-inventory/dist/demo-cliente/index.html (só o portal, para mandar por link)
 *
 * Nada aqui entra no build de produção (vite.config.ts não conhece esta pasta).
 */
import fs from "fs";
import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, normalizePath, type Plugin } from "vite";

const here = import.meta.dirname;
const app = path.resolve(here, "..");
const src = path.resolve(app, "src");
const publicDir = path.resolve(app, "public");

/**
 * Caminho comparável no Linux e no Windows. No Windows o Vite entrega os ids
 * com "/" e o path.join monta com "\"; sem isso nenhuma troca casava e o build
 * saía com o login de produção ("Firebase não configurado") e sem logo.
 */
function pathKey(file: string) {
  const normalized = normalizePath(file);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/** Módulos do app trocados pela versão da demo (só quando quem importa está em src/). */
const OVERRIDES = new Map<string, string>([
  [pathKey(path.join(src, "lib/auth.tsx")), path.join(here, "auth.tsx")],
  [pathKey(path.join(src, "lib/functions-api.ts")), path.join(here, "functions-api.ts")],
  [pathKey(path.join(src, "pages/client/estoque.tsx")), path.join(here, "portal/estoque.tsx")],
  [pathKey(path.join(src, "pages/not-found.tsx")), path.join(here, "not-found.tsx")],
]);

function demoOverrides(): Plugin {
  const demoDir = `${pathKey(here)}/`;
  const applied = new Set<string>();
  return {
    name: "dute-demo-overrides",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || pathKey(importer).startsWith(demoDir)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      const target = resolved ? OVERRIDES.get(pathKey(resolved.id)) : undefined;
      if (!target) return null;
      applied.add(target);
      return target;
    },
    // Sem as trocas o arquivo sai com o login e o Firebase de produção: melhor não sair.
    buildEnd(error) {
      if (error) return;
      const missing = [...OVERRIDES.values()].filter((target) => !applied.has(target));
      if (missing.length) {
        this.error(`Demo: troca de módulo não aplicada (${missing.map((target) => path.relative(app, target)).join(", ")}). O arquivo sairia com o app de produção.`);
      }
    },
  };
}

function dataUri(file: string) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "svg" ? "image/svg+xml" : `image/${ext}`;
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

/** Logos que o app pede por caminho absoluto (/dutelog-logo.png) viram data URI. */
function inlinePublicAssets(): Plugin {
  const pattern = /`\$\{basePath\}\/([\w.-]+\.(?:png|jpg|svg))`|"\/(dutelog-[\w.-]+\.png)"/g;
  const srcDir = `${pathKey(src)}/`;
  let inlined = 0;
  return {
    name: "dute-demo-public-assets",
    enforce: "pre",
    transform(code, id) {
      if (!pathKey(id).startsWith(srcDir)) return null;
      const next = code.replace(pattern, (match, fromTemplate: string | undefined, fromString: string | undefined) => {
        const file = path.join(publicDir, fromTemplate ?? fromString ?? "");
        if (!fs.existsSync(file)) return match;
        inlined += 1;
        return JSON.stringify(dataUri(file));
      });
      return next === code ? null : { code: next, map: null };
    },
    // Sem logo embutido, a página publicada mostra a imagem quebrada.
    buildEnd(error) {
      if (!error && inlined === 0) this.error("Demo: nenhum logo do app foi embutido no arquivo.");
    },
  };
}

/** Junta JS e CSS dentro do HTML e renomeia para dutelog-demo.html. */
function singleFile(fileName: string): Plugin {
  return {
    name: "dute-demo-single-file",
    enforce: "post",
    generateBundle(_options, bundle) {
      const htmlName = Object.keys(bundle).find((name) => name.endsWith(".html"));
      if (!htmlName) return;
      const htmlAsset = bundle[htmlName];
      if (htmlAsset.type !== "asset") return;
      let html = String(htmlAsset.source).replace("%DEMO_FAVICON%", dataUri(path.join(publicDir, "dutelog-mark-32.png")));
      const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === "chunk") {
          const tag = new RegExp(`<script[^>]*src="[^"]*${escape(name)}"[^>]*></script>`);
          // Com inlineDynamicImports o Vite deixa o marcador de preload sem trocar; sem lista, o import é direto.
          const code = file.code.replace(/__VITE_PRELOAD__/g, "void 0").replace(/<\/script/gi, "<\\/script");
          if (tag.test(html)) {
            html = html.replace(tag, () => `<script type="module">${code}</script>`);
            delete bundle[name];
          }
        } else if (name.endsWith(".css")) {
          const tag = new RegExp(`<link[^>]*href="[^"]*${escape(name)}"[^>]*>`);
          if (tag.test(html)) {
            html = html.replace(tag, () => `<style>${String(file.source)}</style>`);
            delete bundle[name];
          }
        }
      }
      html = html.replace(/<link rel="modulepreload"[^>]*>/g, "");
      // Sobra só o worker do leitor de PDF, que a demo não usa (anexos não funcionam aqui).
      for (const name of Object.keys(bundle)) if (name.startsWith("assets/")) delete bundle[name];
      delete bundle[htmlName];
      this.emitFile({ type: "asset", fileName, source: html });
    },
  };
}

export default defineConfig(({ mode }) => {
  const clientOnly = mode === "cliente";
  return {
    root: here,
    base: "/",
    publicDir: false,
    define: {
      __BUILD_COMMIT__: JSON.stringify("demo"),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      __DEMO_CLIENT_ONLY__: JSON.stringify(clientOnly),
    },
    plugins: [demoOverrides(), inlinePublicAssets(), react(), tailwindcss({ optimize: false }), singleFile(clientOnly ? "index.html" : "dutelog-demo.html")],
    resolve: {
      alias: { "@": src },
      dedupe: ["react", "react-dom"],
    },
    build: {
      outDir: path.resolve(app, clientOnly ? "dist/demo-cliente" : "dist/demo"),
      emptyOutDir: true,
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      modulePreload: false,
      chunkSizeWarningLimit: 100_000,
      rollupOptions: {
        output: { inlineDynamicImports: true },
      },
    },
    server: { port: 5198, strictPort: true, host: "127.0.0.1" },
  };
});
