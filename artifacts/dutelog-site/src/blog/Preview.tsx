import type { MouseEvent } from "react";
import { Layout } from "../components/Layout";
import type { Article, ImageName } from "../content";
import { ArticlePage } from "../pages/Blog";
import { BLOG_SERVICES, readTime, type BlogDraft } from "./model";
import "./preview.css";

export default function Preview({ draft }: { draft: BlogDraft }) {
  const image: ImageName =
    draft.category === "Armazenagem"
      ? "storage"
      : draft.category === "Transporte de Cargas"
        ? "transport"
        : "corporate";
  const article: Article = {
    title: draft.title.trim() || "Título do artigo",
    slug: draft.slug || "previa",
    excerpt: draft.excerpt,
    category: draft.category,
    service: BLOG_SERVICES.some(({ slug }) => slug === draft.service)
      ? draft.service
      : "",
    readTime: readTime(draft.body),
    image,
    cover: draft.cover.src ? draft.cover : undefined,
    body: draft.body,
    sections: [],
  };

  function keepPreviewOpen(event: MouseEvent<HTMLDivElement>) {
    const link =
      event.target instanceof Element ? event.target.closest("a") : null;
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute("href") || "";
    if (href.startsWith("#")) {
      const target = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>("[id]"),
      ).find((element) => element.id === href.slice(1));
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      target?.focus({ preventScroll: true });
    }
  }

  return (
    <div
      className="blog-preview"
      data-private-preview
      onClickCapture={keepPreviewOpen}
      onAuxClickCapture={keepPreviewOpen}
    >
      <Layout pathname="/blog/previa/">
        <ArticlePage article={article} preview />
      </Layout>
    </div>
  );
}
