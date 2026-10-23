import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { catalogoDaTabela, formDoOrcamento, formSujo, linhaDoServidor, payloadSalvar } from "./montar";
import { pendenciasDoComercial } from "./pendencias";
import { carregarVistoria, foraDaTabelaDaVistoria, itensDaVistoriaEmTexto, vistoriaAUsar, vistoriaDaDemanda } from "./vistoria-da-operacao";

/**
 * A vistoria da Operação no Comercial (parte 3.11e): o resumo da demanda, a
 * vistoria que espera o orçamento no Início, os itens carregados pela tabela
 * e a vistoria marcada no orçamento ao salvar. Sem valor.
 */

const here = dirname(fileURLToPath(import.meta.url));
const QUOTES_DO_SERVIDOR = readFileSync(resolve(here, "../../../../../functions/comercial/src/domain/quotes.ts"), "utf8");

const VISTORIA = {
  os: "10045-01",
  enviada_em: "2026-10-22T18:40:00.000Z",
  ambientes: [
    { nome: "Recepção", itens: [{ lpu_item_id: "lpu_cad", item: "Transporte de cadeira", unidade: "UN", quantidade: "8" }], fotos: ["os/10045-01/fotos/ft_a000000000000001.jpg", "os/99999-01/fotos/ft_x.jpg"] },
    { nome: "Estações", itens: [{ lpu_item_id: "lpu_est", item: "Desmontagem de estação", unidade: "UN", quantidade: "12" }], fotos: [] },
  ],
  itens: [
    { lpu_item_id: "lpu_cad", item: "Transporte de cadeira", unidade: "UN", quantidade: "24" },
    { lpu_item_id: "lpu_est", item: "Desmontagem de estação", unidade: "UN", quantidade: "12" },
    { lpu_item_id: "lpu_cofre", item: "Cofre", unidade: "VB", quantidade: "1" },
  ],
  medidas: [{ nome: "Porta", valor: "0,90 m" }],
  acesso: { horario_de_carga: "Depois das 18h", vaga_de_carga: null },
  observacoes: "Elevador de serviço só até as 19h.",
};

const DEMANDA = { numero: "10045", customer_code: "ITAU", customer_name: "Itaú Unibanco", etapa: "em_montagem", vistoria: VISTORIA };

const CATALOGO = catalogoDaTabela(
  {
    lpu_cad: { codigo: "4.12", descricao_cliente: "Transporte de cadeira", preco: "11.4" },
    lpu_est: { codigo: "3.02", descricao_cliente: "Desmontagem de estação", preco: "21" },
  },
  new Map(),
);

describe("a vistoria na demanda", () => {
  it("o resumo da Operação: os ambientes (só as fotos da OS da vistoria), os itens somados, as medidas e o acesso", () => {
    const vistoria = vistoriaDaDemanda(DEMANDA)!;
    expect([vistoria.os, vistoria.enviadaEm, vistoria.itens.length]).toEqual(["10045-01", "2026-10-22T18:40:00.000Z", 3]);
    expect(vistoria.ambientes[0].fotos).toEqual(["os/10045-01/fotos/ft_a000000000000001.jpg"]);
    expect(vistoria.acesso).toEqual({ horarioDeCarga: "Depois das 18h", vagaDeCarga: null });
    expect(vistoriaDaDemanda({ vistoria: { os: "x" } })).toBeNull();
    expect(vistoriaDaDemanda(null)).toBeNull();
    expect(JSON.stringify(vistoria)).not.toMatch(/preco|cents|R\$/);
  });

  it("espera no Início até o orçamento carregar os itens dela, só na montagem", () => {
    expect(vistoriaAUsar("10045", DEMANDA, { vistoria_os: "" })).toEqual({ numero: "10045", cliente: "Itaú Unibanco", os: "10045-01", enviadaEm: "2026-10-22T18:40:00.000Z", itens: 3 });
    expect(vistoriaAUsar("10045", DEMANDA, { vistoria_os: "10045-01" })).toBeNull();
    // Outra vistoria, enviada depois da que o orçamento carregou, espera de novo.
    expect(vistoriaAUsar("10045", { ...DEMANDA, vistoria: { ...VISTORIA, os: "10045-03" } }, { vistoria_os: "10045-01" })?.os).toBe("10045-03");
    expect(vistoriaAUsar("10045", { ...DEMANDA, etapa: "para_aprovar" }, null)).toBeNull();
    const [item] = pendenciasDoComercial({ role: "comercial", vistorias: [vistoriaAUsar("10045", DEMANDA, null)!], comercialLiberado: true });
    expect([item.title, item.detail, item.href, item.actionLabel]).toEqual([
      "Vistoria concluída · 10045",
      "Itaú Unibanco · 3 itens levantados · enviada pela Operação 22/10/2026",
      "/comercial/orcamento?numero=10045",
      "Abrir orçamento",
    ]);
    expect(pendenciasDoComercial({ role: "interno", vistorias: [vistoriaAUsar("10045", DEMANDA, null)!], comercialLiberado: true })).toEqual([]);
  });
});

describe("carregar a vistoria no orçamento", () => {
  it("o item que já está na linha da tabela fica com a quantidade levantada; o outro entra pela tabela; o fora da tabela fica dito", () => {
    const vistoria = vistoriaDaDemanda(DEMANDA)!;
    const antes = [linhaDoServidor({ id: "ln_1", lpu_item_id: "lpu_cad", item: "Transporte de cadeira", quantidade: "20", preco: "11.4", preco_tabela: "11.4", origem: "tabela" })];
    let chave = 0;
    const linhas = carregarVistoria(antes, vistoria, CATALOGO, () => `nova-${++chave}`);
    expect(linhas.map((linha) => [linha.id, linha.lpuItemId, linha.quantidade, linha.preco])).toEqual([
      ["ln_1", "lpu_cad", "24", "11,40"],
      [null, "lpu_est", "12", "21,00"],
    ]);
    expect(foraDaTabelaDaVistoria(vistoria, CATALOGO).map((item) => item.item)).toEqual(["Cofre"]);
    expect(itensDaVistoriaEmTexto(vistoria.itens)).toBe("24 Transporte de cadeira · 12 Desmontagem de estação · 1 vb Cofre");
  });

  it("ao salvar, o orçamento marca a vistoria uma vez; o servidor aceita o campo", () => {
    const original = formDoOrcamento(DEMANDA, { linhas: [] });
    const carregado = { ...original, vistoriaOs: "10045-01" };
    expect(formSujo(original, carregado)).toBe(true);
    expect(payloadSalvar({ original, form: carregado, numero: "10045", edicao: 3, chave: "k" })).toMatchObject({ action: "update", vistoria_os: "10045-01" });
    expect(payloadSalvar({ original: carregado, form: carregado, numero: "10045", edicao: 4, chave: "k" })).not.toHaveProperty("vistoria_os");
    expect(formDoOrcamento(DEMANDA, { vistoria_os: "10045-01" }).vistoriaOs).toBe("10045-01");
    const bloco = QUOTES_DO_SERVIDOR.slice(QUOTES_DO_SERVIDOR.indexOf("const AtualizarOrcamento = z"), QUOTES_DO_SERVIDOR.indexOf(".strict();", QUOTES_DO_SERVIDOR.indexOf("const AtualizarOrcamento = z")));
    expect(bloco).toMatch(/^ {4}vistoria_os: z\.string\(\)/m);
  });
});
