import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { concluirOs, interpretarConclusao } from "./conclusao.js";
import type { ItemDoCatalogo } from "./demanda-direta.js";
import { interpretarEtapa, registrarEtapa, type ContextoDoRegistro, type EtapaRegistrada } from "./execucao.js";
import type { FotoRegistrada } from "./fotos.js";
import { comItens, problemaParaAbrirVistoria, type OsGravada } from "./os.js";
import { ETAPAS_DA_VISTORIA, enviarVistoria, interpretarVistoria, vistoriaLida } from "./vistoria.js";

/**
 * A vistoria (parte 3.11a): abre só antes do escopo fechado e uma por vez;
 * só ir, chegar e terminar; sem itens da OS nem aceite; o envio confere
 * ambientes, itens do catálogo, fotos e medidas, soma os itens para o
 * Comercial e registra o Fim. Sem valor.
 */

const ANA = "col_aaaaaaaaaaaaaaaa"; // líder
const BRUNO = "col_bbbbbbbbbbbbbbbb"; // ajudante
const AGORA = new Date("2026-10-22T21:00:00.000Z");

const CELULAR_DA_ANA: ContextoDoRegistro = { agora: AGORA, canal: "celular", registrado_por: { uid: "uid-ana", role: "campo" }, informante: ANA };
const CELULAR_DO_BRUNO: ContextoDoRegistro = { ...CELULAR_DA_ANA, registrado_por: { uid: "uid-bruno", role: "campo" }, informante: BRUNO };
const ESCRITORIO: ContextoDoRegistro = { agora: AGORA, canal: "escritorio", registrado_por: { uid: "u-paula", role: "interno" } };

const VISTORIA: OsGravada = {
  numero: "10045-01",
  demanda: "10045",
  seq: 1,
  customer_code: "ITAU",
  cliente_nome: "Itaú Unibanco",
  tipo: "vistoria",
  status: "em_execucao",
  escopo_rv: null,
  itens: [],
  servicos: ["vistoria"],
  locais: { origem: null, destino: null },
  janela: { data: "2026-10-22", inicio: "14:00", fim: "16:00" },
  equipe: [
    { colaborador_id: ANA, nome: "Ana Lima", papel: "lider", vinculo: "proprio", empresa: null, no_app: true, usuario_uid: "uid-ana" },
    { colaborador_id: BRUNO, nome: "Bruno Teixeira", papel: "ajudante", vinculo: "proprio", empresa: null, no_app: true, usuario_uid: "uid-bruno" },
  ],
  equipe_uids: ["uid-ana", "uid-bruno"],
  veiculos: [],
  instrucoes: null,
  edicao: 3,
  cancelamento: null,
};

const REGISTRO = { canal: "celular" as const, meio: null, informado_por: ANA, registrado_por: { uid: "uid-ana", role: "campo" }, registrado_em: "2026-10-22T17:05:00.000Z" };
const CHEGADA: EtapaRegistrada = { ...REGISTRO, etapa: "chegada_origem", instante: "2026-10-22T17:05:00.000Z" };

function foto(id: string, legenda: string): FotoRegistrada {
  return { ...REGISTRO, id, caminho: `os/10045-01/fotos/${id}.jpg`, etapa: null, ocorrencia: null, linha: null, legenda, instante: "2026-10-22T17:20:00.000Z" };
}
const FOTOS = [foto("ft_a000000000000001", "Recepção"), foto("ft_a000000000000002", "Estações")];

function doCatalogo(id: string, item: string, extra: Partial<ItemDoCatalogo> = {}): [string, ItemDoCatalogo] {
  return [id, { id, item, descricao: item, servico: "Transporte", unidade: "UN", ativo: true, orcavel: true, ...extra }];
}
const CATALOGO = new Map([
  doCatalogo("lpu_cadeira", "Transporte de cadeira"),
  doCatalogo("lpu_estacao", "Desmontagem de estação", { servico: "Desmontagem" }),
  doCatalogo("lpu_armaz", "Armazenagem", { orcavel: false, unidade: "M3" }),
  doCatalogo("lpu_velho", "Item antigo", { ativo: false }),
]);

