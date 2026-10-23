import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  MOTIVOS_DE_PERDA,
  MOTIVOS_DE_REVISAO,
  ROTULO_DA_ACAO,
  ETAPAS_QUE_PERDEM,
  acoesDepoisDoEnvio,
  demandaComprometida,
  camposDoDialogo,
  formInicialDoDialogo,
  problemasDoDialogo,
  chaveDoPedido,
  classificarErroDepoisDoEnvio,
  motivosDePerdaPermitidos,
  pedidoDaAcao,
  pedidoDeExecucaoDireta,
  problemasDaExecucao,
  problemasDaPerda,
  problemasDaResposta,
  problemasDaRevisao,
  type ItemParaAcoes,
} from "./depois-do-envio";

/**
 * As ações depois do envio (parte 12b de docs/plataforma/fase-6-comercial.md):
 * quais ações cada etapa oferece (por tipo de RV e papel), a validação dos
 * diálogos (motivo, datas, contato, link) e o pedido que cada ação faz às
 * callables advanceDemand e advanceQuote, sempre com a etapa e a RV (ou a
 * situação e a edição) que a tela viu.
 */

const here = dirname(fileURLToPath(import.meta.url));
const eventsDoComercial = readFileSync(resolve(here, "../../../../../functions/comercial/src/domain/events.ts"), "utf8");

function item(parcial: Partial<ItemParaAcoes> = {}): ItemParaAcoes {
  return {
    numero: "10045",
    rv: 0,
    etapa: "aguardando_cliente",
    tipoRv: "proposta",
    status: "enviado",
    edicao: 6,
    revisaoDe: null,
    autorUid: "u-gui",
    escopoRv: null,
    executada: false,
    validada: false,
    ...parcial,
  };
}

const COMERCIAL = { role: "comercial", uid: "u-gui" };
const OWNER = { role: "owner", uid: "u-leo" };

