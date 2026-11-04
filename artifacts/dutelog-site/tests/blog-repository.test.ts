import test from "node:test";
import assert from "node:assert/strict";
import { FirestoreBlogRepository, MemoryBlogRepository } from "../server/repository.ts";

const actor = { uid: "admin-test", email: "editor@example.test", name: "Editor", role: "admin" as const };
const draft = { title: "Artigo de teste", slug: "artigo-de-teste", excerpt: "Resumo editorial de teste para o artigo.", category: "Armazenagem", service: "armazenagem", cover: { src: "/images/storage.webp", alt: "Armazém" }, body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Conteúdo de teste" }] }] } };

test("draft updates use compare-and-swap and never change publication fields", async () => {
  const repo = new MemoryBlogRepository();
  const first = await repo.createDraft(draft, actor);
  const results = await Promise.allSettled([
    repo.saveDraft(first.id, { ...draft, title: "Primeira aba" }, first.revision, actor),
    repo.saveDraft(first.id, { ...draft, title: "Segunda aba" }, first.revision, actor),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const failure = results.find(result => result.status === "rejected");
  assert.equal(failure?.reason.status, 409);
  const saved = await repo.getDraft(first.id);
  assert.equal(saved?.revision, 2);
  assert.equal(saved?.publishedAt, null);
  assert.equal(saved?.publishedSlug, null);
});

test("legacy import is idempotent and never overwrites an edited draft", async () => {
  const repo = new MemoryBlogRepository();
  assert.equal(await repo.importLegacy([draft], actor), 1);
  const [first] = await repo.listDrafts();
  await repo.saveDraft(first.id, { ...draft, title: "Minha edição" }, first.revision, actor);
  assert.equal(await repo.importLegacy([draft], actor), 0);
  const [saved] = await repo.listDrafts();
  assert.equal(saved.draft.title, "Minha edição");
  assert.equal(saved.publishedSlug, draft.slug);
  assert.equal((await repo.listDrafts()).length, 1);
});

test("manual publication snapshots content; later saves do not change the public version", async () => {
  const repo = new MemoryBlogRepository();
  const first = await repo.createDraft(draft, actor);
  const published = await repo.publishDraft(first.id, first.revision, actor);
  assert.equal(published.revision, 2);
  assert.equal(published.publishedRevision, 2);
  await repo.saveDraft(first.id, { ...draft, title: "Edição ainda privada" }, published.revision, actor);
  const post = await repo.getPublished(draft.slug);
  assert.equal(post?.content.title, draft.title);
  assert.equal(Object.hasOwn(post!, "updatedBy"), false);
  assert.equal(Object.hasOwn(post!, "draft"), false);
  assert.equal((await repo.getDraft(first.id))?.draft.title, "Edição ainda privada");
});

test("permalinks remain reserved after withdrawal and stale publication is rejected", async () => {
  const repo = new MemoryBlogRepository();
  const first = await repo.createDraft(draft, actor);
  const published = await repo.publishDraft(first.id, first.revision, actor);
  await assert.rejects(repo.publishDraft(first.id, first.revision, actor), { status: 409 });
  const withdrawn = await repo.unpublishDraft(first.id, published.revision, actor);
  assert.equal(withdrawn.publishedAt, null);
  assert.equal(await repo.getPublished(draft.slug), null);
  await assert.rejects(repo.saveDraft(first.id, { ...draft, slug: "outro-endereco" }, withdrawn.revision, actor), { status: 422 });
  const duplicate = await repo.createDraft(draft, actor);
  await assert.rejects(repo.publishDraft(duplicate.id, duplicate.revision, actor), { status: 409 });
});

test("shared images remain public only while at least one published article references them", async () => {
  const repo = new MemoryBlogRepository();
  const imageId = "9f4bf955-6b3b-4bd2-9d18-d799cd321147";
  const media = { id: imageId, src: `/api/blog/media/${imageId}`, alt: "Foto", name: "foto.png", width: 50, height: 40, createdAt: new Date().toISOString() };
  await repo.saveMedia(media);
  const a = await repo.createDraft({ ...draft, cover: { src: media.src, alt: media.alt } }, actor);
  const b = await repo.createDraft({ ...draft, slug: "segundo-artigo", cover: { src: media.src, alt: media.alt } }, actor);
  assert.equal(await repo.isMediaPublished(imageId), false);
  const pa = await repo.publishDraft(a.id, a.revision, actor);
  const pb = await repo.publishDraft(b.id, b.revision, actor);
  assert.equal(await repo.isMediaPublished(imageId), true);
  await repo.unpublishDraft(a.id, pa.revision, actor);
  assert.equal(await repo.isMediaPublished(imageId), true);
  await repo.unpublishDraft(b.id, pb.revision, actor);
  assert.equal(await repo.isMediaPublished(imageId), false);
});

test("legacy migration initializes catalog atomically and cannot restore a withdrawn article", async () => {
  const repo = new MemoryBlogRepository();
  assert.deepEqual(await repo.getCatalog(), { initialized: false, posts: [] });
  await repo.importLegacy([draft], actor);
  assert.equal((await repo.getCatalog()).initialized, true);
  const [first] = await repo.listDrafts();
  await repo.unpublishDraft(first.id, first.revision, actor);
  await repo.importLegacy([draft], actor);
  assert.deepEqual(await repo.getCatalog(), { initialized: true, posts: [] });
});

test("Firestore transactions enforce CAS, reservations, snapshot/media atomicity and one-time migration", { skip: !process.env.BLOG_TEST_FIRESTORE_PROJECT }, async () => {
  const projectId = process.env.BLOG_TEST_FIRESTORE_PROJECT!;
  assert.match(projectId, /^demo-site-blog-tests(?:-[a-z0-9-]+)?$/);
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^(127\.0\.0\.1|localhost):\d+$/);
  const { initializeApp, deleteApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = initializeApp({ projectId }, "blog-repository-test");
  const db = getFirestore(app);
  try {
    const repo = new FirestoreBlogRepository(db);
    assert.deepEqual(await repo.getCatalog(), { initialized: false, posts: [] });
    assert.equal(await repo.importLegacy([draft], actor), 1);
    assert.equal((await repo.getCatalog()).posts.length, 1);
    const [legacy] = await repo.listDrafts();
    const mediaId = "62e76479-5bf0-4322-95e9-01aff1cfc67c";
    const media = { id: mediaId, src: `/api/blog/media/${mediaId}`, alt: "Imagem", name: "imagem.webp", width: 80, height: 60, createdAt: new Date().toISOString() };
    await repo.saveMedia(media);
    const first = await repo.createDraft({ ...draft, slug: "artigo-novo", cover: { src: media.src, alt: media.alt } }, actor);
    const results = await Promise.allSettled([
      repo.saveDraft(first.id, first.draft, first.revision, actor),
      repo.saveDraft(first.id, { ...first.draft, title: "Outra aba" }, first.revision, actor),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
    const saved = (await repo.getDraft(first.id))!;
    const published = await repo.publishDraft(saved.id, saved.revision, actor);
    assert.equal(await repo.isMediaPublished(mediaId), true);
    const publicTitle = (await repo.getPublished("artigo-novo"))!.content.title;
    const privateEdit = await repo.saveDraft(saved.id, { ...saved.draft, title: "Edição privada" }, published.revision, actor);
    assert.equal((await repo.getPublished("artigo-novo"))!.content.title, publicTitle);
    const withdrawn = await repo.unpublishDraft(saved.id, privateEdit.revision, actor);
    assert.equal(await repo.isMediaPublished(mediaId), false);
    assert.equal(await repo.getPublished("artigo-novo"), null);
    assert.equal(withdrawn.publishedSlug, "artigo-novo");
    const collision = await repo.createDraft({ ...draft, slug: "artigo-novo" }, actor);
    await assert.rejects(repo.publishDraft(collision.id, collision.revision, actor), { status: 409 });
    await repo.unpublishDraft(legacy.id, legacy.revision, actor);
    assert.equal(await repo.importLegacy([draft], actor), 0);
    assert.deepEqual(await repo.getCatalog(), { initialized: true, posts: [] });
    await assert.rejects(repo.getDraft("../users/owner"), { status: 404 });
  } finally { await db.terminate(); await deleteApp(app); }
});
