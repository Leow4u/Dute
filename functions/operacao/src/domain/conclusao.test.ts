import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpsError } from "firebase-functions/https";

import { caminhoDaAssinatura, conclusaoLida, concluirOs, interpretarConclusao, itensAMenos } from "./conclusao.js";
import type { ContextoDoRegistro, EtapaRegistrada } from "./execucao.js";
import type { FotoRegistrada } from "./fotos.js";
import type { ItemEmExecucao } from "./itens-executados.js";
import type { OsGravada } from "./os.js";

/**
 * A conclusão da OS (parte 3.9a): com assinatura ou "sem aceite no local",
 * ao menos uma foto do final, o motivo de cada item feito a menos, e a OS vai
 * para Em revisão. No celular, só o líder conclui.
 */

const ANA = "col_aaaaaaaaaaaaaaaa"; // líder, com o app
const BRUNO = "col_bbbbbbbbbbbbbbbb"; // montador, com o app
const AGORA = new Date("2026-10-22T21:00:00.000Z");
const PNG = { contentType: "image/png", size: 18_000 };

const OS = {
  numero: "10045-01",
  demanda: "10045",
  customer_code: "ITAU",
  status: "em_execucao",
  janela: { data: "2026-10-22", inicio: "07:30", fim: "18:00" },
  equipe: [
    { colaborador_id: ANA, nome: "Ana Lima", papel: "lider", vinculo: "proprio", empresa: null, no_app: true, usuario_uid: "uid-ana" },
    { colaborador_id: BRUNO, nome: "Bruno Teixeira", papel: "montador", vinculo: "proprio", empresa: null, no_app: true, usuario_uid: "uid-bruno" },
  ],
  equipe_uids: ["uid-ana", "uid-bruno"],
  edicao: 9,
} as unknown as OsGravada;

const LIDER: ContextoDoRegistro = { agora: AGORA, canal: "celular", registrado_por: { uid: "uid-ana", role: "campo" }, informante: ANA };
const MONTADOR: ContextoDoRegistro = { agora: AGORA, canal: "celular", registrado_por: { uid: "uid-bruno", role: "campo" }, informante: BRUNO };
const ESCRITORIO: ContextoDoRegistro = { agora: AGORA, canal: "escritorio", registrado_por: { uid: "u-paula", role: "interno" } };

const REGISTRO = { canal: "celular", meio: null, informado_por: ANA, registrado_por: { uid: "uid-ana", role: "campo" }, registrado_em: "2026-10-22T20:40:00.000Z" } as const;

function etapa(nome: EtapaRegistrada["etapa"], hora: string): EtapaRegistrada {
  return { ...REGISTRO, etapa: nome, instante: `2026-10-22T${hora}:00.000Z` };
}

const ETAPAS = [etapa("saida_patio", "10:30"), etapa("chegada_destino", "12:10"), etapa("montagem", "13:00")];

function item(id: string, nome: string, planejado: string, executado: string | null, incluidos: string[] = []): ItemEmExecucao {
  return {
    id,
    lpu_item_id: null,
    codigo: null,
    item: nome,
    descricao: nome,
    servico: "Transporte",
    unidade: "UN",
    planejado,
    origem_local: null,
    destino_local: null,
    executado,
    executado_em: executado ? "2026-10-22T20:30:00.000Z" : null,
    incluidos: incluidos.map((quantidade) => ({ ...REGISTRO, instante: "2026-10-22T12:32:00.000Z", quantidade, pedido_por: "Renata", motivo: "Pedido no local" })),
    incluido_em_campo: false,
  };
}

const CADEIRA = item("ln_1", "Transporte de cadeira", "150", "160", ["10"]);
const MESA = item("ln_2", "Montagem de mesa de trabalho", "60", "58");
const GAVETEIRO = item("ln_3", "Transporte de gaveteiro", "60", null);

function foto(id: string, etapaDaFoto: FotoRegistrada["etapa"]): FotoRegistrada {
  return { ...REGISTRO, id, caminho: `os/10045-01/fotos/${id}.jpg`, etapa: etapaDaFoto, ocorrencia: null, linha: null, legenda: null, instante: "2026-10-22T20:46:00.000Z" };
}

const FOTO_DO_FINAL = foto("ft_f000000000000001", "fim");

function pedido(extra: Record<string, unknown> = {}) {
  return interpretarConclusao({
    idempotency_key: "k",
    numero: "10045-01",
    instante: "2026-10-22T17:50-03:00",
    aceite: "assinatura",
    responsavel: { nome: "Renata Campos", cargo: "Facilities", documento: "12.345.678-9" },
    assinatura: "as_0123456789abcdef.png",
    diferencas: [{ linha: "ln_2", motivo: "2 mesas com pé quebrado; ficam para o 5º andar" }],
    ...extra,
  });
}

