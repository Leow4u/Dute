import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CANAIS_DA_DIRETA,
  HORAS_DO_EMERGENCIAL,
  buscarNoCatalogo,
  formularioVazio,
  instanteDeSaoPaulo,
  itemDoCatalogo,
  pedidoDaDemanda,
  problemasDoFormulario,
  quantidadeDigitada,
  tipoDoFormulario,
  tipoPelaHora,
  type FormularioDaDemanda,
} from "./demanda-direta";

/** Nova demanda direta (parte 3.5c): o formulário e o pedido de openDirectDemand. */

const CALLABLE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../functions/operacao/src/domain/demanda-direta.ts"),
  "utf8",
);

// Sexta, 23/10/2026, 13:06 em São Paulo.
const AGORA = new Date("2026-10-23T16:06:00.000Z");

function form(extra: Partial<FormularioDaDemanda> = {}): FormularioDaDemanda {
  return {
    ...formularioVazio(AGORA),
    customerCode: "ITAU",
    titulo: "Troca de cadeiras do 5º andar",
    pedidoPorNome: "Renata Campos",
    pedidoPorTelefone: "(11) 98765-4321",
    recebidaHora: "13:05",
    executarHora: "19:00",
    origemLocalId: "loc_faria",
    origemComplemento: "5º andar",
    linhas: [
      { chave: "c1", lpuItemId: "lpu_cadeira", item: "Cadeira Flexform", unidade: "UN", quantidade: "40" },
      { chave: "c2", lpuItemId: null, item: "Retirada de entulho", unidade: "VB", quantidade: "1,5" },
    ],
    ...extra,
  };
}

describe("iguais à callable", () => {
  it("as horas do emergencial e os canais são os de functions/operacao", () => {
    expect(CALLABLE).toMatch(new RegExp(`HORAS_DO_EMERGENCIAL = ${HORAS_DO_EMERGENCIAL};`));
    const canais = CALLABLE.match(/CANAIS_DA_DIRETA = \[([^\]]*)\]/);
    expect(canais).not.toBeNull();
    expect([...canais![1].matchAll(/"([^"]+)"/g)].map((item) => item[1])).toEqual([...CANAIS_DA_DIRETA]);
  });

  it("o tipo pela hora dá o mesmo que a callable nos casos do teste dela", () => {
    expect(tipoPelaHora("2026-10-20T16:05:00.000Z", "2026-10-20T22:00:00.000Z")).toBe("paraquedas");
    expect(tipoPelaHora("2026-10-21T02:30:00.000Z", "2026-10-21T04:00:00.000Z")).toBe("emergencial");
    expect(tipoPelaHora("2026-10-20T16:00:00.000Z", "2026-10-22T16:00:00.000Z")).toBe("emergencial");
    expect(tipoPelaHora("2026-10-20T16:00:00.000Z", "2026-10-22T16:01:00.000Z")).toBe("planejada");
    expect(tipoPelaHora("x", "2026-10-22T16:01:00.000Z")).toBeNull();
  });
});

describe("instantes e quantidades", () => {
  it("a data e a hora digitadas viram o instante com o fuso de São Paulo", () => {
    expect(instanteDeSaoPaulo("2026-10-23", "13:05")).toBe("2026-10-23T13:05-03:00");
    expect(instanteDeSaoPaulo("2026-10-23", "13:05:30")).toBe("2026-10-23T13:05-03:00");
    expect(instanteDeSaoPaulo("2026-10-23", "")).toBeNull();
    expect(instanteDeSaoPaulo("23/10/2026", "13:05")).toBeNull();
    expect(quantidadeDigitada(" 12,5 ")).toBe("12.5");
  });

  it("o formulário vazio recebe agora e executa hoje às 18:00", () => {
    expect(formularioVazio(AGORA)).toMatchObject({ recebidaData: "2026-10-23", recebidaHora: "13:06", executarData: "2026-10-23", executarHora: "18:00", canal: "telefone", linhas: [] });
  });
});

