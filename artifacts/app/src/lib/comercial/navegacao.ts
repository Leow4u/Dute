import type { Papel } from "@workspace/dominio";

import { rotaDoAgenteNoModulo } from "../agente/navegacao";
import { AGENTE_LIBERADO, COMERCIAL_LIBERADO } from "../liberacao";

/**
 * Navegação do Comercial no app (docs/plataforma/fase-6-comercial.md).
 * As rotas são do ambiente Comercial (lib/ambientes.ts): menu, título e
 * página inicial próprios, não uma seção do WMS. O conteúdo segue a
 * identidade v3.
 *
 * Tudo aqui depende da liberação própria do Comercial (lib/liberacao.ts): fora
 * dela (produção) não há rota, item de menu, card na tela de entrada nem
 * aterrissagem, como antes. As funções recebem a liberação como parâmetro (o
 * padrão é a deste build) para os testes decidirem o ambiente.
 */

/**
 * Quem trabalha no Comercial: os papéis com o módulo em MODULOS_POR_PAPEL
 * (lib/dominio), a mesma lista das callables (functions/comercial,
 * platform-roles.ts). Travada por lib/platform-lists.test.ts.
 */
export const COMERCIAL_ROLES = ["owner", "admin", "comercial"] as const satisfies readonly Papel[];

/** Casa do módulo: o Início do Comercial (parte 2.5, docs/mockups/ModComInicio.dc.html). */
export const ROTA_COMERCIAL = "/comercial";
/** A fila de orçamentos (parte 11, docs/mockups/ComFila.dc.html); era a casa até a parte 2.5. */
export const ROTA_ORCAMENTOS = "/comercial/orcamentos";
/** Montar orçamento (docs/mockups/ComOrcamento.dc.html), aberto pela fila: ?numero=10045. */
export const ROTA_ORCAMENTO = "/comercial/orcamento";
/** Aprovar no celular (docs/mockups/ComAprovarCelular.dc.html, parte 12a): só o owner. */
export const ROTA_APROVAR = "/comercial/aprovar";

/** A aprovação numa tela: "/comercial/aprovar", ou já num orçamento ("?numero=10045"). */
export function hrefDaAprovacao(numero?: string | null): string {
  return numero ? `${ROTA_APROVAR}?numero=${encodeURIComponent(numero)}` : ROTA_APROVAR;
}
/** O documento A4 do orçamento (docs/mockups/ComDocumento.dc.html): ?numero=10045&rv=1. */
export const ROTA_DOCUMENTO = "/comercial/orcamento/documento";
export const ROTA_CLIENTES = "/comercial/clientes";
/** Aba Contratos do módulo (parte 14): lista e ficha do contrato. */
export const ROTA_CONTRATOS = "/comercial/contratos";
/**
 * Aba Autorizações (parte 15b, docs/mockups/ComAutorizacoes.dc.html): a fila de
 * executados e o registro da autorização de faturamento. Owner, admin e
 * comercial; o financeiro registra pela callable e lê pelas regras, e a tela
 * dele é da Fase 7.
 */
export const ROTA_AUTORIZACOES = "/comercial/autorizacoes";
/** Aba Medições do módulo (parte 16b): a medição mensal de cada contrato e competência. */
export const ROTA_MEDICOES = "/comercial/medicoes";

/**
 * Telas do Comercial que já existem no app. Cada parte nova acrescenta a dela:
 * a rota passa a existir e a aba ou o link para ela aparece.
 */
export const TELAS_DO_COMERCIAL: readonly string[] = [
  ROTA_COMERCIAL,
  ROTA_ORCAMENTOS,
  ROTA_ORCAMENTO,
  ROTA_DOCUMENTO,
  ROTA_APROVAR,
  ROTA_CLIENTES,
  ROTA_CONTRATOS,
  ROTA_AUTORIZACOES,
  ROTA_MEDICOES,
];

