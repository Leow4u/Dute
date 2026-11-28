import { describe, expect, it } from "vitest";

import { edicaoDaNecton, produtosDaNecton } from "@/test/eventos-necton";

import {
  campoDaMensagem,
  criacaoDoFormulario,
  formularioDaEdicao,
  formularioVazio,
  gravadoDaEdicao,
  patchDoFormulario,
  problemasDoFormulario,
  resumoDaEdicao,
  type FormularioDaEdicao,
} from "./formulario";
import { itemDeEntrada } from "./itens";
import type { EventoView, PrecoDaEdicao } from "./leitura";

/**
 * O formulário da edição no portal (docs/mockups/EventosPortalNovo.dc.html):
 * o que vai à criação e ao patch, o que falta antes do envio, a frase do
 * servidor no campo e o resumo da edição.
 */

const NECTON = edicaoDaNecton();
const PRODUTOS = produtosDaNecton();
const CAPA: EventoView = {
  id: NECTON.event_id,
  customer_code: "BTG",
  name: "B2B Conference Necton",
  description: "Lounge, balcão de recepção e brindes da conferência B2B da Necton",
  status: "active",
  editions_count: 1,
  last_edition_id: NECTON.id,
  last_edition_label: "2027",
};
const PRECO: PrecoDaEdicao = { id: NECTON.id, valor_declarado_cents: 10_000_000, fechado_cents: null };

const formDaNecton = (): FormularioDaEdicao => formularioDaEdicao(NECTON, CAPA, PRECO);

function semUndefined(valor: unknown): boolean {
  if (valor === undefined) return false;
  if (Array.isArray(valor)) return valor.every(semUndefined);
  if (valor && typeof valor === "object") return Object.values(valor).every(semUndefined);
  return true;
}

