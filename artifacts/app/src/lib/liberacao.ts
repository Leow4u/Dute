/**
 * Liberação por ambiente da Fase 2 da plataforma (docs/plataforma/fase-2-nucleo.md).
 *
 * A produção publica a `main` por disparo manual, então uma correção do WMS
 * levaria junto as telas novas da plataforma. Elas ficam ligadas só na
 * homologação e, no desenvolvimento, quando o projeto não é de produção.
 * Ligar na produção é um PR que acrescenta "dute-prod" em AMBIENTES_LIBERADOS,
 * com o OK do Leonardo.
 *
 * Fica sob a liberação: papéis novos no convite, módulos contratados em
 * Configurações › Clientes e a tela de entrada por módulo (/).
 */

export const AMBIENTES_LIBERADOS: readonly string[] = ["dute-homolog"];

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
 * tela só aparece onde as callables respondem. Ligar na produção é um PR com
 * o OK do Leonardo que muda as duas listas.
 */
export const COMERCIAL_AMBIENTES_LIBERADOS: readonly string[] = ["dute-homolog"];

export function comercialLiberado(projectId: string | null | undefined): boolean {
  return COMERCIAL_AMBIENTES_LIBERADOS.includes(String(projectId ?? "").trim());
}

/** Valor deste build, para as telas do Comercial. */
export const COMERCIAL_LIBERADO = comercialLiberado(import.meta.env.VITE_FIREBASE_PROJECT_ID);
