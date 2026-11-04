import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import type { BlogDraft } from "../src/blog/model.ts";
import { FirestoreBlogRepository } from "./repository.ts";
import { BLOG_STORAGE_PREFIX, assertBlogId, type BlogApiDependencies, type BlogProfile } from "./types.ts";

export type FirebaseBlogOptions = {
  projectId: string;
  storageBucket: string;
  firebaseConfig: Record<string, string>;
  allowedOrigin: string;
  secureCookies: boolean;
  legacyDrafts?: BlogDraft[];
  authEmulatorUrl?: string;
  app?: App;
};

export function createFirebaseBlogDependencies(options: FirebaseBlogOptions): BlogApiDependencies {
  const origin = new URL(options.allowedOrigin);
  const localDemo = options.projectId.startsWith("demo-") && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  const usesEmulator = options.authEmulatorUrl || ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "STORAGE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"].some(key => Boolean(process.env[key]));
  if (usesEmulator && !localDemo) throw new Error("Emuladores do Blog exigem projeto demo- e origem local.");
  if (localDemo) {
    const hosts = [process.env.FIREBASE_AUTH_EMULATOR_HOST, process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? process.env.STORAGE_EMULATOR_HOST];
    if (hosts.some(host => !host)) throw new Error("A demonstração exige os emuladores de Auth, Firestore e Storage juntos.");
    if (hosts.some(host => !/^(?:http:\/\/)?(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host!))) throw new Error("Use apenas emuladores locais na demonstração.");
    if (options.authEmulatorUrl && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(options.authEmulatorUrl).hostname)) throw new Error("Use apenas emuladores locais na demonstração.");
  }
  if (!options.secureCookies && !localDemo) throw new Error("Cookies sem HTTPS são permitidos somente na demonstração local.");
  if (options.secureCookies && origin.protocol !== "https:") throw new Error("O painel de produção exige uma origem HTTPS.");
  if (!options.projectId || !options.storageBucket || options.firebaseConfig.projectId !== options.projectId) throw new Error("Configuração Firebase do Blog inconsistente.");
  const app = options.app ?? getApps().find(app => app.name === "dutelog-blog") ?? initializeApp({ projectId: options.projectId, storageBucket: options.storageBucket }, "dutelog-blog");
  if (app.options.projectId !== options.projectId) throw new Error("A instância Firebase do Blog pertence a outro projeto.");
  const auth = getAuth(app);
  const db = getFirestore(app);
  const bucket = getStorage(app).bucket(options.storageBucket);
  const file = (id: string) => bucket.file(`${BLOG_STORAGE_PREFIX}/${assertBlogId(id)}/image.webp`);
  return {
    allowedOrigin: options.allowedOrigin,
    secureCookies: options.secureCookies,
    firebaseConfig: options.firebaseConfig,
    legacyDrafts: options.legacyDrafts,
    ...(options.authEmulatorUrl ? { authEmulatorUrl: options.authEmulatorUrl } : {}),
    repository: new FirestoreBlogRepository(db),
    auth: {
      async verifyIdToken(token) { return auth.verifyIdToken(token, true); },
      async createSessionCookie(token, expiresIn) { return auth.createSessionCookie(token, { expiresIn }); },
      async verifySessionCookie(cookie) { return auth.verifySessionCookie(cookie, true); },
      async getProfile(uid) {
        const profile = await db.collection("users").doc(uid).get();
        return profile.exists ? profile.data() as BlogProfile : null;
      },
    },
    mediaStorage: {
      async put(id, bytes) { await file(id).save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: "image/webp", cacheControl: "private, no-store" } }); },
      async get(id) {
        try { return (await file(id).download())[0]; } catch (error) { if ((error as { code?: number }).code === 404) return null; throw error; }
      },
      async remove(id) { await file(id).delete({ ignoreNotFound: true }); },
    },
  };
}
