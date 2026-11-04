import express, { type Router } from "express";
import type { Article } from "../src/content.ts";
import type { SiteRoute } from "../src/routes.ts";
import { join } from "node:path";
import { adminDocument, escapeHtml, renderDocument } from "./html.ts";
export type SiteOptions = {
  publicDir: string;
  template: string;
  api: Router;
  origin: string;
  loadArticles: () => Promise<Article[]>;
  render: (path: string, articles: Article[]) => { html: string; route: SiteRoute };
  routes: (articles: Article[]) => SiteRoute[];
};
export function createSiteApp(options: SiteOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "X-Frame-Options": "SAMEORIGIN" });
    next();
  });
  app.get(["/health", "/healthz"], (_req, res) => res.type("text").send("ok\n"));
  app.use("/api/blog", options.api);
  app.use("/api", (_req, res) => res.status(404).set("Cache-Control", "no-store").json({ error: { code: "not-found", message: "Recurso não encontrado." } }));
  for (const directory of ["assets", "images", "fonts"]) {
    app.use(`/${directory}`, express.static(join(options.publicDir, directory), { index: false, redirect: false, maxAge: directory === "assets" ? "1y" : "1h", immutable: directory === "assets" }));
  }
  for (const name of ["favicon.png", "favicon.ico", "dutelog-logo.png", "dutelog-logo-light.png"]) app.get(`/${name}`, (_req, res, next) => res.sendFile(join(options.publicDir, name), (error) => error && next()));
  app.get("/robots.txt", (_req, res) => res.type("text").send(`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nSitemap: ${options.origin}/sitemap.xml\n`));
  app.get(/^\/admin\/blog(?:\/.*)?$/, (req, res) => {
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" });
    if (options.origin.startsWith("https:") && req.hostname !== new URL(options.origin).hostname) { res.redirect(302, options.origin + req.originalUrl); return; }
    if (req.path === "/admin/blog") { res.redirect(301, "/admin/blog/" + req.originalUrl.slice(req.path.length)); return; }
    res.type("html").send(adminDocument(options.template));
  });
  app.get("/sitemap.xml", async (_req, res, next) => {
    try {
      const articles = await options.loadArticles();
      res.set("Cache-Control", "no-cache").type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${options.routes(articles).map((route) => `<url><loc>${escapeHtml(options.origin + route.path)}</loc></url>`).join("")}</urlset>`);
    } catch (error) { next(error); }
  });
  app.use(async (req, res, next) => {
    if (!["GET", "HEAD"].includes(req.method)) { res.status(405).set("Allow", "GET, HEAD").end(); return; }
    try {
      const articles = await options.loadArticles();
      const pathname = req.path.replace(/\/index\.html$/, "/").replace(/\/?$/, "/");
      const result = options.render(pathname, articles);
      if (result.route.kind !== "notfound" && req.path !== result.route.path) {
        res.redirect(301, result.route.path + req.originalUrl.slice(req.path.length)); return;
      }
      res.status(result.route.kind === "notfound" ? 404 : 200).set("Cache-Control", "no-cache").type("html").send(renderDocument(options.template, options.origin, result, articles));
    } catch (error) { next(error); }
  });
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(503).set({ "Cache-Control": "no-store", "Retry-After": "30" }).type("html").send('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Temporariamente indisponível | Dutelog</title><h1>Voltamos em instantes.</h1><p>Não foi possível carregar o conteúdo. Tente novamente ou fale com <a href="mailto:comercial@dutelog.com.br">comercial@dutelog.com.br</a>.</p></html>');
  });
  return app;
}
