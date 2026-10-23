import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DIAS_A_FRENTE,
  MAX_ANEXOS,
  MAX_BYTES_DO_ANEXO,
  MAX_DESCRICAO,
  MAX_ORIGEM,
  TIPOS_DE_SERVICO,
  caminhoDoAnexo,
  detalheDaSolicitacao,
  escolherAnexos,
  formularioInicial,
  nomeDoAnexo,
  pedidoDaSolicitacao,
  podeEnviar,
  problemasDaSolicitacao,
  solicitacaoDoPortal,
  solicitacoesEmAberto,
  tituloDaSolicitacao,
} from "./solicitacao";

/**
 * Solicitar OS pelo portal (parte 4.4b): o formulário diz antes o que a
 * callable recusaria, com as mesmas listas e os mesmos limites de
 * functions/operacao; as solicitações em aberto somem quando a OS conta a
 * história. Dados sintéticos.
 */

const here = dirname(fileURLToPath(import.meta.url));
const DO_BACKEND = readFileSync(resolve(here, "../../../../../functions/operacao/src/domain/solicitacao.ts"), "utf8");
const STORAGE = readFileSync(resolve(here, "../../../../../storage.rules"), "utf8");

function constante(nome: string): string {
  const achado = DO_BACKEND.match(new RegExp(`export const ${nome} = ([^;]+);`));
  if (!achado) throw new Error(`${nome} não encontrado`);
  return achado[1].trim();
}

const AGORA = new Date("2026-10-23T13:00:00.000Z");
const HOJE = "2026-10-23";

function arquivo(nome: string, tipo: string, tamanho = 1000): File {
  const conteudo = new File(["x"], nome, { type: tipo });
  Object.defineProperty(conteudo, "size", { value: tamanho });
  return conteudo;
}

describe("iguais a functions/operacao", () => {
  it("os tipos de serviço, os anexos, os dias e os tamanhos", () => {
    expect([...constante("TIPOS_DE_SERVICO").matchAll(/"([^"]+)"/g)].map((item) => item[1])).toEqual([...TIPOS_DE_SERVICO]);
    expect(Number(constante("MAX_ANEXOS"))).toBe(MAX_ANEXOS);
    expect(constante("MAX_BYTES_DO_ANEXO")).toBe("10 * 1024 * 1024");
    expect(MAX_BYTES_DO_ANEXO).toBe(10 * 1024 * 1024);
    expect(Number(constante("DIAS_A_FRENTE"))).toBe(DIAS_A_FRENTE);
    expect(Number(constante("MAX_ORIGEM"))).toBe(MAX_ORIGEM);
    expect(Number(constante("MAX_DESCRICAO"))).toBe(MAX_DESCRICAO);
    for (const tipo of ["application/pdf", "image/jpeg", "image/png", "image/webp"]) expect(constante("TIPO_DO_ANEXO")).toContain(`"${tipo}"`);
    expect(STORAGE).toContain("match /portal/{code}/solicitacoes/{arquivo}");
    expect(caminhoDoAnexo("ITAU", "an_0123456789abcdef.pdf")).toBe("portal/ITAU/solicitacoes/an_0123456789abcdef.pdf");
  });
});

describe("o formulário", () => {
  it("começa em transporte, amanhã às 08:00, como no desenho", () => {
    expect(formularioInicial(HOJE)).toEqual({ tipo: "transporte", data: "2026-10-24", horario: "08:00", origem: "", destino: "", descricao: "", anexos: [] });
    expect(formularioInicial("2026-12-31").data).toBe("2027-01-01");
  });

  it("diz o que falta: a data que passou ou além de um ano, a origem e o que será feito", () => {
    const vazio = formularioInicial(HOJE);
    expect(problemasDaSolicitacao(vazio, AGORA)).toEqual({ origem: "Informe a origem.", descricao: "Diga o que será feito." });
    const pronto = { ...vazio, origem: "Rua das Indústrias, 450", descricao: "Levar 12 paletes" };
    expect(problemasDaSolicitacao(pronto, AGORA)).toEqual({});
    expect(podeEnviar(pronto, AGORA)).toBe(true);
    // 13:00 UTC é 10:00 em São Paulo.
    expect(problemasDaSolicitacao({ ...pronto, data: HOJE, horario: "10:00" }, AGORA)).toEqual({ quando: "A data e o horário já passaram." });
    expect(problemasDaSolicitacao({ ...pronto, data: HOJE, horario: "10:30" }, AGORA)).toEqual({});
    expect(problemasDaSolicitacao({ ...pronto, data: "2027-10-24" }, AGORA)).toEqual({ quando: "Peça com até 365 dias de antecedência." });
    expect(problemasDaSolicitacao({ ...pronto, data: "", horario: "" }, AGORA)).toEqual({ quando: "Informe a data e o horário." });
    expect(problemasDaSolicitacao({ ...pronto, origem: "x".repeat(161) }, AGORA)).toEqual({ origem: "Use até 160 caracteres." });
  });

  it("o anexo: PDF ou imagem, até 10 MB e até 3; o nome no Storage é aleatório, com a extensão do tipo", () => {
    expect(nomeDoAnexo("application/pdf", () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 255]))).toBe("an_01020304050607ff.pdf");
    expect(nomeDoAnexo("image/jpeg")).toMatch(/^an_[a-f0-9]{16}\.jpg$/);
    expect(nomeDoAnexo("text/html")).toBeNull();
    const um = escolherAnexos([arquivo("  NF   4498.pdf ", "application/pdf")], []);
    expect(um.problema).toBeNull();
    expect(um.anexos.map((anexo) => anexo.rotulo)).toEqual(["NF 4498.pdf"]);
    expect(escolherAnexos([arquivo("planilha.xlsx", "application/vnd.ms-excel")], []).problema).toBe("planilha.xlsx: use PDF, JPG, PNG ou WEBP.");
    expect(escolherAnexos([arquivo("grande.pdf", "application/pdf", MAX_BYTES_DO_ANEXO + 1)], []).problema).toBe("grande.pdf: o arquivo passa de 10 MB.");
    const quatro = escolherAnexos(["a", "b", "c", "d"].map((nome) => arquivo(`${nome}.png`, "image/png")), []);
    expect([quatro.anexos.length, quatro.problema]).toEqual([3, "Anexe até 3 arquivos."]);
  });

  it("o pedido leva o texto aparado, o destino vazio como nulo e os anexos pelo nome no Storage", () => {
    const anexos = escolherAnexos([arquivo("NF.pdf", "application/pdf")], []).anexos;
    const form = { ...formularioInicial(HOJE), tipo: "mudanca" as const, origem: " Rua Funchal, 200 ", destino: "  ", descricao: " Mudança do 5º andar ", anexos };
    expect(pedidoDaSolicitacao(form, "k1")).toEqual({
      idempotency_key: "k1",
      tipo_servico: "mudanca",
      data: "2026-10-24",
      horario: "08:00",
      origem: "Rua Funchal, 200",
      destino: null,
      descricao: "Mudança do 5º andar",
      anexos: [{ arquivo: anexos[0].nome, nome: "NF.pdf" }],
    });
  });
});

