import { collection, getDocs, query, where } from "firebase/firestore";

import { firestore } from "../firebase";
import {
  ETAPAS_COM_PRAZO_DE_PERDA,
  autorizacoesParaOInicio,
  demandaDoRegistro,
  type DemandaDaFila,
  type PendenciasDoInicio,
} from "./autorizacoes";
import { cadastroDoDocumento, hojeLocal, type CadastroComercial } from "./clientes";
import { alertasParaOInicio, contratoDoRegistro, nomesDosClientes, type AlertaDoInicio, type Contrato } from "./contratos";
import { orcamentosParaOInicio, type OrcamentoParaAprovarNoInicio } from "./aprovar";

/**
 * Alertas de contrato do Início (parte 14): lê `contracts` e `customers` pelo
 * Firestore (as regras abrem a owner, admin e comercial). A página só chama
 * para quem abre o Comercial (veContratosNoInicio, lib/home-inbox.ts): para
 * os outros papéis, nenhuma consulta sai.
 */
export async function lerAlertasDosContratos(hoje: string = hojeLocal()): Promise<AlertaDoInicio[]> {
  if (!firestore) throw new Error("Firebase não configurado.");
  const [contratos, clientes] = await Promise.all([
    getDocs(collection(firestore, "contracts")),
    getDocs(collection(firestore, "customers")),
  ]);
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
