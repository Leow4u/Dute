import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";

import {
  ADITIVOS_SUBCOLLECTION,
  ADITIVO_DADOS,
  CONTRACTS_COLLECTION,
  CONTRATO_DADOS,
  CUSTOMERS_COLLECTION,
  ID_DOCUMENTO,
  PRICE_TABLES_COLLECTION,
  aditivoDocId,
  camposAlterados,
  problemaDoCadastro,
  problemaDoIdDoContrato,
  registrarAditivo,
  salvarContrato,
  vigenciaComAditivo,
  type AditivoDados,
  type ContratoDados,
  type Vigencia,
} from "../domain/contratos.js";
import { podeGravarNoProjeto } from "./projeto.js";
import { canonical, digest, type ComercialActor } from "../domain/operations.js";

/**
 * Carga de contratos e aditivos (docs/plataforma/comercial-cargas.md, parte 8).
 *
 *   node functions/comercial/lib/cargas/contratos.js --arquivo <json> [--projeto <id>] [--executar]
 *
 * - Lê um JSON fora do repositório (tmp/ e .secrets/, que o git ignora,
 *   também servem) e valida com as mesmas regras das callables.
 * - Dry-run por padrão. Sem --projeto, só valida o arquivo; com --projeto,
 *   lê o banco e diz o que faria (criar, atualizar, sem mudança; aditivo a
 *   registrar ou já registrado) e o que impede (prospect, tabela de outro
 *   contrato, aditivo registrado com outro conteúdo).
 * - --executar exige --projeto, e só grava onde o Comercial está liberado
 *   (ou no emulador, projeto demo-*). Grava pelas mesmas operações das
 *   callables (salvarContrato e registrarAditivo): recibo, evento e
 *   conferência na transação. Rodar de novo o mesmo arquivo não muda nada,
 *   nem desfaz o aditivo registrado depois pela tela.
 * - O relatório vai para tmp/comercial/ na raiz do repositório.
 */

/** Raiz do repositório, a partir de functions/comercial/lib/cargas/. */
export const RAIZ_DO_REPOSITORIO = fileURLToPath(new URL("../../../../", import.meta.url));

/** Quem grava na carga: aparece no recibo e no evento. */
export const ATOR_DA_CARGA: ComercialActor = { uid: "carga-contratos", role: "carga", name: "Carga de contratos" };

/** Pastas do repositório que o git ignora e que podem guardar o JSON. */
const PASTAS_IGNORADAS = ["tmp", ".secrets"];

const USO =
  "Uso: node functions/comercial/lib/cargas/contratos.js --arquivo <json> [--projeto <id>] [--executar] [--relatorio-dir <pasta>]";

export class ErroDeUso extends Error {}

export type OpcoesCarga = {
  arquivo: string;
  projeto: string | null;
  executar: boolean;
  relatorioDir: string;
};

function dentro(pasta: string, caminho: string): boolean {
  const rel = relative(pasta, caminho);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel));
}

/** Lê os argumentos. Erro de uso não lê arquivo nem banco. */
export function lerOpcoes(
  argv: readonly string[],
  raiz = RAIZ_DO_REPOSITORIO,
  env: Record<string, string | undefined> = process.env,
): OpcoesCarga {
  const valores: Record<string, string> = {};
  let executar = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--executar") {
      executar = true;
      continue;
    }
    const match = /^--(arquivo|projeto|relatorio-dir)(?:=(.*))?$/.exec(arg);
    if (!match) throw new ErroDeUso(`Argumento desconhecido: ${arg}.`);
    const value = match[2] ?? argv[(index += 1)];
    if (!value || value.startsWith("--")) throw new ErroDeUso(`--${match[1]} precisa de um valor.`);
    valores[match[1]] = value.trim();
  }
  if (!valores.arquivo) throw new ErroDeUso("--arquivo é obrigatório.");
  const projeto = valores.projeto || null;
  if (executar && !projeto) {
    throw new ErroDeUso("--projeto é obrigatório com --executar. Rode antes sem --executar (dry-run) e confira o relatório.");
  }
  if (executar && projeto) {
    const recusa = podeGravarNoProjeto(projeto, env);
    if (recusa) throw new ErroDeUso(recusa);
  }
  const arquivo = resolve(valores.arquivo);
  const raizResolvida = resolve(raiz);
  if (dentro(raizResolvida, arquivo) && !PASTAS_IGNORADAS.some((pasta) => dentro(join(raizResolvida, pasta), arquivo))) {
    throw new ErroDeUso("O JSON da carga fica fora do repositório (ou em tmp/, que o git ignora): ele tem dado de contrato.");
  }
  return {
    arquivo,
    projeto,
    executar,
    relatorioDir: resolve(valores["relatorio-dir"] ?? join(raizResolvida, "tmp", "comercial")),
  };
}