/** Rotas do Comercial que o App registra: nenhuma fora da liberação; o Agent Dute, só com a dele (parte 5.5j). */
export function rotasDoComercial(liberado: boolean = COMERCIAL_LIBERADO, agente: boolean = AGENTE_LIBERADO): string[] {
  return liberado ? Array.from(new Set([ROTA_COMERCIAL, ...TELAS_DO_COMERCIAL, ...rotaDoAgenteNoModulo("comercial", agente)])) : [];
}

/**
 * O portão das rotas no App: toda rota do Comercial passa por aqui, e fora
 * da liberação nenhuma é registrada (cai na tela de não encontrado). O teste
 * de navegação exige que o App.tsx não registre rota do Comercial fora dele.
 */
export function soComComercialLiberado<T extends { path: string }>(
  rotas: readonly T[],
  liberado: boolean = COMERCIAL_LIBERADO,
  agente: boolean = AGENTE_LIBERADO,
): T[] {
  const permitidas = rotasDoComercial(liberado, agente);
  return rotas.filter((rota) => permitidas.includes(rota.path));
}

/**
 * A pessoa abre o Comercial: papel do módulo e ambiente liberado. É a decisão
 * que o menu (modules.ts), a aterrissagem e o card da tela de entrada
 * (platform-modules.ts) usam.
 */
export function abreComercial(role: Papel | string | null | undefined, liberado: boolean = COMERCIAL_LIBERADO): boolean {
  return liberado && Boolean(role) && (COMERCIAL_ROLES as readonly string[]).includes(role as string);
}

/**
 * Quem aprova o orçamento: só o owner (pergunta 1 da fase 6; canApproveQuote
 * em functions/comercial). É a guarda da tela de aprovar e o `enabled` da
 * consulta do Início: para os outros papéis, nada é lido.
 */
export const APROVADOR_ROLES = ["owner"] as const satisfies readonly Papel[];

export function aprovaOrcamento(role: Papel | string | null | undefined, liberado: boolean = COMERCIAL_LIBERADO): boolean {
  return abreComercial(role, liberado) && (APROVADOR_ROLES as readonly string[]).includes(role as string);
}

/** Link para a ficha do contrato na aba Contratos (parte 14), quando a tela existe. */
export function hrefDoContrato(contratoId: string, telas: readonly string[] = TELAS_DO_COMERCIAL): string | null {
  return telas.includes(ROTA_CONTRATOS) ? `${ROTA_CONTRATOS}?id=${encodeURIComponent(contratoId)}` : null;
}

/** O contrato aberto na aba Contratos: o `id` da busca da URL (`?id=...`), ou null. */
export function contratoDaBusca(busca: string): string | null {
  const id = new URLSearchParams(busca.startsWith("?") ? busca.slice(1) : busca).get("id")?.trim();
  return id ? id : null;
}

/**
 * Link para a medição de um contrato (e uma competência, AAAA-MM) na aba
 * Medições (parte 16b), quando a tela existe. O Início leva por aqui.
 */
export function hrefDaMedicao(contratoId: string, competencia?: string | null, telas: readonly string[] = TELAS_DO_COMERCIAL): string | null {
  if (!telas.includes(ROTA_MEDICOES)) return null;
  const contrato = `contrato=${encodeURIComponent(contratoId)}`;
  return `${ROTA_MEDICOES}?${competencia ? `${contrato}&competencia=${encodeURIComponent(competencia)}` : contrato}`;
}

/** O contrato e a competência abertos na aba Medições: `contrato` e `competencia` da busca da URL. */
export function medicaoDaBusca(busca: string): { contrato: string | null; competencia: string | null } {
  const parametros = new URLSearchParams(busca.startsWith("?") ? busca.slice(1) : busca);
  const contrato = parametros.get("contrato")?.trim() || null;
  const competencia = parametros.get("competencia")?.trim() ?? "";
  return { contrato, competencia: /^\d{4}-(0[1-9]|1[0-2])$/.test(competencia) ? competencia : null };
}
