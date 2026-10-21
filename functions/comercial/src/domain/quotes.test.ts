import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nomeDoAutor, revisaoCongelada, rvRestaurada, rvSeguinte } from "./quotes.js";

/**
 * O nome de quem montou o orçamento (parte 12a): o documento A4 diz
 * "Orçamento elaborado por <nome>", e o comercial não lê o perfil de outra
 * pessoa em `users`. O nome fica no orçamento (autor_nome), segue para a RV
 * congelada no envio e acompanha o autor quando a RV muda. Sem Firestore:
 * as funções que montam os documentos.
 */

const QUOTE = {
  numero: "10045",
  rv: 0,
  tipo_rv: "proposta",
  edicao: 3,
  customer_code: "ITAU",
  data_base: "2026-10-14",
  tabela: { id: "pt_itau", nome: "LPU Itaú v2.0", variante: "Comercial" },
  linhas: [],
  subtotal_cents: 0,
  ajustes_cents: 0,
  total_cents: 0,
  marcas: [],
  autor_uid: "com-1",
  autor_nome: "Guilherme",
  status: "enviado",
};

describe("nome do autor no orçamento", () => {
  it("é o nome do perfil de quem chama, sem espaços nas pontas; sem nome, null", () => {
    assert.equal(nomeDoAutor({ name: "  Guilherme Souza " }), "Guilherme Souza");
    assert.equal(nomeDoAutor({ name: "" }), null);
    assert.equal(nomeDoAutor({}), null);
    assert.equal(nomeDoAutor({ name: "x".repeat(300) })?.length, 120);
  });

  it("a RV congelada leva o nome de quem montou (não o de quem aprovou ou enviou)", () => {
    const congelada = revisaoCongelada(QUOTE, { titulo: "Mudança" }, { aprovacao: { por_uid: "owner-1" }, enviado_por: "owner-1", enviado_em: "x" });
    assert.equal(congelada.autor_uid, "com-1");
    assert.equal(congelada.autor_nome, "Guilherme");
    assert.equal(revisaoCongelada({ ...QUOTE, autor_nome: undefined }, {}, { aprovacao: null }).autor_nome, null);
  });

  it("a RV seguinte passa a ser de quem a abre, com o nome dele", () => {
    const seguinte = rvSeguinte("10045", QUOTE, "pedido_cliente", { uid: "owner-1", nome: "Leonardo", iso: "2026-10-20T12:00:00.000Z" });
    assert.equal(seguinte.patch.autor_uid, "owner-1");
    assert.equal(seguinte.patch.autor_nome, "Leonardo");
    assert.equal(rvSeguinte("10045", QUOTE, "pedido_cliente", { uid: "owner-1", iso: "x" }).patch.autor_nome, null);
  });

  it("de volta à RV enviada, o autor é o dela", () => {
    const enviada = { ...QUOTE, autor_uid: "com-2", autor_nome: "Outro", enviado_por: "com-2", enviado_em: "x" };
    const restaurada = rvRestaurada("10045", { ...QUOTE, rv: 1, edicao: 4 }, enviada, [], { uid: "owner-1", iso: "x" });
    assert.equal(restaurada.patch.autor_uid, "com-2");
    assert.equal(restaurada.patch.autor_nome, "Outro");
  });
});
