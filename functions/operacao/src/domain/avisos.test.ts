import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ENDERECO_DO_APP,
  EVENTOS_DE_AVISO,
  MODELOS_DE_AVISO,
  avisoDoEvento,
  clienteRecebeOModelo,
  contatoPodeReceber,
  destinatariosDoModelo,
  documentoDoModelo,
  emailDoAviso,
  enderecoDoApp,
  eventoLido,
  idDoAviso,
  idDoEmail,
  modeloDoEvento,
  type EventoLido,
} from "./avisos.js";
import { enviarPeloResend } from "./avisos-gravacao.js";
import { OPERACAO_EVENT_TYPES } from "./events.js";

/**
 * Os avisos por modelo (parte 4.6a): qual evento vira aviso, o texto de cada
 * modelo, quem recebe o e-mail e o envio pelo Resend. Dados sintéticos.
 */

function evento(type: string, payload: Record<string, unknown>, extra: Partial<EventoLido> = {}): EventoLido {
  const source = type.startsWith("nf.") ? "functions_financeiro" : "functions_operacao";
  return { id: "evt_0123456789abcdef01234567", type, source, customer_code: "ITAU", payload, occurred_at: "2026-10-23T13:00:00.000Z", ...extra };
}

const OS = {
  id: "10050-01",
  customer_code: "ITAU",
  tipo: "servico",
  servicos: ["desmontagem", "transporte", "montagem"],
  janela: { data: "2026-10-28", inicio: "08:00", fim: "12:00" },
  // A OS no banco não tem valor; mesmo que viesse um, o aviso não leva.
  valor_cents: 123456,
};

const FATURA = { id: "fat_0123456789abcdef01234567", customer_code: "ITAU", nf: { numero: "1234", serie: "1" }, valor_cents: 123456, vencimento: "2026-11-22" };

const SOLICITACAO = { id: "sol_0123456789abcdef", customer_code: "ITAU", tipo_servico: "mudanca", data: "2026-10-30", horario: "09:00" };

describe("qual evento vira aviso", () => {
  it("a OS agendada (ou planejada com a data), iniciada e concluída, a NF registrada e a solicitação do portal", () => {
    assert.equal(modeloDoEvento(evento("os.scheduled", { id: "10050-01" })), "os_agendada");
    assert.equal(modeloDoEvento(evento("os.planned", { id: "10050-01", data: "2026-10-28" })), "os_agendada");
    assert.equal(modeloDoEvento(evento("os.planned", { id: "10050-01", data: null })), null);
    assert.equal(modeloDoEvento(evento("os.started", { id: "10050-01" })), "os_iniciada");
    assert.equal(modeloDoEvento(evento("os.completed", { id: "10050-01" })), "os_concluida");
    assert.equal(modeloDoEvento(evento("nf.registered", { id: FATURA.id })), "nf_emitida");
    assert.equal(modeloDoEvento(evento("portal.service_requested", { id: SOLICITACAO.id })), "pedido_do_portal");
    for (const type of ["os.cancelled", "os.reviewed", "nf.sent", "expedicao.delivery_set"]) assert.equal(modeloDoEvento(evento(type, { id: "x" })), null, type);
  });

  it("o tipo vale só da codebase que grava o tipo", () => {
    assert.equal(modeloDoEvento(evento("os.completed", { id: "10050-01" }, { source: "functions_wms" })), null);
    assert.equal(modeloDoEvento(evento("nf.registered", { id: FATURA.id }, { source: "functions_operacao" })), null);
    assert.equal(modeloDoEvento(evento("os.completed", { id: "10050-01" }, { source: "" })), null);
  });

  it("os tipos da Operação que dão aviso existem na lista de eventos da Operação", () => {
    for (const type of EVENTOS_DE_AVISO.filter((tipo) => !tipo.startsWith("nf."))) assert.ok((OPERACAO_EVENT_TYPES as readonly string[]).includes(type), type);
  });

  it("o documento de cada modelo, nunca um caminho", () => {
    assert.deepEqual(documentoDoModelo("os_agendada", evento("os.scheduled", { id: "10050-01" })), { colecao: "service_orders", id: "10050-01" });
    assert.deepEqual(documentoDoModelo("nf_emitida", evento("nf.registered", { id: FATURA.id })), { colecao: "client_faturas", id: FATURA.id });
    assert.deepEqual(documentoDoModelo("pedido_do_portal", evento("portal.service_requested", { id: SOLICITACAO.id })), { colecao: "service_requests", id: SOLICITACAO.id });
    assert.equal(documentoDoModelo("os_agendada", evento("os.scheduled", { id: "a/b" })), null);
    assert.equal(documentoDoModelo("os_agendada", evento("os.scheduled", {})), null);
  });

  it("o evento lido do banco, com o que falta vazio", () => {
    assert.deepEqual(eventoLido("evt_1", { type: "os.started", source: "functions_operacao", customer_code: " ITAU ", payload: { id: "10050-01" } }), {
      id: "evt_1",
      type: "os.started",
      source: "functions_operacao",
      customer_code: "ITAU",
      payload: { id: "10050-01" },
      occurred_at: null,
    });
    assert.deepEqual(eventoLido("evt_2", { payload: ["x"] }).payload, {});
  });
});

