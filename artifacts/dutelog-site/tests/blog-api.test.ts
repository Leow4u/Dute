import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import sharp from "sharp";
import type { AddressInfo } from "node:net";
import { createBlogApi } from "../server/api.ts";
import { MemoryBlogRepository } from "../server/repository.ts";
import type { BlogAuth, BlogMediaStorage, BlogProfile } from "../server/types.ts";
import { createFirebaseBlogDependencies } from "../server/firebase.ts";

const origin = "https://www.dutelog.com.br";
const now = new Date("2026-11-04T19:00:00Z");
const draft = { title: "Artigo de teste", slug: "artigo-de-teste", excerpt: "Resumo editorial de teste para o artigo.", category: "Armazenagem", service: "armazenagem", cover: { src: "/images/storage.webp", alt: "Armazém" }, body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Conteúdo de teste" }] }] } };

async function fixture() {
  let profile: BlogProfile = { role: "admin", nome: "Editor", email: "editor@example.test" };
  let revoked = false;
  const auth: BlogAuth = {
    async verifyIdToken(token) { if (token !== "valid" && token !== "stale") throw Error("Invalid token"); return { uid: "editor", email: "editor@example.test", auth_time: now.getTime() / 1000 - (token === "stale" ? 3600 : 30) }; },
    async createSessionCookie() { return "session-value"; },
    async verifySessionCookie(cookie) { if (revoked || cookie !== "session-value") throw Error("Invalid cookie"); return { uid: "editor", email: "editor@example.test", auth_time: now.getTime() / 1000 - 30 }; },
    async getProfile() { return profile; },
  };
  const files = new Map<string, Buffer>();
  const mediaStorage: BlogMediaStorage = { async put(id, bytes) { files.set(id, bytes); }, async get(id) { return files.get(id) ?? null; }, async remove(id) { files.delete(id); } };
  const app = express();
  app.use("/api/blog", createBlogApi({ auth, repository: new MemoryBlogRepository(), mediaStorage, allowedOrigin: origin, secureCookies: true, firebaseConfig: { projectId: "demo-blog", private_key: "synthetic-do-not-expose" }, legacyDrafts: [draft], now: () => now }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/blog`;
  const request = (path: string, init: RequestInit = {}) => fetch(base + path, init);
  const json = (body: unknown, extra: Record<string, string> = {}) => ({ "Content-Type": "application/json", Origin: origin, Cookie: "__Host-dutelog-blog=session-value", ...extra });
  return { request, json, setProfile: (value: BlogProfile) => { profile = value; }, revoke: () => { revoked = true; }, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

test("session login rejects CSRF and stale identities; sets private secure cookie", async () => {
  const f = await fixture();
  try {
    const anonymous = await f.request("/session");
    assert.equal(anonymous.status, 200);
    const initial = await anonymous.json();
    assert.equal(initial.user, null);
    assert.deepEqual(initial.firebaseConfig, { projectId: "demo-blog" });
    const csrf = await f.request("/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: "valid" }) });
    assert.equal(csrf.status, 403);
    const stale = await f.request("/session", { method: "POST", headers: f.json(null), body: JSON.stringify({ idToken: "stale" }) });
    assert.equal(stale.status, 401);
    const login = await f.request("/session", { method: "POST", headers: f.json(null), body: JSON.stringify({ idToken: "valid" }) });
    assert.equal(login.status, 200);
    assert.match(login.headers.get("set-cookie")!, /__Host-dutelog-blog=.*HttpOnly; Secure; SameSite=Strict/);
    assert.equal(login.headers.get("cache-control"), "no-store");
    assert.deepEqual((await login.json()).user.uid, "editor");
  } finally { await f.close(); }
});

test("all private endpoints recheck live role, access removal and token revocation", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request("/drafts")).status, 401);
    assert.equal((await f.request("/media/9f4bf955-6b3b-4bd2-9d18-d799cd321147")).status, 401);
    f.setProfile({ role: "cliente" });
    assert.equal((await f.request("/drafts", { headers: f.json(null) })).status, 403);
    f.setProfile({ role: "admin", access_disabled: true });
    assert.equal((await f.request("/drafts", { headers: f.json(null) })).status, 403);
    f.setProfile({ role: "owner" }); f.revoke();
    assert.equal((await f.request("/drafts", { headers: f.json(null) })).status, 401);
  } finally { await f.close(); }
});

test("draft saves are private, revision checked, and legacy import is explicit", async () => {
  const f = await fixture();
  try {
    const initialList = await (await f.request("/drafts", { headers: f.json(null) })).json();
    assert.equal(initialList.items.length, 0);
    assert.equal(initialList.initialized, false);
    const create = await f.request("/drafts", { method: "POST", headers: f.json(null), body: JSON.stringify({ draft }) });
    assert.equal(create.status, 201);
    const { item } = await create.json();
    const save = await f.request(`/drafts/${item.id}`, { method: "PUT", headers: f.json(null), body: JSON.stringify({ draft: { ...draft, title: "Editado" }, revision: item.revision }) });
    assert.equal(save.status, 200);
    assert.equal((await f.request(`/drafts/${item.id}`, { method: "PUT", headers: f.json(null), body: JSON.stringify({ draft, revision: item.revision }) })).status, 409);
    assert.equal((await (await f.request(`/drafts/${item.id}`, { headers: f.json(null) })).json()).item.publishedAt, null);
    const imported = await f.request("/import-existing", { method: "POST", headers: f.json(null), body: "{}" });
    assert.equal(imported.status, 200);
    assert.equal((await imported.json()).imported, 1);
    assert.equal((await (await f.request("/drafts", { headers: f.json(null) })).json()).initialized, true);
  } finally { await f.close(); }
});

test("demo configuration cannot mix emulated authentication with real data services", () => {
  const keys = ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "STORAGE_EMULATOR_HOST", "FIREBASE_STORAGE_EMULATOR_HOST"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    const options = { projectId: "demo-site-blog-tests", storageBucket: "demo-site-blog-tests.appspot.com", firebaseConfig: { projectId: "demo-site-blog-tests" }, allowedOrigin: "http://127.0.0.1:4178", secureCookies: false, authEmulatorUrl: "http://127.0.0.1:9198" };
    assert.throws(() => createFirebaseBlogDependencies(options), /emuladores/i);
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9198";
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8188";
    process.env.FIREBASE_STORAGE_EMULATOR_HOST = "outside.example:9298";
    assert.throws(() => createFirebaseBlogDependencies(options), /locais/i);
    assert.throws(() => createFirebaseBlogDependencies({ ...options, projectId: "dute-prod", firebaseConfig: { projectId: "dute-prod" }, allowedOrigin: origin, secureCookies: true }), /demo-/i);
  } finally {
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
});

test("publication is manual, revision checked and makes only referenced media public", async () => {
  const f = await fixture();
  try {
    const image = await sharp({ create: { width: 50, height: 40, channels: 3, background: "green" } }).png().toBuffer();
    const uploaded = await f.request("/media", { method: "POST", headers: { ...f.json(null), "Content-Type": "image/png", "X-File-Name": "foto.png", "X-Image-Alt": "Foto" }, body: image });
    assert.equal(uploaded.status, 201);
    const media = (await uploaded.json()).item;
    assert.equal((await f.request(`/media/${media.id}`)).status, 401);
    const created = await f.request("/drafts", { method: "POST", headers: f.json(null), body: JSON.stringify({ draft: { ...draft, slug: "novo-artigo", cover: { src: media.src, alt: media.alt } } }) });
    assert.equal(created.status, 201);
    const record = (await created.json()).item;
    assert.equal((await f.request(`/drafts/${record.id}/publish`, { method: "POST", headers: f.json(null, { Origin: "https://attacker.test" }), body: JSON.stringify({ revision: record.revision }) })).status, 403);
    const published = await f.request(`/drafts/${record.id}/publish`, { method: "POST", headers: f.json(null), body: JSON.stringify({ revision: record.revision }) });
    assert.equal(published.status, 200);
    const publicMedia = await f.request(`/media/${media.id}`);
    assert.equal(publicMedia.status, 200);
    assert.equal(publicMedia.headers.get("cache-control"), "no-cache");
    assert.equal(publicMedia.headers.get("content-type"), "image/webp");
    assert.equal((await f.request(`/drafts/${record.id}`)).status, 401);
    const publishedRecord = (await published.json()).item;
    const withdrawn = await f.request(`/drafts/${record.id}/unpublish`, { method: "POST", headers: f.json(null), body: JSON.stringify({ revision: publishedRecord.revision }) });
    assert.equal(withdrawn.status, 200);
    assert.equal((await f.request(`/media/${media.id}`)).status, 401);
  } finally { await f.close(); }
});
