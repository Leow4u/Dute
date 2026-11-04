import { createHash, randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { mediaIds, validatePublication, type BlogActor, type BlogDraft, type BlogMedia, type BlogRecord, type PublishedBlogPost } from "../src/blog/model.ts";
import { BlogError, BLOG_DRAFTS_COLLECTION, BLOG_MEDIA_COLLECTION, BLOG_POSTS_COLLECTION, BLOG_SLUGS_COLLECTION, BLOG_META_COLLECTION, assertBlogId, type BlogRepository } from "./types.ts";

function importedId(slug: string) {
  const hash = createHash("sha256").update("dutelog-blog-legacy:" + slug).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
function assertSlug(slug: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 180) throw new BlogError(404, "not-found", "Artigo não encontrado.");
  return slug;
}
function record(id: string, draft: BlogDraft, actor: BlogActor, now: Date): BlogRecord {
  return { id, revision: 1, draft, createdAt: now.toISOString(), updatedAt: now.toISOString(), updatedBy: actor, publishedAt: null, publishedSlug: null, publishedRevision: null };
}
function currentRevision(current: BlogRecord | null, revision: number): BlogRecord {
  if (!current) throw new BlogError(404, "not-found", "Artigo não encontrado.");
  if (current.revision !== revision) throw new BlogError(409, "conflict", "Este artigo foi alterado em outra aba. Sua edição foi preservada; confira a versão salva antes de continuar.");
  return current;
}
function updated(current: BlogRecord | null, draft: BlogDraft, revision: number, actor: BlogActor, now: Date): BlogRecord {
  const previous = currentRevision(current, revision);
  if (previous.publishedSlug && previous.publishedSlug !== draft.slug) throw new BlogError(422, "slug-locked", "O endereço de um artigo já publicado deve ser preservado.");
  return { ...previous, draft, revision: previous.revision + 1, updatedAt: now.toISOString(), updatedBy: actor };
}
function publication(current: BlogRecord, actor: BlogActor, now: Date) {
  let content: BlogDraft;
  try { content = validatePublication(current.draft); } catch (error) { throw new BlogError(422, "invalid-content", error instanceof Error ? error.message : "Complete o artigo antes de publicar."); }
  const item = updated(current, content, current.revision, actor, now);
  item.publishedAt = current.publishedAt ?? now.toISOString();
  item.publishedSlug = content.slug;
  item.publishedRevision = item.revision;
  return { item, post: { id: item.id, content, publishedAt: item.publishedAt, updatedAt: item.updatedAt } satisfies PublishedBlogPost };
}
function postData(value: Record<string, unknown>): PublishedBlogPost {
  return { id: value.id as string, content: value.content as BlogDraft, publishedAt: value.publishedAt as string, updatedAt: value.updatedAt as string };
}
function mediaData(id: string, value: Record<string, unknown>): BlogMedia {
  return { id, src: value.src as string, name: value.name as string, alt: value.alt as string, width: value.width as number, height: value.height as number, createdAt: value.createdAt as string };
}
const slugConflict = () => new BlogError(409, "slug-conflict", "Este endereço já pertence a outro artigo. Escolha outro endereço.");
const missingImage = () => new BlogError(422, "invalid-image", "Uma imagem do artigo não foi encontrada na biblioteca.");
function mediaReferences(value: unknown): string[] { return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []; }

export class FirestoreBlogRepository implements BlogRepository {
  private db: Firestore;
  private now: () => Date;
  constructor(db: Firestore, now: () => Date = () => new Date()) { this.db = db; this.now = now; }
  async listDrafts() {
    const result = await this.db.collection(BLOG_DRAFTS_COLLECTION).orderBy("updatedAt", "desc").get();
    return result.docs.map(doc => ({ ...doc.data(), id: doc.id }) as BlogRecord);
  }
  async getDraft(id: string) {
    const result = await this.db.collection(BLOG_DRAFTS_COLLECTION).doc(assertBlogId(id)).get();
    return result.exists ? ({ ...result.data(), id: result.id } as BlogRecord) : null;
  }
  async createDraft(draft: BlogDraft, actor: BlogActor) {
    const item = record(randomUUID(), draft, actor, this.now());
    await this.db.collection(BLOG_DRAFTS_COLLECTION).doc(item.id).create(item);
    return item;
  }
  async saveDraft(id: string, draft: BlogDraft, revision: number, actor: BlogActor) {
    const ref = this.db.collection(BLOG_DRAFTS_COLLECTION).doc(assertBlogId(id));
    return this.db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      const item = updated(snapshot.exists ? ({ ...snapshot.data(), id } as BlogRecord) : null, draft, revision, actor, this.now());
      tx.set(ref, item);
      return item;
    });
  }
  async publishDraft(id: string, revision: number, actor: BlogActor) {
    const draftRef = this.db.collection(BLOG_DRAFTS_COLLECTION).doc(assertBlogId(id));
    return this.db.runTransaction(async tx => {
      const draftSnapshot = await tx.get(draftRef);
      const previous = currentRevision(draftSnapshot.exists ? draftSnapshot.data() as BlogRecord : null, revision);
      const { item, post } = publication(previous, actor, this.now());
      const postRef = this.db.collection(BLOG_POSTS_COLLECTION).doc(assertSlug(post.content.slug));
      const slugRef = this.db.collection(BLOG_SLUGS_COLLECTION).doc(post.content.slug);
      const [slugSnapshot, postSnapshot] = await tx.getAll(slugRef, postRef);
      if ((slugSnapshot.exists && slugSnapshot.get("id") !== id) || (postSnapshot.exists && postSnapshot.get("id") !== id)) throw slugConflict();
      const oldMedia = postSnapshot.exists ? mediaIds(postData(postSnapshot.data()!).content) : [];
      const newMedia = mediaIds(post.content);
      const ids = [...new Set([...oldMedia, ...newMedia])];
      const mediaSnapshots = ids.length ? await tx.getAll(...ids.map(mediaId => this.db.collection(BLOG_MEDIA_COLLECTION).doc(assertBlogId(mediaId)))) : [];
      for (const snapshot of mediaSnapshots) if (newMedia.includes(snapshot.id) && !snapshot.exists) throw missingImage();
      tx.set(draftRef, item);
      tx.set(postRef, post);
      tx.set(slugRef, { id });
      for (const snapshot of mediaSnapshots) {
        if (!snapshot.exists) continue;
        const refs = mediaReferences(snapshot.get("publishedPostIds")).filter(postId => postId !== id);
        if (newMedia.includes(snapshot.id)) refs.push(id);
        tx.update(snapshot.ref, { publishedPostIds: refs });
      }
      return item;
    });
  }
  async unpublishDraft(id: string, revision: number, actor: BlogActor) {
    const draftRef = this.db.collection(BLOG_DRAFTS_COLLECTION).doc(assertBlogId(id));
    return this.db.runTransaction(async tx => {
      const snapshot = await tx.get(draftRef);
      const previous = currentRevision(snapshot.exists ? snapshot.data() as BlogRecord : null, revision);
      if (!previous.publishedAt || !previous.publishedSlug) throw new BlogError(409, "not-published", "Este artigo já está fora do ar.");
      const postRef = this.db.collection(BLOG_POSTS_COLLECTION).doc(assertSlug(previous.publishedSlug));
      const postSnapshot = await tx.get(postRef);
      if (postSnapshot.exists && postSnapshot.get("id") !== id) throw slugConflict();
      const ids = postSnapshot.exists ? mediaIds(postData(postSnapshot.data()!).content) : [];
      const mediaSnapshots = ids.length ? await tx.getAll(...ids.map(mediaId => this.db.collection(BLOG_MEDIA_COLLECTION).doc(assertBlogId(mediaId)))) : [];
      const item = { ...updated(previous, previous.draft, revision, actor, this.now()), publishedAt: null, publishedRevision: null };
      tx.set(draftRef, item);
      tx.delete(postRef);
      for (const media of mediaSnapshots) if (media.exists) tx.update(media.ref, { publishedPostIds: mediaReferences(media.get("publishedPostIds")).filter(postId => postId !== id) });
      return item;
    });
  }
  async importLegacy(drafts: BlogDraft[], actor: BlogActor) {
    const marker = this.db.collection(BLOG_META_COLLECTION).doc("catalog");
    const candidates = drafts.map(draft => {
      const content = validatePublication(draft);
      const id = importedId(content.slug);
      return { id, content, draftRef: this.db.collection(BLOG_DRAFTS_COLLECTION).doc(id), postRef: this.db.collection(BLOG_POSTS_COLLECTION).doc(assertSlug(content.slug)), slugRef: this.db.collection(BLOG_SLUGS_COLLECTION).doc(content.slug) };
    });
    return this.db.runTransaction(async tx => {
      const markerSnapshot = await tx.get(marker);
      // Import is a one-time cutover. Repeating it must never restore withdrawals.
      if (markerSnapshot.exists && markerSnapshot.get("initialized") === true) return 0;
      const snapshots = candidates.length ? await tx.getAll(...candidates.flatMap(candidate => [candidate.draftRef, candidate.postRef, candidate.slugRef])) : [];
      let count = 0;
      for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index];
        const [existingDraft, existingPost, existingSlug] = snapshots.slice(index * 3, index * 3 + 3);
        if (existingDraft.exists) continue;
        if ((existingPost.exists && existingPost.get("id") !== candidate.id) || (existingSlug.exists && existingSlug.get("id") !== candidate.id)) throw slugConflict();
        const item = { ...record(candidate.id, candidate.content, actor, this.now()), publishedAt: this.now().toISOString(), publishedSlug: candidate.content.slug, publishedRevision: 1 };
        tx.create(candidate.draftRef, item);
        if (!existingPost.exists) tx.create(candidate.postRef, { id: item.id, content: candidate.content, publishedAt: item.publishedAt, updatedAt: item.updatedAt });
        tx.set(candidate.slugRef, { id: candidate.id });
        count++;
      }
      tx.set(marker, { initialized: true, initializedAt: this.now().toISOString() });
      return count;
    });
  }
  async listPublished() {
    const result = await this.db.collection(BLOG_POSTS_COLLECTION).orderBy("publishedAt", "desc").get();
    return result.docs.map(doc => postData(doc.data()));
  }
  async getPublished(slug: string) {
    const doc = await this.db.collection(BLOG_POSTS_COLLECTION).doc(assertSlug(slug)).get();
    return doc.exists ? postData(doc.data()!) : null;
  }
  async getCatalog() {
    return this.db.runTransaction(async tx => {
      const marker = await tx.get(this.db.collection(BLOG_META_COLLECTION).doc("catalog"));
      const posts = await tx.get(this.db.collection(BLOG_POSTS_COLLECTION).orderBy("publishedAt", "desc"));
      return { initialized: marker.exists && marker.get("initialized") === true, posts: posts.docs.map(doc => postData(doc.data())) };
    }, { readOnly: true });
  }
  async listMedia() {
    const result = await this.db.collection(BLOG_MEDIA_COLLECTION).orderBy("createdAt", "desc").get();
    return result.docs.map(doc => mediaData(doc.id, doc.data()));
  }
  async getMedia(id: string) {
    const result = await this.db.collection(BLOG_MEDIA_COLLECTION).doc(assertBlogId(id)).get();
    return result.exists ? mediaData(result.id, result.data()!) : null;
  }
  async saveMedia(item: BlogMedia) { await this.db.collection(BLOG_MEDIA_COLLECTION).doc(assertBlogId(item.id)).create({ ...item, publishedPostIds: [] }); }
  async isMediaPublished(id: string) {
    const media = await this.db.collection(BLOG_MEDIA_COLLECTION).doc(assertBlogId(id)).get();
    return media.exists && mediaReferences(media.get("publishedPostIds")).length > 0;
  }
}

