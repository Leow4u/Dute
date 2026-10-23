import { Timestamp, collection, doc, getDoc, getDocs, query, where, type QuerySnapshot } from "firebase/firestore";

import { firestore } from "../firebase";
import {
  ETAPAS_COM_PRAZO_DE_PERDA,
  autorizacoesParaOInicio,
  demandaDoRegistro,
  type DemandaDaFila,
  type PendenciasDoInicio,
} from "./autorizacoes";
import { ETAPAS_COM_ADITIVO_A_FAZER, aditivoAFazer, aditivoPedido, type AditivoAFazer } from "./aditivos-da-operacao";
import { ETAPAS_COM_VISTORIA_A_USAR, vistoriaAUsar, vistoriaDaDemanda, type VistoriaAUsar } from "./vistoria-da-operacao";
import { cadastroDoDocumento, hojeLocal, type CadastroComercial } from "./clientes";
import { alertasParaOInicio, contratoDoRegistro, nomesDosClientes, type AlertaDoInicio, type Contrato } from "./contratos";
import { orcamentosParaOInicio, type OrcamentoParaAprovarNoInicio } from "./aprovar";
import {
  alertaMedicaoNaoEnviada,
  alertasDeMedicaoParaOInicio,
  competenciaAnterior,
  competenciaAtual,
  contratoComMedicaoMensal,
  medicaoDoRegistro,
  periodosDosAditivos,
  type AlertaDeMedicaoDoInicio,
  type ContratoParaAlertaDeMedicao,
  type Medicao,
} from "./medicoes";
import { ETAPAS_DEMANDA } from "./orcamentos";
import {
  ETAPAS_DO_RESUMO,
  contagemPorEtapa,
  demandaDoResumo,
  devolvidosDe,
  inicioDaCompetencia,
  numerosDoMes,
  propostasSemResposta,
  type DemandaDoResumo,
  type NumerosDoMes,
  type OrcamentoDevolvido,
  type PropostaSemResposta,
} from "./pendencias";

const VALIDADE_DA_LEITURA_MS = 15_000;
const leiturasRecentes = new Map<string, { em: number; leitura: Promise<QuerySnapshot> }>();

/**
 * `contracts` e `customers` alimentam dois alertas do Início, que saem juntos:
 * a leitura feita nos últimos segundos é reaproveitada, em vez de repetida.
 */
function lerColecao(nome: "contracts" | "customers"): Promise<QuerySnapshot> {
  if (!firestore) return Promise.reject(new Error("Firebase não configurado."));
  const agora = Date.now();
  const recente = leiturasRecentes.get(nome);
  if (recente && agora - recente.em < VALIDADE_DA_LEITURA_MS) return recente.leitura;
  const leitura = getDocs(collection(firestore, nome));
  leiturasRecentes.set(nome, { em: agora, leitura });
  leitura.catch(() => {
    if (leiturasRecentes.get(nome)?.leitura === leitura) leiturasRecentes.delete(nome);
  });
  return leitura;
}

/**
 * Alertas de contrato do Início (parte 14): lê `contracts` e `customers` pelo
 * Firestore (as regras abrem a owner, admin e comercial). A página só chama
 * para quem abre o Comercial (veContratosNoInicio, lib/home-inbox.ts): para
 * os outros papéis, nenhuma consulta sai.
 */
export async function lerAlertasDosContratos(hoje: string = hojeLocal()): Promise<AlertaDoInicio[]> {
  if (!firestore) throw new Error("Firebase não configurado.");
  const [contratos, clientes] = await Promise.all([lerColecao("contracts"), lerColecao("customers")]);
  const lidos = contratos.docs
    .map((row) => contratoDoRegistro(row.id, row.data()))
    .filter((contrato): contrato is Contrato => contrato !== null);
  const cadastros = clientes.docs
    .map((row) => cadastroDoDocumento(row.id, row.data()))
    .filter((cadastro): cadastro is CadastroComercial => cadastro !== null);
  return alertasParaOInicio(lidos, nomesDosClientes(cadastros), hoje);
}

/**
 * Os orçamentos para aprovar no Início (parte 12a): as demandas em "Para
 * aprovar". A página só chama para o owner (veAprovacoesNoInicio,
 * lib/home-inbox.ts); para os outros papéis, nenhuma consulta sai.
 */
export async function lerOrcamentosParaAprovar(): Promise<OrcamentoParaAprovarNoInicio[]> {
  if (!firestore) throw new Error("Firebase não configurado.");
  const demandas = await getDocs(query(collection(firestore, "demands"), where("etapa", "==", "para_aprovar")));
  return orcamentosParaOInicio(demandas.docs.map((row) => ({ id: row.id, data: row.data() })));
}

