import { createHash, randomUUID } from "node:crypto";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { FERRAMENTAS_DO_AGENTE } from "./agente-catalogo.js";
import { cartaoDasRespostas, emOrdem, notasDoPrompt, playbooksDoPrompt, playbooksUsados } from "./agente-comuns.js";
import { escopoDoAgente, type EscopoDoAgente } from "./agente-escopo.js";
import { executarFerramenta, ferramentasDoEscopo, texto, type FerramentaDoAgente } from "./agente-ferramentas.js";
import { leitorDoAgente } from "./agente-leitor.js";
import { promptDoAgente } from "./agente-prompt.js";
import type { CoreProfile } from "./profile.js";

/**
 * A conversa com o Agent Dute do núcleo (docs/plataforma/fase-5-memoria.md,
 * parte 5.5e). O escopo vem do servidor; as ferramentas só leem, pelo leitor
 * do escopo; o modelo só escolhe o que perguntar. Quem grava é este fluxo, e
 * só o registro da própria conversa: a conversa, as duas mensagens, o uso (com
 * os playbooks abertos) e o resumo da conversa longa.
 *
 * As coleções e os formatos são os do agente do WMS, para o histórico seguir
 * e o cartão de pedido e de envio sair pela createCustomerRequest do WMS.
 * O modelo entra por `gerar` (agente-modelo.ts, com o Genkit), e os testes
 * passam um modelo falso.
 */

export const CONVERSATIONS_COLLECTION = "agent_conversations";
export const MESSAGES_COLLECTION = "agent_messages";
export const USAGE_COLLECTION = "agent_usage";

/** As últimas mensagens que vão ao modelo; o que fica para trás vira o resumo. */
export const JANELA_DO_HISTORICO = 20;
const LOTE_DO_RESUMO = 10;
const MENSAGENS_DO_RESUMO = 200;
const TAMANHO_DO_RESUMO = 2000;
const TAMANHO_DA_MENSAGEM_NO_MODELO = 9000;

// --- O modelo -------------------------------------------------------------------------------------

export type FerramentaParaOModelo = {
  nome: string;
  descricao: string;
  entrada: FerramentaDoAgente["entrada"];
  executar: (entrada: unknown) => Promise<unknown>;
};

/** Os pedaços que a tela recebe enquanto a resposta é gerada: os mesmos do WMS. */
export type PedacoDaResposta = { type: "text"; index: number; text: string } | { type: "tool"; name: string } | { type: "reset" };

export type PedidoAoModelo = {
  sistema: string;
  historico: Array<{ papel: "user" | "model"; texto: string }>;
  mensagem: string;
  ferramentas: FerramentaParaOModelo[];
  aoPedaco?: (pedaco: PedacoDaResposta) => void;
};

export type RespostaDoModelo = {
  texto: string;
  /** "genkit_<modelo>" ou "fallback_indisponivel". */
  fonte: string;
  modelo?: string;
  tokens_entrada?: number;
  tokens_saida?: number;
  latencia_ms?: number;
  erro?: string;
};

export type GerarResposta = (pedido: PedidoAoModelo) => Promise<RespostaDoModelo>;

export type MensagemDoResumo = { papel: "user" | "assistant"; conteudo: string; em: string };
export type Resumir = (anterior: string, mensagens: MensagemDoResumo[]) => Promise<string>;

// --- O pedido -------------------------------------------------------------------------------------

const PedidoDeConversa = z.object({
  message: z.string().trim().min(1, "Escreva a mensagem.").max(4000, "Mensagem longa demais."),
  conversation_id: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,160}$/, "Conversa inválida.")
    .nullish(),
  attachments: z.array(z.unknown()).max(0, "O anexo ainda não é lido pelo Agent Dute do núcleo.").nullish(),
});

export function interpretarConversa(data: unknown) {
  const lido = PedidoDeConversa.safeParse(data && typeof data === "object" ? data : {});
  if (!lido.success) throw new HttpsError("invalid-argument", lido.error.issues[0]?.message ?? "Pedido inválido.");
  return lido.data;
}

