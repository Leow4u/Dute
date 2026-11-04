import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("dist/public");
const read = (path) => readFileSync(resolve(root, path), "utf8");
test("build serves content for deep links before JavaScript runs", () => {
  for (const [path, text] of [
    ["logistica-corporativa/inventario/index.html", "Saiba o que existe."],
    ["transporte-de-cargas/transporte-dedicado/index.html", "Uma carga."],
    [
      "blog/checklist-mudanca-corporativa/index.html",
      "Defina o que realmente vai mudar",
    ],
    ["contato/index.html", "comercial@dutelog.com.br"],
  ])
    assert.ok(read(path).includes(text), path);
});
test("every sitemap page has one heading, unique metadata, resolved links and assets", () => {
  const paths = [
    ...read("sitemap.xml").matchAll(
      /<loc>https:\/\/www\.dutelog\.com\.br([^<]*)<\/loc>/g,
    ),
  ].map((match) => match[1]);
  assert.equal(paths.length, 24);
  const titles = new Set();
  for (const path of paths) {
    const html = read(`${path.slice(1)}index.html`);
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1, path);
    const title = html.match(/<title>(.*?)<\/title>/)?.[1];
    assert.ok(title, path);
    titles.add(title);
    assert.ok(
      html.includes(`rel="canonical" href="https://www.dutelog.com.br${path}"`),
      path,
    );
    assert.ok(
      !/Protótipo|Prévia para aprovação|Simular envio|Artigos demonstrativos/.test(
        html,
      ),
      path,
    );
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(ids.length, new Set(ids).size, path);
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const ref = match[1].replaceAll("&amp;", "&");
      if (ref.startsWith("#")) {
        assert.ok(ids.includes(ref.slice(1)), `${path}: ${ref}`);
        continue;
      }
      if (!ref.startsWith("/") || ref.startsWith("//")) continue;
      const resource = ref.split(/[?#]/)[0];
      const target = resolve(
        root,
        resource.slice(1),
        resource.endsWith("/") ? "index.html" : "",
      );
      assert.ok(existsSync(target), `${path}: missing ${ref}`);
    }
  }
  assert.equal(titles.size, paths.length);
});
test("404 is a real distinct page and forms never pretend delivery", () => {
  assert.ok(read("404.html").includes("Página não encontrada"));
  assert.ok(read("404.html").includes("noindex"));
  const contact = read("contato/index.html");
  assert.ok(contact.includes("mailto:comercial@dutelog.com.br"));
  assert.ok(!contact.includes("Mensagem enviada"));
});