/**
 * Pendências das autorizações de faturamento no Início (parte 15b): as
 * demandas aguardando autorização ou a faturar (`demands` por etapa) e, se
 * alguma tem contrato, os contratos (o prazo de perda). O nome do cliente vem
 * da própria demanda. Como os contratos, só para quem abre o Comercial
 * (veAutorizacoesNoInicio).
 */
export async function lerAutorizacoesDoInicio(hoje: string = hojeLocal()): Promise<PendenciasDoInicio> {
  if (!firestore) throw new Error("Firebase não configurado.");
  const demandas = (await getDocs(query(collection(firestore, "demands"), where("etapa", "in", [...ETAPAS_COM_PRAZO_DE_PERDA])))).docs
    .map((row) => demandaDoRegistro(row.id, row.data()))
    .filter((demanda): demanda is DemandaDaFila => demanda !== null);
  const contratos = demandas.some((demanda) => demanda.contratoId)
    ? (await getDocs(collection(firestore, "contracts"))).docs
        .map((row) => contratoDoRegistro(row.id, row.data()))
        .filter((contrato): contrato is Contrato => contrato !== null)
    : [];
  return autorizacoesParaOInicio(demandas, contratos, new Map(), hoje);
}

/**
 * A medição do mês que passou sem envio (parte 16b), para o Início: as
 * medições em rascunho, as da competência anterior (de qualquer situação, para
 * saber se o mês foi aberto) e os contratos por medição mensal, com os
 * períodos anteriores dos aditivos (a prorrogação reescreve a vigência). A
 * página só chama para quem abre o Comercial (veMedicoesNoInicio,
 * lib/home-inbox.ts): para os outros papéis, nenhuma consulta sai.
 */
export async function lerAlertasDeMedicao(hoje: string = hojeLocal()): Promise<AlertaDeMedicaoDoInicio[]> {
  const db = firestore;
  if (!db) throw new Error("Firebase não configurado.");
  const anterior = competenciaAnterior(competenciaAtual(hoje));
  const [rascunhos, doMesAnterior, contratosLidos, clientes] = await Promise.all([
    getDocs(query(collection(db, "medicoes"), where("status", "==", "rascunho"))),
    getDocs(query(collection(db, "medicoes"), where("competencia", "==", anterior))),
    lerColecao("contracts"),
    lerColecao("customers"),
  ]);
  const medicoes = new Map<string, Medicao>();
  for (const row of [...rascunhos.docs, ...doMesAnterior.docs]) {
    const medicao = medicaoDoRegistro(row.id, row.data());
    if (medicao) medicoes.set(row.id, medicao);
  }
  const contratos = contratosLidos.docs
    .map((row) => contratoDoRegistro(row.id, row.data()))
    .filter((contrato): contrato is Contrato => contrato !== null);
  const comMedicao = contratos.filter((contrato) => contrato.dados.status !== "encerrado" && contratoComMedicaoMensal(contrato.dados));
  const paraAlerta: ContratoParaAlertaDeMedicao[] = await Promise.all(
    comMedicao.map(async (contrato) => {
      const aditivos = await getDocs(collection(db, "contracts", contrato.id, "aditivos"));
      return {
        id: contrato.id,
        customer_code: contrato.dados.customer_code,
        status: contrato.dados.status,
        regime_padrao: contrato.dados.regime_padrao,
        regimes: contrato.dados.regimes,
        vigente_de: contrato.dados.vigente_de,
        vigente_ate: contrato.dados.vigente_ate,
        vigencias_anteriores: periodosDosAditivos(aditivos.docs.map((aditivo) => aditivo.data())),
      };
    }),
  );
  const cadastros = clientes.docs
    .map((row) => cadastroDoDocumento(row.id, row.data()))
    .filter((cadastro): cadastro is CadastroComercial => cadastro !== null);
  const alertas = alertaMedicaoNaoEnviada(hoje, [...medicoes.values()], paraAlerta);
  return alertasDeMedicaoParaOInicio(alertas, contratos, nomesDosClientes(cadastros));
}

export type ResumoDoComercial = {
  competencia: string;
  porEtapa: ReturnType<typeof contagemPorEtapa>;
  mes: NumerosDoMes;
  /** As propostas aguardando o cliente há mais de DIAS_SEM_RESPOSTA dias, para o "Precisa de você". */
  semResposta: PropostaSemResposta[];
};

