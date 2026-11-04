import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RichText, richHeadings } from "../src/blog/RichText";
import { ArticlePage } from "../src/pages/Blog";
import { ArticleCard } from "../src/components/ui";
import { articles, type Article } from "../src/content";
import { emptyDraft, parseDraft, type RichNode } from "../src/blog/model";

const media = "/api/blog/media/3b7cba81-cf41-456c-a472-235afe14ec37";
const text = (value: string) => ({ type: "text", text: value });
const body = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2, id: "unsafe-id" },
      content: [text("Planeje & confira")],
    },
    {
      type: "paragraph",
      content: [{ ...text("Comece por aqui"), marks: [{ type: "bold" }] }],
    },
    {
      type: "heading",
      attrs: { level: 3 },
      content: [text("Planeje & confira")],
    },
    {
      type: "image",
      attrs: { src: media, alt: "Móveis protegidos", onerror: "alert(1)" },
    },
  ],
};

test("malformed and unknown marks preserve readable text without crashing the renderer", () => {
  for (const mark of [
    null,
    false,
    1,
    "bold",
    {},
    { type: "unrecognized" },
    { type: "link", attrs: null },
  ]) {
    const malformedBody = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Texto preservado",
              marks: [mark, { type: "bold" }],
            },
          ],
        },
      ],
    } as unknown as RichNode;
    assert.throws(
      () => parseDraft({ ...emptyDraft(), body: malformedBody }),
      "the shared parser must reject malformed formatting",
    );
    const html = renderToStaticMarkup(<RichText document={malformedBody} />);
    assert.ok(
      html.includes("<strong>Texto preservado</strong>"),
      "the renderer must ignore invalid formatting defensively",
    );
    assert.ok(!html.includes("<a "));
  }
});

test("rich text escapes text and drops dangerous URLs, attributes and unsupported nodes", () => {
  const html = renderToStaticMarkup(
    <RichText
      document={{
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              text('<script>alert("texto")</script>'),
              {
                ...text("link malicioso"),
                marks: [
                  { type: "link", attrs: { href: "javascript:alert(1)" } },
                ],
              },
              {
                ...text("host externo disfarçado"),
                marks: [{ type: "link", attrs: { href: "//example.com" } }],
              },
              {
                ...text("barra invertida"),
                marks: [{ type: "link", attrs: { href: "/\\example.com" } }],
              },
              {
                ...text("site seguro"),
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: "https://example.com/guia",
                      onclick: "alert(1)",
                    },
                  },
                ],
              },
            ],
          },
          {
            type: "script",
            content: [text("executar()")],
            attrs: { src: "https://example.com/script" },
          },
          {
            type: "image",
            attrs: {
              src: "data:image/svg+xml,<svg onload=alert(1)>",
              alt: "maliciosa",
            },
          },
          {
            type: "image",
            attrs: {
              src: "https://example.com/tracker.png",
              alt: "rastreador",
            },
          },
        ],
      }}
    />,
  );
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes('href="https://example.com/guia"'));
  assert.ok(
    !/<script|javascript:|onclick=|onerror=|<img|href="\/\//i.test(html),
  );
  assert.ok(!html.includes("executar()"));
  assert.ok(html.includes("link malicioso"));
});

test("rich headings have unique generated anchors shared with the table of contents", () => {
  const headings = richHeadings(body);
  assert.deepEqual(
    headings.map(({ id, title, level }) => ({ id, title, level })),
    [
      { id: "artigo-0", title: "Planeje & confira", level: 2 },
      { id: "artigo-2", title: "Planeje & confira", level: 3 },
    ],
  );
  const html = renderToStaticMarkup(<RichText document={body} />);
  assert.ok(html.includes('<h2 id="artigo-0"'));
  assert.ok(html.includes('<h3 id="artigo-2"'));
  assert.ok(!html.includes("unsafe-id"));
  assert.ok(html.includes("<strong>Comece por aqui</strong>"));
  assert.ok(html.includes(`src="${media}"`));
  assert.ok(html.includes('alt="Móveis protegidos"'));
  assert.ok(!html.includes("onerror"));
});

test("article preview renders new content and cover without a published-link action", () => {
  const article: Article = {
    ...articles[0],
    title: "Meu rascunho",
    body,
    cover: { src: media, alt: "Capa escolhida" },
  };
  const html = renderToStaticMarkup(<ArticlePage article={article} preview />);
  assert.ok(html.includes("Meu rascunho"));
  assert.ok(html.includes('href="#artigo-0"'));
  assert.ok(html.includes('id="artigo-0"'));
  assert.ok(html.includes('alt="Capa escolhida"'));
  assert.ok(!html.includes("Defina o que realmente vai mudar"));
  assert.ok(!html.includes("Copiar link"));
  assert.ok(!html.includes("Continue explorando"));
});

test("legacy article remains readable and cards use a custom cover only when safe", () => {
  const legacy = renderToStaticMarkup(<ArticlePage article={articles[0]} />);
  assert.ok(legacy.includes("Defina o que realmente vai mudar"));
  assert.ok(legacy.includes("Copiar link"));
  const valid = renderToStaticMarkup(
    <ArticleCard
      article={{ ...articles[0], cover: { src: media, alt: "Minha capa" } }}
    />,
  );
  assert.ok(valid.includes(`src="${media}"`));
  const unsafe = renderToStaticMarkup(
    <ArticleCard
      article={{
        ...articles[0],
        cover: { src: "https://example.com/tracker", alt: "" },
      }}
    />,
  );
  assert.ok(!unsafe.includes("example.com"));
  assert.ok(unsafe.includes('src="/images/corporate.webp"'));
});

test("an article without headings does not show an empty table of contents", () => {
  const html = renderToStaticMarkup(
    <ArticlePage
      article={{
        ...articles[0],
        body: {
          type: "doc",
          content: [
            { type: "paragraph", content: [text("Texto sem subtítulos.")] },
          ],
        },
      }}
      preview
    />,
  );
  assert.ok(html.includes("Texto sem subtítulos."));
  assert.ok(!html.includes("Neste artigo"));
  assert.ok(!html.includes('aria-label="Sumário do artigo"'));
  assert.ok(html.includes("Conheça a solução"));
});