describe("ações por etapa, tipo de RV e papel", () => {
  it("aguardando cliente, proposta: Fechado é a principal; Revisar e Perdido ao lado", () => {
    expect(acoesDepoisDoEnvio(item(), COMERCIAL)).toEqual({ principal: "fechar", secundarias: ["revisar", "perder"] });
  });

  it("aguardando cliente, RV de execução: Validado e Revisar; sem Perdido nem recusa", () => {
    expect(acoesDepoisDoEnvio(item({ tipoRv: "execucao", rv: 2 }), COMERCIAL)).toEqual({ principal: "validar", secundarias: ["revisar"] });
  });

  it("aguardando cliente, aditivo: Validado, Recusar aditivo e Revisar", () => {
    expect(acoesDepoisDoEnvio(item({ tipoRv: "aditivo", rv: 1 }), COMERCIAL)).toEqual({
      principal: "validar",
      secundarias: ["recusar_aditivo", "revisar"],
    });
  });

  it("para planejar: Registrar execução; Aditivo; Perdido", () => {
    expect(acoesDepoisDoEnvio(item({ etapa: "para_planejar" }), COMERCIAL)).toEqual({
      principal: "registrar_execucao",
      secundarias: ["aditivo", "perder"],
    });
  });

  it("execução a orçar com a RV enviada: Orçar execução abre a RV de execução; Validado fica ao lado (sem desvio)", () => {
    expect(acoesDepoisDoEnvio(item({ etapa: "execucao_a_orcar" }), COMERCIAL)).toEqual({
      principal: "orcar_execucao",
      secundarias: ["validar"],
    });
  });

  it("aditivo em negociação: o serviço não espera, Registrar execução fica entre as ações", () => {
    const negociando = { tipoRv: "aditivo", rv: 1, escopoRv: 0, revisaoDe: { rv: 0, motivo: "aditivo" } } as const;
    expect(acoesDepoisDoEnvio(item({ ...negociando }), COMERCIAL)).toEqual({
      principal: "validar",
      secundarias: ["recusar_aditivo", "revisar", "registrar_execucao"],
    });
    expect(acoesDepoisDoEnvio(item({ ...negociando, status: "rascunho", etapa: "em_montagem" }), COMERCIAL).secundarias).toEqual([
      "descartar_rv",
      "registrar_execucao",
      "perder",
    ]);
    expect(acoesDepoisDoEnvio(item({ ...negociando, status: "para_aprovar", etapa: "para_aprovar" }), COMERCIAL).secundarias).toEqual([
      "descartar_rv",
      "registrar_execucao",
    ]);
    expect(acoesDepoisDoEnvio(item({ ...negociando, status: "aprovado", etapa: "para_enviar" }), COMERCIAL).secundarias).toEqual([
      "descartar_rv",
      "registrar_execucao",
      "perder",
    ]);
    // Quem não pode descartar o "para aprovar" ainda registra a execução.
    expect(
      acoesDepoisDoEnvio(item({ ...negociando, status: "para_aprovar", etapa: "para_aprovar" }), { role: "admin", uid: "u-ana" }).secundarias,
    ).toEqual(["registrar_execucao"]);
  });

  it("aditivo sem a execução em aberto: já executada, já validada ou sem escopo fechado não oferecem o registro", () => {
    const base = { tipoRv: "aditivo", rv: 1, revisaoDe: { rv: 0, motivo: "aditivo" } } as const;
    expect(acoesDepoisDoEnvio(item({ ...base, escopoRv: 0, executada: true }), COMERCIAL).secundarias).not.toContain("registrar_execucao");
    expect(acoesDepoisDoEnvio(item({ ...base, escopoRv: 0, validada: true }), COMERCIAL).secundarias).not.toContain("registrar_execucao");
    expect(acoesDepoisDoEnvio(item({ ...base, escopoRv: null }), COMERCIAL).secundarias).not.toContain("registrar_execucao");
    expect(acoesDepoisDoEnvio(item({ escopoRv: 0 }), COMERCIAL).secundarias).not.toContain("registrar_execucao");
  });

  it("perdida: Reabrir; a cancelada e as etapas do faturamento não têm ação aqui", () => {
    expect(acoesDepoisDoEnvio(item({ etapa: "perdida" }), COMERCIAL)).toEqual({ principal: "reabrir", secundarias: [] });
    for (const etapa of ["cancelada", "aguardando_autorizacao", "a_faturar"] as const) {
      expect(acoesDepoisDoEnvio(item({ etapa }), COMERCIAL)).toEqual({ principal: null, secundarias: [] });
    }
  });

  it("rascunho de RV seguinte: Descartar RV; a primeira RV não tem de onde voltar", () => {
    const seguinte = item({ status: "rascunho", etapa: "em_montagem", rv: 1, revisaoDe: { rv: 0, motivo: "pedido_cliente" } });
    expect(acoesDepoisDoEnvio(seguinte, COMERCIAL)).toEqual({ principal: null, secundarias: ["descartar_rv", "perder"] });
    expect(acoesDepoisDoEnvio(item({ status: "rascunho", etapa: "em_montagem" }), COMERCIAL)).toEqual({ principal: null, secundarias: ["perder"] });
    // A RV de execução em rascunho (execução a orçar) também se descarta.
    const execucao = item({ status: "rascunho", etapa: "execucao_a_orcar", tipoRv: "execucao", rv: 2, revisaoDe: { rv: 1, motivo: "execucao" } });
    expect(acoesDepoisDoEnvio(execucao, COMERCIAL)).toEqual({ principal: null, secundarias: ["descartar_rv", "perder"] });
  });

  it("Perdido no rascunho e no aprovado ainda não enviado (parte 6.22); no para aprovar, não", () => {
    expect(acoesDepoisDoEnvio(item({ status: "rascunho", etapa: "em_montagem" }), COMERCIAL).secundarias).toEqual(["perder"]);
    expect(acoesDepoisDoEnvio(item({ status: "aprovado", etapa: "para_enviar" }), COMERCIAL).secundarias).toEqual(["perder"]);
    expect(acoesDepoisDoEnvio(item({ status: "para_aprovar", etapa: "para_aprovar" }), COMERCIAL)).toEqual({ principal: null, secundarias: [] });
    // Antes do fechamento, todos os motivos; depois, só o cancelamento do cliente.
    expect(demandaComprometida(item({ status: "rascunho", etapa: "em_montagem" }))).toBe(false);
    expect(demandaComprometida(item({ status: "rascunho", etapa: "em_montagem", escopoRv: 0 }))).toBe(true);
    expect(demandaComprometida(item({ executada: true }))).toBe(true);
    expect(demandaComprometida(item({ validada: true }))).toBe(true);
  });

  it("as etapas que perdem são as do servidor (ETAPAS_QUE_PERDEM, functions/comercial)", () => {
    const fonte = readFileSync(new URL("../../../../../functions/comercial/src/domain/demanda.ts", import.meta.url), "utf8");
    const lista = fonte.match(/export const ETAPAS_QUE_PERDEM = \[([\s\S]*?)\]/)?.[1] ?? "";
    expect([...lista.matchAll(/"([a-z_]+)"/g)].map(([, etapa]) => etapa)).toEqual([...ETAPAS_QUE_PERDEM]);
  });

  it("descartar a RV que está para aprovar é de quem montou ou do owner; as outras pessoas não", () => {
    const aprovar = item({ status: "para_aprovar", etapa: "para_aprovar", rv: 1, revisaoDe: { rv: 0, motivo: "correcao" } });
    expect(acoesDepoisDoEnvio(aprovar, COMERCIAL).secundarias).toEqual(["descartar_rv"]);
    expect(acoesDepoisDoEnvio(aprovar, OWNER).secundarias).toEqual(["descartar_rv"]);
    expect(acoesDepoisDoEnvio(aprovar, { role: "admin", uid: "u-ana" }).secundarias).toEqual([]);
    const aprovada = item({ status: "aprovado", etapa: "para_enviar", rv: 1, revisaoDe: { rv: 0, motivo: "correcao" } });
    expect(acoesDepoisDoEnvio(aprovada, { role: "admin", uid: "u-ana" }).secundarias).toEqual(["descartar_rv", "perder"]);
  });

  it("a demanda perdida não descarta RV: reabre antes", () => {
    const perdida = item({ status: "rascunho", etapa: "perdida", rv: 1, revisaoDe: { rv: 0, motivo: "correcao" } });
    expect(acoesDepoisDoEnvio(perdida, COMERCIAL)).toEqual({ principal: "reabrir", secundarias: [] });
  });

  it("papel fora do Comercial (ou sem papel) não tem ação", () => {
    for (const role of ["financeiro", "operacao", "campo", "cliente", null, undefined]) {
      expect(acoesDepoisDoEnvio(item(), { role, uid: "u-x" })).toEqual({ principal: null, secundarias: [] });
    }
  });

  it("owner, admin e comercial têm as mesmas ações depois do envio", () => {
    for (const role of ["owner", "admin", "comercial"]) {
      expect(acoesDepoisDoEnvio(item(), { role, uid: "u-x" }).principal).toBe("fechar");
    }
  });

  it("os rótulos são os do pedido, sem legenda", () => {
    expect(ROTULO_DA_ACAO).toEqual({
      fechar: "Fechado",
      perder: "Perdido",
      revisar: "Revisar",
      validar: "Validado",
      recusar_aditivo: "Recusar aditivo",
      registrar_execucao: "Registrar execução",
      aditivo: "Aditivo",
      orcar_execucao: "Orçar execução",
      reabrir: "Reabrir",
      descartar_rv: "Descartar RV",
    });
  });
});

