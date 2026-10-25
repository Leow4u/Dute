/**
 * Liberação por ambiente da Fase 2 da plataforma (docs/plataforma/fase-2-nucleo.md).
 *
 * A produção publica a `main` por disparo manual, então uma correção do WMS
 * levaria junto as telas novas da plataforma. Elas ficam ligadas só na
 * homologação e, no desenvolvimento, quando o projeto não é de produção.
 * A produção (dute-prod) entrou na lista com o OK do Leonardo em 21/10/2026,
 * para o login ver os cards dos módulos. O dute-btg continua de fora.
 *
 * Fica sob a liberação: papéis novos no convite, módulos contratados em
 * Configurações › Clientes e a tela de entrada por módulo (/).
 */

export const AMBIENTES_LIBERADOS: readonly string[] = ["dute-homolog", "dute-prod"];

/** Projetos com dado real: nunca liberados por estar em desenvolvimento. */
const PROJETOS_DE_PRODUCAO: readonly string[] = ["dute-prod", "dute-btg"];

export function plataformaLiberada(projectId: string | null | undefined, dev: boolean): boolean {
  const id = String(projectId ?? "").trim();
  if (!id) return false;
  if (AMBIENTES_LIBERADOS.includes(id)) return true;
  return dev && !PROJETOS_DE_PRODUCAO.includes(id);
}

/** Valor deste build. Testes chamam plataformaLiberada com o ambiente explícito. */
export const PLATAFORMA_LIBERADA = plataformaLiberada(
  import.meta.env.VITE_FIREBASE_PROJECT_ID,
  import.meta.env.DEV,
);

/**
 * Liberação própria do Comercial (docs/plataforma/fase-6-comercial.md). As
 * callables de functions/comercial recusam fora de COMERCIAL_AMBIENTES_LIBERADOS
 * (functions/comercial/src/domain/liberacao.ts, travada igual a esta por
 * platform-lists.test.ts), então aqui não há exceção de desenvolvimento: a
 * tela só aparece onde as callables respondem. Produção e homologação estão
 * na lista; a carga em massa continua sem gravar no dute-prod
 * (functions/comercial/src/cargas/projeto.ts).
 */
export const COMERCIAL_AMBIENTES_LIBERADOS: readonly string[] = ["dute-homolog", "dute-prod"];

export function comercialLiberado(projectId: string | null | undefined): boolean {
  return COMERCIAL_AMBIENTES_LIBERADOS.includes(String(projectId ?? "").trim());
}

/** Valor deste build, para as telas do Comercial. */
export const COMERCIAL_LIBERADO = comercialLiberado(import.meta.env.VITE_FIREBASE_PROJECT_ID);

/**
 * Liberação própria da Operação (docs/plataforma/fase-3-operacao.md). As
 * callables de functions/operacao recusam fora de OPERACAO_AMBIENTES_LIBERADOS
 * (functions/operacao/src/domain/liberacao.ts, travada igual a esta por
 * platform-lists.test.ts). Homologação e produção atendem: o dute-prod entrou
 * na lista com o OK do Leonardo em 22/10/2026. O dute-btg continua de fora.
 */
export const OPERACAO_AMBIENTES_LIBERADOS: readonly string[] = ["dute-homolog", "dute-prod"];

export function operacaoLiberada(projectId: string | null | undefined): boolean {
  return OPERACAO_AMBIENTES_LIBERADOS.includes(String(projectId ?? "").trim());
}

/** Valor deste build, para as telas da Operação. */
export const OPERACAO_LIBERADO = operacaoLiberada(import.meta.env.VITE_FIREBASE_PROJECT_ID);

/**
 * Liberação própria do Financeiro (docs/plataforma/fase-4-financeiro.md). As
 * callables de functions/financeiro recusam fora de
 * FINANCEIRO_AMBIENTES_LIBERADOS (functions/financeiro/src/domain/liberacao.ts,
 * travada igual a esta por platform-lists.test.ts). Homologação e produção
 * atendem: o dute-prod entrou na lista no lançamento da Fase 4 (parte 4.9b),
 * com o OK do Leonardo em 25/10/2026. O dute-btg continua de fora.
 */
export const FINANCEIRO_AMBIENTES_LIBERADOS: readonly string[] = ["dute-homolog", "dute-prod"];

export function financeiroLiberado(projectId: string | null | undefined): boolean {
  return FINANCEIRO_AMBIENTES_LIBERADOS.includes(String(projectId ?? "").trim());
}