describe("o patch e a criação", () => {
  it("patchDoFormulario da Necton, com o gravado igual ao formulário: a coleta de 2.190 sem observação, o id e o local dos momentos, nenhum undefined, nenhum evento, nem o valor nem os itens que não mudaram", () => {
    const form = formDaNecton();
    expect(form.coleta).toEqual({ onde: "BTG Pactual · Av. Brigadeiro Faria Lima, 3477", quantidade: "2.190", valorDeclarado: "R$ 100.000,00" });
    const patch = patchDoFormulario(form, gravadoDaEdicao(NECTON, CAPA, PRECO));
    expect(patch.coleta).toEqual({ onde: "BTG Pactual · Av. Brigadeiro Faria Lima, 3477", quantidade: 2190 });
    expect(patch.onde).toEqual({ local: "Hotel Unique", endereco: "Av. Brigadeiro Luís Antônio, 4700", contato: { nome: "Cristiane", telefone: null } });
    expect(patch.cronograma).toHaveLength(7);
    expect(patch.cronograma?.[2]).toMatchObject({ id: "mo_00000003", tipo: "montagem", hora: "10:00", ate: "19:00", local: null });
    expect(patch.observacoes).toBe(NECTON.observacoes);
    expect("evento" in patch).toBe(false);
    expect("itens" in patch).toBe(false);
    expect(semUndefined(patch)).toBe(true);
  });

  it("o valor declarado e os itens vão quando mudam; cada item só com as seis chaves de entrada", () => {
    const form = formDaNecton();
    const gravado = gravadoDaEdicao(NECTON, CAPA, PRECO);
    const comValor = patchDoFormulario({ ...form, coleta: { ...form.coleta, valorDeclarado: "120.000,50" } }, gravado);
    expect(comValor.coleta).toEqual({ onde: "BTG Pactual · Av. Brigadeiro Faria Lima, 3477", quantidade: 2190, valor_declarado_cents: 12_000_050 });
    const semValor = patchDoFormulario({ ...form, coleta: { ...form.coleta, valorDeclarado: "" } }, gravado);
    expect(semValor.coleta).toMatchObject({ valor_declarado_cents: null });
    const menos = patchDoFormulario({ ...form, itens: form.itens.slice(1) }, gravado);
    expect(menos.itens).toHaveLength(99);
    for (const item of menos.itens ?? []) {
      expect(Object.keys(item).sort()).toEqual(["category", "client_item_code", "product_name", "quantity", "size", "sku_code"]);
    }
    expect(menos.itens?.[0]).toEqual(itemDeEntrada(NECTON.itens[1]));
  });

  it("com a descrição mudada, evento: { description } sem name; com o nome mudado, evento: { name } sem description; o nome vazio não vai", () => {
    const form = formDaNecton();
    const gravado = gravadoDaEdicao(NECTON, CAPA, PRECO);
    expect(patchDoFormulario({ ...form, descricao: "Lounge e brindes" }, gravado).evento).toEqual({ description: "Lounge e brindes" });
    expect(patchDoFormulario({ ...form, descricao: "" }, gravado).evento).toEqual({ description: null });
    expect(patchDoFormulario({ ...form, nome: " B2B Necton 2027 " }, gravado).evento).toEqual({ name: "B2B Necton 2027" });
    expect("evento" in patchDoFormulario({ ...form, nome: "  " }, gravado)).toBe(false);
  });

  it("formularioDaEdicao traz o nome e a descrição da capa, não o event_name da edição; sem a capa, o event_name e a descrição vazia", () => {
    const renomeada = { ...CAPA, name: "B2B Necton" };
    expect(formularioDaEdicao(NECTON, renomeada, PRECO)).toMatchObject({ nome: "B2B Necton", descricao: CAPA.description, eventoId: NECTON.event_id });
    expect(formularioDaEdicao(NECTON, null, null)).toMatchObject({ nome: "B2B Conference Necton", descricao: "", coleta: { valorDeclarado: "" } });
    expect(gravadoDaEdicao(NECTON, renomeada, PRECO)).toMatchObject({ nome: "B2B Necton", descricao: CAPA.description, valorDeclaradoCents: 10_000_000 });
  });

  it("criacaoDoFormulario com eventId leva event_id e sem ele leva name", () => {
    const form: FormularioDaEdicao = { ...formularioVazio(), nome: " Feira de Investimentos ", descricao: "", onde: { ...formularioVazio().onde, local: "Expo Center Norte" } };
    const nova = criacaoDoFormulario(form, "chave-0001", null);
    expect(nova).toMatchObject({ idempotency_key: "chave-0001", name: "Feira de Investimentos", description: null });
    expect("event_id" in nova).toBe(false);
    expect(nova.patch?.onde).toMatchObject({ local: "Expo Center Norte" });
    expect(nova.patch?.cronograma).toEqual([]);
    expect(semUndefined(nova)).toBe(true);
    const daCapa = criacaoDoFormulario({ ...form, nome: "Feira de Investimentos" }, "chave-0002", { id: "cve_00000000000000c1", nome: "Feira de Investimentos", descricao: null });
    expect(daCapa).toMatchObject({ idempotency_key: "chave-0002", event_id: "cve_00000000000000c1" });
    expect("name" in daCapa).toBe(false);
    expect(daCapa.patch?.evento).toBeUndefined();
    const renomeada = criacaoDoFormulario({ ...form, nome: "Feira 2027" }, "chave-0003", { id: "cve_00000000000000c1", nome: "Feira de Investimentos", descricao: null });
    expect(renomeada.patch?.evento).toEqual({ name: "Feira 2027" });
  });
});

