import { lazy, type ComponentType, type LazyExoticComponent } from "react";

import { BUILD_COMMIT } from "./build-info";
import { appRoleForProfile, canAccessModule, type AppRole, type ProfileRole } from "./modules";

/**
 * As telas da equipe guardadas no aparelho (docs/plataforma/diagnostico-
 * carregamento.md, 9.3, PR 2 do celular, e decisão 3 de 06/11/2026). O
 * service worker guarda só o shell, e cada tela entra no cache na primeira
 * visita; como todo deploy troca o nome dos arquivos, a tela ainda não aberta
 * desde a última publicação quebrava sem sinal. Depois de entrar, os papéis
 * internos baixam os arquivos das telas que podem abrir, um por vez e sem
 * pressa, e o cache das rotas (`dute-route-chunks`, vite.config.ts) os guarda.
 * O custo é baixar alguns MB a cada publicação; o cliente não baixa nada.
 *
 * A guarda só baixa: nunca importa a tela. O import que falha fica guardado
 * no mapa de módulos do navegador até a página recarregar, e a tela aberta
 * depois, já com sinal, cairia em "Sem conexão." sem pedir o arquivo de novo.
 * Quem diz quais arquivos cada tela usa é o mapa do build
 * (`telas-no-aparelho.json`, gerado por telas-no-aparelho-no-build.ts).
 */

type Modulo<T> = { default: T };

export interface Guardavel {
  /**
   * O arquivo da tela a partir de `src`, sem a extensão ("pages/billing-hub"):
   * a chave dela no mapa do build. É o mesmo caminho do `import()`.
   */
  arquivo: string;
}

export type TelaSobDemanda<T extends ComponentType<any>> = LazyExoticComponent<T> & Guardavel;

/** A guarda que está baixando agora: sai da frente quando uma tela abre. */
let baixandoAgora: AbortController | null = null;

/**
 * Uma tela vai abrir: a guarda larga o arquivo que baixava. Um pedido parado
 * (sinal ruim que não fecha a conexão) segura o mesmo arquivo para quem o pede
 * depois, até 20 s no Chromium; largado, a tela pede o dela na hora.
 */
export function abrindoUmaTela(): void {
  baixandoAgora?.abort();
}

/** De cada import de tela que falhou, quando ele começou: a espera continua no mesmo relógio. */
const inicioDaFalha = new WeakMap<object, number>();

/**
 * Quando começou o carregamento da tela que falhou com este erro
 * (`performance.now()`), para a `ChunkErrorBoundary` seguir o relógio da
 * espera que já estava na tela enquanto confere o que houve.
 */
export function inicioDoCarregamento(erro: unknown): number | undefined {
  return typeof erro === "object" && erro !== null ? inicioDaFalha.get(erro) : undefined;
}

/**
 * O `lazy` do React com o arquivo da tela, para a guarda saber o que baixar.
 * `arquivo` é o caminho do `import()` a partir de `src`, sem a extensão.
 */
export function telaSobDemanda<T extends ComponentType<any>>(
  arquivo: string,
  carregar: () => Promise<Modulo<T>>,
): TelaSobDemanda<T> {
  const tela = lazy(() => {
    abrindoUmaTela();
    const inicio = performance.now();
    return carregar().catch((erro: unknown) => {
      if (typeof erro === "object" && erro !== null) inicioDaFalha.set(erro, inicio);
      throw erro;
    });
  });
  return Object.assign(tela, { arquivo });
}

/** A rota que mostra uma tela sob demanda por um componente próprio (a Qualidade na bancada). */
export function abreATela<C extends object>(componente: C, tela: Guardavel): C & Guardavel {
  return Object.assign(componente, { arquivo: tela.arquivo });
}

/** Tem o arquivo da tela (as rotas que só redirecionam não têm). */
export function guardavel(componente: unknown): componente is Guardavel {
  return (
    (typeof componente === "object" || typeof componente === "function") &&
    componente !== null &&
    typeof (componente as Partial<Guardavel>).arquivo === "string"
  );
}

export interface RotaGuardavel {
  path: string;
  component: unknown;
  appRoles: readonly AppRole[];
  profileRoles: readonly ProfileRole[];
}

/**
 * Os arquivos das telas que este papel abre, pela mesma porta do `RoleGate`:
 * as rotas recebidas (só as que existem neste ambiente) e as telas sem rota
 * própria (`extras`, como a Entrada). Cliente e papel nenhum: nenhuma.
 */
export function telasDoPapel(
  rotas: readonly RotaGuardavel[],
  papel: ProfileRole | null | undefined,
  extras: readonly Guardavel[] = [],
): string[] {
  if (appRoleForProfile(papel) !== "interno") return [];
  const telas = new Set<string>();
  for (const rota of rotas) {
    if (!rota.appRoles.includes("interno")) continue;
    if (!canAccessModule(papel, [...rota.profileRoles])) continue;
    if (guardavel(rota.component)) telas.add(rota.component.arquivo);
  }
  for (const extra of extras) telas.add(extra.arquivo);
  return [...telas];
}

/** O mapa do build: de cada tela, os arquivos que ela usa e as telas de dentro dela (as abas do Faturamento). */
export interface MapaDasTelas {
  versao: string;
  telas: Record<string, { arquivos: string[]; dentro: string[] }>;
}