describe("tipo do formulário", () => {
  it("calcula pela hora e respeita a correção", () => {
    expect(tipoDoFormulario(form())).toEqual({ calculado: "paraquedas", tipo: "paraquedas" });
    expect(tipoDoFormulario(form({ executarData: "2026-10-24" }))).toEqual({ calculado: "emergencial", tipo: "emergencial" });
    expect(tipoDoFormulario(form({ executarData: "2026-10-30" }))).toEqual({ calculado: "planejada", tipo: "planejada" });
    expect(tipoDoFormulario(form({ tipoCorrigido: "emergencial" }))).toEqual({ calculado: "paraquedas", tipo: "emergencial" });
  });
});

describe("conferência do formulário", () => {
  it("o pedido completo não tem problema", () => {
    expect(problemasDoFormulario(form(), AGORA)).toEqual([]);
  });

  it("diz o que falta, na ordem do formulário", () => {
    expect(problemasDoFormulario({ ...formularioVazio(AGORA), executarHora: "12:00" }, AGORA)).toEqual([
      "Escolha o cliente.",
      "Informe o título da demanda.",
      "Executar até vem depois de quando o pedido foi recebido.",
      "Inclua ao menos um item.",
    ]);
    expect(problemasDoFormulario(form({ recebidaHora: "15:00" }), AGORA)).toContain("Recebida em não pode ser depois de agora.");
    expect(problemasDoFormulario(form({ pedidoPorTelefone: "123" }), AGORA)).toContain("Telefone de quem pediu inválido: use DDD e número.");
    expect(
      problemasDoFormulario(form({ linhas: [{ chave: "c1", lpuItemId: null, item: "", unidade: "", quantidade: "0" }] }), AGORA),
    ).toEqual(["Item avulso: informe a quantidade.", "Item avulso: informe o nome e a unidade."]);
  });
});

describe("pedido para openDirectDemand", () => {
  it("manda os campos no formato da callable, sem preço", () => {
    const pedido = pedidoDaDemanda(form(), "k1");
    expect(pedido).toEqual({
      idempotency_key: "k1",
      customer_code: "ITAU",
      titulo: "Troca de cadeiras do 5º andar",
      canal: "telefone",
      pedido_por: { nome: "Renata Campos", telefone: "(11) 98765-4321" },
      recebida_em: "2026-10-23T13:05-03:00",
      executar_ate: "2026-10-23T19:00-03:00",
      origem: { local_id: "loc_faria", complemento: "5º andar" },
      destino: null,
      itens: [
        { lpu_item_id: "lpu_cadeira", quantidade: "40" },
        { item: "Retirada de entulho", unidade: "VB", quantidade: "1.5" },
      ],
    });
    expect(JSON.stringify(pedido)).not.toMatch(/preco|valor/);
  });

  it("o tipo só vai quando o coordenador corrigiu para outro", () => {
    expect(pedidoDaDemanda(form({ tipoCorrigido: "emergencial" }), "k")).toMatchObject({ tipo: "emergencial" });
    expect(pedidoDaDemanda(form({ tipoCorrigido: "paraquedas" }), "k")).not.toHaveProperty("tipo");
  });
});

describe("catálogo", () => {
  const itens = [
    itemDoCatalogo("lpu_cadeira", { item: "Cadeira Flexform", servico: "Transporte", unidade: "UN", ativo: true, orcavel: true, preco: "10.00" }),
    itemDoCatalogo("lpu_mesa", { item: "Mesa de trabalho", servico: "Montagem", unidade: "UN" }),
    itemDoCatalogo("lpu_velho", { item: "Cadeira antiga", ativo: false }),
    itemDoCatalogo("lpu_guarda", { item: "Guarda de mobiliário", orcavel: false }),
  ].filter((item) => item !== null);

  it("só o item ativo e orçável, sem preço", () => {
    expect(itens.map((item) => item.id)).toEqual(["lpu_cadeira", "lpu_mesa"]);
    expect(JSON.stringify(itens)).not.toContain("10.00");
  });

  it("busca por todas as palavras no nome ou no serviço, sem acento", () => {
    expect(buscarNoCatalogo(itens, "cadeira transp").map((item) => item.id)).toEqual(["lpu_cadeira"]);
    expect(buscarNoCatalogo(itens, "montagem").map((item) => item.id)).toEqual(["lpu_mesa"]);
    expect(buscarNoCatalogo(itens, "  ")).toEqual([]);
    expect(buscarNoCatalogo(itens, "ca", 1)).toHaveLength(1);
  });
});