const ENTRADA = { etapas: ETAPAS, itens: [CADEIRA, MESA], fotos: [foto("ft_0000000000000001", "carregamento"), FOTO_DO_FINAL], assinatura: PNG };

function recusa(fn: () => unknown, codigo: string, mensagem: string) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof HttpsError);
    assert.equal(error.code, codigo);
    assert.equal(error.message, mensagem);
    return true;
  });
}

describe("conclusão da OS", () => {
  it("com assinatura: guarda o responsável, a assinatura, as diferenças com o motivo e registra a etapa Fim", () => {
    const { conclusao, etapas, fim, fotosDoFinal } = concluirOs(OS, ENTRADA, pedido(), LIDER);
    assert.deepEqual(conclusao, {
      instante: "2026-10-22T20:50:00.000Z",
      canal: "celular",
      meio: null,
      informado_por: ANA,
      registrado_por: { uid: "uid-ana", role: "campo" },
      registrado_em: "2026-10-22T21:00:00.000Z",
      aceite: "assinatura",
      // O documento que o app antigo manda não se grava (decisão 3 da LGPD).
      responsavel: { nome: "Renata Campos", cargo: "Facilities" },
      assinatura: "os/10045-01/assinatura/as_0123456789abcdef.png",
      diferencas: [{ linha: "ln_2", previsto: "60", executado: "58", motivo: "2 mesas com pé quebrado; ficam para o 5º andar" }],
      // As fotos do final vão ao comprovante do cliente (parte 4.3c); a do carregamento, não.
      arquivos_do_final: ["ft_f000000000000001.jpg"],
    });
    assert.deepEqual(fim, {
      etapa: "fim",
      instante: "2026-10-22T20:50:00.000Z",
      canal: "celular",
      meio: null,
      informado_por: ANA,
      registrado_por: { uid: "uid-ana", role: "campo" },
      registrado_em: "2026-10-22T21:00:00.000Z",
    });
    assert.deepEqual(
      etapas.map((registrada) => registrada.etapa),
      ["saida_patio", "chegada_destino", "montagem", "fim"],
    );
    assert.equal(fotosDoFinal, 1);
  });

  it("sem motivo para o item feito a menos, recusa; o item nunca informado conta zero", () => {
    recusa(() => concluirOs(OS, ENTRADA, pedido({ diferencas: [] }), LIDER), "invalid-argument", "Montagem de mesa de trabalho: feito 58 de 60. Informe o motivo da diferença.");
    recusa(
      () => concluirOs(OS, { ...ENTRADA, itens: [CADEIRA, MESA, GAVETEIRO] }, pedido(), LIDER),
      "invalid-argument",
      "Transporte de gaveteiro: feito 0 de 60. Informe o motivo da diferença.",
    );
    assert.deepEqual(
      itensAMenos([CADEIRA, MESA, GAVETEIRO]).map((diferenca) => [diferenca.item.id, diferenca.previsto, diferenca.executado]),
      [
        ["ln_2", 60_000, 58_000],
        ["ln_3", 60_000, 0],
      ],
    );
  });

  it("o motivo vale só para o item com diferença, uma vez, e o item precisa estar na OS", () => {
    // O feito chegou por outro aparelho: o motivo do item sem diferença fica de fora, sem recusar.
    const { conclusao } = concluirOs(OS, ENTRADA, pedido({ diferencas: [{ linha: "ln_1", motivo: "Sobrou" }, { linha: "ln_2", motivo: "Quebrado" }] }), LIDER);
    assert.deepEqual(conclusao.diferencas, [{ linha: "ln_2", previsto: "60", executado: "58", motivo: "Quebrado" }]);
    recusa(() => concluirOs(OS, ENTRADA, pedido({ diferencas: [{ linha: "ln_9", motivo: "Quebrado" }] }), LIDER), "invalid-argument", "O item não está na OS.");
    recusa(
      () => concluirOs(OS, ENTRADA, pedido({ diferencas: [{ linha: "ln_2", motivo: "Quebrado" }, { linha: "ln_2", motivo: "Outro" }] }), LIDER),
      "invalid-argument",
      "Informe o motivo de cada item uma vez só.",
    );
    recusa(() => pedido({ diferencas: [{ linha: "ln_2", motivo: "x" }] }), "invalid-argument", "Informe o motivo da diferença.");
  });

  it("sem aceite no local: o nome de quem recebeu, sem assinatura, com a foto do final", () => {
    const sem = pedido({ aceite: "sem_aceite", assinatura: null, responsavel: { nome: "Sr. Almeida (portaria)" } });
    const { conclusao } = concluirOs(OS, { ...ENTRADA, assinatura: null }, sem, LIDER);
    assert.equal(conclusao.aceite, "sem_aceite");
    assert.deepEqual(conclusao.responsavel, { nome: "Sr. Almeida (portaria)", cargo: null });
    assert.equal(conclusao.assinatura, null);
    recusa(() => pedido({ aceite: "sem_aceite" }), "invalid-argument", "Sem aceite no local não leva assinatura.");
    recusa(() => pedido({ assinatura: null }), "invalid-argument", "Colha a assinatura do responsável.");
    recusa(() => pedido({ responsavel: { nome: "R" } }), "invalid-argument", "Informe o nome do responsável.");
  });

  it("sem foto do final, recusa; a foto de outra etapa não conta", () => {
    recusa(() => concluirOs(OS, { ...ENTRADA, fotos: [foto("ft_0000000000000001", "carregamento")] }, pedido(), LIDER), "failed-precondition", "Tire ao menos uma foto do final.");
  });

  it("a assinatura precisa ter chegado ao Storage e ser imagem", () => {
    recusa(() => concluirOs(OS, { ...ENTRADA, assinatura: null }, pedido(), LIDER), "failed-precondition", "A assinatura não chegou ao armazenamento. Envie de novo.");
    recusa(() => concluirOs(OS, { ...ENTRADA, assinatura: { contentType: "application/pdf", size: 10 } }, pedido(), LIDER), "failed-precondition", "O arquivo da assinatura não é uma imagem.");
    assert.equal(caminhoDaAssinatura("10045-01", "as_0123456789abcdef.png"), "os/10045-01/assinatura/as_0123456789abcdef.png");
    recusa(() => pedido({ assinatura: "../fotos/as_0123456789abcdef.png" }), "invalid-argument", "Arquivo da assinatura inválido.");
  });

  it("no celular, só o líder conclui; o escritório conclui e diz quem informou", () => {
    recusa(() => concluirOs(OS, ENTRADA, pedido(), MONTADOR), "permission-denied", "Só o líder conclui a OS pelo celular.");
    const semLider = { ...OS, equipe: OS.equipe.map((pessoa) => ({ ...pessoa, papel: "montador" })) } as OsGravada;
    assert.equal(concluirOs(semLider, ENTRADA, pedido(), MONTADOR).conclusao.informado_por, BRUNO);
    const peloEscritorio = concluirOs(OS, ENTRADA, pedido({ informado_por: ANA, meio: "whatsapp" }), ESCRITORIO).conclusao;
    assert.deepEqual([peloEscritorio.canal, peloEscritorio.meio, peloEscritorio.informado_por], ["escritorio", "whatsapp", ANA]);
  });

  it("só a OS em execução; a hora não vem antes da última etapa; o Fim já registrado fica", () => {
    recusa(() => concluirOs({ ...OS, status: "agendada" } as OsGravada, ENTRADA, pedido(), LIDER), "failed-precondition", "Registre a primeira etapa antes de concluir.");
    recusa(() => concluirOs({ ...OS, status: "em_revisao" } as OsGravada, ENTRADA, pedido(), LIDER), "failed-precondition", "A OS já foi concluída.");
    recusa(() => concluirOs({ ...OS, status: "cancelada" } as OsGravada, ENTRADA, pedido(), LIDER), "failed-precondition", "A OS está cancelada.");
    recusa(() => concluirOs(OS, ENTRADA, pedido({ instante: "2026-10-22T09:59-03:00" }), LIDER), "failed-precondition", "A hora vem antes de Montagem (10:00).");
    const comFim = concluirOs(OS, { ...ENTRADA, etapas: [...ETAPAS, etapa("fim", "20:45")] }, pedido(), LIDER);
    assert.equal(comFim.fim, null);
    assert.deepEqual(comFim.etapas.map((registrada) => registrada.instante).at(-1), "2026-10-22T20:45:00.000Z");
  });

  it("não tem nenhum campo de valor; a leitura devolve o que foi gravado", () => {
    const { conclusao } = concluirOs(OS, ENTRADA, pedido(), LIDER);
    const chaves = (valor: unknown): string[] =>
      Array.isArray(valor) ? valor.flatMap(chaves) : valor && typeof valor === "object" ? Object.entries(valor).flatMap(([chave, filho]) => [chave, ...chaves(filho)]) : [];
    assert.deepEqual(chaves(conclusao).filter((chave) => /preco|price|valor|total|cents|custo|diaria/i.test(chave)), []);
    assert.deepEqual(conclusaoLida({ conclusao }), conclusao);
    assert.equal(conclusaoLida({}), null);
    assert.equal(conclusaoLida({ conclusao: { aceite: "talvez", instante: "2026-10-22T20:50:00.000Z" } }), null);
  });
});
