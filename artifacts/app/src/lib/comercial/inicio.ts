import { collection, getDocs, query, where, type QuerySnapshot } from "firebase/firestore";

import { firestore } from "../firebase";
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
