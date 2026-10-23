import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  acaoDoContador,
  gravarUltimo,
  lerEstadoDoContador,
  problemaDoUltimo,
  problemaDoValor,
  type AcaoDoContador,
  type EstadoDoContador,
} from "../domain/contador.js";
import type { ComercialActor } from "../domain/operations.js";
import { podeGravarNoProjeto } from "./projeto.js";

/**
 * Ponto de partida do contador das demandas (parte 6.21 do plano de
 * implantação; `docs/plataforma/comercial-producao.md`).
 *
 *   node functions/comercial/lib/cargas/contador.js --ultimo <n> [--projeto <id>] [--executar]
 *
 * - `--ultimo` é o último número já usado (o da planilha); a próxima demanda
 *   é `ultimo + 1`.
 * - Dry-run por padrão. Sem --projeto, só confere o número; com --projeto,
 *   lê o contador e as demandas e diz o que faria e o que impede.
 * - --executar exige --projeto e grava numa transação que confere tudo de
 *   novo (`gravarUltimo`), com o evento `demand_counter.set`. Mesmo valor
 *   não grava nada. Só onde as cargas gravam (`podeGravarNoProjeto`).
 * - O relatório vai para tmp/comercial/ na raiz do repositório.
 */

export const RAIZ_DO_REPOSITORIO = fileURLToPath(new URL("../../../../", import.meta.url));

export const ATOR_DO_CONTADOR: ComercialActor = { uid: "carga-contador", role: "carga", name: "Contador das demandas" };

const USO = "Uso: node functions/comercial/lib/cargas/contador.js --ultimo <n> [--projeto <id>] [--executar] [--relatorio-dir <pasta>]";

export class ErroDeUso extends Error {}

export type OpcoesContador = { ultimo: number; projeto: string | null; executar: boolean; relatorioDir: string };

/** Lê os argumentos. Erro de uso não lê banco. */
export function lerOpcoes(argv: readonly string[], raiz = RAIZ_DO_REPOSITORIO, env: Record<string, string | undefined> = process.env): OpcoesContador {
  const valores: Record<string, string> = {};
  let executar = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--executar") {
      executar = true;
      continue;
    }
    const match = /^--(ultimo|projeto|relatorio-dir)(?:=(.*))?$/.exec(arg);
    if (!match) throw new ErroDeUso(`Argumento desconhecido: ${arg}.`);
    const value = match[2] ?? argv[(index += 1)];
    if (!value || value.startsWith("--")) throw new ErroDeUso(`--${match[1]} precisa de um valor.`);
    valores[match[1]] = value.trim();
  }
  if (!valores.ultimo) throw new ErroDeUso("--ultimo é obrigatório: o último número já usado.");
  if (!/^\d+$/.test(valores.ultimo)) throw new ErroDeUso("--ultimo é um número inteiro, sem ponto nem espaço.");
  const ultimo = Number(valores.ultimo);
  const problema = problemaDoValor(ultimo);
  if (problema) throw new ErroDeUso(problema);
  const projeto = valores.projeto || null;
  if (executar && !projeto) {
    throw new ErroDeUso("--projeto é obrigatório com --executar. Rode antes sem --executar (dry-run) e confira o relatório.");
  }
  if (executar && projeto) {
    const recusa = podeGravarNoProjeto(projeto, env);
    if (recusa) throw new ErroDeUso(recusa);
  }
  return { ultimo, projeto, executar, relatorioDir: resolve(valores["relatorio-dir"] ?? join(resolve(raiz), "tmp", "comercial")) };
}

export type RelatorioDoContador = {
  carga: "contador";
  modo: "dry-run" | "executar";
  projeto: string | null;
  gerado_em: string;
  ultimo: number;
  proxima: number;
  atual: number | null;
  maior_demanda: number | null;
  acao: AcaoDoContador | null;
  problema: string | null;
  evento: string | null;
  erro: string | null;
};

export type DependenciasContador = {
  /** Banco já aberto (testes). Sem ele, a ferramenta abre o do --projeto. */
  db?: Firestore;
  agora?: () => Date;
  log?: (linha: string) => void;
};