// --- Arquivo ---------------------------------------------------------------------

export const CARGA_CONTRATOS = z
  .object({
    contratos: z
      .array(
        z
          .object({ id: ID_DOCUMENTO, contrato: CONTRATO_DADOS, aditivos: z.array(ADITIVO_DADOS).max(100).default([]) })
          .strict(),
      )
      .min(1, "A carga não tem contrato.")
      .max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    value.contratos.forEach((entrada, index) => {
      if (ids.has(entrada.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["contratos", index, "id"], message: `Contrato ${entrada.id} repetido.` });
      }
      ids.add(entrada.id);
      const problemaDoId = problemaDoIdDoContrato(entrada.id, entrada.contrato.numeros);
      if (problemaDoId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["contratos", index, "id"], message: problemaDoId });
      const numeros = new Set<number>();
      entrada.aditivos.forEach((aditivo, aditivoIndex) => {
        if (numeros.has(aditivo.numero)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["contratos", index, "aditivos", aditivoIndex, "numero"],
            message: `Aditivo ${aditivo.numero} repetido no contrato ${entrada.id}.`,
          });
        }
        numeros.add(aditivo.numero);
      });
    });
  });

export type CargaContratos = z.output<typeof CARGA_CONTRATOS>;
type EntradaCarga = CargaContratos["contratos"][number];

