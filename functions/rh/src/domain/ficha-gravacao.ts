import { FieldValue, type DocumentData, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { ID_ARQUIVO, tipoDeArquivo, type ArquivoDoRegistro } from "./arquivos.js";
import { diaEmSaoPaulo } from "./dia.js";
import { createRhEvent } from "./events.js";
import {
  CATEGORIAS,
  COLLABORATORS_COLLECTION,
  REGISTROS_COLLECTION,
  RESULTADOS_DO_EXAME,
  SITUACOES,
  TIPOS_POR_CATEGORIA,
  entradaDaFicha,
  entradaDoArquivamento,
  entradaDoRegistro,
  grupoDoRegistro,
  novoIdDeRegistro,
  registroArquivado,
  registroSalvo,
  situacoesDoGrupo,
  vencimentosDoDia,
  type Categoria,
  type RegistroGravado,
  type ResultadoDoExame,
  type Situacao,
  type SituacaoNoGrupo,
  type Vencimento,
} from "./ficha.js";
import { actorPayload, runIdempotent, type RhActor } from "./operations.js";
import { rhWriteProblem } from "./platform-roles.js";
import type { RhProfile } from "./profile.js";

/**
 * A ficha no Firestore (parte 8.2a). `padrao` é o banco padrão, onde moram o
 * `users` e o `collaborators`; `rh` é o banco do RH, onde ficam os
 * registros, o recibo e o evento. A gravação confere o colaborador no banco
 * padrão antes e grava tudo dela numa transação do banco `rh`.
 */

export const VINCULOS = ["proprio", "freelancer", "terceiro"] as const;
export type Vinculo = (typeof VINCULOS)[number];

/** O que o RH lê do cadastro da Operação: sem CPF, telefone nem CNH. */
export type ColaboradorDoRh = { id: string; nome: string; funcao: string; vinculo: Vinculo; ativo: boolean };

function texto(data: DocumentData, campo: string): string {
  const valor = data[campo];
  return typeof valor === "string" ? valor : "";
}

function ilegivel(): never {
  throw new HttpsError("failed-precondition", "Registro ilegível.");
}

export function colaboradorDoRh(id: string, data: DocumentData): ColaboradorDoRh {
  return {
    id,
    nome: texto(data, "nome"),
    funcao: texto(data, "funcao"),
    vinculo: (VINCULOS as readonly string[]).includes(data.vinculo) ? (data.vinculo as Vinculo) : "proprio",
    ativo: data.ativo === true,
  };
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

function textoOuNull(valor: unknown): string | null {
  if (valor == null) return null;
  if (typeof valor !== "string") ilegivel();
  return valor;
}

function arquivoLido(valor: unknown): ArquivoDoRegistro | null {
  if (valor == null) return null;
  if (typeof valor !== "object") ilegivel();
  const arquivo = valor as Record<string, unknown>;
  if (typeof arquivo.id !== "string" || !ID_ARQUIVO.test(arquivo.id) || typeof arquivo.caminho !== "string") ilegivel();
  if (!tipoDeArquivo(arquivo.content_type) || typeof arquivo.tamanho !== "number") ilegivel();
  const geracao = typeof arquivo.geracao === "string" && /^\d+$/.test(arquivo.geracao) ? arquivo.geracao : null;
  return { id: arquivo.id, caminho: arquivo.caminho, content_type: arquivo.content_type, tamanho: arquivo.tamanho, geracao };
}

/** O registro gravado, conferido campo a campo; o que não confere é ilegível. */
export function registroLido(id: string, data: DocumentData): RegistroGravado {
  const categoria = data.categoria as Categoria;
  if (!(CATEGORIAS as readonly string[]).includes(categoria)) ilegivel();
  const tipos: readonly string[] = TIPOS_POR_CATEGORIA[categoria];
  if (typeof data.tipo !== "string" || !tipos.includes(data.tipo)) ilegivel();
  if (typeof data.colaborador_id !== "string" || typeof data.emitido_em !== "string" || !DIA.test(data.emitido_em)) ilegivel();
  const venceEm = textoOuNull(data.vence_em);
  if (venceEm !== null && !DIA.test(venceEm)) ilegivel();
  const resultado = textoOuNull(data.resultado);
  if (resultado !== null && !(RESULTADOS_DO_EXAME as readonly string[]).includes(resultado)) ilegivel();
  if (!(SITUACOES as readonly string[]).includes(data.situacao) || typeof data.edicao !== "number") ilegivel();
  return {
    id,
    colaborador_id: data.colaborador_id,
    categoria,
    tipo: data.tipo,
    descricao: textoOuNull(data.descricao),
    emitido_em: data.emitido_em,
    vence_em: venceEm,
    resultado: resultado as ResultadoDoExame | null,
    situacao: data.situacao as Situacao,
    substituido_por: textoOuNull(data.substituido_por),
    arquivo: arquivoLido(data.arquivo),
    criado_em: typeof data.criado_em === "string" ? data.criado_em : "",
    edicao: data.edicao,
  };
}

/** Os legíveis; o ilegível fica de fora da leitura (a gravação recusa). */
function legiveis(docs: ReadonlyArray<{ id: string; data: () => DocumentData }>): RegistroGravado[] {
  return docs.flatMap((doc) => {
    try {
      return [registroLido(doc.id, doc.data())];
    } catch {
      return [];
    }
  });
}

export function atorDoRh(caller: RhProfile): RhActor {
  return { uid: caller.uid, role: caller.role, email: caller.email, name: caller.name };
}

export function exigeQuemGrava(caller: RhProfile): void {
  const problema = rhWriteProblem(caller.role);
  if (problema) throw new HttpsError("permission-denied", problema);
}

async function lerColaborador(padrao: Firestore, id: string): Promise<ColaboradorDoRh> {
  const snapshot = await padrao.collection(COLLABORATORS_COLLECTION).doc(id).get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Colaborador não encontrado.");
  return colaboradorDoRh(snapshot.id, snapshot.data() ?? {});
}

function eventoDeSituacao(
  transaction: Transaction,
  rh: Firestore,
  antes: RegistroGravado,
  depois: SituacaoNoGrupo,
  contexto: { operationId: string; actor: RhActor },
): void {
  createRhEvent(transaction, rh, {
    operation_id: contexto.operationId,
    suffix: `rh.record_status_changed:${antes.id}`,
    type: "rh.record_status_changed",
    entity_id: antes.id,
    payload: {
      id: antes.id,
      colaborador_id: antes.colaborador_id,
      categoria: antes.categoria,
      tipo: antes.tipo,
      antes: antes.situacao,
      depois: depois.situacao,
      por: depois.substituido_por,
    },
    actor: contexto.actor,
  });
}

/**
 * Grava a situação nova dos outros registros do grupo e o evento de cada
 * mudança de situação. `exceto` é o registro que a ação já grava.
 */
function aplicarSituacoes(
  transaction: Transaction,
  rh: Firestore,
  grupo: readonly RegistroGravado[],
  situacoes: Map<string, SituacaoNoGrupo>,
  contexto: { operationId: string; actor: RhActor; exceto: string },
): void {
  for (const registro of grupo) {
    const nova = situacoes.get(registro.id);
    if (!nova || registro.id === contexto.exceto) continue;
    if (nova.situacao === registro.situacao && nova.substituido_por === registro.substituido_por) continue;
    transaction.update(rh.collection(REGISTROS_COLLECTION).doc(registro.id), {
      situacao: nova.situacao,
      substituido_por: nova.substituido_por,
      updated_at: FieldValue.serverTimestamp(),
      updated_by: actorPayload(contexto.actor),
    });
    if (nova.situacao !== registro.situacao) eventoDeSituacao(transaction, rh, registro, nova, contexto);
  }
}

async function fichaNaTransacao(transaction: Transaction, rh: Firestore, colaboradorId: string): Promise<RegistroGravado[]> {
  const snapshot = await transaction.get(rh.collection(REGISTROS_COLLECTION).where("colaborador_id", "==", colaboradorId));
  return snapshot.docs.map((doc) => registroLido(doc.id, doc.data()));
}

export type ResultadoDoRegistro = { id: string; edicao: number; situacao: Situacao };

/** saveRhRecord: inclui ou altera um registro da ficha. Só o rh grava. */
export async function saveRhRecordFor(padrao: Firestore, rh: Firestore, caller: RhProfile, data: unknown, agora: Date = new Date()) {
  exigeQuemGrava(caller);
  const entrada = entradaDoRegistro(data, diaEmSaoPaulo(agora));
  await lerColaborador(padrao, entrada.colaborador_id);
  const actor = atorDoRh(caller);
  const { idempotency_key, ...input } = entrada;
  return runIdempotent<ResultadoDoRegistro>(
    rh,
    { kind: "registro_rh", scope: { colaborador_id: entrada.colaborador_id }, idempotency_key, input, actor },
    async (transaction, { operationId }) => {
      const ficha = await fichaNaTransacao(transaction, rh, entrada.colaborador_id);
      const atual = entrada.id ? ficha.find((registro) => registro.id === entrada.id) ?? null : null;
      if (entrada.id && !atual) throw new HttpsError("not-found", "Registro não encontrado.");
      const id = entrada.id ?? novoIdDeRegistro();
      const salvo = registroSalvo(atual, entrada, id, agora.toISOString());
      const grupo = [...ficha.filter((registro) => registro.id !== id && grupoDoRegistro(registro) === grupoDoRegistro(salvo)), salvo];
      const situacoes = situacoesDoGrupo(grupo);
      const registro: RegistroGravado = { ...salvo, ...situacoes.get(id) };
      const ref = rh.collection(REGISTROS_COLLECTION).doc(id);
      if (atual) {
        transaction.update(ref, { ...registro, updated_at: FieldValue.serverTimestamp(), updated_by: actorPayload(actor) });
        createRhEvent(transaction, rh, {
          operation_id: operationId,
          type: "rh.record_updated",
          entity_id: id,
          payload: {
            id,
            colaborador_id: registro.colaborador_id,
            categoria: registro.categoria,
            tipo: registro.tipo,
            emitido_em: registro.emitido_em,
            vence_em: registro.vence_em,
            edicao_antes: atual.edicao,
            edicao_depois: registro.edicao,
          },
          actor,
        });
      } else {
        transaction.create(ref, {
          ...registro,
          created_at: FieldValue.serverTimestamp(),
          created_by: actorPayload(actor),
          updated_at: FieldValue.serverTimestamp(),
          updated_by: actorPayload(actor),
        });
        createRhEvent(transaction, rh, {
          operation_id: operationId,
          type: "rh.record_created",
          entity_id: id,
          payload: {
            id,
            colaborador_id: registro.colaborador_id,
            categoria: registro.categoria,
            tipo: registro.tipo,
            emitido_em: registro.emitido_em,
            vence_em: registro.vence_em,
            situacao: registro.situacao,
          },
          actor,
        });
      }
      // O registro alterado também muda de situação quando a data dele passa
      // a de outro do mesmo tipo, ou o contrário; o incluído nasce com ela.
      if (atual && atual.situacao !== registro.situacao) {
        eventoDeSituacao(transaction, rh, atual, { situacao: registro.situacao, substituido_por: registro.substituido_por }, { operationId, actor });
      }
      aplicarSituacoes(transaction, rh, grupo, situacoes, { operationId, actor, exceto: id });
      return { target_id: id, result: { id, edicao: registro.edicao, situacao: registro.situacao } };
    },
  );
}

/** archiveRhRecord: tira o registro da ficha, que fica no histórico. Só o rh grava. */
export async function archiveRhRecordFor(rh: Firestore, caller: RhProfile, data: unknown) {
  exigeQuemGrava(caller);
  const entrada = entradaDoArquivamento(data);
  const actor = atorDoRh(caller);
  const { idempotency_key, ...input } = entrada;
  return runIdempotent<ResultadoDoRegistro>(
    rh,
    { kind: "registro_rh_arquivado", scope: { id: entrada.id }, idempotency_key, input, actor },
    async (transaction, { operationId }) => {
      const ref = rh.collection(REGISTROS_COLLECTION).doc(entrada.id);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new HttpsError("not-found", "Registro não encontrado.");
      const atual = registroLido(snapshot.id, snapshot.data() ?? {});
      const ficha = await fichaNaTransacao(transaction, rh, atual.colaborador_id);
      const arquivado = registroArquivado(atual, entrada.expected_edicao);
      const grupo = ficha.filter((registro) => grupoDoRegistro(registro) === grupoDoRegistro(atual));
      const situacoes = situacoesDoGrupo(grupo.map((registro) => (registro.id === atual.id ? arquivado : registro)));
      transaction.update(ref, {
        situacao: arquivado.situacao,
        substituido_por: null,
        edicao: arquivado.edicao,
        updated_at: FieldValue.serverTimestamp(),
        updated_by: actorPayload(actor),
      });
      createRhEvent(transaction, rh, {
        operation_id: operationId,
        type: "rh.record_archived",
        entity_id: atual.id,
        payload: { id: atual.id, colaborador_id: atual.colaborador_id, categoria: atual.categoria, tipo: atual.tipo },
        actor,
      });
      aplicarSituacoes(transaction, rh, grupo, situacoes, { operationId, actor, exceto: atual.id });
      return { target_id: atual.id, result: { id: atual.id, edicao: arquivado.edicao, situacao: arquivado.situacao } };
    },
  );
}

export type ColaboradorNoPainel = ColaboradorDoRh & {
  /** Registros vigentes na ficha. */
  registros: number;
  vencendo: number;
  vencidos: number;
  /** O vencimento mais próximo entre os vigentes que ainda não venceram, ou null. */
  proximo_vencimento: string | null;
};

export type VencimentoNoPainel = Vencimento & { nome: string };

export type PainelDoRh = { hoje: string; colaboradores: ColaboradorNoPainel[]; vencimentos: VencimentoNoPainel[] };

const POR_NOME = new Intl.Collator("pt-BR", { sensitivity: "base" });

/**
 * getRhPanel: o Início e a lista do RH. Quem está ativo no cadastro da
 * Operação, com a contagem da ficha, e os vencimentos (vencimentosDoDia),
 * que são o "Precisa de você" do RH.
 */
export async function getRhPanelFor(padrao: Firestore, rh: Firestore, agora: Date = new Date()): Promise<PainelDoRh> {
  const hoje = diaEmSaoPaulo(agora);
  const [cadastro, vigentes] = await Promise.all([
    padrao.collection(COLLABORATORS_COLLECTION).where("ativo", "==", true).get(),
    rh.collection(REGISTROS_COLLECTION).where("situacao", "==", "vigente").get(),
  ]);
  const ativos = cadastro.docs.map((doc) => colaboradorDoRh(doc.id, doc.data()));
  const registros = legiveis(vigentes.docs);
  const vencimentos = vencimentosDoDia(hoje, registros, new Set(ativos.map((colaborador) => colaborador.id)));
  const nomes = new Map(ativos.map((colaborador) => [colaborador.id, colaborador.nome]));
  const colaboradores = ativos
    .map((colaborador): ColaboradorNoPainel => {
      const daFicha = registros.filter((registro) => registro.colaborador_id === colaborador.id);
      const seus = vencimentos.filter((vencimento) => vencimento.colaborador_id === colaborador.id);
      // O próximo é o que ainda não venceu; o vencido já conta em `vencidos`.
      const datas = daFicha.flatMap((registro) => (registro.vence_em && registro.vence_em >= hoje ? [registro.vence_em] : [])).sort();
      return {
        ...colaborador,
        registros: daFicha.length,
        vencendo: seus.filter((vencimento) => vencimento.dias >= 0).length,
        vencidos: seus.filter((vencimento) => vencimento.dias < 0).length,
        proximo_vencimento: datas[0] ?? null,
      };
    })
    .sort((a, b) => POR_NOME.compare(a.nome, b.nome) || a.id.localeCompare(b.id));
  return {
    hoje,
    colaboradores,
    vencimentos: vencimentos.map((vencimento) => ({ ...vencimento, nome: nomes.get(vencimento.colaborador_id) ?? "" })),
  };
}

/** O registro na tela: o arquivo sem o caminho no bucket, que só a callable usa. */
export type RegistroNaFicha = Omit<RegistroGravado, "arquivo"> & { arquivo: Omit<ArquivoDoRegistro, "caminho" | "geracao"> | null };

export type FichaDoColaborador = { hoje: string; colaborador: ColaboradorDoRh; registros: RegistroNaFicha[] };

function registroNaFicha(registro: RegistroGravado): RegistroNaFicha {
  const { arquivo, ...resto } = registro;
  return { ...resto, arquivo: arquivo ? { id: arquivo.id, content_type: arquivo.content_type, tamanho: arquivo.tamanho } : null };
}

const ORDEM_DA_SITUACAO: Record<Situacao, number> = { vigente: 0, substituido: 1, arquivado: 2 };

/** getRhFicha: a ficha de uma pessoa, ativa ou não, com o histórico. */
export async function getRhFichaFor(padrao: Firestore, rh: Firestore, data: unknown, agora: Date = new Date()): Promise<FichaDoColaborador> {
  const { colaborador_id } = entradaDaFicha(data);
  const colaborador = await lerColaborador(padrao, colaborador_id);
  const snapshot = await rh.collection(REGISTROS_COLLECTION).where("colaborador_id", "==", colaborador_id).get();
  const registros = legiveis(snapshot.docs).sort(
    (a, b) =>
      CATEGORIAS.indexOf(a.categoria) - CATEGORIAS.indexOf(b.categoria) ||
      ORDEM_DA_SITUACAO[a.situacao] - ORDEM_DA_SITUACAO[b.situacao] ||
      b.emitido_em.localeCompare(a.emitido_em) ||
      a.id.localeCompare(b.id),
  );
  return { hoje: diaEmSaoPaulo(agora), colaborador, registros: registros.map(registroNaFicha) };
}