describe("o texto de cada modelo", () => {
  it("a OS agendada: os serviços e a janela", () => {
    assert.deepEqual(avisoDoEvento(evento("os.scheduled", { id: "10050-01" }), OS), {
      modelo: "os_agendada",
      customer_code: "ITAU",
      titulo: "OS 10050-01 agendada",
      texto: "Desmontagem, transporte e montagem · 28/10/2026 08:00–12:00",
      link: "/portal/servicos?os=10050-01",
      entidade: "10050-01",
    });
    const semJanela = avisoDoEvento(evento("os.planned", { id: "10050-01", data: "2026-10-29" }), { ...OS, servicos: ["transporte"], janela: null });
    assert.equal(semJanela?.texto, "Transporte · 29/10/2026");
  });

  it("a OS iniciada e concluída, com a hora de São Paulo", () => {
    assert.equal(avisoDoEvento(evento("os.started", { id: "10050-01", instante: "2026-10-28T11:05:00.000Z" }), OS)?.texto, "Desmontagem, transporte e montagem · desde 08:05");
    assert.equal(avisoDoEvento(evento("os.completed", { id: "10050-01", instante: "2026-10-28T14:40:00.000Z" }), OS)?.texto, "Desmontagem, transporte e montagem · concluída em 28/10/2026 11:40");
    assert.equal(avisoDoEvento(evento("os.completed", { id: "10050-01" }), OS)?.titulo, "OS 10050-01 concluída");
    // A concluída abre o comprovante do portal (parte 4.3d); as outras, o andamento.
    assert.equal(avisoDoEvento(evento("os.completed", { id: "10050-01" }), OS)?.link, "/portal/servicos/comprovante?os=10050-01");
    assert.equal(avisoDoEvento(evento("os.started", { id: "10050-01" }), OS)?.link, "/portal/servicos?os=10050-01");
  });

  it("nenhum aviso da OS leva valor", () => {
    for (const type of ["os.scheduled", "os.started", "os.completed"]) {
      const aviso = avisoDoEvento(evento(type, { id: "10050-01", instante: "2026-10-28T11:05:00.000Z" }), OS);
      assert.ok(aviso, type);
      assert.doesNotMatch(`${aviso.titulo} ${aviso.texto}`, /R\$|1\.234|123456/, type);
    }
  });

  it("a NF: o número, o valor e o vencimento, que o cliente vê nas próprias faturas", () => {
    assert.deepEqual(avisoDoEvento(evento("nf.registered", { id: FATURA.id }), FATURA), {
      modelo: "nf_emitida",
      customer_code: "ITAU",
      titulo: "NF 1234 emitida",
      texto: "R$ 1.234,56 · vence 22/11/2026",
      link: "/portal/faturas",
      entidade: FATURA.id,
    });
    assert.equal(avisoDoEvento(evento("nf.registered", { id: FATURA.id }), { ...FATURA, nf: {} }), null);
  });

  it("a solicitação recebida: o tipo de serviço e o dia pedido", () => {
    assert.equal(avisoDoEvento(evento("portal.service_requested", { id: SOLICITACAO.id }), SOLICITACAO)?.texto, "Mudança / transporte dedicado · 30/10/2026 09:00");
  });

  it("sem o documento, de outro cliente, sem cliente ou na vistoria, não há aviso", () => {
    assert.equal(avisoDoEvento(evento("os.scheduled", { id: "10050-01" }), null), null);
    assert.equal(avisoDoEvento(evento("os.scheduled", { id: "10050-01" }), { ...OS, customer_code: "SAFRA" }), null);
    assert.equal(avisoDoEvento(evento("os.scheduled", { id: "10050-01" }, { customer_code: null }), OS), null);
    for (const type of ["os.scheduled", "os.started", "os.completed"]) assert.equal(avisoDoEvento(evento(type, { id: "10050-01" }), { ...OS, tipo: "vistoria" }), null, type);
  });
});