function pedido(extra: Record<string, unknown> = {}) {
  return interpretarVistoria({
    idempotency_key: "v-1",
    numero: "10045-01",
    instante: "2026-10-22T15:40-03:00",
    ambientes: [
      { nome: "Recepção", itens: [{ lpu_item_id: "lpu_cadeira", quantidade: "8" }], fotos: ["ft_a000000000000001"] },
      { nome: "Estações", itens: [{ lpu_item_id: "lpu_estacao", quantidade: "12" }, { lpu_item_id: "lpu_cadeira", quantidade: "16" }], fotos: ["ft_a000000000000002"] },
    ],
    medidas: [{ nome: "Porta", valor: "0,90 m" }, { nome: "Carga do elevador", valor: "600 kg" }],
    acesso: { horario_de_carga: "Depois das 18h", vaga_de_carga: "Doca 2" },
    observacoes: "Elevador de serviço só até as 19h.",
    ...extra,
  });
}

const ENTRADA = { etapas: [CHEGADA], fotos: FOTOS, catalogo: CATALOGO };

function recusa(acao: () => unknown, codigo: string, mensagem: string) {
  assert.throws(acao, (error: unknown) => {
    assert.ok(error instanceof HttpsError);
    assert.equal(error.code, codigo);
    assert.equal(error.message, mensagem);
    return true;
  });
}

describe("abrir a vistoria", () => {
  const comercial = { entrada: "comercial", etapa: "em_montagem", escopo_rv: null, executado_de: null, perda: null, cancelamento: null };

  it("antes do escopo fechado, na demanda do Comercial, uma por vez", () => {
    assert.equal(problemaParaAbrirVistoria(comercial, []), null);
    assert.equal(problemaParaAbrirVistoria({ ...comercial, etapa: "aguardando_cliente" }, []), null);
    assert.equal(
      problemaParaAbrirVistoria({ ...comercial, entrada: "direta" }, []),
      "A demanda direta não tem vistoria: a Operação executa e o Comercial orça depois.",
    );
    assert.equal(problemaParaAbrirVistoria({ ...comercial, escopo_rv: 0 }, []), "A vistoria vem antes do escopo fechado: a demanda já foi fechada pelo cliente.");
    assert.equal(problemaParaAbrirVistoria({ ...comercial, perda: { motivo: "preco" } }, []), "A demanda foi perdida no Comercial.");
    assert.equal(problemaParaAbrirVistoria({ ...comercial, cancelamento: { motivo: "x" } }, []), "A demanda foi cancelada no Comercial.");
    const aberta = { numero: "10045-01", tipo: "vistoria" as const, status: "agendada" as const };
    assert.equal(problemaParaAbrirVistoria(comercial, [aberta]), "A demanda já tem a vistoria 10045-01 em aberto.");
    // A que terminou ou foi cancelada não segura outra; a OS de serviço não conta.
    assert.equal(problemaParaAbrirVistoria(comercial, [{ ...aberta, status: "revisada" }, { ...aberta, status: "cancelada" }]), null);
    assert.equal(problemaParaAbrirVistoria(comercial, [{ ...aberta, tipo: "servico" }]), null);
  });
});

describe("a execução da vistoria", () => {
  it("só ir, chegar e terminar; sem itens da OS nem aceite", () => {
    assert.deepEqual([...ETAPAS_DA_VISTORIA], ["saida_patio", "chegada_origem", "fim"]);
    const agendada = { ...VISTORIA, status: "agendada" as const };
    const etapa = (nome: string) => interpretarEtapa({ idempotency_key: "e-1", numero: "10045-01", etapa: nome, instante: "2026-10-22T14:05-03:00" });
    assert.equal(registrarEtapa(agendada, [], etapa("chegada_origem"), CELULAR_DA_ANA).iniciou, true);
    recusa(() => registrarEtapa(agendada, [], etapa("carregamento"), CELULAR_DA_ANA), "invalid-argument", "A vistoria não tem a etapa Carregamento.");
    recusa(() => registrarEtapa(agendada, [], etapa("montagem"), CELULAR_DA_ANA), "invalid-argument", "A vistoria não tem a etapa Montagem.");
    recusa(() => comItens(VISTORIA, [], null), "failed-precondition", "A vistoria não tem itens do escopo: os itens levantados vão no envio ao Comercial.");
    const conclusao = interpretarConclusao({
      idempotency_key: "c-1",
      numero: "10045-01",
      instante: "2026-10-22T15:40-03:00",
      aceite: "sem_aceite",
      responsavel: { nome: "Portaria" },
    });
    recusa(
      () => concluirOs(VISTORIA, { etapas: [CHEGADA], itens: [], fotos: FOTOS, assinatura: null }, conclusao, CELULAR_DA_ANA),
      "failed-precondition",
      "A vistoria não se conclui com aceite: envie a vistoria ao Comercial.",
    );
  });
});

