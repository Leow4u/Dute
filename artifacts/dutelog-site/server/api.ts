import { randomUUID } from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import { mediaIds, parseDraft, validatePublication, type BlogActor, type BlogDraft } from "../src/blog/model.ts";
import { normalizeBlogImage, MAX_IMAGE_BYTES } from "./media.ts";
import { BlogError, assertBlogId, type BlogApiDependencies, type BlogIdentity } from "./types.ts";

const SESSION_DURATION = 5 * 24 * 60 * 60 * 1000;
const LOGIN_RECENCY_SECONDS = 5 * 60;
const forbidden = () => new BlogError(403, "permission-denied", "Seu perfil não tem acesso ao painel do Blog.");
const unauthorized = () => new BlogError(401, "unauthenticated", "Entre novamente para continuar.");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BlogError(422, "invalid-content", "Confira os campos enviados.");
  return value as Record<string, unknown>;
}
function decodedHeader(value: string | undefined, maxLength: number): string {
  try {
    const decoded = decodeURIComponent(value ?? "");
    if (decoded.length > maxLength || /[\u0000-\u001f\u007f]/.test(decoded)) throw new Error("Invalid header");
    return decoded.trim();
  } catch { throw new BlogError(422, "invalid-content", "Confira o nome e a descrição da imagem."); }
}
function onlyFields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new BlogError(422, "invalid-content", "A solicitação contém campos não permitidos.");
}

