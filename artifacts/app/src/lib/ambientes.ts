import type { Modulo, Papel } from "@workspace/dominio";

import { COMERCIAL_LIBERADO, OPERACAO_LIBERADO, PLATAFORMA_LIBERADA } from "./liberacao";
import { normalizePath } from "./modules";
import type { OperationProfile } from "./operations";
import { entrada } from "./platform-modules";
import { isSettingsPath } from "./settings-nav";

/**
 * Ambientes da plataforma dentro do app único. O caminho da URL escolhe o
 * shell, então link direto, atualização e voltar/avançar do navegador
 * mantêm o módulo. Módulo novo com telas próprias entra em POR_PREFIXO e
 * ganha um layout em App.tsx; sem tela, não entra.
 *
 * O Faturamento continua no WMS: é a tela que existe hoje, e tirá-la do
 * menu da Armazenagem mudaria o WMS. O prefixo /financeiro fica para quando
 * o módulo tiver navegação própria.
 */

export type Ambiente = "wms" | "comercial" | "operacao" | "campo";

const POR_PREFIXO: readonly { prefixo: string; ambiente: Ambiente }[] = [
  { prefixo: "/comercial", ambiente: "comercial" },
  { prefixo: "/operacao", ambiente: "operacao" },
  // O app do campo, no celular (parte 3.8b): é da Operação, com shell próprio.
  { prefixo: "/campo", ambiente: "campo" },
];

/** Ambiente de navegação do caminho. Configuração não é módulo: use layoutDaRota. */
export function ambienteDaRota(path: string): Ambiente {
  const normalized = normalizePath(path);
  for (const item of POR_PREFIXO) {
    if (normalized === item.prefixo || normalized.startsWith(`${item.prefixo}/`)) return item.ambiente;
  }
  return "wms";
}

/**
 * Módulo cuja casa a rota pertence, para marcar o item aberto no menu da
 * conta. Configuração não é módulo. O Faturamento mora no shell do WMS, mas
 * é a casa do Financeiro. O resto desse shell é a Armazenagem.
 */
export function moduloDaRota(path: string): Modulo | null {
  if (isSettingsPath(path)) return null;
  const ambiente = ambienteDaRota(path);
  if (ambiente === "comercial" || ambiente === "operacao") return ambiente;
  if (ambiente === "campo") return "operacao";
  const normalized = normalizePath(path);
  if (normalized === "/faturamento" || normalized.startsWith("/faturamento/")) return "financeiro";
  return "wms";
}

/** Qual shell desenha a rota. "app" é o layout do WMS e do portal. */
export type LayoutDaRota = "app" | "settings" | "comercial" | "operacao" | "campo";

export function layoutDaRota(path: string): LayoutDaRota {
  if (isSettingsPath(path)) return "settings";
  const ambiente = ambienteDaRota(path);
  if (ambiente === "comercial" || ambiente === "operacao" || ambiente === "campo") return ambiente;
  return "app";
}

/**
 * A pessoa tem mais de um módulo com tela, então a entrada em "/" mostra
 * os cards. Com um só, "/" devolve direto para a casa e o atalho não aparece.
 * Fora da liberação da plataforma, não há seletor.
 */
export function podeTrocarDeModulo(
  role: Papel | null | undefined,
  profile: Pick<OperationProfile, "modules"> | null | undefined,
  comercial: boolean = COMERCIAL_LIBERADO,
  plataforma: boolean = PLATAFORMA_LIBERADA,
  operacao: boolean = OPERACAO_LIBERADO,
): boolean {
  if (!plataforma) return false;
  return entrada(role, profile, comercial, operacao).kind === "cards";
}