describe("motivos", () => {
  it("os motivos de perda são os do servidor, com rótulo em português", () => {
    const servidor = /export const MOTIVOS_PERDA = \[([^\]]+)\]/.exec(eventsDoComercial)?.[1];
    const motivos = Array.from(servidor!.matchAll(/"([^"]+)"/g), ([, motivo]) => motivo);
    expect(MOTIVOS_DE_PERDA.map((motivo) => motivo.valor)).toEqual(motivos);
    expect(MOTIVOS_DE_PERDA.map((motivo) => motivo.rotulo)).toEqual([
      "Preço",
      "Prazo",
      "Desistência",
      "Sem resposta",
      "Cancelado pelo cliente",
      "Outro",
    ]);
  });

  it("Revisar oferece o pedido do cliente e a correção (os outros motivos abrem RV por outra ação)", () => {
    const servidor = /export const MOTIVOS_REVISAO = \[([^\]]+)\]/.exec(eventsDoComercial)?.[1];
    const todos = Array.from(servidor!.matchAll(/"([^"]+)"/g), ([, motivo]) => motivo);
    expect(MOTIVOS_DE_REVISAO.map((motivo) => motivo.valor)).toEqual(["pedido_cliente", "correcao"]);
    for (const motivo of MOTIVOS_DE_REVISAO) expect(todos).toContain(motivo.valor);
    expect(MOTIVOS_DE_REVISAO.map((motivo) => motivo.rotulo)).toEqual(["Pedido do cliente", "Correção"]);
  });

  it("depois do fechamento, Perdido só com cancelado pelo cliente; antes dele, todos", () => {
    expect(motivosDePerdaPermitidos(true).map((motivo) => motivo.valor)).toEqual(["cancelado_cliente"]);
    expect(motivosDePerdaPermitidos(false)).toEqual(MOTIVOS_DE_PERDA);
  });
});