export function createBlogApi(deps: BlogApiDependencies) {
  const router = express.Router();
  const now = deps.now ?? (() => new Date());
  const publicConfigKeys = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId", "measurementId"];
  const firebaseConfig = Object.fromEntries(publicConfigKeys.filter(key => typeof deps.firebaseConfig[key] === "string").map(key => [key, deps.firebaseConfig[key]]));
  const allowedOrigin = new URL(deps.allowedOrigin).origin;
  if (allowedOrigin !== deps.allowedOrigin || !/^https?:$/.test(new URL(allowedOrigin).protocol)) throw new Error("A origem do painel deve ser uma origem HTTP(S) exata.");
  const cookieName = deps.secureCookies ? "__Host-dutelog-blog" : "dutelog-blog";
  const cookieOptions = { httpOnly: true, secure: deps.secureCookies, sameSite: "strict" as const, path: "/", maxAge: SESSION_DURATION };
  const json = express.json({ limit: "512kb", strict: true });
  function clearSession(res: Response) { res.clearCookie(cookieName, { httpOnly: true, secure: deps.secureCookies, sameSite: "strict", path: "/" }); }
  function sessionCookie(req: Request) {
    const matches = (req.headers.cookie ?? "").split(";").map(part => part.trim()).filter(part => part.startsWith(cookieName + "="));
    if (matches.length !== 1) return null;
    const value = matches[0].slice(cookieName.length + 1);
    return value.length <= 10_000 ? value : null;
  }
  async function actor(identity: BlogIdentity): Promise<BlogActor> {
    const profile = await deps.auth.getProfile(identity.uid);
    if (!profile || profile.access_disabled === true || (profile.role !== "owner" && profile.role !== "admin")) throw forbidden();
    return { uid: identity.uid, role: profile.role, email: identity.email ?? (typeof profile.email === "string" ? profile.email : ""), name: typeof profile.nome === "string" ? profile.nome : identity.name ?? "Editor" };
  }
  async function session(req: Request) {
    const cookie = sessionCookie(req);
    if (!cookie) throw unauthorized();
    let identity: BlogIdentity;
    try { identity = await deps.auth.verifySessionCookie(cookie); } catch { throw unauthorized(); }
    return actor(identity);
  }
  const requireSession = async (req: Request, res: Response, next: NextFunction) => {
    try { res.locals.blogActor = await session(req); next(); } catch (error) { next(error); }
  };
  const requireJson = (req: Request, _res: Response, next: NextFunction) => {
    if (!req.is("application/json")) return next(new BlogError(415, "invalid-content-type", "Envie os dados em formato JSON."));
    next();
  };
  async function validatedDraft(input: unknown): Promise<BlogDraft> {
    let draft: BlogDraft;
    try { draft = parseDraft(input); } catch (error) { throw new BlogError(422, "invalid-content", error instanceof Error ? error.message : "Confira o conteúdo do artigo."); }
    for (const id of mediaIds(draft)) {
      if (!await deps.repository.getMedia(id)) throw new BlogError(422, "invalid-image", "Uma imagem do artigo não foi encontrada na biblioteca.");
    }
    return draft;
  }
  function legacyCatalog(): BlogDraft[] {
    if (!deps.legacyDrafts) throw new BlogError(503, "catalog-unavailable", "O catálogo inicial não está disponível. Tente novamente antes de publicar.");
    return deps.legacyDrafts.map(draft => validatePublication(draft));
  }
  router.use((req, res, next) => {
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("Origin") !== allowedOrigin) return next(new BlogError(403, "invalid-origin", "Reabra o painel no endereço oficial para continuar."));
    next();
  });
  router.get("/session", async (req, res, next) => {
    let user: BlogActor | null = null;
    if (sessionCookie(req)) {
      try { user = await session(req); } catch (error) {
        clearSession(res);
        if (!(error instanceof BlogError) || error.status !== 401) return next(error);
      }
    }
    res.json({ user, firebaseConfig, ...(deps.authEmulatorUrl ? { authEmulatorUrl: deps.authEmulatorUrl } : {}) });
  });
  router.post("/session", requireJson, json, async (req, res) => {
    const body = object(req.body);
    onlyFields(body, ["idToken"]);
    if (typeof body.idToken !== "string" || body.idToken.length < 1 || body.idToken.length > 10_000) throw unauthorized();
    let identity: BlogIdentity;
    try { identity = await deps.auth.verifyIdToken(body.idToken); } catch { throw unauthorized(); }
    const age = now().getTime() / 1000 - identity.auth_time;
    if (!Number.isFinite(age) || age < -60 || age > LOGIN_RECENCY_SECONDS) throw new BlogError(401, "recent-login-required", "Para entrar no painel, informe sua senha novamente.");
    const user = await actor(identity);
    const value = await deps.auth.createSessionCookie(body.idToken, SESSION_DURATION);
    res.cookie(cookieName, value, cookieOptions).json({ user });
  });
  router.delete("/session", (_req, res) => { clearSession(res); res.json({ user: null }); });
  router.get("/media/:id", async (req, res) => {
    const id = assertBlogId(String(req.params.id));
    const isPublic = await deps.repository.isMediaPublished(id);
    if (!isPublic) await session(req);
    const media = await deps.repository.getMedia(id);
    if (!media) throw new BlogError(404, "not-found", "Imagem não encontrada.");
    const bytes = await deps.mediaStorage.get(id);
    if (!bytes) throw new BlogError(404, "not-found", "Imagem não encontrada.");
    // A withdrawn asset is reauthorized on its next request; never mark it immutable.
    if (isPublic) res.set("Cache-Control", "no-cache");
    res.set({ "Content-Type": "image/webp", "Content-Disposition": `inline; filename="${id}.webp"` }).send(bytes);
  });
  router.use(requireSession);
  router.get("/drafts", async (_req, res) => {
    const [items, catalog] = await Promise.all([deps.repository.listDrafts(), deps.repository.getCatalog()]);
    res.json({ items, initialized: catalog.initialized });
  });
  router.post("/drafts", requireJson, json, async (req, res) => {
    const body = object(req.body); onlyFields(body, ["draft"]);
    const draft = await validatedDraft(body.draft);
    res.status(201).json({ item: await deps.repository.createDraft(draft, res.locals.blogActor as BlogActor) });
  });
  router.get("/drafts/:id", async (req, res) => {
    const item = await deps.repository.getDraft(assertBlogId(String(req.params.id)));
    if (!item) throw new BlogError(404, "not-found", "Artigo não encontrado.");
    res.json({ item });
  });
  router.put("/drafts/:id", requireJson, json, async (req, res) => {
    const body = object(req.body); onlyFields(body, ["draft", "revision"]);
    if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 1) throw new BlogError(422, "invalid-revision", "A versão do artigo é inválida. Reabra o artigo para continuar.");
    const draft = await validatedDraft(body.draft);
    res.json({ item: await deps.repository.saveDraft(assertBlogId(String(req.params.id)), draft, Number(body.revision), res.locals.blogActor as BlogActor) });
  });
  router.post("/drafts/:id/publish", requireJson, json, async (req, res) => {
    const body = object(req.body); onlyFields(body, ["revision"]);
    if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 1) throw new BlogError(422, "invalid-revision", "Reabra o artigo antes de publicar.");
    const id = assertBlogId(String(req.params.id));
    const current = await deps.repository.getDraft(id);
    if (!current) throw new BlogError(404, "not-found", "Artigo não encontrado.");
    if (current.revision !== body.revision) throw new BlogError(409, "conflict", "Este artigo foi alterado em outra aba. Confira a versão salva antes de publicar.");
    const content = await validatedDraft(current.draft);
    try { validatePublication(content); } catch (error) { throw new BlogError(422, "invalid-content", error instanceof Error ? error.message : "Complete o artigo antes de publicar."); }
    // The first explicit publication imports the existing public catalog; saving never does.
    if (!(await deps.repository.getCatalog()).initialized) await deps.repository.importLegacy(legacyCatalog(), res.locals.blogActor as BlogActor);
    res.json({ item: await deps.repository.publishDraft(id, Number(body.revision), res.locals.blogActor as BlogActor) });
  });
  router.post("/drafts/:id/unpublish", requireJson, json, async (req, res) => {
    const body = object(req.body); onlyFields(body, ["revision"]);
    if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 1) throw new BlogError(422, "invalid-revision", "Reabra o artigo antes de retirar do ar.");
    res.json({ item: await deps.repository.unpublishDraft(assertBlogId(String(req.params.id)), Number(body.revision), res.locals.blogActor as BlogActor) });
  });
  router.post("/import-existing", requireJson, json, async (req, res) => {
    onlyFields(object(req.body), []);
    const drafts = legacyCatalog();
    res.json({ imported: await deps.repository.importLegacy(drafts, res.locals.blogActor as BlogActor) });
  });
  router.get("/media", async (_req, res) => { res.json({ items: await deps.repository.listMedia() }); });
  router.post("/media", express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }), async (req, res) => {
    const name = decodedHeader(req.get("X-File-Name"), 255).replace(/[/\\]/g, "-") || "Imagem";
    const alt = decodedHeader(req.get("X-Image-Alt"), 500);
    const image = await normalizeBlogImage(req.body as Buffer, (req.get("Content-Type") ?? "").split(";")[0].trim());
    const id = randomUUID();
    const item = { id, src: `/api/blog/media/${id}`, name, alt, width: image.width, height: image.height, createdAt: now().toISOString() };
    await deps.mediaStorage.put(id, image.bytes);
    try { await deps.repository.saveMedia(item); } catch (error) {
      try { await deps.mediaStorage.remove(id); } catch { /* Private orphan: never made public; preserve original save error. */ }
      throw error;
    }
    res.status(201).json({ item });
  });
  router.use((_req, _res, next) => next(new BlogError(404, "not-found", "Recurso não encontrado.")));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof BlogError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    const bodyError = error as { type?: string };
    if (bodyError?.type === "entity.too.large") return res.status(413).json({ error: { code: "payload-too-large", message: "O arquivo ou conteúdo ultrapassou o tamanho permitido." } });
    if (bodyError?.type === "entity.parse.failed") return res.status(400).json({ error: { code: "invalid-json", message: "Não foi possível ler os dados enviados." } });
    return res.status(503).json({ error: { code: "unavailable", message: "Não foi possível concluir a operação. Seu conteúdo foi preservado; tente novamente." } });
  });
  return router;
}