describe("quem recebe", () => {
  const contatos = [
    { nome: "Gestora", email: "Gestora@Itau.com", papel: "gestor_cliente", avisos: ["os_agendada", "nf_emitida"] },
    { nome: "Financeiro", email: "financeiro@itau.com", papel: "financeiro", avisos: ["nf_emitida"] },
    { nome: "Gerenciadora", email: "obra@gerenciadora.com", papel: "gerenciadora", avisos: ["os_agendada", "nf_emitida"] },
    { nome: "Sem o modelo", email: "outro@itau.com", papel: "outro", avisos: [] },
    { nome: "Inativo", email: "inativo@itau.com", papel: "gestor_cliente", avisos: ["os_agendada"], ativo: false },
    { nome: "Sem e-mail", email: null, papel: "gestor_cliente", avisos: ["os_agendada"] },
    { nome: "E-mail inválido", email: "sem-arroba", papel: "gestor_cliente", avisos: ["os_agendada"] },
    { nome: "Repetido", email: "gestora@itau.com", papel: "gestor_cliente", avisos: ["os_agendada"] },
  ];

  it("o e-mail só vai a quem ligou o modelo, ativo e com e-mail", () => {
    assert.deepEqual(destinatariosDoModelo("os_agendada", contatos), ["gestora@itau.com", "obra@gerenciadora.com"]);
    assert.deepEqual(destinatariosDoModelo("os_concluida", contatos), []);
  });

  it("a NF, que leva valor, só ao gestor e ao financeiro do cliente, nunca à gerenciadora", () => {
    assert.deepEqual(destinatariosDoModelo("nf_emitida", contatos), ["financeiro@itau.com", "gestora@itau.com"]);
    assert.equal(contatoPodeReceber("nf_emitida", "gerenciadora"), false);
    assert.equal(contatoPodeReceber("nf_emitida", "outro"), false);
    assert.equal(contatoPodeReceber("os_concluida", "gerenciadora"), true);
  });

  it("o cliente recebe o modelo só com o módulo no contrato", () => {
    assert.equal(clienteRecebeOModelo("os_agendada", ["wms", "operacao"]), true);
    assert.equal(clienteRecebeOModelo("os_agendada", ["wms", "financeiro"]), false);
    assert.equal(clienteRecebeOModelo("pedido_do_portal", ["financeiro"]), false);
    assert.equal(clienteRecebeOModelo("nf_emitida", ["wms", "financeiro"]), true);
    assert.equal(clienteRecebeOModelo("nf_emitida", ["operacao"]), false);
    for (const modelo of MODELOS_DE_AVISO) assert.equal(clienteRecebeOModelo(modelo, []), false, modelo);
  });
});

describe("o e-mail", () => {
  const aviso = avisoDoEvento(evento("os.scheduled", { id: "10050-01" }), OS)!;

  it("sem destinatário, não há e-mail", () => {
    assert.equal(emailDoAviso(aviso, [], "https://app.dutelog.com.br"), null);
  });

  it("o assunto, o texto e o link da tela do portal no endereço do ambiente", () => {
    assert.deepEqual(emailDoAviso(aviso, ["gestora@itau.com"], "https://app.dutelog.com.br/"), {
      to: ["gestora@itau.com"],
      subject: "OS 10050-01 agendada · Dutelog",
      text: "OS 10050-01 agendada\nDesmontagem, transporte e montagem · 28/10/2026 08:00–12:00\n\nhttps://app.dutelog.com.br/portal/servicos?os=10050-01\n\nDutelog Soluções Logísticas",
    });
  });

  it("o da OS concluída diz que o comprovante, com a assinatura e as fotos do final, está no link", () => {
    const concluida = avisoDoEvento(evento("os.completed", { id: "10050-01", instante: "2026-10-28T14:40:00.000Z" }), OS)!;
    assert.equal(
      emailDoAviso(concluida, ["gestora@itau.com"], "https://app.dutelog.com.br")?.text,
      "OS 10050-01 concluída\nDesmontagem, transporte e montagem · concluída em 28/10/2026 11:40\n\nO comprovante, com a assinatura e as fotos do final, está no portal:\nhttps://app.dutelog.com.br/portal/servicos/comprovante?os=10050-01\n\nDutelog Soluções Logísticas",
    );
  });

  it("o endereço do app por ambiente; o dute-btg fica de fora", () => {
    assert.equal(enderecoDoApp("dute-prod"), "https://app.dutelog.com.br");
    assert.equal(enderecoDoApp(" dute-homolog "), ENDERECO_DO_APP["dute-homolog"]);
    assert.equal(enderecoDoApp("dute-btg"), null);
    assert.equal(enderecoDoApp(""), null);
  });

  it("o id do aviso e do e-mail sai do evento", () => {
    assert.equal(idDoAviso("evt_1"), "ntf_evt_1");
    assert.equal(idDoEmail("evt_1"), "mail_evt_1");
  });
});

describe("o envio pelo Resend", () => {
  const email = { id: "mail_evt_1", from: "Dutelog <avisos@dutelog.com.br>", to: ["gestora@itau.com"], subject: "OS agendada · Dutelog", text: "texto" };

  it("manda a chave no cabeçalho e o id do e-mail como chave de idempotência", async () => {
    const chamadas: Array<{ url: string; init: RequestInit }> = [];
    const buscar = (async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      return new Response(JSON.stringify({ id: "re_123" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
    assert.deepEqual(await enviarPeloResend("re_chave", buscar)(email), { status: "sent", provider_id: "re_123" });
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].url, "https://api.resend.com/emails");
    const headers = chamadas[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer re_chave");
    assert.equal(headers["Idempotency-Key"], "mail_evt_1");
    assert.deepEqual(JSON.parse(String(chamadas[0].init.body)), { from: email.from, to: email.to, subject: email.subject, text: email.text });
  });

  it("a recusa do provedor vira erro, para a fila tentar de novo", async () => {
    const buscar = (async () => new Response(JSON.stringify({ message: "Domínio não verificado" }), { status: 403 })) as unknown as typeof fetch;
    await assert.rejects(enviarPeloResend("re_chave", buscar)(email), /Resend recusou o envio \(403\): Domínio não verificado/);
  });
});