describe("validação dos diálogos", () => {
  const contatos = [{ id: "ct_marina" }, { id: "ct_paula" }];
  const agora = new Date("2026-10-21T15:00:00.000Z"); // 12:00 em São Paulo
  const contexto = { agora, envioEm: "2026-10-20T13:00:00.000Z", contatos };
  const certo = { em: "2026-10-21T10:30", contatoId: "ct_marina", link: "https://outlook.office.com/mail/id/AAA" };

  it("resposta completa não tem problema; o link e a hora podem ficar como estão", () => {
    expect(problemasDaResposta(certo, contexto)).toEqual({});
    expect(problemasDaResposta({ ...certo, link: "" }, contexto)).toEqual({});
  });

  it("a data e a hora são obrigatórias", () => {
    expect(problemasDaResposta({ ...certo, em: "" }, contexto).em).toBe("Informe quando o cliente respondeu.");
    expect(problemasDaResposta({ ...certo, em: "ontem" }, contexto).em).toBe("Informe quando o cliente respondeu.");
  });

  it("a resposta não é depois de agora (folga de 5 minutos do relógio) nem antes do envio", () => {
    expect(problemasDaResposta({ ...certo, em: "2026-10-21T12:04" }, contexto)).toEqual({});
    expect(problemasDaResposta({ ...certo, em: "2026-10-21T12:06" }, contexto).em).toBe("A resposta não pode ser depois de agora.");
    expect(problemasDaResposta({ ...certo, em: "2026-10-20T09:00" }, contexto).em).toBe("A resposta não pode ser antes do envio (20/10 10:00).");
    expect(problemasDaResposta({ ...certo, em: "2026-10-20T09:56" }, contexto)).toEqual({});
    // Sem a data do envio, só vale o limite de agora.
    expect(problemasDaResposta({ ...certo, em: "2026-01-02T09:00" }, { ...contexto, envioEm: null })).toEqual({});
  });

  it("o contato é do cliente: obrigatório quando há contatos; sem contatos cadastrados, não se exige", () => {
    expect(problemasDaResposta({ ...certo, contatoId: "" }, contexto).contato).toBe("Escolha o contato do cliente.");
    expect(problemasDaResposta({ ...certo, contatoId: "ct_de_outro" }, contexto).contato).toBe("Escolha o contato do cliente.");
    expect(problemasDaResposta({ ...certo, contatoId: "" }, { ...contexto, contatos: [] })).toEqual({});
  });

  it("o link começa com https:// (ou http://) e cabe em 2000 caracteres", () => {
    expect(problemasDaResposta({ ...certo, link: "outlook.office.com/mail" }, contexto).link).toBe("Informe o link que começa com https://.");
    expect(problemasDaResposta({ ...certo, link: "https://a b" }, contexto).link).toBe("Informe o link que começa com https://.");
    expect(problemasDaResposta({ ...certo, link: `https://x.com/${"a".repeat(2000)}` }, contexto).link).toBe("Use até 2000 caracteres no link.");
  });

  it("perdido: motivo da lista; outro pede a nota; nota até 1000 caracteres", () => {
    const todos = MOTIVOS_DE_PERDA;
    expect(problemasDaPerda({ motivo: "", nota: "" }, todos).motivo).toBe("Escolha o motivo.");
    expect(problemasDaPerda({ motivo: "preco", nota: "" }, todos)).toEqual({});
    expect(problemasDaPerda({ motivo: "outro", nota: "  " }, todos).nota).toBe("Conte o motivo na nota.");
    expect(problemasDaPerda({ motivo: "outro", nota: "Mudou a diretoria" }, todos)).toEqual({});
    expect(problemasDaPerda({ motivo: "preco", nota: "x".repeat(1001) }, todos).nota).toBe("Use até 1000 caracteres na nota.");
    // Depois do fechamento, o motivo precisa estar entre os permitidos.
    expect(problemasDaPerda({ motivo: "preco", nota: "" }, motivosDePerdaPermitidos("para_planejar")).motivo).toBe("Escolha o motivo.");
    expect(problemasDaPerda({ motivo: "cancelado_cliente", nota: "" }, motivosDePerdaPermitidos("para_planejar"))).toEqual({});
  });

  it("revisar: o motivo é obrigatório", () => {
    expect(problemasDaRevisao({ motivo: "" }).motivo).toBe("Escolha o motivo.");
    expect(problemasDaRevisao({ motivo: "execucao" }).motivo).toBe("Escolha o motivo.");
    expect(problemasDaRevisao({ motivo: "correcao" })).toEqual({});
  });

  it("execução: as duas datas, o fim depois do início e até hoje", () => {
    expect(problemasDaExecucao({ de: "", ate: "" }, "2026-10-21")).toEqual({ de: "Informe o início.", ate: "Informe o fim." });
    expect(problemasDaExecucao({ de: "2026-10-18", ate: "2026-10-20" }, "2026-10-21")).toEqual({});
    expect(problemasDaExecucao({ de: "2026-10-21", ate: "2026-10-21" }, "2026-10-21")).toEqual({});
    expect(problemasDaExecucao({ de: "2026-10-20", ate: "2026-10-18" }, "2026-10-21").ate).toBe("O fim vem antes do início.");
    expect(problemasDaExecucao({ de: "2026-10-18", ate: "2026-10-22" }, "2026-10-21").ate).toBe("O fim não pode ser depois de hoje.");
    expect(problemasDaExecucao({ de: "2026-02-30", ate: "2026-10-20" }, "2026-10-21").de).toBe("Informe o início.");
  });
});