/** Lê e valida o arquivo. Os problemas saem com o caminho do campo. */
export function lerCarga(caminho: string): { carga: CargaContratos | null; problemas: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(caminho, "utf8").replace(/^﻿/, ""));
  } catch (error) {
    return { carga: null, problemas: [`Não consegui ler o JSON: ${(error as Error).message}`] };
  }
  const parsed = CARGA_CONTRATOS.safeParse(json);
  if (parsed.success) return { carga: parsed.data, problemas: [] };
  return {
    carga: null,
    problemas: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`),
  };
}

// --- Banco ---------------------------------------------------------------------------

export type Banco = {
  contratos: Map<string, { dados: DocumentData; aditivos: Map<string, DocumentData> } | null>;
  cadastros: Map<string, DocumentData[]>;
  tabelas: Map<string, DocumentData | null>;
};

/** Lê só o que a carga toca: os contratos e aditivos dela, os cadastros e as tabelas citadas. */
export async function lerBanco(db: Firestore, carga: CargaContratos): Promise<Banco> {
  const banco: Banco = { contratos: new Map(), cadastros: new Map(), tabelas: new Map() };
  for (const entrada of carga.contratos) {
    const ref = db.collection(CONTRACTS_COLLECTION).doc(entrada.id);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      banco.contratos.set(entrada.id, null);
    } else {
      const aditivos = await ref.collection(ADITIVOS_SUBCOLLECTION).get();
      banco.contratos.set(entrada.id, {
        dados: snapshot.data() ?? {},
        aditivos: new Map(aditivos.docs.map((doc) => [doc.id, doc.data()])),
      });
    }
    const code = entrada.contrato.customer_code;
    if (!banco.cadastros.has(code)) {
      const customers = db.collection(CUSTOMERS_COLLECTION);
      const [byCode, byCustomerCode] = await Promise.all([
        customers.where("code", "==", code).get(),
        customers.where("customer_code", "==", code).get(),
      ]);
      const registros = new Map<string, DocumentData>();
      for (const row of [...byCode.docs, ...byCustomerCode.docs]) registros.set(row.id, row.data());
      banco.cadastros.set(code, [...registros.values()]);
    }
    for (const aditivo of entrada.aditivos) {
      for (const id of aditivo.tabela_ids) {
        if (banco.tabelas.has(id)) continue;
        const tabela = await db.collection(PRICE_TABLES_COLLECTION).doc(id).get();
        banco.tabelas.set(id, tabela.exists ? tabela.data() ?? {} : null);
      }
    }
  }
  return banco;
}

// --- Plano ---------------------------------------------------------------------------

export type AcaoContrato = "criar" | "atualizar" | "sem_mudanca" | "a_conferir";
export type AcaoAditivo = "registrar" | "ja_registrado" | "a_conferir";

export type ItemAditivo = {
  numero: number;
  aditivo_id: string;
  tipo: AditivoDados["tipo"];
  acao: AcaoAditivo;
  problemas: string[];
  resultado?: Record<string, unknown>;
  erro?: string;
};

export type ItemContrato = {
  id: string;
  customer_code: string;
  acao: AcaoContrato;
  campos: string[];
  problemas: string[];
  aditivos: ItemAditivo[];
  resultado?: Record<string, unknown>;
  erro?: string;
};

type Plano = { item: ItemContrato; entrada: EntradaCarga; esperado: ContratoDados; edicao: number | null };

const CAMPOS_DO_ADITIVO = ["numero", "assinado_em", "tipo", "vigente_de", "vigente_ate", "tabela_ids", "documento", "observacao"] as const;

function mesmoAditivo(gravado: DocumentData, aditivo: AditivoDados): boolean {
  return CAMPOS_DO_ADITIVO.every(
    (campo) => JSON.stringify(canonical(gravado[campo] ?? null)) === JSON.stringify(canonical(aditivo[campo] ?? null)),
  );
}

function planejarContrato(entrada: EntradaCarga, banco: Banco | null): Plano {
  const aditivosEmOrdem = [...entrada.aditivos].sort((a, b) => a.numero - b.numero);
  const item: ItemContrato = {
    id: entrada.id,
    customer_code: entrada.contrato.customer_code,
    acao: "a_conferir",
    campos: [],
    problemas: [],
    aditivos: aditivosEmOrdem.map((aditivo) => ({
      numero: aditivo.numero,
      aditivo_id: aditivoDocId(aditivo.numero),
      tipo: aditivo.tipo,
      acao: "a_conferir" as AcaoAditivo,
      problemas: [],
    })),
  };
  if (!banco) return { item, entrada, esperado: entrada.contrato, edicao: null };

  const atual = banco.contratos.get(entrada.id) ?? null;
  const code = entrada.contrato.customer_code;
  const problemaCadastro = problemaDoCadastro(code, banco.cadastros.get(code) ?? [], atual === null);
  if (problemaCadastro) item.problemas.push(problemaCadastro);
  if (atual && atual.dados.customer_code !== code) {
    item.problemas.push(`O contrato ${entrada.id} já é de ${String(atual.dados.customer_code)}: o cliente do contrato não muda.`);
  }

  for (const [index, aditivo] of aditivosEmOrdem.entries()) {
    const destino = item.aditivos[index];
    const gravado = atual?.aditivos.get(destino.aditivo_id);
    if (gravado) {
      destino.acao = "ja_registrado";
      if (!mesmoAditivo(gravado, aditivo)) {
        destino.problemas.push(`O aditivo ${destino.aditivo_id} já está registrado com outro conteúdo: aditivo não se altera.`);
      }
      continue;
    }
    destino.acao = "registrar";
    for (const id of aditivo.tabela_ids) {
      const tabela = banco.tabelas.get(id) ?? null;
      if (!tabela) destino.problemas.push(`Tabela ${id} não encontrada: carregue a tabela antes do aditivo.`);
      else if (tabela.customer_code !== code || tabela.contract_id !== entrada.id) {
        destino.problemas.push(`A tabela ${id} não é deste contrato.`);
      }
    }
  }

  // A vigência gravada é a do arquivo prorrogada pelos aditivos já
  // registrados, estejam ou não no arquivo (o registrado pela tela também
  // vale). No contrato encerrado, o aditivo entra só no histórico
  // (registrarAditivo): por isso os aditivos que a carga vai registrar nele
  // já entram aqui, e a vigência vai pelo próprio contrato.
  const prorrogam: Array<Pick<AditivoDados, "numero" | "tipo" | "vigente_de" | "vigente_ate">> = [];
  for (const gravado of atual?.aditivos.values() ?? []) {
    prorrogam.push({
      numero: Number(gravado.numero),
      tipo: gravado.tipo,
      vigente_de: gravado.vigente_de ?? null,
      vigente_ate: gravado.vigente_ate ?? null,
    });
  }
  if (entrada.contrato.status === "encerrado") {
    aditivosEmOrdem.forEach((aditivo, index) => {
      const destino = item.aditivos[index];
      if (destino.acao === "registrar" && destino.problemas.length === 0) prorrogam.push(aditivo);
    });
  }
  const vigencia = prorrogam
    .sort((a, b) => a.numero - b.numero)
    .reduce<Vigencia>((atualizada, aditivo) => vigenciaComAditivo(atualizada, aditivo), {
      de: entrada.contrato.vigente_de,
      ate: entrada.contrato.vigente_ate,
    });

  const esperado: ContratoDados = { ...entrada.contrato, vigente_de: vigencia.de, vigente_ate: vigencia.ate };
  if (!atual) {
    item.acao = "criar";
    return { item, entrada, esperado, edicao: null };
  }
  item.campos = camposAlterados(atual.dados, esperado);
  item.acao = item.campos.length ? "atualizar" : "sem_mudanca";
  return { item, entrada, esperado, edicao: Number(atual.dados.edicao) };
}

function temProblema(item: ItemContrato): boolean {
  return item.problemas.length > 0 || item.aditivos.some((aditivo) => aditivo.problemas.length > 0);
}

// --- Execução ------------------------------------------------------------------------

async function executarContrato(db: Firestore, plano: Plano, ator: ComercialActor): Promise<void> {
  const { item, entrada, esperado, edicao } = plano;
  try {
    if (item.acao === "criar") {
      item.resultado = await salvarContrato(db, ator, {
        idempotency_key: `carga-contratos:${entrada.id}:criar:${digest(esperado)}`,
        acao: "criar",
        contrato_id: entrada.id,
        contrato: esperado,
      });
    } else if (item.acao === "atualizar") {
      item.resultado = await salvarContrato(db, ator, {
        idempotency_key: `carga-contratos:${entrada.id}:atualizar:${edicao}:${digest(esperado)}`,
        acao: "atualizar",
        contrato_id: entrada.id,
        edicao,
        contrato: esperado,
      });
    }
  } catch (error) {
    item.erro = (error as Error).message;
    return;
  }
  const aditivos = [...entrada.aditivos].sort((a, b) => a.numero - b.numero);
  for (const [index, aditivo] of aditivos.entries()) {
    const destino = item.aditivos[index];
    if (destino.acao !== "registrar" || destino.problemas.length > 0) continue;
    try {
      destino.resultado = await registrarAditivo(db, ator, {
        idempotency_key: `carga-contratos:${entrada.id}:aditivo:${destino.aditivo_id}:${digest(aditivo)}`,
        contrato_id: entrada.id,
        aditivo,
      });
    } catch (error) {
      destino.erro = (error as Error).message;
      return;
    }
  }
}

// --- Relatório e entrada -------------------------------------------------------------

export type Relatorio = {
  carga: "contratos";
  modo: "dry-run" | "executar";
  projeto: string | null;
  arquivo: string;
  gerado_em: string;
  resumo: Record<string, number>;
  invalido: string[];
  contratos: ItemContrato[];
};

function resumo(itens: readonly ItemContrato[], invalido: readonly string[]): Record<string, number> {
  const contar = (filtro: (item: ItemContrato) => boolean) => itens.filter(filtro).length;
  const aditivos = itens.flatMap((item) => item.aditivos);
  return {
    contratos: itens.length,
    criar: contar((item) => item.acao === "criar"),
    atualizar: contar((item) => item.acao === "atualizar"),
    sem_mudanca: contar((item) => item.acao === "sem_mudanca"),
    a_conferir: contar((item) => item.acao === "a_conferir"),
    aditivos: aditivos.length,
    aditivos_registrar: aditivos.filter((aditivo) => aditivo.acao === "registrar").length,
    aditivos_ja_registrados: aditivos.filter((aditivo) => aditivo.acao === "ja_registrado").length,
    com_problema: contar(temProblema),
    com_erro: contar((item) => Boolean(item.erro) || item.aditivos.some((aditivo) => Boolean(aditivo.erro))),
    invalido: invalido.length,
  };
}

export type DependenciasCarga = {
  /** Banco já aberto (testes). Sem ele, a carga abre o do --projeto. */
  db?: Firestore;
  agora?: () => Date;
  log?: (linha: string) => void;
};

export type ResultadoCarga = { codigo: number; relatorio: string | null; conteudo: Relatorio | null };

/**
 * Roda a carga. Código 0: tudo certo; 1: arquivo inválido, problema no plano
 * ou erro ao gravar (o relatório diz qual); 2: erro de uso, sem ler nada.
 */
export async function main(argv: readonly string[], deps: DependenciasCarga = {}): Promise<ResultadoCarga> {
  const log = deps.log ?? ((linha: string) => console.log(linha));
  const agora = deps.agora ?? (() => new Date());

  let opcoes: OpcoesCarga;
  try {
    opcoes = lerOpcoes(argv);
  } catch (error) {
    if (!(error instanceof ErroDeUso)) throw error;
    log(error.message);
    log(USO);
    return { codigo: 2, relatorio: null, conteudo: null };
  }

  const modo = opcoes.executar ? "executar" : "dry-run";
  const { carga, problemas: invalido } = lerCarga(opcoes.arquivo);
  let itens: ItemContrato[] = [];

  if (carga) {
    let db = deps.db;
    const app = !db && opcoes.projeto ? initializeApp({ projectId: opcoes.projeto }, `carga-contratos-${agora().getTime()}`) : null;
    if (app) db = getFirestore(app);
    try {
      const banco = db && opcoes.projeto ? await lerBanco(db, carga) : null;
      const planos = carga.contratos.map((entrada) => planejarContrato(entrada, banco));
      itens = planos.map((plano) => plano.item);
      if (opcoes.executar && db) {
        for (const plano of planos) {
          // Problema no contrato deixa o contrato de fora; no aditivo, só o aditivo.
          if (plano.item.problemas.length > 0) continue;
          await executarContrato(db, plano, ATOR_DA_CARGA);
        }
      }
    } finally {
      if (app) await deleteApp(app);
    }
  }

  const conteudo: Relatorio = {
    carga: "contratos",
    modo,
    projeto: opcoes.projeto,
    arquivo: basename(opcoes.arquivo),
    gerado_em: agora().toISOString(),
    resumo: resumo(itens, invalido),
    invalido,
    contratos: itens,
  };
  mkdirSync(opcoes.relatorioDir, { recursive: true });
  const carimbo = conteudo.gerado_em.replace(/[:.]/g, "-");
  const relatorio = join(opcoes.relatorioDir, `contratos-${modo}-${opcoes.projeto ?? "sem-projeto"}-${carimbo}.json`);
  writeFileSync(relatorio, `${JSON.stringify(conteudo, null, 2)}\n`, "utf8");

  for (const problema of invalido) log(`Arquivo inválido: ${problema}`);
  for (const item of itens) {
    const aditivos = item.aditivos.map((aditivo) => `${aditivo.aditivo_id}:${aditivo.acao}`).join(" ");
    const avisos = [...item.problemas, ...item.aditivos.flatMap((aditivo) => aditivo.problemas)];
    const erros = [item.erro, ...item.aditivos.map((aditivo) => aditivo.erro)].filter(Boolean);
    log(`${item.id} (${item.customer_code}): ${item.acao}${item.campos.length ? ` [${item.campos.join(", ")}]` : ""}${aditivos ? `; aditivos ${aditivos}` : ""}`);
    for (const aviso of avisos) log(`  problema: ${aviso}`);
    for (const erro of erros) log(`  erro: ${erro}`);
  }
  if (!opcoes.projeto) log("Dry-run sem --projeto: só o arquivo foi conferido. Com --projeto, a carga compara com o banco.");
  else if (!opcoes.executar) log("Dry-run: nada foi gravado. Para gravar, repita com --executar.");
  log(`Relatório: ${relatorio}`);

  const falhou = invalido.length > 0 || conteudo.resumo.com_problema > 0 || conteudo.resumo.com_erro > 0;
  return { codigo: falhou ? 1 : 0, relatorio, conteudo };
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