function idPadraoDaConversa(escopo: EscopoDoAgente): string {
  return `dute_${createHash("sha256").update(JSON.stringify([escopo.uid, escopo.customerCode, escopo.modulo])).digest("hex").slice(0, 24)}`;
}

/** O que vai ao Firestore: sem os campos vazios. */
function compacto(dados: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(dados).filter(([, valor]) => valor !== undefined));
}

export type OpcoesDaConversa = {
  gerar: GerarResposta;
  resumir?: Resumir;
  aoPedaco?: (pedaco: PedacoDaResposta) => void;
  agora?: () => Date;
  novoId?: (prefixo: string) => string;
  /** A rotina agendada (parte 5.5g): sem histórico, com o dia na pergunta e a origem "rotina". */
  rotina?: { id: string; nome: string };
};

/** A fonte da resposta de reserva, quando nenhum modelo respondeu. */
export const FONTE_SEM_MODELO = "fallback_indisponivel";

const diaDaRotina = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });

/** A pergunta da rotina ao modelo: o texto dela, com o dia, para ele responder sobre o período certo. */
export function perguntaDaRotina(rotina: { nome: string }, pergunta: string, agora: Date): string {
  return `${pergunta}\n\n(Rotina agendada "${rotina.nome}", ${diaDaRotina.format(agora)}. Responda direto, sem perguntas de volta: ninguém está esperando na conversa agora.)`;
}

