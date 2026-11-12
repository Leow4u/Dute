import test from "node:test";
import assert from "node:assert/strict";
import { emptyDraft, parseDraft } from "../src/blog/model.ts";
import { publishActionLabel, publishBlockReason, saveStatusLabel } from "../src/admin/save-state.ts";

test("save status uses the three editorial labels", () => {
  const savedAt = "2026-11-12T18:04:00.000Z";
  const clock = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(savedAt));
  assert.equal(saveStatusLabel({ saving: true, dirty: true, savedAt }), "Salvando…");
  assert.equal(saveStatusLabel({ saving: false, dirty: true, savedAt }), "Alterações não salvas");
  assert.equal(saveStatusLabel({ saving: false, dirty: false, savedAt: null }), "Novo rascunho");
  assert.equal(saveStatusLabel({ saving: false, dirty: false, savedAt }), `Salvo às ${clock}`);
});

test("publish offers save-and-publish and names the missing field", () => {
  assert.equal(publishActionLabel(true, false), "Salvar e publicar");
  assert.equal(publishActionLabel(true, true), "Salvar e atualizar");
  assert.equal(publishActionLabel(false, false), "Publicar");
  assert.equal(publishActionLabel(false, true), "Atualizar publicação");
  assert.match(publishBlockReason(emptyDraft()) ?? "", /título/);
  const ready = parseDraft({
    ...emptyDraft(),
    title: "Mudança",
    slug: "mudanca",
    excerpt: "Resumo",
    cover: { src: "/images/corporate.webp", alt: "Sala pronta" },
    body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Texto." }] }] },
  });
  assert.equal(publishBlockReason(ready), null);
  assert.match(publishBlockReason({ ...ready, excerpt: "" }) ?? "", /resumo/i);
});
