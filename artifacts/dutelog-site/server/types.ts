import type { BlogActor, BlogDraft, BlogMedia, BlogRecord, PublishedBlogPost } from "../src/blog/model.ts";

export class BlogError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "BlogError";
    this.status = status;
    this.code = code;
  }
}

export type BlogIdentity = { uid: string; email?: string; name?: string; auth_time: number };
export type BlogProfile = { role?: unknown; access_disabled?: unknown; nome?: unknown; email?: unknown };
export interface BlogAuth {
  verifyIdToken(token: string): Promise<BlogIdentity>;
  createSessionCookie(token: string, expiresIn: number): Promise<string>;
  verifySessionCookie(cookie: string): Promise<BlogIdentity>;
  getProfile(uid: string): Promise<BlogProfile | null>;
}
export interface BlogRepository {
  listDrafts(): Promise<BlogRecord[]>;
  getDraft(id: string): Promise<BlogRecord | null>;
  createDraft(draft: BlogDraft, actor: BlogActor): Promise<BlogRecord>;
  saveDraft(id: string, draft: BlogDraft, revision: number, actor: BlogActor): Promise<BlogRecord>;
  importLegacy(drafts: BlogDraft[], actor: BlogActor): Promise<number>;
  publishDraft(id: string, revision: number, actor: BlogActor): Promise<BlogRecord>;
  unpublishDraft(id: string, revision: number, actor: BlogActor): Promise<BlogRecord>;
  listPublished(): Promise<PublishedBlogPost[]>;
  getPublished(slug: string): Promise<PublishedBlogPost | null>;
  getCatalog(): Promise<{ initialized: boolean; posts: PublishedBlogPost[] }>;
  isMediaPublished(id: string): Promise<boolean>;
  listMedia(): Promise<BlogMedia[]>;
  getMedia(id: string): Promise<BlogMedia | null>;
  saveMedia(media: BlogMedia): Promise<void>;
}
export interface BlogMediaStorage {
  put(id: string, bytes: Buffer): Promise<void>;
  get(id: string): Promise<Buffer | null>;
  remove(id: string): Promise<void>;
}
export type BlogApiDependencies = {
  repository: BlogRepository;
  auth: BlogAuth;
  mediaStorage: BlogMediaStorage;
  firebaseConfig: Record<string, string>;
  allowedOrigin: string;
  secureCookies: boolean;
  legacyDrafts?: BlogDraft[];
  authEmulatorUrl?: string;
  now?: () => Date;
};

export const BLOG_DRAFTS_COLLECTION = "site_blog_drafts";
export const BLOG_MEDIA_COLLECTION = "site_blog_media";
export const BLOG_POSTS_COLLECTION = "site_blog_posts";
export const BLOG_SLUGS_COLLECTION = "site_blog_slugs";
export const BLOG_META_COLLECTION = "site_blog_meta";
export const BLOG_STORAGE_PREFIX = "site-blog";
export const BLOG_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function assertBlogId(id: string): string {
  if (!BLOG_UUID.test(id)) throw new BlogError(404, "not-found", "Conteúdo não encontrado.");
  return id;
}