describe("o pedido que cada ação faz", () => {
  const base = { numero: "10045", rv: 0, etapa: "aguardando_cliente", status: "enviado", edicao: 6 } as const;

  it("Fechado: advanceDemand close com a etapa e a RV que a tela viu, a resposta com fuso e o contato", () => {
    const pedido = pedidoDaAcao("fechar", item(base), { em: "2026-10-21T10:30", contatoId: "ct_marina", link: " https://outlook.office.com/mail/id/AAA " }, "chave-1");
    expect(pedido).toEqual({
      callable: "advanceDemand",
      payload: {
        action: "close",
        request_id: "chave-1",
        numero: "10045",
        expected_etapa: "aguardando_cliente",
        expected_rv: 0,
        em: "2026-10-21T10:30-03:00",
        contato_id: "ct_marina",
        link: "https://outlook.office.com/mail/id/AAA",
      },
      sucesso: "Fechamento registrado",
      abreMontagem: false,
    });
  });

  it("sem link nem contato, a resposta vai só com a hora; Validado e Recusar aditivo usam a mesma resposta", () => {
    const resposta = { em: "2026-10-21T10:30", contatoId: "", link: "" };
    const validar = pedidoDaAcao("validar", item({ ...base, tipoRv: "execucao", rv: 2 }), resposta, "k");
    expect(validar.payload).toEqual({
      action: "validate",
      request_id: "k",
      numero: "10045",
      expected_etapa: "aguardando_cliente",
      expected_rv: 2,
      em: "2026-10-21T10:30-03:00",
    });
    const recusa = pedidoDaAcao("recusar_aditivo", item({ ...base, tipoRv: "aditivo", rv: 1 }), resposta, "k2");
    expect(recusa.payload.action).toBe("refuse_addendum");
    expect(recusa.callable).toBe("advanceDemand");
  });

  it("Perdido: lose com o motivo e a nota (a nota só quando escrita)", () => {
    expect(pedidoDaAcao("perder", item(base), { motivo: "preco", nota: "" }, "k").payload).toEqual({
      action: "lose",
      request_id: "k",
      numero: "10045",
      expected_etapa: "aguardando_cliente",
      expected_rv: 0,
      motivo: "preco",
    });
    expect(pedidoDaAcao("perder", item(base), { motivo: "outro", nota: " Mudou a diretoria " }, "k").payload).toMatchObject({
      motivo: "outro",
      nota: "Mudou a diretoria",
    });
  });

  it("Reabrir e Registrar execução vão por advanceDemand", () => {
    expect(pedidoDaAcao("reabrir", item({ ...base, etapa: "perdida" }), {}, "k").payload).toEqual({
      action: "reopen",
      request_id: "k",
      numero: "10045",
      expected_etapa: "perdida",
      expected_rv: 0,
    });
    expect(pedidoDaAcao("registrar_execucao", item({ ...base, etapa: "para_planejar" }), { de: "2026-10-18", ate: "2026-10-20" }, "k").payload).toEqual({
      action: "register_execution",
      request_id: "k",
      numero: "10045",
      expected_etapa: "para_planejar",
      expected_rv: 0,
      executado_de: "2026-10-18",
      executado_ate: "2026-10-20",
    });
  });

  it("Revisar, Aditivo e Orçar execução abrem a RV seguinte por advanceQuote revise e levam à montagem", () => {
    const revisar = pedidoDaAcao("revisar", item(base), { motivo: "pedido_cliente" }, "k");
    expect(revisar).toMatchObject({ callable: "advanceQuote", abreMontagem: true, sucesso: "RV nova aberta" });
    expect(revisar.payload).toEqual({
      action: "revise",
      request_id: "k",
      numero: "10045",
      expected_status: "enviado",
      expected_edicao: 6,
      motivo: "pedido_cliente",
    });
    expect(pedidoDaAcao("aditivo", item({ ...base, etapa: "para_planejar" }), {}, "k").payload).toMatchObject({ action: "revise", motivo: "aditivo" });
    const execucao = pedidoDaAcao("orcar_execucao", item({ ...base, etapa: "execucao_a_orcar" }), {}, "k");
    expect(execucao.payload).toMatchObject({ action: "revise", motivo: "execucao", expected_status: "enviado", expected_edicao: 6 });
    expect(execucao.abreMontagem).toBe(true);
  });

  it("Descartar RV: discard com a situação e a edição do rascunho que a tela viu; fica onde está", () => {
    const pedido = pedidoDaAcao("descartar_rv", item({ numero: "10045", rv: 1, etapa: "em_montagem", status: "rascunho", edicao: 3 }), {}, "k");
    expect(pedido).toEqual({
      callable: "advanceQuote",
      payload: { action: "discard", request_id: "k", numero: "10045", expected_status: "rascunho", expected_edicao: 3 },
      sucesso: "RV descartada",
      abreMontagem: false,
    });
  });

  it("Orçar execução da fila: create_execution com o cliente, o período executado, o contrato e a tabela", () => {
    expect(
      pedidoDeExecucaoDireta({ customerCode: "ITAU-UNIBANCO", contratoId: "ct-itau", variante: "Noturna", de: "2026-10-18", ate: "2026-10-20" }, "k"),
    ).toEqual({
      callable: "saveQuote",
      payload: {
        action: "create_execution",
        request_id: "k",
        customer_code: "ITAU-UNIBANCO",
        contrato_id: "ct-itau",
        variante: "Noturna",
        executado_de: "2026-10-18",
        executado_ate: "2026-10-20",
      },
      sucesso: "Orçamento de execução criado",
      abreMontagem: true,
    });
  });
});