describe("as solicitações do cliente", () => {
  const ler = (id: string, extra: Record<string, unknown>) =>
    solicitacaoDoPortal(id, { tipo_servico: "transporte", status: "recebida", data: "2026-10-27", horario: "08:00", origem: "Rua A, 1", recebida_em: "2026-10-23T12:00:00.000Z", ...extra });

  it("a situação para o cliente: aguardando, em planejamento com a demanda, não atendida com o motivo", () => {
    const aguardando = ler("sol_1", { destino: "Rua B, 2", anexos: [{ nome: "NF.pdf", caminho: "portal/ITAU/solicitacoes/an_x.pdf" }] })!;
    expect(aguardando).toMatchObject({ situacao: "aguardando", quando: "27/10/2026 08:00", origem: "Rua A, 1", destino: "Rua B, 2", anexos: ["NF.pdf"], motivo: null });
    expect(tituloDaSolicitacao(aguardando)).toBe("Transporte / frete · 27/10/2026 08:00");
    expect(detalheDaSolicitacao(aguardando)).toBeNull();
    const aceita = ler("sol_2", { status: "aceita", demanda: "10050" })!;
    expect([aceita.situacao, detalheDaSolicitacao(aceita)]).toEqual(["em_planejamento", "Demanda 10050"]);
    const recusada = ler("sol_3", { status: "recusada", recusa: { motivo: "Fora da área atendida", em: "2026-10-23T02:00:00.000Z", por_uid: "u1" } })!;
    expect([recusada.situacao, detalheDaSolicitacao(recusada), recusada.recusadaEm]).toEqual(["nao_atendida", "Fora da área atendida", "2026-10-22"]);
    expect(JSON.stringify(recusada)).not.toContain("u1");
    expect(ler("sol_4", { tipo_servico: "frete" })).toBeNull();
    expect(ler("sol_5", { status: "pendente" })).toBeNull();
  });

  it("em aberto: as que aguardam, as atendidas sem OS ainda e as não atendidas dos últimos 30 dias, a mais recente primeiro", () => {
    const lista = [
      ler("sol_antiga", { recebida_em: "2026-10-01T12:00:00.000Z" })!,
      ler("sol_com_os", { status: "aceita", demanda: "10045", recebida_em: "2026-10-20T12:00:00.000Z" })!,
      ler("sol_sem_os", { status: "aceita", demanda: "10050", recebida_em: "2026-10-22T12:00:00.000Z" })!,
      ler("sol_recusada_hoje", { status: "recusada", recusa: { motivo: "Repetida", em: "2026-10-23T12:00:00.000Z" }, recebida_em: "2026-10-23T11:00:00.000Z" })!,
      ler("sol_recusada_velha", { status: "recusada", recusa: { motivo: "Repetida", em: "2026-09-01T12:00:00.000Z" }, recebida_em: "2026-08-30T12:00:00.000Z" })!,
    ];
    expect(solicitacoesEmAberto(lista, new Set(["10045"]), HOJE).map((item) => item.id)).toEqual(["sol_recusada_hoje", "sol_sem_os", "sol_antiga"]);
  });
});
