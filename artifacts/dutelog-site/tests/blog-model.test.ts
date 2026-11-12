import test from "node:test";
import assert from "node:assert/strict";
import { emptyDraft, parseDraft, slugify, safeLink, safeImageSrc, legacyToDraft, mediaIds, readTime, validatePublication, canonicalBody, editorBody, draftFingerprint, type RichNode } from "../src/blog/model.ts";

test("draft allows unfinished writing but rejects hostile URLs and nodes", () => {
  assert.deepEqual(parseDraft(emptyDraft()), emptyDraft());
  for (const href of ["javascript:alert(1)", "data:text/html,bad", "//evil.test/a", "/\\evil.test/a", "https://good.test\n@evil.test"]) {
    assert.equal(safeLink(href), false, href);
    assert.throws(() => parseDraft({ ...emptyDraft(), body: { type: "doc", content: [{ type: "paragraph", content: [{type:"text",text:"Link",marks:[{type:"link",attrs:{href}}]}] }] } }));
  }
  assert.throws(() => parseDraft({ ...emptyDraft(), body: { type: "doc", content: [{type:"script",text:"alert(1)"}] } }));
  assert.throws(() => parseDraft({ ...emptyDraft(), cover: {src:"https://tracking.test/image.png",alt:""} }));
  assert.throws(() => parseDraft({ ...emptyDraft(), service:"private-database" }));
});
test("draft rejects excessive size, nesting and malformed rich-text relationships", () => {
  assert.throws(() => parseDraft({ ...emptyDraft(), title:"a".repeat(201) }));
  assert.throws(() => parseDraft({ ...emptyDraft(), slug:"../admin" }));
  let node: RichNode = {type:"paragraph"};
  for(let i=0;i<20;i++) node={type:"blockquote",content:[node]};
  assert.throws(() => parseDraft({ ...emptyDraft(), body:{type:"doc",content:[node]} }));
  assert.throws(() => parseDraft({ ...emptyDraft(), body:{type:"doc",content:[{type:"text",text:"outside paragraph"}]} }));
  assert.throws(() => parseDraft({ ...emptyDraft(), body:{type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"a".repeat(200001)}]}]} }));
});
test("accepted body preserves formatting and identifies only owned media", () => {
  const id="351232ff-8af3-4800-bd30-af416927e86b";
  const draft={...emptyDraft(), cover:{src:`/api/blog/media/${id}`,alt:"Capa"},body:{type:"doc",content:[{type:"heading",attrs:{level:2},content:[{type:"text",text:"Planeje",marks:[{type:"bold"}]}]},{type:"paragraph",content:[{type:"text",text:"Veja",marks:[{type:"link",attrs:{href:"https://www.dutelog.com.br/",target:"_blank",rel:"noopener noreferrer nofollow",class:null}}]}]},{type:"image",attrs:{src:`/api/blog/media/${id}`,alt:"Sala",title:null,width:null,height:null}}]}};
  const parsed=parseDraft(draft);
  assert.equal(parsed.body.content?.[0].attrs?.level,2);
  assert.deepEqual(mediaIds(parsed),[id]);
  assert.equal(safeImageSrc("/images/corporate.webp"),true);
  assert.equal(safeImageSrc("/images/../../private"),false);
  assert.equal(safeLink("/blog/"),true);
  assert.equal(safeLink("mailto:comercial@dutelog.com.br"),true);
});
test("legacy import retains title, paragraphs and list content in the visual document", () => {
  const draft=legacyToDraft({title:"Uma mudança",slug:"uma-mudanca",excerpt:"Resumo",category:"Logística Corporativa",service:"inventario",image:"corporate",sections:[{title:"Prepare",paragraphs:["Texto preservado."],bullets:["Primeiro item"]}]});
  assert.equal(draft.title,"Uma mudança");
  assert.equal(draft.cover.src,"/images/corporate.webp");
  assert.equal(draft.body.content?.[0].type,"heading");
  assert.ok(JSON.stringify(draft.body).includes("Texto preservado."));
  assert.ok(JSON.stringify(draft.body).includes("Primeiro item"));
  assert.doesNotThrow(()=>parseDraft(draft));
  assert.equal(slugify("  Logística & mudanças: São Paulo!  "),"logistica-mudancas-sao-paulo");
  assert.equal(readTime({type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"palavra ".repeat(401)}]}]}),"3 min");
});
test("publishing requires readable content and described images, while drafts remain editable", () => {
  const draft=emptyDraft();
  assert.doesNotThrow(()=>parseDraft(draft));
  assert.throws(()=>validatePublication(draft),/título/);
  Object.assign(draft,{title:"Mudança",slug:"mudanca",excerpt:"Resumo",cover:{src:"/images/corporate.webp",alt:""}});
  assert.throws(()=>validatePublication(draft),/capa/);
  draft.cover.alt="Uma sala em preparação";
  assert.throws(()=>validatePublication(draft),/conteúdo/);
  draft.body={type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"Prepare o projeto."}]},{type:"image",attrs:{src:"/images/corporate.webp",alt:""}}]};
  assert.throws(()=>validatePublication(draft),/imagens/);
  draft.body.content![1].attrs!.alt="Mobiliário protegido";
  assert.doesNotThrow(()=>validatePublication(draft));
});
test("dirty check ignores TipTap shape differences and notices a real edit", () => {
  const id = "351232ff-8af3-4800-bd30-af416927e86b";
  const stored = parseDraft({
    ...emptyDraft(),
    title: "Planejamento",
    slug: "planejamento",
    excerpt: "Resumo do artigo",
    cover: { src: `/api/blog/media/${id}`, alt: "Capa" },
    body: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Seção" }] },
        { type: "paragraph", content: [{ type: "text", text: "Negrito", marks: [{ type: "bold" }] }] },
        { type: "paragraph", content: [{ type: "text", text: "Itálico", marks: [{ type: "italic" }] }] },
        { type: "paragraph", content: [{ type: "text", text: "Site", marks: [{ type: "link", attrs: { href: "https://www.dutelog.com.br/", target: "_blank", rel: "noopener noreferrer" } }] }] },
        { type: "image", attrs: { src: `/api/blog/media/${id}`, alt: "Sala" } },
        { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Primeiro" }] }] }] },
      ],
    },
  });
  const echoed = {
    ...stored,
    body: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Seção" }] },
        { type: "paragraph", content: [{ type: "text", marks: [{ type: "bold" }], text: "Negrito" }] },
        { type: "paragraph", content: [{ type: "text", marks: [{ type: "italic" }], text: "Itálico" }] },
        { type: "paragraph", content: [{ type: "text", marks: [{ type: "link", attrs: { href: "https://www.dutelog.com.br/", target: "_blank", rel: "noopener noreferrer", class: null, title: null } }], text: "Site" }] },
        { type: "image", attrs: { src: `/api/blog/media/${id}`, alt: "Sala", title: null, width: null, height: null } },
        { type: "orderedList", attrs: { start: 1, type: null }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Primeiro" }] }] }] },
      ],
    },
  };
  assert.notEqual(JSON.stringify(echoed), JSON.stringify(stored));
  assert.equal(draftFingerprint(echoed), draftFingerprint(stored));
  assert.deepEqual(editorBody(echoed.body), stored.body);
  assert.doesNotThrow(() => validatePublication(echoed));
  const edited = {
    ...echoed,
    body: { ...echoed.body, content: echoed.body.content.slice(0, 1) },
  };
  assert.notEqual(draftFingerprint(edited), draftFingerprint(stored));
  const plain = parseDraft({
    ...emptyDraft(),
    title: "Simples",
    slug: "simples",
    excerpt: "Resumo",
    body: { type: "doc", content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Seção" }] },
      { type: "paragraph", content: [{ type: "text", text: "Só texto." }] },
    ] },
  });
  assert.equal(draftFingerprint(plain), JSON.stringify(plain));
  assert.notEqual(draftFingerprint({ ...plain, title: `${plain.title} ` }), draftFingerprint(plain));
  const hostile = { type: "doc", content: [{ type: "script", text: "alert(1)" }] };
  assert.throws(() => canonicalBody(hostile));
  assert.deepEqual(editorBody(hostile), hostile);
  assert.ok(draftFingerprint({ ...emptyDraft(), body: hostile as RichNode }).startsWith("invalid:"));
});