describe("chave de idempotência e recusas", () => {
  it("clicar de novo no mesmo pedido leva a mesma chave; outro pedido, chave nova", () => {
    let contador = 0;
    const nova = () => `k${++contador}`;
    const pedido = (motivo: string) => ({ callable: "advanceDemand" as const, payload: { action: "lose", request_id: "x", numero: "10045", motivo } });
    const primeira = chaveDoPedido(null, pedido("preco"), nova);
    const repetida = chaveDoPedido(primeira, pedido("preco"), nova);
    expect(repetida).toBe(primeira);
    const outra = chaveDoPedido(repetida, pedido("prazo"), nova);
    expect(outra.chave).toBe("k2");
    expect(chaveDoPedido(outra, { ...pedido("prazo"), callable: "advanceQuote" as never }, nova).chave).toBe("k3");
  });

  it("a etapa que mudou (demanda ou orçamento) recarrega; outras recusas só mostram a mensagem", () => {
    const erro = (mensagem: string, codigo: string) => Object.assign(new Error(mensagem), { codigo });
    expect(
      classificarErroDepoisDoEnvio(erro("A demanda 10045 mudou: está para planejar, na 10045. Abra de novo.", "failed-precondition")),
    ).toEqual({ mensagem: "A demanda 10045 mudou: está para planejar, na 10045. Abra de novo.", recarregar: true });
    expect(classificarErroDepoisDoEnvio(erro("O orçamento 10045 mudou: está em rascunho, não enviado. Abra de novo.", "failed-precondition")).recarregar).toBe(true);
    expect(classificarErroDepoisDoEnvio(erro("Executado: o fim vem antes do início.", "invalid-argument"))).toEqual({
      mensagem: "Executado: o fim vem antes do início.",
      recarregar: false,
    });
    expect(classificarErroDepoisDoEnvio(erro("A demanda 10045 mudou: está perdida.", "invalid-argument")).recarregar).toBe(false);
  });
});

