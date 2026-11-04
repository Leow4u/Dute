import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { createSiteApp } from "../server/site.ts";
import { renderDocument } from "../server/html.ts";
import type { Article } from "../src/content.ts";

test("HTML insertion preserves replacement tokens in metadata, article markup and catalog JSON", () => {
  const title = "Custo $& $` $' $$ agora";
  const escapedTitle = "Custo $&amp; $` $' $$ agora";
  const article: Article = {
    slug: "custo",
    title,
    excerpt: title,
    category: "Armazenagem",
    image: "storage",
    service: "armazenagem",
    readTime: "1 min",
    sections: [],
  };
  const markup = `<h1>${escapedTitle}</h1>`;
  const template =
    '<html><head><!--site-head--></head><body><div id="root"></div><script type="module" src="/assets/site.js"></script></body></html>';
  const html = renderDocument(
    template,
    "https://www.dutelog.com.br",
    {
      html: markup,
      route: {
        path: "/blog/custo/",
        title,
        description: title,
        kind: "article",
        slug: "custo",
      },
    },
    [article],
  );

  assert.ok(
    html.includes(`<title>${escapedTitle}</title>`),
    "metadata must preserve literal dollar tokens",
  );
  assert.ok(
    html.includes(`<div id="root">${markup}</div>`),
    "SSR markup must preserve literal dollar tokens",
  );
  assert.equal(
    (html.match(/id="root"/g) || []).length,
    1,
    "insertion must not duplicate the template",
  );
  const catalog = html.match(
    /<script id="blog-catalog" type="application\/json">([\s\S]*?)<\/script>/,
  )?.[1];
  assert.ok(catalog, "hydration catalog must exist");
  assert.deepEqual(
    JSON.parse(catalog),
    [article],
    "hydration must receive the exact public catalog",
  );
  const structured = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
  )?.[1];
  assert.ok(structured, "structured metadata must exist");
  assert.equal(JSON.parse(structured).headline, title);
});

test("runtime returns public snapshots with metadata and removes withdrawn routes including old static HTML", async () => {
  const root = await mkdtemp(join(tmpdir(), "dutelog-site-"));
  await mkdir(join(root, "blog", "old"), { recursive: true });
  await writeFile(
    join(root, "blog", "old", "index.html"),
    "STALE PRIVATE ARTICLE",
  );
  let published = true;
  const article = {
    slug: "novo",
    title: "Uma notícia <script>alert(1)</script>",
    excerpt: "Resumo",
    category: "Armazenagem",
    image: "storage",
    service: "armazenagem",
    readTime: "1 min",
    sections: [],
  } as Article;
  const route = {
    path: "/blog/novo/",
    title: article.title,
    description: "Resumo",
    kind: "article",
    slug: "novo",
  };
  const app = createSiteApp({
    publicDir: root,
    origin: "https://www.dutelog.com.br",
    template:
      '<html><head><!--site-head--></head><body><div id="root"></div><script type="module" src="/assets/site.js"></script></body></html>',
    api: express.Router(),
    loadArticles: async () => (published ? [article] : []),
    routes: (items) => (items.length ? [route] : []),
    render: (path, items) =>
      path === "/blog/novo/" && items.length
        ? { html: "<h1>Uma notícia</h1>", route }
        : {
            html: "<h1>Não encontrada</h1>",
            route: {
              path: "/404.html",
              title: "Não encontrada",
              description: "",
              kind: "notfound",
            },
          },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const result = await fetch(base + "/blog/novo/");
    assert.equal(result.status, 200);
    const html = await result.text();
    assert.ok(
      html.includes(
        '<link rel="canonical" href="https://www.dutelog.com.br/blog/novo/"',
      ),
    );
    assert.ok(html.includes('id="blog-catalog"'));
    assert.ok(!html.includes("<script>alert(1)</script>"));
    assert.ok(html.includes("\\u003cscript"));
    assert.equal(result.headers.get("cache-control"), "no-cache");
    const redirect = await fetch(base + "/blog/novo?origem=x", {
      redirect: "manual",
    });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get("location"), "/blog/novo/?origem=x");
    assert.ok(
      (await (await fetch(base + "/sitemap.xml")).text()).includes(
        "/blog/novo/",
      ),
    );
    published = false;
    assert.equal((await fetch(base + "/blog/novo/")).status, 404);
    assert.equal((await fetch(base + "/blog/old/index.html")).status, 404);
    assert.ok(
      !(await (await fetch(base + "/sitemap.xml")).text()).includes(
        "/blog/novo/",
      ),
    );
    const admin = await fetch(base + "/admin/blog/", { redirect: "manual" });
    assert.equal(admin.status, 302);
    assert.equal(
      admin.headers.get("location"),
      "https://www.dutelog.com.br/admin/blog/",
    );
    assert.equal(admin.headers.get("cache-control"), "no-store");
    assert.ok(admin.headers.get("x-robots-tag")?.includes("noindex"));
    assert.equal((await fetch(base + "/health")).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.ok(root.startsWith(join(tmpdir(), "dutelog-site-")));
    await rm(root, { recursive: true, force: true });
  }
});
test("catalog failure returns unavailable rather than resurrecting bundled articles", async () => {
  const app = createSiteApp({
    publicDir: tmpdir(),
    origin: "https://www.dutelog.com.br",
    template: "",
    api: express.Router(),
    loadArticles: async () => {
      throw new Error("Database unavailable");
    },
    routes: () => [],
    render: () => {
      throw new Error("Must not render fallback");
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/blog/`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