function novoIdPadrao(prefixo: string): string {
  return `${prefixo}_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/** A conversa da pessoa: a mesma pessoa, o mesmo cliente e o mesmo módulo. A de antes do núcleo não tem módulo: vale a Armazenagem. */
function conferirDono(dados: Record<string, unknown>, escopo: EscopoDoAgente): void {
  if (dados.user_id !== escopo.uid || dados.customer_code !== escopo.customerCode) throw new HttpsError("permission-denied", "Esta conversa pertence a outro usuário.");
  if ((texto(dados.modulo) || "wms") !== escopo.modulo) throw new HttpsError("failed-precondition", "Esta conversa é de outro módulo.");
}

export async function conversarComDute(db: Firestore, caller: CoreProfile, data: unknown, opcoes: OpcoesDaConversa) {
  const pedido = interpretarConversa(data);
  const escopo = await escopoDoAgente(db, caller, data);
  const agora = opcoes.agora ?? (() => new Date());
  const novoId = opcoes.novoId ?? novoIdPadrao;
  const conversaId = pedido.conversation_id ?? idPadraoDaConversa(escopo);
  const perguntaEm = agora().toISOString();

  const conversaRef = db.collection(CONVERSATIONS_COLLECTION).doc(conversaId);
  const conversa = await conversaRef.get();
  if (conversa.exists) conferirDono(conversa.data() ?? {}, escopo);

  const leitor = leitorDoAgente(db, escopo);
  const rotina = opcoes.rotina;
  const [mensagens, notas, playbooks] = await Promise.all([
    // A rotina responde sempre do zero: o histórico dela são as respostas de antes.
    rotina
      ? Promise.resolve([])
      : leitor.doCliente("agent_messages", {
          onde: [
            ["conversation_id", "==", conversaId],
            ["user_id", "==", escopo.uid],
          ],
          ordem: [["created_at_iso", "desc"]],
          limite: JANELA_DO_HISTORICO,
        }),
    notasDoPrompt(leitor).catch(() => [] as string[]),
    playbooksDoPrompt(leitor).catch(() => []),
  ]);
  const resumo = conversa.exists ? texto(conversa.get("summary")).slice(0, TAMANHO_DO_RESUMO) : "";

  // Cada chamada de ferramenta passa pelo esquema e fica anotada: o cartão e os playbooks usados saem daqui, não do formato do modelo.
  const chamadas: Array<{ nome: string; saida: unknown }> = [];
  const contexto = { leitor, escopo, agora: agora(), conversaId };
  const ferramentas: FerramentaParaOModelo[] = ferramentasDoEscopo(escopo, FERRAMENTAS_DO_AGENTE).map((item) => ({
    nome: item.nome,
    descricao: item.descricao,
    entrada: item.entrada,
    executar: async (entrada) => {
      const saida = await executarFerramenta(item, contexto, entrada);
      chamadas.push({ nome: item.nome, saida });
      return saida;
    },
  }));

  const resposta = await opcoes.gerar({
    sistema: promptDoAgente({ escopo, agora: contexto.agora, notas, playbooks, resumo }),
    historico: emOrdem(mensagens)
      .filter((mensagem) => mensagem.conteudo.trim())
      .map((mensagem) => ({ papel: mensagem.papel === "assistant" ? ("model" as const) : ("user" as const), texto: mensagem.conteudo.slice(0, TAMANHO_DA_MENSAGEM_NO_MODELO) })),
    mensagem: rotina ? perguntaDaRotina(rotina, pedido.message, contexto.agora) : pedido.message,
    ferramentas,
    aoPedaco: opcoes.aoPedaco,
  });

  // A rotina sem modelo não grava a resposta de reserva: falha e tenta de novo em 15 minutos.
  if (rotina && resposta.fonte === FONTE_SEM_MODELO) throw new Error(resposta.erro || "Nenhum modelo respondeu.");

  // A resposta grava depois da pergunta, para a ordem do histórico nunca empatar.
  const respostaEm = new Date(Math.max(agora().getTime(), Date.parse(perguntaEm) + 1)).toISOString();
  const ferramentasUsadas = chamadas.map((chamada) => chamada.nome);
  const cartao = cartaoDasRespostas(chamadas);
  const usados = playbooksUsados(chamadas);
  const perguntaId = novoId("msg_user");
  const respostaId = novoId("msg_agent");
  const origem = rotina ? "rotina" : escopo.audiencia === "cliente" ? "portal_cliente" : "painel_interno";

  const lote = db.batch();
  lote.set(
    conversaRef,
    compacto({
      id: conversaId,
      customer_code: escopo.customerCode,
      user_id: escopo.uid,
      user_email: caller.email,
      user_name: caller.name,
      modulo: escopo.modulo,
      // O título é a primeira pergunta (ou o nome da rotina); não muda a cada mensagem.
      title: conversa.exists ? undefined : (rotina ? `Rotina: ${rotina.nome}` : pedido.message).slice(0, 90),
      routine_id: rotina?.id,
      status: "active",
      last_message_at: respostaEm,
      updated_at: FieldValue.serverTimestamp(),
      created_at: conversa.exists ? undefined : FieldValue.serverTimestamp(),
    }),
    { merge: true },
  );
  lote.set(db.collection(MESSAGES_COLLECTION).doc(perguntaId), {
    id: perguntaId,
    conversation_id: conversaId,
    customer_code: escopo.customerCode,
    user_id: escopo.uid,
    modulo: escopo.modulo,
    role: "user",
    content: pedido.message,
    created_at_iso: perguntaEm,
    created_at: FieldValue.serverTimestamp(),
    source: origem,
  });
  lote.set(
    db.collection(MESSAGES_COLLECTION).doc(respostaId),
    compacto({
      id: respostaId,
      conversation_id: conversaId,
      customer_code: escopo.customerCode,
      user_id: escopo.uid,
      modulo: escopo.modulo,
      role: "assistant",
      content: resposta.texto,
      tools_used: ferramentasUsadas,
      draft: cartao,
      created_at_iso: respostaEm,
      created_at: FieldValue.serverTimestamp(),
      source: resposta.fonte,
    }),
  );
  // O uso: só o backend lê e grava (o painel de custo do WMS lê esta coleção).
  lote.set(
    db.collection(USAGE_COLLECTION).doc(respostaId),
    compacto({
      id: respostaId,
      conversation_id: conversaId,
      customer_code: escopo.customerCode,
      user_id: escopo.uid,
      role: escopo.role,
      modulo: escopo.modulo,
      model: resposta.modelo,
      // O painel de custo separa a rotina da conversa pela origem, como no WMS.
      source: rotina ? "rotina" : resposta.fonte,
      tools_used: ferramentasUsadas,
      tool_calls: ferramentasUsadas.length,
      playbooks: usados,
      input_tokens: resposta.tokens_entrada,
      output_tokens: resposta.tokens_saida,
      latency_ms: resposta.latencia_ms,
      error: resposta.erro,
      created_at_iso: respostaEm,
      created_at: FieldValue.serverTimestamp(),
    }),
  );
  await lote.commit();

  // Conversa longa: o que sai da janela vira resumo. A falha aqui nunca derruba a resposta, que já foi gravada.
  if (opcoes.resumir && !rotina) {
    await atualizarResumo(db, escopo, conversaId, opcoes.resumir).catch((erro) => console.warn("[agente] resumo da conversa não atualizado", erro));
  }

  return {
    conversation: { id: conversaId, customer_code: escopo.customerCode, modulo: escopo.modulo, status: "active", last_message_at: respostaEm },
    messages: [
      { id: perguntaId, role: "user", content: pedido.message, created_at: perguntaEm, source: origem },
      compacto({ id: respostaId, role: "assistant", content: resposta.texto, created_at: respostaEm, source: resposta.fonte, tools_used: ferramentasUsadas, draft: cartao }),
    ],
  };
}

/**
 * O resumo da conversa longa: quando ao menos 10 mensagens antigas, fora das
 * 20 da janela, ainda não estão nele. Devolve true quando gravou. A falha do
 * resumidor não grava nada.
 */
export async function atualizarResumo(db: Firestore, escopo: Pick<EscopoDoAgente, "uid" | "customerCode">, conversaId: string, resumir: Resumir): Promise<boolean> {
  const conversaRef = db.collection(CONVERSATIONS_COLLECTION).doc(conversaId);
  const conversa = (await conversaRef.get()).data();
  if (!conversa || conversa.user_id !== escopo.uid || conversa.customer_code !== escopo.customerCode) return false;
  const lidas = await db
    .collection(MESSAGES_COLLECTION)
    .where("customer_code", "==", escopo.customerCode)
    .where("conversation_id", "==", conversaId)
    .where("user_id", "==", escopo.uid)
    .orderBy("created_at_iso", "desc")
    .limit(MENSAGENS_DO_RESUMO)
    .get();
  const mensagens = emOrdem(lidas.docs.map((doc) => ({ ...doc.data(), id: doc.id })));
  if (mensagens.length <= JANELA_DO_HISTORICO) return false;
  const antigas = mensagens.slice(0, mensagens.length - JANELA_DO_HISTORICO);
  const ate = texto(conversa.summary_upto_iso);
  const novas = antigas.filter((mensagem) => mensagem.em > ate);
  if (novas.length < LOTE_DO_RESUMO) return false;
  const resumo = (await resumir(texto(conversa.summary), novas)).trim().slice(0, TAMANHO_DO_RESUMO);
  if (!resumo) return false;
  await conversaRef.update({ summary: resumo, summary_upto_iso: novas[novas.length - 1]!.em, summary_updated_at: FieldValue.serverTimestamp() });
  return true;
}

/** O pedido ao modelo para resumir: o resumo anterior e as mensagens novas. */
export function promptDoResumo(anterior: string, mensagens: readonly MensagemDoResumo[]): string {
  const linhas = mensagens.map((mensagem) => `${mensagem.papel === "user" ? "Pessoa" : "Agent Dute"}: ${mensagem.conteudo.slice(0, 1500)}`);
  return [
    "Atualize o resumo desta conversa com o Agent Dute (assistente da Dutelog).",
    "Guarde só o que serve para continuar a conversa: o que a pessoa quer, números de pedido, aviso, demanda e OS, itens, quantidades, datas, decisões e pendências.",
    "Português do Brasil, no máximo 12 linhas com '- '. Não invente nada que não esteja abaixo.",
    "",
    `Resumo até agora:\n${anterior || "(vazio)"}`,
    "",
    `Mensagens novas:\n${linhas.join("\n")}`,
  ].join("\n");
}