/** O endereço do mapa, publicado com o app; muda a cada versão e nunca vai para o cache do service worker. */
export const MAPA_DAS_TELAS = "telas-no-aparelho.json";

/** Os arquivos destas telas e das de dentro delas, sem repetir, na ordem das telas. */
export function arquivosDasTelas(mapa: MapaDasTelas, telas: Iterable<string>): string[] {
  const vistas = new Set<string>();
  const arquivos = new Set<string>();
  const fila = [...telas];
  while (fila.length > 0) {
    const tela = fila.shift()!;
    if (vistas.has(tela)) continue;
    vistas.add(tela);
    const doMapa = mapa.telas[tela];
    if (!doMapa) continue;
    for (const arquivo of doMapa.arquivos) arquivos.add(arquivo);
    fila.push(...doMapa.dentro);
  }
  return [...arquivos];
}

export interface OpcoesDaGuarda {
  /** Baixa um arquivo inteiro, sem executar nada; o sinal larga o pedido. */
  baixar: (arquivo: string, sinal: AbortSignal) => Promise<void>;
  /** A pausa entre um arquivo e outro, para não disputar com a tela aberta. */
  pausa?: () => Promise<void>;
  /** Para no meio (a pessoa saiu, a rede caiu). */
  parar?: () => boolean;
  /** O mais que um arquivo espera; depois, o pedido é largado e conta como falha. */
  prazoMs?: number;
}

export interface ResultadoDaGuarda {
  guardados: number;
  falhas: number;
  interrompida: boolean;
}

/** O mais que um arquivo da guarda espera. */
export const PRAZO_DO_ARQUIVO_MS = 30_000;

/**
 * Baixa os arquivos um por vez. O que falha, ou que uma tela aberta faz largar,
 * conta como falha, e a guarda segue: a marca só sai sem falha nenhuma.
 */
export async function guardarArquivos(arquivos: Iterable<string>, opcoes: OpcoesDaGuarda): Promise<ResultadoDaGuarda> {
  const resultado: ResultadoDaGuarda = { guardados: 0, falhas: 0, interrompida: false };
  for (const arquivo of arquivos) {
    if (opcoes.parar?.()) {
      resultado.interrompida = true;
      return resultado;
    }
    if (opcoes.pausa) await opcoes.pausa();
    if (opcoes.parar?.()) {
      resultado.interrompida = true;
      return resultado;
    }
    const controle = new AbortController();
    const prazo = setTimeout(() => controle.abort(), opcoes.prazoMs ?? PRAZO_DO_ARQUIVO_MS);
    baixandoAgora = controle;
    try {
      await opcoes.baixar(arquivo, controle.signal);
      resultado.guardados += 1;
    } catch {
      resultado.falhas += 1;
    } finally {
      clearTimeout(prazo);
      if (baixandoAgora === controle) baixandoAgora = null;
    }
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
/** O intervalo entre um arquivo e o seguinte. */
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

const endereco = (arquivo: string) => `${import.meta.env.BASE_URL}${arquivo}`;

/** O mapa desta versão, sem cache; nulo se não veio ou é de outra versão (saiu uma publicação no meio). */
async function lerMapa(): Promise<MapaDasTelas | null> {
  try {
    const resposta = await fetch(endereco(MAPA_DAS_TELAS), { cache: "no-store" });
    if (!resposta.ok) return null;
    const mapa = (await resposta.json()) as Partial<MapaDasTelas>;
    if (mapa.versao !== BUILD_COMMIT || typeof mapa.telas !== "object" || mapa.telas === null) return null;
    return mapa as MapaDasTelas;
  } catch {
    return null;
  }
}

/** Baixa o arquivo inteiro pelo service worker, que o guarda em `dute-route-chunks`; nada é executado. */
async function baixarDoServidor(arquivo: string, sinal: AbortSignal): Promise<void> {
  const resposta = await fetch(endereco(arquivo), { signal: sinal, credentials: "same-origin" });
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  await resposta.arrayBuffer();
}

/**
 * Agenda a guarda das telas deste papel, uma vez por versão do app. Não
 * guarda sem rede, com a economia de dados ligada nem no desenvolvimento.
 * Devolve quem cancela.
 */
export function agendarGuardaDasTelas(papel: ProfileRole, telas: readonly string[]): () => void {
  if (import.meta.env.DEV || telas.length === 0) return () => undefined;
  if (guardaFeita(papel) || navigator.onLine === false || semDadosMoveis()) return () => undefined;
  let cancelada = false;
  const parar = () => cancelada || navigator.onLine === false;
  const inicio = setTimeout(() => {
    void (async () => {
      const mapa = await lerMapa();
      if (!mapa || parar()) return;
      const resultado = await guardarArquivos(arquivosDasTelas(mapa, telas), {
        baixar: baixarDoServidor,
        pausa: () => esperarOcioso(PAUSA_ENTRE_TELAS_MS),
        parar,
      });
      if (!resultado.interrompida && resultado.falhas === 0) marcarGuarda(papel);
    })();
  }, ESPERA_PARA_GUARDAR_MS);
  return () => {
    cancelada = true;
    clearTimeout(inicio);
    baixandoAgora?.abort();
  };
}