/** Injectable ephemeral repository for isolated tests and the explicit local demo. */
export class MemoryBlogRepository implements BlogRepository {
  private drafts = new Map<string, BlogRecord>();
  private media = new Map<string, BlogMedia>();
  private posts = new Map<string, PublishedBlogPost>();
  private slugs = new Map<string, string>();
  private initialized = false;
  private now: () => Date;
  constructor(now: () => Date = () => new Date()) { this.now = now; }
  async listDrafts() { return structuredClone([...this.drafts.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); }
  async getDraft(id: string) { return structuredClone(this.drafts.get(assertBlogId(id)) ?? null); }
  async createDraft(draft: BlogDraft, actor: BlogActor) {
    const item = record(randomUUID(), draft, actor, this.now());
    this.drafts.set(item.id, structuredClone(item));
    return structuredClone(item);
  }
  async saveDraft(id: string, draft: BlogDraft, revision: number, actor: BlogActor) {
    const item = updated(this.drafts.get(assertBlogId(id)) ?? null, draft, revision, actor, this.now());
    this.drafts.set(id, structuredClone(item));
    return structuredClone(item);
  }
  async publishDraft(id: string, revision: number, actor: BlogActor) {
    const previous = currentRevision(this.drafts.get(assertBlogId(id)) ?? null, revision);
    const { item, post } = publication(previous, actor, this.now());
    if (this.slugs.has(post.content.slug) && this.slugs.get(post.content.slug) !== id) throw slugConflict();
    if (mediaIds(post.content).some(mediaId => !this.media.has(mediaId))) throw missingImage();
    this.drafts.set(id, structuredClone(item)); this.posts.set(post.content.slug, structuredClone(post)); this.slugs.set(post.content.slug, id);
    return structuredClone(item);
  }
  async unpublishDraft(id: string, revision: number, actor: BlogActor) {
    const previous = currentRevision(this.drafts.get(assertBlogId(id)) ?? null, revision);
    if (!previous.publishedAt || !previous.publishedSlug) throw new BlogError(409, "not-published", "Este artigo já está fora do ar.");
    const item = { ...updated(previous, previous.draft, revision, actor, this.now()), publishedAt: null, publishedRevision: null };
    this.drafts.set(id, structuredClone(item)); this.posts.delete(previous.publishedSlug);
    return structuredClone(item);
  }
  async importLegacy(drafts: BlogDraft[], actor: BlogActor) {
    if (this.initialized) return 0;
    const pending = drafts.map(draft => {
      const content = validatePublication(draft), id = importedId(content.slug);
      if (this.slugs.has(content.slug) && this.slugs.get(content.slug) !== id) throw slugConflict();
      return { id, content };
    });
    let count = 0;
    for (const { id, content } of pending) {
      if (this.drafts.has(id)) continue;
      const item = { ...record(id, content, actor, this.now()), publishedAt: this.now().toISOString(), publishedSlug: content.slug, publishedRevision: 1 };
      this.drafts.set(id, structuredClone(item));
      this.posts.set(content.slug, structuredClone({ id, content, publishedAt: item.publishedAt, updatedAt: item.updatedAt }));
      this.slugs.set(content.slug, id); count++;
    }
    this.initialized = true;
    return count;
  }
  async listPublished() { return structuredClone([...this.posts.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))); }
  async getPublished(slug: string) { return structuredClone(this.posts.get(assertSlug(slug)) ?? null); }
  async getCatalog() { return { initialized: this.initialized, posts: await this.listPublished() }; }
  async listMedia() { return structuredClone([...this.media.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))); }
  async getMedia(id: string) { return structuredClone(this.media.get(assertBlogId(id)) ?? null); }
  async saveMedia(item: BlogMedia) { if (this.media.has(assertBlogId(item.id))) throw new BlogError(409, "conflict", "A imagem já existe."); this.media.set(item.id, structuredClone(item)); }
  async isMediaPublished(id: string) { assertBlogId(id); return [...this.posts.values()].some(post => mediaIds(post.content).includes(id)); }
}