describe("o formulário do diálogo", () => {
  const contatos = [{ id: "ct_marina" }, { id: "ct_paula" }];
  const agora = new Date("2026-10-21T15:00:00.000Z");

  it("cada ação pede só os campos de que precisa", () => {
    expect(camposDoDialogo("fechar")).toBe("resposta");
    expect(camposDoDialogo("validar")).toBe("resposta");
    expect(camposDoDialogo("recusar_aditivo")).toBe("resposta");
    expect(camposDoDialogo("perder")).toBe("perda");
    expect(camposDoDialogo("revisar")).toBe("revisao");
    expect(camposDoDialogo("registrar_execucao")).toBe("execucao");
    for (const acao of ["aditivo", "orcar_execucao", "reabrir", "descartar_rv"] as const) expect(camposDoDialogo(acao)).toBe("confirmar");
  });

  it("abre com agora (hora de São Paulo) e o contato do pedido, se ainda for do cliente", () => {
    const base = { agora, contatos, etapa: "aguardando_cliente" as const };
    expect(formInicialDoDialogo("fechar", { ...base, contatoId: "ct_paula" })).toEqual({
      em: "2026-10-21T12:00",
      contatoId: "ct_paula",
      link: "",
      motivo: "",
      nota: "",
      de: "",
      ate: "",
    });
    expect(formInicialDoDialogo("fechar", { ...base, contatoId: "ct_apagado" }).contatoId).toBe("");
    expect(formInicialDoDialogo("fechar", { ...base, contatoId: null }).contatoId).toBe("");
  });

  it("Perdido depois do fechamento já vem com o único motivo possível", () => {
    const base = { agora, contatos, contatoId: null };
    expect(formInicialDoDialogo("perder", { ...base, comprometida: true }).motivo).toBe("cancelado_cliente");
    expect(formInicialDoDialogo("perder", { ...base, comprometida: false }).motivo).toBe("");
  });

  it("os problemas seguem a ação: resposta, perda, revisão, execução; confirmar não tem campo", () => {
    const contexto = { agora, hoje: "2026-10-21", envioEm: null, contatos, comprometida: false };
    const vazio = formInicialDoDialogo("fechar", { agora, contatos, contatoId: null, comprometida: false });
    expect(problemasDoDialogo("fechar", vazio, contexto)).toEqual({ contato: "Escolha o contato do cliente." });
    expect(problemasDoDialogo("perder", vazio, contexto)).toEqual({ motivo: "Escolha o motivo." });
    expect(problemasDoDialogo("revisar", vazio, contexto)).toEqual({ motivo: "Escolha o motivo." });
    expect(problemasDoDialogo("registrar_execucao", vazio, contexto)).toEqual({ de: "Informe o início.", ate: "Informe o fim." });
    expect(problemasDoDialogo("reabrir", vazio, contexto)).toEqual({});
  });
});