/**
 * A coluna ao lado do Início do Comercial (parte 2.5): as demandas nas etapas
 * ativas (a contagem por etapa) e as que mudaram no mês (enviadas, fechadas e
 * perdidas nele). Toda escrita da demanda grava `updated_at`, então quem foi
 * enviada, fechada ou perdida no mês foi atualizada no mês. A mesma leitura
 * das etapas ativas dá as propostas sem resposta. Só para quem abre o
 * Comercial: a página não consulta para os outros papéis.
 */
export async function lerResumoDoComercial(hoje: string = hojeLocal()): Promise<ResumoDoComercial> {
  const db = firestore;
  if (!db) throw new Error("Firebase não configurado.");
  const competencia = competenciaAtual(hoje);
  const [ativas, doMes] = await Promise.all([
    getDocs(query(collection(db, "demands"), where("etapa", "in", [...ETAPAS_DO_RESUMO]))),
    getDocs(query(collection(db, "demands"), where("updated_at", ">=", Timestamp.fromDate(inicioDaCompetencia(competencia))))),
  ]);
  const lidas = (docs: typeof ativas.docs, etapas: readonly string[]) =>
    docs.map((row) => demandaDoResumo(row.id, row.data(), etapas)).filter((demanda): demanda is DemandaDoResumo => demanda !== null);
  const doMesPorId = new Map([...lidas(ativas.docs, ETAPAS_DEMANDA), ...lidas(doMes.docs, ETAPAS_DEMANDA)].map((demanda) => [demanda.numero, demanda]));
  const ativasLidas = lidas(ativas.docs, ETAPAS_DO_RESUMO);
  return {
    competencia,
    porEtapa: contagemPorEtapa(ativasLidas),
    mes: numerosDoMes([...doMesPorId.values()], competencia),
    semResposta: propostasSemResposta(ativasLidas, hoje),
  };
}

/**
 * Os orçamentos que a pessoa montou e o owner devolveu (parte 2.5): os
 * `quotes` em rascunho, filtrados pela devolução e pelo autor. Rascunhos são
 * poucos de cada vez; a leitura não cresce com o histórico.
 */
export async function lerDevolvidos(uid: string): Promise<OrcamentoDevolvido[]> {
  if (!firestore) throw new Error("Firebase não configurado.");
  const rascunhos = await getDocs(query(collection(firestore, "quotes"), where("status", "==", "rascunho")));
  return devolvidosDe(rascunhos.docs.map((row) => ({ id: row.id, data: row.data() })), uid);
}

/**
 * Os aditivos que a revisão da Operação pediu e o Comercial ainda não fez
 * (parte 3.10c): as demandas em Para planejar ou Execução a orçar com o
 * pedido no resumo da Operação, e o orçamento de cada uma para ver se a RV de
 * aditivo já veio. São poucas de cada vez.
 */
export async function lerAditivosAFazer(): Promise<AditivoAFazer[]> {
  const db = firestore;
  if (!db) throw new Error("Firebase não configurado.");
  const demandas = await getDocs(query(collection(db, "demands"), where("etapa", "in", [...ETAPAS_COM_ADITIVO_A_FAZER])));
  const comPedido = demandas.docs.filter((row) => aditivoPedido(row.data()) !== null);
  const quotes = await Promise.all(comPedido.map((row) => getDoc(doc(db, "quotes", row.id))));
  return comPedido
    .map((row, indice) => aditivoAFazer(row.id, row.data(), quotes[indice].exists() ? quotes[indice].data() : null))
    .filter((aditivo): aditivo is AditivoAFazer => aditivo !== null)
    .sort((a, b) => a.pedidoEm.localeCompare(b.pedidoEm));
}

/** As vistorias que a Operação enviou e o orçamento ainda não carregou, a mais antiga primeiro (parte 3.11e). */
export async function lerVistoriasAUsar(): Promise<VistoriaAUsar[]> {
  const db = firestore;
  if (!db) throw new Error("Firebase não configurado.");
  const demandas = await getDocs(query(collection(db, "demands"), where("etapa", "in", [...ETAPAS_COM_VISTORIA_A_USAR])));
  const comVistoria = demandas.docs.filter((row) => vistoriaDaDemanda(row.data()) !== null);
  const quotes = await Promise.all(comVistoria.map((row) => getDoc(doc(db, "quotes", row.id))));
  return comVistoria
    .map((row, indice) => vistoriaAUsar(row.id, row.data(), quotes[indice].exists() ? quotes[indice].data() : null))
    .filter((vistoria): vistoria is VistoriaAUsar => vistoria !== null)
    .sort((a, b) => a.enviadaEm.localeCompare(b.enviadaEm));
}
