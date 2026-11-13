import { lazy, type ComponentType, type LazyExoticComponent } from "react";

import { BUILD_COMMIT } from "./build-info";
import { appRoleForProfile, canAccessModule, type AppRole, type ProfileRole } from "./modules";

/**
 * As telas da equipe guardadas no aparelho (docs/plataforma/diagnostico-
 * carregamento.md, 9.3, PR 2 do celular, e decisão 3 de 06/11/2026). O
 * service worker guarda só o shell, e cada tela entra no cache na primeira
 * visita; como todo deploy troca o nome dos arquivos, a tela ainda não aberta
 * desde a última publicação quebrava sem sinal. Depois de entrar, os papéis
 * internos baixam as telas que podem abrir, uma por vez e sem pressa, e o
 * cache das rotas (`dute-route-chunks`, vite.config.ts) as guarda. O custo é
 * baixar alguns MB a cada publicação; o cliente não baixa nada.
 */

type Modulo<T> = { default: T };

export interface Guardavel {
  /** Baixa o arquivo da tela e o que ele importa, sem abrir a tela. */
  guardar: () => Promise<void>;
}

export type TelaSobDemanda<T extends ComponentType<any>> = LazyExoticComponent<T> & Guardavel;

/** Toda tela sob demanda criada até agora, também as de dentro de outra tela (as abas do Faturamento). */
const criadas = new Set<Guardavel>();

/**
 * O `lazy` do React com o `guardar`: a tela e quem a guarda dividem o mesmo
 * import, então a tela guardada abre sem baixar de novo. O import que falha
 * (sem sinal) não fica preso: a próxima vez tenta de novo.
 */
export function telaSobDemanda<T extends ComponentType<any>>(carregar: () => Promise<Modulo<T>>): TelaSobDemanda<T> {
  let promessa: Promise<Modulo<T>> | null = null;
  const buscar = () => {
    promessa ??= carregar().catch((erro: unknown) => {
      promessa = null;
      throw erro;
    });
    return promessa;
  };
  const tela = Object.assign(lazy(buscar), { guardar: () => buscar().then(() => undefined) });
  criadas.add(tela);
  return tela;
}

/** Tem o `guardar` (as rotas que só redirecionam não têm). */
export function guardavel(componente: unknown): componente is Guardavel {
  return (
    (typeof componente === "object" || typeof componente === "function") &&
    componente !== null &&
    typeof (componente as Partial<Guardavel>).guardar === "function"
  );
}

export interface RotaGuardavel {
  path: string;
  component: unknown;
  appRoles: readonly AppRole[];
  profileRoles: readonly ProfileRole[];
}

/** As telas que este papel abre, pela mesma porta do `RoleGate`. Cliente e papel nenhum: nenhuma. */
export function telasDoPapel(rotas: readonly RotaGuardavel[], papel: ProfileRole | null | undefined): Guardavel[] {
  if (appRoleForProfile(papel) !== "interno") return [];
  const telas = new Set<Guardavel>();
  for (const rota of rotas) {
    if (!rota.appRoles.includes("interno")) continue;
    if (!canAccessModule(papel, [...rota.profileRoles])) continue;
    if (guardavel(rota.component)) telas.add(rota.component);
  }
  return [...telas];
}

export interface OpcoesDaGuarda {
  /** As telas sob demanda das rotas (todas), para reconhecer as de dentro de uma tela guardada. */
  rotas?: Iterable<unknown>;
  /** A pausa entre uma tela e outra, para não disputar com a tela aberta. */
  pausa?: () => Promise<void>;
  /** Para no meio (a pessoa saiu, a rede caiu). */
  parar?: () => boolean;
}

export interface ResultadoDaGuarda {
  guardadas: number;
  falhas: number;
  interrompida: boolean;
}

/**
 * Guarda as telas uma por vez. As telas de dentro das guardadas (as abas do
 * Faturamento e do Catálogo, o painel antigo do agente) nascem quando o
 * arquivo da tela de fora chega, e entram na fila em seguida.
 */
export async function guardarTelas(telas: Iterable<Guardavel>, opcoes: OpcoesDaGuarda = {}): Promise<ResultadoDaGuarda> {
  const dasRotas = new Set(opcoes.rotas ?? []);
  const feitas = new Set<Guardavel>();
  const resultado: ResultadoDaGuarda = { guardadas: 0, falhas: 0, interrompida: false };
  let fila = [...telas];
  while (fila.length > 0) {
    for (const tela of fila) {
      if (feitas.has(tela)) continue;
      if (opcoes.parar?.()) {
        resultado.interrompida = true;
        return resultado;
      }
      feitas.add(tela);
      if (opcoes.pausa) await opcoes.pausa();
      try {
        await tela.guardar();
        resultado.guardadas += 1;
      } catch {
        resultado.falhas += 1;
      }
    }
    fila = [...criadas].filter((tela) => !feitas.has(tela) && !dasRotas.has(tela));
  }
  return resultado;
}

const CHAVE = "dute.telas-no-aparelho";

type Armazenamento = Pick<Storage, "getItem" | "setItem">;

function armazenamentoDoAparelho(): Armazenamento | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** A versão e o papel cujas telas já estão no aparelho. */
export function marcaDaGuarda(papel: ProfileRole, versao: string = BUILD_COMMIT): string {
  return `${versao}|${papel}`;
}

export function guardaFeita(papel: ProfileRole, armazenamento = armazenamentoDoAparelho(), versao = BUILD_COMMIT): boolean {
  try {
    return armazenamento?.getItem(CHAVE) === marcaDaGuarda(papel, versao);
  } catch {
    return false;
  }
}

function marcarGuarda(papel: ProfileRole, armazenamento = armazenamentoDoAparelho(), versao = BUILD_COMMIT): void {
  try {
    armazenamento?.setItem(CHAVE, marcaDaGuarda(papel, versao));
  } catch {
    // Sem storage: na próxima entrada guarda de novo, e o cache já tem quase tudo.
  }
}

/** Quanto esperar depois de entrar: a tela aberta e as leituras dela vêm primeiro. */
export const ESPERA_PARA_GUARDAR_MS = 5_000;
/** O intervalo entre uma tela e a seguinte. */
export const PAUSA_ENTRE_TELAS_MS = 150;

function semDadosMoveis(): boolean {
  const conexao = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return conexao?.saveData === true;
}

function esperarOcioso(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const ocioso = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
        .requestIdleCallback;
      if (ocioso) ocioso(() => resolve(), { timeout: 2_000 });
      else resolve();
    }, ms);
  });
}

/**
 * Agenda a guarda das telas deste papel, uma vez por versão do app. Não
 * guarda sem rede, com a economia de dados ligada nem no desenvolvimento.
 * Devolve quem cancela.
 */
export function agendarGuardaDasTelas(papel: ProfileRole, telas: Guardavel[], rotas: Iterable<unknown>): () => void {
  if (import.meta.env.DEV || telas.length === 0) return () => undefined;
  if (guardaFeita(papel) || navigator.onLine === false || semDadosMoveis()) return () => undefined;
  let cancelada = false;
  const inicio = setTimeout(() => {
    void guardarTelas(telas, {
      rotas,
      pausa: () => esperarOcioso(PAUSA_ENTRE_TELAS_MS),
      parar: () => cancelada || navigator.onLine === false,
    }).then((resultado) => {
      if (!resultado.interrompida && resultado.falhas === 0) marcarGuarda(papel);
    });
  }, ESPERA_PARA_GUARDAR_MS);
  return () => {
    cancelada = true;
    clearTimeout(inicio);
  };
}