/** Valor deste build, para as telas do Financeiro. */
export const FINANCEIRO_LIBERADO = financeiroLiberado(import.meta.env.VITE_FIREBASE_PROJECT_ID);

/**
 * A NFS-e pela Omie (Fase 7, parte 7.4e): a mesma lista de
 * OMIE_AMBIENTES_LIBERADOS (functions/financeiro/src/domain/emissao-omie.ts),
 * travada pelo platform-lists.test.ts. Só vale onde o Financeiro está ligado.
 */
export const OMIE_AMBIENTES_LIBERADOS: readonly string[] = ["dute-homolog"];

export function omieLiberada(projectId: string | null | undefined): boolean {
  return financeiroLiberado(projectId) && OMIE_AMBIENTES_LIBERADOS.includes(String(projectId ?? "").trim());
}

export const OMIE_LIBERADA = omieLiberada(import.meta.env.VITE_FIREBASE_PROJECT_ID);

/**
 * Liberação própria da memória da Dute (docs/plataforma/fase-5-memoria.md).
 * A rotina e as callables de functions/core recusam fora de
 * MEMORIA_AMBIENTES_LIBERADOS (functions/core/src/domain/liberacao.ts,
 * travada igual a esta por platform-lists.test.ts). Homologação e produção
 * atendem: o dute-prod entrou no lançamento da Fase 5, com o OK do Leonardo
 * em 25/10/2026. O dute-btg continua de fora.
 */
export const MEMORIA_AMBIENTES_LIBERADOS: readonly string[] = ["dute-homolog", "dute-prod"];

export function memoriaLiberada(projectId: string | null | undefined): boolean {
  return MEMORIA_AMBIENTES_LIBERADOS.includes(String(projectId ?? "").trim());
}

/** Valor deste build, para as sugestões da memória nas telas. */
export const MEMORIA_LIBERADA = memoriaLiberada(import.meta.env.VITE_FIREBASE_PROJECT_ID);

/**
 * Liberação própria do Agent Dute do núcleo (docs/plataforma/fase-5-memoria.md,
 * parte 5.5). As callables do agente em functions/core recusam fora de
 * AGENTE_AMBIENTES_LIBERADOS (functions/core/src/domain/liberacao.ts, travada
 * igual a esta por platform-lists.test.ts). Fora dela, o app segue com o
 * agente do WMS. Homologação e produção atendem: o dute-prod entrou no
 * lançamento da Fase 5, com o OK do Leonardo em 25/10/2026.
 */
export const AGENTE_AMBIENTES_LIBERADOS: readonly string[] = ["dute-homolog", "dute-prod"];

export function agenteLiberado(projectId: string | null | undefined): boolean {
  return AGENTE_AMBIENTES_LIBERADOS.includes(String(projectId ?? "").trim());
}

/** Valor deste build: o app fala com o Agent Dute do núcleo, e não com o do WMS. */
export const AGENTE_LIBERADO = agenteLiberado(import.meta.env.VITE_FIREBASE_PROJECT_ID);

/**
 * Liberação própria do RH (docs/plataforma/fase-8-rh.md). As callables de
 * functions/rh recusam fora de RH_AMBIENTES_LIBERADOS
 * (functions/rh/src/domain/liberacao.ts, travada igual a esta por
 * platform-lists.test.ts). Homologação e produção atendem: o dute-prod entrou
 * no lançamento da fase, com o OK do Leonardo em 25/10/2026.
 *
 * O RH só existe no app quando a codebase `rh` e o banco `dute-rh` estão na
 * publicação (parte 8.1b, depois de o Leonardo criar o banco): RH_PUBLICADO
 * acompanha o firebase.json, e o platform-lists.test.ts trava os dois juntos.
 * Antes disso, as telas não aparecem em ambiente nenhum.
 */
export const RH_AMBIENTES_LIBERADOS: readonly string[] = ["dute-homolog", "dute-prod"];

/** A codebase `rh` está no firebase.json (parte 8.1b). */
export const RH_PUBLICADO = true;

export function rhLiberado(projectId: string | null | undefined, publicado: boolean = RH_PUBLICADO): boolean {
  return publicado && RH_AMBIENTES_LIBERADOS.includes(String(projectId ?? "").trim());
}

/** Valor deste build, para as telas do RH. */
export const RH_LIBERADO = rhLiberado(import.meta.env.VITE_FIREBASE_PROJECT_ID);