describe("enviar a vistoria ao Comercial", () => {
  it("grava ambientes, itens do catálogo, fotos, medidas e acesso; soma os itens para o Comercial; registra o Fim", () => {
    const { vistoria, resumo, etapas, fim, contagem } = enviarVistoria(VISTORIA, ENTRADA, pedido(), CELULAR_DA_ANA);
    assert.equal(vistoria.instante, "2026-10-22T18:40:00.000Z");
    assert.deepEqual([vistoria.canal, vistoria.informado_por], ["celular", ANA]);
    assert.deepEqual(vistoria.ambientes[1], {
      nome: "Estações",
      itens: [
        { lpu_item_id: "lpu_estacao", item: "Desmontagem de estação", unidade: "UN", servico: "Desmontagem", quantidade: "12" },
        { lpu_item_id: "lpu_cadeira", item: "Transporte de cadeira", unidade: "UN", servico: "Transporte", quantidade: "16" },
      ],
      fotos: ["ft_a000000000000002"],
    });
    assert.deepEqual(vistoria.acesso, { horario_de_carga: "Depois das 18h", vaga_de_carga: "Doca 2" });
    assert.deepEqual(resumo.itens, [
      { lpu_item_id: "lpu_cadeira", item: "Transporte de cadeira", unidade: "UN", quantidade: "24" },
      { lpu_item_id: "lpu_estacao", item: "Desmontagem de estação", unidade: "UN", quantidade: "12" },
    ]);
    assert.deepEqual(resumo.ambientes[0].fotos, ["os/10045-01/fotos/ft_a000000000000001.jpg"]);
    assert.deepEqual([resumo.os, resumo.enviada_em, resumo.observacoes], ["10045-01", "2026-10-22T18:40:00.000Z", "Elevador de serviço só até as 19h."]);
    assert.deepEqual(contagem, { ambientes: 2, itens: 2, fotos: 2, medidas: 2 });
    assert.deepEqual(etapas.map((etapa) => etapa.etapa), ["chegada_origem", "fim"]);
    assert.equal(fim?.instante, "2026-10-22T18:40:00.000Z");
    // Com o Fim já registrado, não registra outro.
    assert.equal(enviarVistoria(VISTORIA, { ...ENTRADA, etapas: [CHEGADA, { ...CHEGADA, etapa: "fim" }] }, pedido(), CELULAR_DA_ANA).fim, null);
    // Sem valor no que vai ao Comercial.
    assert.doesNotMatch(JSON.stringify(resumo), /preco|cents|R\$/);
    // O que se gravou se lê de volta.
    assert.deepEqual(vistoriaLida({ vistoria }), vistoria);
  });

  it("pelo celular, só o líder envia; pelo escritório, quem coordena", () => {
    recusa(() => enviarVistoria(VISTORIA, ENTRADA, pedido(), CELULAR_DO_BRUNO), "permission-denied", "Só o líder envia a vistoria pelo celular.");
    assert.equal(enviarVistoria(VISTORIA, ENTRADA, pedido({ informado_por: BRUNO, meio: "whatsapp" }), ESCRITORIO).vistoria.informado_por, BRUNO);
  });

  it("só a vistoria em execução, e a hora não vem antes da última etapa", () => {
    recusa(() => enviarVistoria({ ...VISTORIA, tipo: "servico" }, ENTRADA, pedido(), CELULAR_DA_ANA), "failed-precondition", "Só a OS de vistoria vai ao Comercial por aqui.");
    recusa(() => enviarVistoria({ ...VISTORIA, status: "agendada" }, ENTRADA, pedido(), CELULAR_DA_ANA), "failed-precondition", "Registre a chegada antes de enviar a vistoria.");
    recusa(() => enviarVistoria({ ...VISTORIA, status: "revisada" }, ENTRADA, pedido(), CELULAR_DA_ANA), "failed-precondition", "A OS já foi concluída.");
    recusa(
      () => enviarVistoria(VISTORIA, ENTRADA, pedido({ instante: "2026-10-22T13:00-03:00" }), CELULAR_DA_ANA),
      "failed-precondition",
      "A hora vem antes de Chegada na origem (14:05).",
    );
  });

  it("ambiente com nome único; item do catálogo, ativo, orçável, uma vez por ambiente e maior que zero", () => {
    const ambiente = (itens: unknown[], nome = "Arquivo") => [{ nome, itens, fotos: ["ft_a000000000000001"] }];
    recusa(
      () => enviarVistoria(VISTORIA, ENTRADA, pedido({ ambientes: [...ambiente([{ lpu_item_id: "lpu_cadeira", quantidade: "1" }], "Recepção"), { nome: "recepcao", itens: [] }] }), ESCRITORIO),
      "invalid-argument",
      "O ambiente recepcao aparece duas vezes.",
    );
    recusa(() => enviarVistoria(VISTORIA, ENTRADA, pedido({ ambientes: ambiente([{ lpu_item_id: "lpu_velho", quantidade: "1" }]) }), ESCRITORIO), "invalid-argument", "Arquivo: um item não está ativo no catálogo.");
    recusa(() => enviarVistoria(VISTORIA, ENTRADA, pedido({ ambientes: ambiente([{ lpu_item_id: "lpu_nada", quantidade: "1" }]) }), ESCRITORIO), "invalid-argument", "Arquivo: um item não está ativo no catálogo.");
    recusa(() => enviarVistoria(VISTORIA, ENTRADA, pedido({ ambientes: ambiente([{ lpu_item_id: "lpu_armaz", quantidade: "1" }]) }), ESCRITORIO), "invalid-argument", "Arquivo: Armazenagem não se orça.");
    recusa(
      () =>
        enviarVistoria(
          VISTORIA,
          ENTRADA,
          pedido({ ambientes: ambiente([{ lpu_item_id: "lpu_cadeira", quantidade: "1" }, { lpu_item_id: "lpu_cadeira", quantidade: "2" }]) }),
          ESCRITORIO,
        ),
      "invalid-argument",
      "Arquivo: Transporte de cadeira aparece duas vezes.",
    );
    recusa(
      () => enviarVistoria(VISTORIA, ENTRADA, pedido({ ambientes: ambiente([{ lpu_item_id: "lpu_cadeira", quantidade: "0" }]) }), ESCRITORIO),
      "invalid-argument",
      "Arquivo: informe uma quantidade maior que zero para Transporte de cadeira.",
    );
    recusa(() => pedido({ ambientes: ambiente([{ lpu_item_id: "lpu_cadeira", quantidade: "1,5" }]) }), "invalid-argument", "Quantidade inválida: use número com ponto e até 3 casas.");
  });

  it("cada foto já está na OS e num ambiente só; ao menos uma foto e um item; medida sem repetir", () => {
    const comFotos = (fotos: string[][]) => pedido({ ambientes: fotos.map((lista, indice) => ({ nome: `Sala ${indice + 1}`, itens: [{ lpu_item_id: "lpu_cadeira", quantidade: "1" }], fotos: lista })) });
    recusa(() => enviarVistoria(VISTORIA, ENTRADA, comFotos([["ft_b000000000000009"]]), ESCRITORIO), "invalid-argument", "Sala 1: uma foto não está na OS. Envie a foto antes.");
    recusa(() => enviarVistoria(VISTORIA, ENTRADA, comFotos([["ft_a000000000000001"], ["ft_a000000000000001"]]), ESCRITORIO), "invalid-argument", "Uma foto está em dois ambientes.");
    recusa(() => enviarVistoria(VISTORIA, ENTRADA, comFotos([[]]), ESCRITORIO), "failed-precondition", "Tire ao menos uma foto da vistoria.");
    recusa(
      () => enviarVistoria(VISTORIA, ENTRADA, pedido({ ambientes: [{ nome: "Sala", fotos: ["ft_a000000000000001"] }] }), ESCRITORIO),
      "failed-precondition",
      "Levante ao menos um item do catálogo.",
    );
    recusa(
      () => enviarVistoria(VISTORIA, ENTRADA, pedido({ medidas: [{ nome: "Porta", valor: "0,90 m" }, { nome: "porta", valor: "0,80 m" }] }), ESCRITORIO),
      "invalid-argument",
      "A medida porta aparece duas vezes.",
    );
  });

  it("a entrada: ao menos um ambiente, campo a mais recusado, textos limitados", () => {
    recusa(() => pedido({ ambientes: [] }), "invalid-argument", "Levante ao menos um ambiente.");
    recusa(() => pedido({ preco: "10.00" }), "invalid-argument", "Campo não aceito: preco.");
    recusa(() => pedido({ observacoes: "x".repeat(2001) }), "invalid-argument", "Use até 2000 caracteres nas observações.");
    assert.deepEqual(pedido({ acesso: undefined, observacoes: "   " }).acesso, { horario_de_carga: null, vaga_de_carga: null });
    assert.equal(pedido({ observacoes: "   " }).observacoes, null);
  });
});