describe("o que falta antes do envio", () => {
  it("problemasDoFormulario: o nome, o local, a escolha, o cronograma, a hora da entrega no local e a falta de saldo", () => {
    expect(problemasDoFormulario(formularioVazio(), [])).toMatchObject({
      nome: "Informe o nome do evento",
      "onde.local": "Informe o local",
      itens: "Escolha ao menos um item ou informe a coleta no cliente",
    });
    const form = formDaNecton();
    expect(problemasDoFormulario(form, PRODUTOS)).toEqual({});
    expect(problemasDoFormulario({ ...form, onde: { ...form.onde, local: " " } }, PRODUTOS)).toEqual({ "onde.local": "Informe o local" });
    const sem = (tipo: string, campo: "data" | "hora") => form.cronograma.map((linha) => (linha.tipo === tipo ? { ...linha, [campo]: "" } : linha));
    expect(problemasDoFormulario({ ...form, cronograma: sem("entrega_no_local", "data") }, PRODUTOS)).toEqual({ cronograma: "Informe a data e a hora da entrega no local" });
    expect(problemasDoFormulario({ ...form, cronograma: sem("entrega_no_local", "hora") }, PRODUTOS)).toEqual({ cronograma: "Informe a data e a hora da entrega no local" });
    const soColeta = { ...form, itens: [], cronograma: sem("entrega_no_local", "hora") };
    expect(problemasDoFormulario(soColeta, PRODUTOS)).toEqual({ cronograma: "Informe a data e a hora da entrega no local" });
    expect(problemasDoFormulario({ ...form, cronograma: sem("montagem", "hora") }, PRODUTOS)).toEqual({});
    expect(problemasDoFormulario({ ...form, cronograma: sem("evento", "data") }, PRODUTOS)).toEqual({ cronograma: "Informe a data do evento" });
    const gg = NECTON.itens[3];
    const produtos = PRODUTOS.map((produto) => (produto.sku === gg.sku_code ? { ...produto, available: 60 } : produto));
    expect(problemasDoFormulario(form, produtos)).toEqual({ itens: "Falta saldo em 1 item: Polo Masculino Piquet Arpoador · GG (no evento 80, disponível 60)" });
    expect(problemasDoFormulario({ ...form, coleta: { ...form.coleta, quantidade: "dois mil" } }, PRODUTOS)).toEqual({ coleta: "A quantidade da coleta inválida" });
    expect(problemasDoFormulario({ ...form, coleta: { ...form.coleta, quantidade: "1.000.001" } }, PRODUTOS)).toEqual({ coleta: "A quantidade da coleta passa de 1.000.000" });
    expect(problemasDoFormulario({ ...form, coleta: { ...form.coleta, valorDeclarado: "cem mil" } }, PRODUTOS)).toEqual({ coleta: "O valor declarado inválido" });
  });

  it("campoDaMensagem leva a frase do servidor ao campo", () => {
    expect(campoDaMensagem("A observação de Montagem passa de 300 caracteres")).toBe("cronograma");
    expect(campoDaMensagem("Entrega no local já tem registro e não sai do cronograma")).toBe("cronograma");
    expect(campoDaMensagem("Informe a data e a hora da entrega no local")).toBe("cronograma");
    expect(campoDaMensagem("Informe o rótulo do outro momento")).toBe("cronograma");
    expect(campoDaMensagem("O local passa de 160 caracteres")).toBe("onde.local");
    expect(campoDaMensagem("O telefone do contato passa de 40 caracteres")).toBe("onde.local");
    expect(campoDaMensagem("O nome do evento passa de 120 caracteres")).toBe("nome");
    expect(campoDaMensagem("Saldo insuficiente para o SKU BTG-000004. Disponível: 80; solicitado: 120.")).toBe("itens");
    expect(campoDaMensagem("A quantidade da coleta passa de 1.000.000")).toBe("coleta");
    expect(campoDaMensagem("As observações para a Dutelog passam de 2000 caracteres")).toBe("observacoes");
    expect(campoDaMensagem("Edição não encontrada.")).toBeNull();
  });
});

describe("o resumo da edição", () => {
  it("resumoDaEdicao da Necton: a entrega 28/01 08:30, o retorno 30/01 09:00 e, sem a hora do retorno, 30/01", () => {
    const form = formDaNecton();
    expect(resumoDaEdicao(form, PRODUTOS, "2026-11-27")).toEqual({
      nome: "B2B Conference Necton",
      dias: "28 e 29/01/2027",
      local: "Hotel Unique",
      estoque: "100 itens · 2.000 peças",
      coleta: "2.190 produtos",
      entrega: "28/01 08:30",
      retorno: "30/01 09:00",
      pedido: "Pedido PED com os 100 itens",
    });
    const semHora = { ...form, cronograma: form.cronograma.map((linha) => (linha.tipo === "retorno_ao_estoque" ? { ...linha, hora: "" } : linha)) };
    expect(resumoDaEdicao(semHora, PRODUTOS, "2026-11-27").retorno).toBe("30/01");
    expect(resumoDaEdicao(formularioVazio(), [], "2026-11-27")).toEqual({
      nome: "",
      dias: null,
      local: null,
      estoque: "0 itens · 0 peças",
      coleta: null,
      entrega: null,
      retorno: null,
      pedido: null,
    });
  });
});
