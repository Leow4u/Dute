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
 * travada igual a esta por platform-lists.test.ts). Só a homologação atende
 * até o lançamento da Fase 4 (parte 4.9), com o OK do Leonardo.
 */
export const FINANCEIRO_AMBIENTES_LIBERADOS: readonly string[] = ["dute-homolog"];

export function financeiroLiberado(projectId: string | null | undefined): boolean {
  return FINANCEIRO_AMBIENTES_LIBERADOS.includes(String(projectId ?? "").trim());
}

/** Valor deste build, para as telas do Financeiro. */
export const FINANCEIRO_LIBERADO = financeiroLiberado(import.meta.env.VITE_FIREBASE_PROJECT_ID);

/**
 * Liberação própria da memória da Dute (docs/plataforma/fase-5-memoria.md).
 * A rotina e as callables de functions/core recusam fora de
 * MEMORIA_AMBIENTES_LIBERADOS (functions/core/src/domain/liberacao.ts,
 * travada igual a esta por platform-lists.test.ts). Só a homologação atende
 * até o fim da Fase 5, com o OK do Leonardo.
 */
export const MEMORIA_AMBIENTES_LIBERADOS: readonly string[] = ["dute-homolog"];

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
 * agente do WMS. Só a homologação atende até o lançamento da Fase 5, com o OK
 * do Leonardo.
 */
export const AGENTE_AMBIENTES_LIBERADOS: readonly string[] = ["dute-homolog"];

export function agenteLiberado(projectId: string | null | undefined): boolean {
  return AGENTE_AMBIENTES_LIBERADOS.includes(String(projectId ?? "").trim());
}

/** Valor deste build: o app fala com o Agent Dute do núcleo, e não com o do WMS. */
export const AGENTE_LIBERADO = agenteLiberado(import.meta.env.VITE_FIREBASE_PROJECT_ID);
