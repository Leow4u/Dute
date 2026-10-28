/**
 * Foco da produção na Armazenagem. A homologação conserva os outros módulos.
 * Para reativar, retirar o projeto daqui e da lista de mesmo nome em
 * functions/wms/src/domain/billing-scope.ts e republicar função e app.
 * Dados, permissões e serviços dos módulos pausados são preservados.
 */
export const ARMAZENAGEM_EXCLUSIVA_AMBIENTES: readonly string[] = ["dute-prod"];

export const SOMENTE_ARMAZENAGEM = ARMAZENAGEM_EXCLUSIVA_AMBIENTES.includes(
  String(import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "").trim(),
);

const ROTAS_DOS_MODULOS_PAUSADOS = [
  "/operacao", "/comercial", "/financeiro", "/rh", "/campo", "/tv", "/portal/servicos",
];

/** Filtro final do registro de rotas: inclui as telas da Operação no portal. */
export function rotaDisponivelNaArmazenagem(path: string, exclusivo = SOMENTE_ARMAZENAGEM): boolean {
  return !exclusivo || !ROTAS_DOS_MODULOS_PAUSADOS.some(
    (prefixo) => path === prefixo || path.startsWith(`${prefixo}/`),
  );
}
