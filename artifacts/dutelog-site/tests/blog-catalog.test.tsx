import test from "node:test";
import assert from "node:assert/strict";
import { articles, type Article } from "../src/content";
import { render } from "../src/entry-server";

const article = (slug: string, title: string): Article => ({
  ...articles[0],
  slug,
  title,
  excerpt: `Resumo de ${title}`,
  sections: [],
  body: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: `Conteúdo de ${title}` }],
      },
    ],
  },
});

test("a newly published slug renders its own metadata and content before JavaScript", () => {
  const catalog = [article("novo-artigo", "Um novo movimento")];
  const result = render("/blog/novo-artigo/", catalog);
  assert.equal(result.route.kind, "article");
  assert.equal(result.route.title, "Um novo movimento | Blog Dutelog");
  assert.equal(result.route.description, "Resumo de Um novo movimento");
  assert.ok(result.html.includes("Conteúdo de Um novo movimento"));
  assert.ok(
    !result.html.includes("Mudança corporativa: antes da primeira caixa"),
  );
});

test("a withdrawn legacy slug and link disappear from page routing and sitemap", () => {
  const catalog = [article("novo-artigo", "Artigo atual")];
  const removed = render(`/blog/${articles[0].slug}/`, catalog);
  assert.equal(removed.route.kind, "notfound");
  const sitemap = render("/mapa-do-site/", catalog).html;
  assert.ok(sitemap.includes('href="/blog/novo-artigo/"'));
  assert.ok(!sitemap.includes(`/blog/${articles[0].slug}/`));
});

test("home, Blog and related reading consistently use the current request catalog", () => {
  const catalog = [
    article("primeiro", "Primeiro conteúdo"),
    article("segundo", "Segundo conteúdo"),
  ];
  for (const path of [
    "/",
    "/blog/",
    "/logistica-corporativa/",
    "/blog/primeiro/",
  ]) {
    const html = render(path, catalog).html;
    assert.ok(html.includes("Segundo conteúdo"), path);
    assert.ok(!html.includes("checklist-mudanca-corporativa"), path);
  }
});

test("an empty published catalog is valid and never falls back to bundled articles", () => {
  const blog = render("/blog/", []);
  assert.equal(blog.route.kind, "blog");
  assert.ok(blog.html.includes("Nenhum artigo por aqui"));
  assert.ok(!blog.html.includes("checklist-mudanca-corporativa"));
  const home = render("/", []).html;
  assert.ok(home.includes("Sua empresa muda."));
  assert.ok(!home.includes("checklist-mudanca-corporativa"));
});

test("independent render requests do not mutate each other or the static build catalog", async () => {
  const [first, second] = await Promise.all([
    Promise.resolve().then(() =>
      render("/blog/", [article("alfa", "Catálogo Alfa")]),
    ),
    Promise.resolve().then(() =>
      render("/blog/", [article("beta", "Catálogo Beta")]),
    ),
  ]);
  assert.ok(
    first.html.includes("Catálogo Alfa") &&
      !first.html.includes("Catálogo Beta"),
  );
  assert.ok(
    second.html.includes("Catálogo Beta") &&
      !second.html.includes("Catálogo Alfa"),
  );
  const legacy = render(`/blog/${articles[0].slug}/`);
  assert.equal(legacy.route.kind, "article");
  assert.ok(legacy.html.includes("Defina o que realmente vai mudar"));
});

test("service hubs and detail pages never expose bundled recommendations after withdrawal", () => {
  for (const catalog of [[], [article("unico", "Conteúdo disponível")]]) {
    for (const path of [
      "/transporte-de-cargas/",
      "/armazenagem/",
      "/logistica-corporativa/inventario/",
    ]) {
      const html = render(path, catalog).html;
      for (const legacy of articles)
        assert.ok(!html.includes(`/blog/${legacy.slug}/`), path);
      if (catalog.length && path !== "/logistica-corporativa/inventario/")
        assert.ok(html.includes("Conteúdo disponível"), path);
    }
  }
});