export type ResultadoContador = { codigo: number; relatorio: string | null; conteudo: RelatorioDoContador | null };

/**
 * Roda a ferramenta. Código 0: tudo certo; 1: o banco impede ou a gravação
 * falhou (o relatório diz qual); 2: erro de uso, sem ler nada.
 */
export async function main(argv: readonly string[], deps: DependenciasContador = {}): Promise<ResultadoContador> {
  const log = deps.log ?? ((linha: string) => console.log(linha));
  const agora = deps.agora ?? (() => new Date());

  let opcoes: OpcoesContador;
  try {
    opcoes = lerOpcoes(argv);
  } catch (error) {
    if (!(error instanceof ErroDeUso)) throw error;
    log(error.message);
    log(USO);
    return { codigo: 2, relatorio: null, conteudo: null };
  }

  const modo = opcoes.executar ? "executar" : "dry-run";
  let estado: EstadoDoContador | null = null;
  let problema: string | null = null;
  let acao: AcaoDoContador | null = null;
  let evento: string | null = null;
  let erro: string | null = null;

  if (opcoes.projeto) {
    const app = deps.db ? null : initializeApp({ projectId: opcoes.projeto }, `contador-${Date.now()}`);
    const db = deps.db ?? getFirestore(app!);
    try {
      estado = await lerEstadoDoContador(db);
      problema = problemaDoUltimo(opcoes.ultimo, estado);
      acao = problema ? null : acaoDoContador(opcoes.ultimo, estado);
      if (opcoes.executar && !problema) {
        try {
          const feito = await gravarUltimo(db, opcoes.ultimo, ATOR_DO_CONTADOR, agora());
          acao = feito.acao;
          evento = feito.evento;
          estado = { ...estado, atual: feito.anterior };
        } catch (error) {
          erro = error instanceof Error ? error.message : String(error);
        }
      }
    } finally {
      if (app) await deleteApp(app);
    }
  }

  const conteudo: RelatorioDoContador = {
    carga: "contador",
    modo,
    projeto: opcoes.projeto,
    gerado_em: agora().toISOString(),
    ultimo: opcoes.ultimo,
    proxima: opcoes.ultimo + 1,
    atual: estado?.atual ?? null,
    maior_demanda: estado?.maiorDemanda ?? null,
    acao,
    problema,
    evento,
    erro,
  };
  mkdirSync(opcoes.relatorioDir, { recursive: true });
  const carimbo = conteudo.gerado_em.replace(/[:.]/g, "-");
  const relatorio = join(opcoes.relatorioDir, `contador-${modo}-${opcoes.projeto ?? "sem-projeto"}-${carimbo}.json`);
  writeFileSync(relatorio, `${JSON.stringify(conteudo, null, 2)}\n`, "utf8");

  log(`Último número: ${conteudo.ultimo} (a próxima demanda é a ${conteudo.proxima}).`);
  if (estado) log(`Hoje o contador guarda ${estado.atual ?? "nada (a próxima seria a 10001)"}; maior demanda: ${estado.maiorDemanda ?? "nenhuma"}.`);
  if (problema) log(`Problema: ${problema}`);
  if (erro) log(`Erro: ${erro}`);
  if (!opcoes.projeto) log("Dry-run sem --projeto: só o número foi conferido. Com --projeto, a ferramenta compara com o banco.");
  else if (!opcoes.executar && acao) log(`Dry-run: nada foi gravado (${acao === "gravar" ? "gravaria" : "já está assim"}). Para gravar, repita com --executar.`);
  else if (opcoes.executar && acao) log(acao === "gravar" ? `Gravado, com o evento ${evento}.` : "Já estava assim: nada foi gravado.");
  log(`Relatório: ${relatorio}`);

  return { codigo: problema || erro ? 1 : 0, relatorio, conteudo };
}

const executadoDireto = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (executadoDireto) {
  main(process.argv.slice(2)).then(
    ({ codigo }) => {
      process.exitCode = codigo;
    },
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
