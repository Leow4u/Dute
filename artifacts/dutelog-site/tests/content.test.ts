import test from "node:test";
import assert from "node:assert/strict";
import {
  articles,
  services,
  serviceHref,
  articleHref,
  filterArticles,
} from "../src/content.ts";

test("every service has a distinct path in its own business category", () => {
  assert.equal(services.filter((s) => s.group === "corporativa").length, 7);
  assert.equal(services.filter((s) => s.group === "transporte").length, 2);
  assert.equal(new Set(services.map((s) => serviceHref(s.slug))).size, 9);
  assert.equal(serviceHref("inventario"), "/logistica-corporativa/inventario/");
  assert.equal(
    serviceHref("transporte-dedicado"),
    "/transporte-de-cargas/transporte-dedicado/",
  );
  assert.equal(serviceHref("armazenagem"), "/armazenagem/");
  assert.throws(() => serviceHref("nao-existe"));
});

test("blog search composes accent-insensitive query and category", () => {
  assert.equal(filterArticles(articles, "", "Todos").length, 6);
  assert.deepEqual(
    filterArticles(articles, " INVENTARIO ", "Todos").map((a) => a.slug),
    ["inventario-antes-da-mudanca"],
  );
  assert.equal(filterArticles(articles, "inventario", "Armazenagem").length, 0);
  assert.equal(filterArticles(articles, "", "Armazenagem").length, 1);
  assert.equal(
    filterArticles(articles, "texto-sem-correspondencia", "Todos").length,
    0,
  );
  assert.equal(filterArticles(articles, "", "categoria-inexistente").length, 6);
});

test("articles link to real services and have unique section anchors", () => {
  for (const article of articles) {
    assert.ok(serviceHref(article.service));
    assert.equal(articleHref(article.slug), `/blog/${article.slug}/`);
    assert.equal(
      new Set(article.sections.map((s) => s.id)).size,
      article.sections.length,
    );
  }
});
