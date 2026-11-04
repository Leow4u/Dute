import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBlogApi } from "./api.ts";
import { createFirebaseBlogDependencies } from "./firebase.ts";
import { createSiteApp } from "./site.ts";
import { legacyToDraft, parseDraft, readTime, type PublishedBlogPost } from "../src/blog/model.ts";
import { articles as legacyArticles, type Article } from "../src/content.ts";

const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(process.env.BLOG_FIREBASE_CONFIG || "null") as Record<string, string> | null;
if (!config?.projectId || !config.apiKey || !config.storageBucket) throw new Error("Defina BLOG_FIREBASE_CONFIG com a configuração pública do Firebase do painel.");
const origin = new URL(process.env.BLOG_ORIGIN || "https://www.dutelog.com.br").origin;
const localDemo = config.projectId.startsWith("demo-") && new URL(origin).hostname === "127.0.0.1";
if (!localDemo && !["dute-prod", "dute-homolog"].includes(config.projectId)) throw new Error("Projeto não autorizado para o Blog.");
if (localDemo && (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST)) throw new Error("A demonstração local exige os três emuladores.");
const dependencies = createFirebaseBlogDependencies({
  projectId: config.projectId, storageBucket: config.storageBucket, firebaseConfig: config,
  allowedOrigin: origin, secureCookies: !localDemo, legacyDrafts: legacyArticles.map(legacyToDraft),
  ...(localDemo ? { authEmulatorUrl: `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}` } : {}),
});
const ssrPath = new URL("../server/entry-server.js", import.meta.url).href;
const ssr = await import(ssrPath) as { render: Parameters<typeof createSiteApp>[0]["render"]; createRoutes: Parameters<typeof createSiteApp>[0]["routes"] };
function publishedArticle(post: PublishedBlogPost): Article {
  const content = parseDraft(post.content);
  return { title: content.title, slug: content.slug, excerpt: content.excerpt, category: content.category, service: content.service, image: "corporate", cover: content.cover, body: content.body, sections: [], readTime: readTime(content.body) };
}
const app = createSiteApp({
  publicDir: resolve(runtimeDirectory, "../public"),
  template: await readFile(resolve(runtimeDirectory, "../server/template.html"), "utf8"),
  api: createBlogApi(dependencies), origin, render: ssr.render, routes: ssr.createRoutes,
  loadArticles: async () => {
    const catalog = await dependencies.repository.getCatalog();
    return catalog.initialized ? catalog.posts.map(publishedArticle) : legacyArticles;
  },
});
const port = Number(process.env.PORT || 8080);
const server = app.listen(port, "0.0.0.0", () => console.log(`Site Dutelog disponível na porta ${port}.`));
process.on("SIGTERM", () => { server.close(() => process.exit(0)); });
