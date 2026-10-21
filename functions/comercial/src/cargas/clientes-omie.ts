import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { CUSTOMERS_COLLECTION, UFS, prospectPayload, type DadosDoProspect } from "../domain/cadastro.js";
import {
  cadastroArquivado,
  canonicalCustomerCode,
  cnpjNormalizado,
  cnpjRoot,
  codigoDoNovoCadastro,
  customerIdentityConflict,
  customerStage,
  entityIdDoCadastro,
  safeDocId,
  sugerirCodigo,
  textoLimpo as text,
  type CustomerStage,
} from "../domain/customer-identity.js";
import { createComercialEvent } from "../domain/events.js";
import { comercialLiberado } from "../domain/liberacao.js";
import { digest, runIdempotent, type ComercialActor } from "../domain/operations.js";
import { ErroDoCsv, celulaCsv, decodificarUtf8, lerCsv } from "./csv.js";

/**
 * Carga dos clientes da Omie no cadastro comercial (docs/plataforma/comercial-cargas.md,
 * parte 13).
 *
 *   node functions/comercial/lib/cargas/clientes-omie.js --clientes <json> --crm <json>
 *     --titulos <json> [--codigos <csv revisado>] [--projeto <id>] [--executar]
 *
 * - Lê os JSON já baixados da Omie (clientes, contas do CRM e contas a
 *   receber), fora do repositório ou em tmp/. Não chama a API da Omie.
 * - Entram as pessoas jurídicas com a tag Cliente e as empresas do CRM, uma
 *   por raiz de CNPJ (as filiais viram um cadastro só). Pessoa física, conta
 *   de teste, fornecedor e contato ficam fora; e-mail, telefone, endereço
 *   completo e observações não são lidos para o cadastro. A conta do CRM sem
 *   CNPJ só entra com um código escrito na revisão.
 * - Quem comprou desde 2024 (título não cancelado, pela raiz do CNPJ) entra
 *   como cliente, desde a primeira compra; o resto, como prospect. O cadastro
 *   que já existe (achado pelos ids da Omie, pela raiz do CNPJ ou pelo código
 *   canônico) só ganha `comercial.omie_ids`: identidade e estágio não mudam. O
 *   cadastro sem CNPJ de nome parecido (a BTG do WMS) deixa a linha a conferir.
 * - Dry-run por padrão: gera o relatório e o CSV de revisão em tmp/comercial/.
 *   As colunas `codigo` e `nome` do CSV revisado voltam com --codigos ("-"
 *   deixa a empresa de fora).
 * - --executar exige --projeto, e só grava onde o Comercial está liberado (ou
 *   no emulador). Grava com as peças das callables do cadastro
 *   (prospectPayload, customerIdentityConflict, runIdempotent e o evento), e
 *   confere de novo, na transação, o estado que o plano leu.
 */

/** Raiz do repositório, a partir de functions/comercial/lib/cargas/. */
export const RAIZ_DO_REPOSITORIO = fileURLToPath(new URL("../../../../", import.meta.url));

/** Quem grava na carga: aparece no cadastro (created_by), no recibo e no evento. */
export const ATOR_DA_CARGA: ComercialActor = { uid: "carga-clientes-omie", role: "carga", name: "Carga de clientes da Omie" };

/** A partir desta data de emissão, um título não cancelado faz da empresa um cliente. */
export const COMPRA_DESDE = "2024-01-01";

/** O nome do cadastro novo, como na callable: de 2 a 120 caracteres. */
const NOME_MIN = 2;
const NOME_MAX = 120;

/** Pastas do repositório que o git ignora e que podem guardar os arquivos. */
const PASTAS_IGNORADAS = ["tmp", ".secrets"];

const USO =
  "Uso: node functions/comercial/lib/cargas/clientes-omie.js --clientes <json> --crm <json> --titulos <json> " +
  "[--codigos <csv revisado>] [--projeto <id>] [--executar] [--relatorio-dir <pasta>]";

export class ErroDeUso extends Error {}

export type OpcoesCarga = {
  clientes: string;
  crm: string;
  titulos: string;
  codigos: string | null;
  projeto: string | null;
  executar: boolean;
  relatorioDir: string;
};

function dentro(pasta: string, caminho: string): boolean {
  const rel = relative(pasta, caminho);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel));
}

const ARQUIVOS = ["clientes", "crm", "titulos"] as const;

/** Lê os argumentos. Erro de uso não lê arquivo nem banco. */
export function lerOpcoes(argv: readonly string[], raiz = RAIZ_DO_REPOSITORIO): OpcoesCarga {
  const valores: Record<string, string> = {};
  let executar = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--executar") {
      executar = true;
      continue;
    }
    const match = /^--(clientes|crm|titulos|codigos|projeto|relatorio-dir)(?:=(.*))?$/.exec(arg);
    if (!match) throw new ErroDeUso(`Argumento desconhecido: ${arg}.`);
    const value = match[2] ?? argv[(index += 1)];
    if (!value || value.startsWith("--")) throw new ErroDeUso(`--${match[1]} precisa de um valor.`);
    if (match[1] in valores) throw new ErroDeUso(`--${match[1]} repetido.`);
    valores[match[1]] = value.trim();
  }
  const projeto = valores.projeto || null;
  if (executar && !projeto) {
    throw new ErroDeUso("--projeto é obrigatório com --executar. Rode antes sem --executar (dry-run) e confira o CSV de revisão.");
  }
  if (executar && projeto && !comercialLiberado(projeto) && !projeto.startsWith("demo-")) {
    throw new ErroDeUso(`O Comercial ainda não está liberado em ${projeto}: a carga não grava lá (domain/liberacao.ts).`);
  }
  for (const nome of ARQUIVOS) {
    if (!valores[nome]) throw new ErroDeUso(`--${nome} é obrigatório.`);
  }
  const raizResolvida = resolve(raiz);
  const arquivo = (nome: string): string => {
    const caminho = resolve(valores[nome]);
    if (dentro(raizResolvida, caminho) && !PASTAS_IGNORADAS.some((pasta) => dentro(join(raizResolvida, pasta), caminho))) {
      throw new ErroDeUso(`--${nome}: o arquivo fica fora do repositório (ou em tmp/, que o git ignora): ele tem dado de cliente.`);
    }
    return caminho;
  };
  return {
    clientes: arquivo("clientes"),
    crm: arquivo("crm"),
    titulos: arquivo("titulos"),
    codigos: valores.codigos ? arquivo("codigos") : null,
    projeto,
    executar,
    relatorioDir: resolve(valores["relatorio-dir"] ?? join(raizResolvida, "tmp", "comercial")),
  };
}

// --- Arquivos da Omie ---------------------------------------------------------------
//
// Os schemas pegam só o que a carga usa: o resto (e-mail, telefone, contato,
// dados bancários, observações, valores) é descartado na leitura.

const textoOmie = z.string().default("");

const CLIENTE_OMIE = z.object({
  codigo_cliente_omie: z.number().int().positive(),
  cnpj_cpf: textoOmie,
  pessoa_fisica: textoOmie,
  razao_social: textoOmie,
  nome_fantasia: textoOmie,
  cidade: textoOmie,
  estado: textoOmie,
  inativo: textoOmie,
  tags: z.array(z.object({ tag: textoOmie })).default([]),
});
export type ClienteOmie = z.output<typeof CLIENTE_OMIE>;

const CONTA_CRM = z.object({
  identificacao: z.object({
    nCod: z.number().int().positive(),
    cNome: textoOmie,
    cNomeFantasia: textoOmie,
    cDoc: textoOmie,
  }),
  endereco: z.object({ cCidade: textoOmie, cUF: textoOmie }).default({}),
});
export type ContaCrm = z.output<typeof CONTA_CRM>;

/** Data da Omie (DD/MM/AAAA) em AAAA-MM-DD, ou null. */
export function dataDaOmie(value: unknown): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text(value));
  if (!match) return null;
  const [, dia, mes, ano] = match;
  const iso = `${ano}-${mes}-${dia}`;
  const data = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== iso ? null : iso;
}

const TITULO_OMIE = z.object({
  codigo_cliente_fornecedor: z.number().int(),
  status_titulo: textoOmie,
  data_emissao: z
    .string()
    .refine((value) => dataDaOmie(value) !== null, "use DD/MM/AAAA.")
    .transform((value) => dataDaOmie(value) as string),
});
export type TituloOmie = z.output<typeof TITULO_OMIE>;

export type FontesOmie = { clientes: ClienteOmie[]; crm: ContaCrm[]; titulos: TituloOmie[] };

const SCHEMAS = {
  clientes: z.array(CLIENTE_OMIE),
  crm: z.array(CONTA_CRM),
  titulos: z.array(TITULO_OMIE),
} as const;

type Leitura = { fontes: FontesOmie | null; problemas: string[] };

/** Valida os três JSON já lidos. Os problemas saem com o arquivo e o caminho do campo, nunca com o valor. */
export function validarFontes(json: { clientes: unknown; crm: unknown; titulos: unknown }): Leitura {
  const problemas: string[] = [];
  const lidos: Record<string, unknown> = {};
  for (const nome of ARQUIVOS) {
    const parsed = SCHEMAS[nome].safeParse(json[nome]);
    if (parsed.success) {
      lidos[nome] = parsed.data;
    } else {
      for (const issue of parsed.error.issues.slice(0, 20)) {
        problemas.push(`${nome}: ${issue.path.join(".") || "(raiz)"}: ${issue.message}`);
      }
    }
  }
  return problemas.length ? { fontes: null, problemas } : { fontes: lidos as FontesOmie, problemas };
}

/** Lê e valida os três JSON baixados da Omie. */
export function lerFontes(caminhos: { clientes: string; crm: string; titulos: string }): Leitura {
  const json: Record<string, unknown> = {};
  const problemas: string[] = [];
  for (const nome of ARQUIVOS) {
    try {
      json[nome] = JSON.parse(readFileSync(caminhos[nome], "utf8").replace(/^﻿/, ""));
    } catch (error) {
      problemas.push(`${nome}: não consegui ler o JSON (${(error as Error).name}).`);
    }
  }
  if (problemas.length) return { fontes: null, problemas };
  return validarFontes(json as { clientes: unknown; crm: unknown; titulos: unknown });
}

// --- O que entra ------------------------------------------------------------------------

function semAcento(value: unknown): string {
  return text(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
}

/** Conta de teste: alguma palavra do nome é "TEST" ou começa por "TESTE" ("Contestel" não é). */
export function contaDeTeste(...nomes: unknown[]): boolean {
  return nomes.some((nome) =>
    semAcento(nome)
      .split(/[^A-Z0-9]+/)
      .some((palavra) => palavra === "TEST" || palavra.startsWith("TESTE")),
  );
}

/** Pessoa física: marcada na Omie, ou com um CPF (11 dígitos) no lugar do CNPJ. */
function pessoaFisica(marca: unknown, documento: unknown): boolean {
  if (semAcento(marca) === "S") return true;
  if (cnpjNormalizado(documento)) return false;
  return text(documento).replace(/\D/g, "").length === 11;
}

function temTagCliente(cliente: ClienteOmie): boolean {
  return cliente.tags.some((tag) => semAcento(tag.tag) === "CLIENTE");
}

/** "SAO PAULO (SP)" → "SAO PAULO". */
function cidadeDaOmie(value: unknown): string | null {
  const cidade = text(value).replace(/\s*\([A-Za-z]{2}\)\s*$/, "").trim();
  return cidade && cidade.length <= 80 && !/[&;<>]/.test(cidade) ? cidade : null;
}

function ufValida(value: unknown): string | null {
  const uf = semAcento(value);
  return (UFS as readonly string[]).includes(uf) ? uf : null;
}

/** Ordem estável dos ids da Omie: "cliente:9" antes de "cliente:10". */
function ordenarIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

export type Entrada = {
  /** "cnpj-<raiz>" ou, para a conta do CRM sem CNPJ, "crm-<nCod>". Não é número, para o Excel não comer zero. */
  chave: string;
  /** Com um CNPJ, o nome fantasia; com mais de um, o começo comum das razões sociais (o nome fantasia de cada CNPJ é o do polo). */
  nome: string;
  /** A da matriz; com mais de um CNPJ, o começo comum das razões sociais. */
  razao_social: string | null;
  /** Todos os nomes do grupo na Omie (nome fantasia e razão social de cada CNPJ): só para achar o cadastro parecido. */
  nomes: string[];
  /** CNPJ inteiro sem máscara, da matriz (ou do menor CNPJ do grupo). */
  cnpj: string | null;
  raiz: string | null;
  /** CNPJs distintos do grupo. */
  filiais: number;
  /** "cliente:<codigo_cliente_omie>" e "crm:<nCod>". */
  omie_ids: string[];
  estagio: CustomerStage;
  /** Emissão do título não cancelado mais antigo, de qualquer ano: o "cliente desde". */
  primeira_compra: string | null;
  /** Emissão do título não cancelado mais recente, de qualquer ano. */
  ultima_compra: string | null;
  cidade: string | null;
  uf: string | null;
  avisos: string[];
};

export type ForaDaCarga = {
  pessoa_fisica: number;
  teste: number;
  sem_tag_cliente: number;
  /** Empresa com a tag Cliente (ou conta do CRM) sem CNPJ válido: só o id, para conferir na Omie. */
  documento_invalido: string[];
};

export type Montagem = { entradas: Entrada[]; fora: ForaDaCarga; titulos_sem_cadastro: number };

/**
 * O começo comum, palavra por palavra (sem acento nem maiúscula), dos nomes de
 * um grupo, sem o separador do fim: "KAPPA BANCO S.A. - SEDE" e "KAPPA BANCO
 * S.A. - POLO NORTE" dão "KAPPA BANCO S.A.". Vazio quando não há.
 */
export function comecoComum(nomes: readonly unknown[]): string {
  const listas = [...new Set(nomes.map(text).filter(Boolean))].map((nome) => nome.split(/\s+/));
  if (!listas.length) return "";
  const comum: string[] = [];
  for (const [index, palavra] of listas[0].entries()) {
    if (!listas.every((lista) => lista[index] !== undefined && semAcento(lista[index]) === semAcento(palavra))) break;
    comum.push(palavra);
  }
  return comum.join(" ").replace(/[\s\-–—/,;:(|]+$/, "");
}

/** Matriz (ordem 0001) primeiro; depois o menor CNPJ; depois o menor id. */
function porMatriz(a: ClienteOmie, b: ClienteOmie): number {
  const ca = cnpjNormalizado(a.cnpj_cpf) ?? "";
  const cb = cnpjNormalizado(b.cnpj_cpf) ?? "";
  const ma = ca.slice(8, 12) === "0001" ? 0 : 1;
  const mb = cb.slice(8, 12) === "0001" ? 0 : 1;
  return ma - mb || ca.localeCompare(cb) || a.codigo_cliente_omie - b.codigo_cliente_omie;
}

/**
 * Filtra e agrupa: pessoa jurídica com a tag Cliente e conta do CRM, uma
 * entrada por raiz de CNPJ, e a conta do CRM sem CNPJ sozinha. O estágio vem
 * dos títulos não cancelados, pela raiz do CNPJ de qualquer cadastro da Omie
 * (inclusive o fornecedor da mesma raiz).
 */
export function montarEntradas(fontes: FontesOmie, desde = COMPRA_DESDE): Montagem {
  const fora: ForaDaCarga = { pessoa_fisica: 0, teste: 0, sem_tag_cliente: 0, documento_invalido: [] };

  // Compras por raiz. Título de pessoa física ou de cadastro fora do arquivo não conta.
  const raizDoCadastro = new Map<number, string | null>();
  for (const cliente of fontes.clientes) {
    const cnpj = pessoaFisica(cliente.pessoa_fisica, cliente.cnpj_cpf) ? null : cnpjNormalizado(cliente.cnpj_cpf);
    raizDoCadastro.set(cliente.codigo_cliente_omie, cnpj ? cnpj.slice(0, 8) : null);
  }
  const primeiraCompra = new Map<string, string>();
  const ultimaCompra = new Map<string, string>();
  let semCadastro = 0;
  for (const titulo of fontes.titulos) {
    if (semAcento(titulo.status_titulo).startsWith("CANCEL")) continue;
    if (!raizDoCadastro.has(titulo.codigo_cliente_fornecedor)) {
      semCadastro += 1;
      continue;
    }
    const raiz = raizDoCadastro.get(titulo.codigo_cliente_fornecedor);
    if (!raiz) continue;
    const primeira = primeiraCompra.get(raiz);
    if (!primeira || titulo.data_emissao < primeira) primeiraCompra.set(raiz, titulo.data_emissao);
    const ultima = ultimaCompra.get(raiz);
    if (!ultima || titulo.data_emissao > ultima) ultimaCompra.set(raiz, titulo.data_emissao);
  }

  type Grupo = { clientes: ClienteOmie[]; crm: ContaCrm[] };
  const grupos = new Map<string, Grupo>();
  const grupo = (raiz: string): Grupo => {
    let atual = grupos.get(raiz);
    if (!atual) {
      atual = { clientes: [], crm: [] };
      grupos.set(raiz, atual);
    }
    return atual;
  };
  const crmSemCnpj: ContaCrm[] = [];

  for (const cliente of fontes.clientes) {
    if (pessoaFisica(cliente.pessoa_fisica, cliente.cnpj_cpf)) {
      fora.pessoa_fisica += 1;
    } else if (contaDeTeste(cliente.razao_social, cliente.nome_fantasia)) {
      fora.teste += 1;
    } else if (!temTagCliente(cliente)) {
      fora.sem_tag_cliente += 1;
    } else {
      const cnpj = cnpjNormalizado(cliente.cnpj_cpf);
      if (!cnpj) fora.documento_invalido.push(`cliente:${cliente.codigo_cliente_omie}`);
      else grupo(cnpj.slice(0, 8)).clientes.push(cliente);
    }
  }
  for (const conta of fontes.crm) {
    const { cNome, cNomeFantasia, cDoc, nCod } = conta.identificacao;
    if (pessoaFisica("", cDoc)) {
      fora.pessoa_fisica += 1;
    } else if (contaDeTeste(cNome, cNomeFantasia)) {
      fora.teste += 1;
    } else if (!text(cDoc)) {
      crmSemCnpj.push(conta);
    } else {
      const cnpj = cnpjNormalizado(cDoc);
      if (!cnpj) fora.documento_invalido.push(`crm:${nCod}`);
      else grupo(cnpj.slice(0, 8)).crm.push(conta);
    }
  }

  const entradas: Entrada[] = [];
  for (const [raiz, { clientes, crm }] of grupos) {
    const avisos: string[] = [];
    const cnpjs = new Set<string>([
      ...clientes.map((cliente) => cnpjNormalizado(cliente.cnpj_cpf) as string),
      ...crm.map((conta) => cnpjNormalizado(conta.identificacao.cDoc) as string),
    ]);
    const omieIds = ordenarIds([
      ...clientes.map((cliente) => `cliente:${cliente.codigo_cliente_omie}`),
      ...crm.map((conta) => `crm:${conta.identificacao.nCod}`),
    ]);
    if (clientes.some((cliente) => semAcento(cliente.inativo) === "S")) avisos.push("Há cadastro inativo na Omie neste grupo.");
    const compra = ultimaCompra.get(raiz) ?? null;
    const nomes = [
      ...new Set(
        [
          ...clientes.flatMap((cliente) => [cliente.nome_fantasia, cliente.razao_social]),
          ...crm.flatMap((conta) => [conta.identificacao.cNomeFantasia, conta.identificacao.cNome]),
        ]
          .map(text)
          .filter(Boolean),
      ),
    ];
    const base = {
      raiz,
      nomes,
      filiais: cnpjs.size,
      omie_ids: omieIds,
      estagio: (compra && compra >= desde ? "cliente" : "prospect") as CustomerStage,
      primeira_compra: primeiraCompra.get(raiz) ?? null,
      ultima_compra: compra,
      avisos,
    };
    // Com mais de um CNPJ, o nome fantasia de cada um é o do polo, e a razão
    // social às vezes também ("KAPPA BANCO S.A. - SEDE"): vale o começo
    // comum das razões sociais do grupo.
    const variosCnpjs = cnpjs.size > 1;
    if (clientes.length) {
      const [principal] = [...clientes].sort(porMatriz);
      const fantasia = text(principal.nome_fantasia);
      const razaoDaMatriz = text(principal.razao_social);
      const comum = comecoComum(clientes.map((cliente) => cliente.razao_social));
      const razao = variosCnpjs && comum.length >= NOME_MIN ? comum : razaoDaMatriz;
      entradas.push({
        chave: `cnpj-${raiz}`,
        nome: variosCnpjs ? razao || fantasia : fantasia || razao,
        razao_social: razao || null,
        cnpj: cnpjNormalizado(principal.cnpj_cpf),
        cidade: cidadeDaOmie(principal.cidade),
        uf: ufValida(principal.estado),
        ...base,
      });
    } else {
      const [principal] = [...crm].sort((a, b) => a.identificacao.nCod - b.identificacao.nCod);
      const fantasia = text(principal.identificacao.cNomeFantasia);
      const comum = comecoComum(crm.map((conta) => conta.identificacao.cNome));
      const nome = variosCnpjs && comum.length >= NOME_MIN ? comum : text(principal.identificacao.cNome);
      entradas.push({
        chave: `cnpj-${raiz}`,
        nome: variosCnpjs ? nome || fantasia : fantasia || nome,
        razao_social: null,
        cnpj: cnpjNormalizado(principal.identificacao.cDoc),
        cidade: ufValida(principal.endereco.cUF) ? cidadeDaOmie(principal.endereco.cCidade) : null,
        uf: ufValida(principal.endereco.cUF),
        ...base,
      });
    }
  }
  for (const conta of crmSemCnpj) {
    const { nCod, cNome, cNomeFantasia } = conta.identificacao;
    entradas.push({
      chave: `crm-${nCod}`,
      nome: text(cNomeFantasia) || text(cNome),
      razao_social: null,
      nomes: [...new Set([cNomeFantasia, cNome].map(text).filter(Boolean))],
      cnpj: null,
      raiz: null,
      filiais: 0,
      omie_ids: [`crm:${nCod}`],
      estagio: "prospect",
      primeira_compra: null,
      ultima_compra: null,
      cidade: ufValida(conta.endereco.cUF) ? cidadeDaOmie(conta.endereco.cCidade) : null,
      uf: ufValida(conta.endereco.cUF),
      avisos: [],
    });
  }
  entradas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.chave.localeCompare(b.chave));
  return { entradas, fora, titulos_sem_cadastro: semCadastro };
}

// --- CSV de revisão e códigos revisados ------------------------------------------------------

/** Código no CSV revisado que deixa a empresa de fora. */
export const CODIGO_FORA = "-";

export const COLUNAS_DA_REVISAO = [
  "chave",
  "nome",
  "cnpj",
  "filiais",
  "omie_ids",
  "primeira_compra",
  "ultima_compra",
  "codigo_sugerido",
  "codigo",
  "estagio",
  "acao",
  "avisos",
] as const;

function cabecalhoNormalizado(value: string): string {
  return semAcento(value).toLowerCase().replace(/[^a-z_]/g, "");
}

export type Revisao = {
  /** Código revisado por chave ("-" deixa a empresa de fora). */
  codigos: Map<string, string>;
  /** Nome revisado por chave, só quando difere do nome da Omie. */
  nomes: Map<string, string>;
  problemas: string[];
  avisos: string[];
};

/**
 * Lê o CSV de revisão (o mesmo que o dry-run gerou, ou qualquer CSV com ";" e
 * as colunas `chave` e `codigo`). Código vazio é o sugerido; "-" deixa a
 * empresa de fora. A coluna `nome`, quando existe, corrige o nome do cadastro
 * novo. O código é conferido no plano, com a regra da callable.
 */
export function lerCodigos(bytes: Uint8Array, entradas: readonly Entrada[]): Revisao {
  const codigos = new Map<string, string>();
  const nomes = new Map<string, string>();
  const problemas: string[] = [];
  const avisos: string[] = [];
  let linhas;
  try {
    linhas = lerCsv(decodificarUtf8(bytes));
  } catch (error) {
    if (error instanceof ErroDoCsv) return { codigos, nomes, problemas: [`--codigos: ${error.message}`], avisos };
    throw error;
  }
  const [cabecalho, ...resto] = linhas;
  const colunas = (cabecalho?.campos ?? []).map(cabecalhoNormalizado);
  const iChave = colunas.indexOf("chave");
  const iCodigo = colunas.indexOf("codigo");
  const iNome = colunas.indexOf("nome");
  if (iChave < 0 || iCodigo < 0) {
    return {
      codigos,
      nomes,
      problemas: ['--codigos: o CSV precisa das colunas "chave" e "codigo", separadas por ";" (o CSV de revisão da carga já vem assim).'],
      avisos,
    };
  }
  const porChave = new Map(entradas.map((entrada) => [entrada.chave, entrada]));
  const vistas = new Set<string>();
  for (const linha of resto) {
    const chave = text(linha.campos[iChave]);
    const codigo = text(linha.campos[iCodigo]).toUpperCase();
    const nome = iNome < 0 ? "" : text(linha.campos[iNome]).replace(/\s+/g, " ");
    if (!chave) {
      if (codigo) problemas.push(`--codigos: linha ${linha.numero}: código sem chave.`);
      continue;
    }
    if (vistas.has(chave)) {
      problemas.push(`--codigos: linha ${linha.numero}: a chave ${chave} aparece mais de uma vez.`);
      continue;
    }
    vistas.add(chave);
    const entrada = porChave.get(chave);
    if (!entrada) {
      if (codigo) avisos.push(`--codigos: linha ${linha.numero}: a chave ${chave} não está nesta carga; a linha foi ignorada.`);
      continue;
    }
    if (codigo) codigos.set(chave, codigo);
    if (nome && nome !== entrada.nome.replace(/\s+/g, " ")) {
      if (nome.length < NOME_MIN || nome.length > NOME_MAX) {
        problemas.push(`--codigos: linha ${linha.numero}: o nome precisa ter de ${NOME_MIN} a ${NOME_MAX} caracteres.`);
      } else {
        nomes.set(chave, nome);
      }
    }
  }
  return { codigos, nomes, problemas, avisos };
}

function cnpjComMascara(cnpj: string | null): string {
  if (!cnpj) return "";
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
}

/** O CSV de revisão: UTF-8 com BOM, ";" e CRLF, como o Excel em português abre e salva. */
export function csvDeRevisao(itens: readonly ItemCliente[]): string {
  const linhas = [
    COLUNAS_DA_REVISAO.join(";"),
    ...itens.map((item) =>
      [
        item.chave,
        item.nome,
        cnpjComMascara(item.cnpj),
        item.filiais,
        item.omie_ids.join(" "),
        item.primeira_compra ?? "",
        item.ultima_compra ?? "",
        item.codigo_sugerido,
        item.codigo,
        item.estagio,
        item.acao,
        [...item.problemas, ...item.avisos].join(" | "),
      ]
        .map((valor) => celulaCsv(valor))
        .join(";"),
    ),
  ];
  return `﻿${linhas.join("\r\n")}\r\n`;
}

// --- Plano ---------------------------------------------------------------------------------

export type CadastroExistente = { id: string; data: Record<string, unknown> };

export type AcaoCliente = "criar" | "vincular" | "sem_mudanca" | "juntar" | "a_conferir" | "fora";

export type ItemCliente = {
  chave: string;
  nome: string;
  cnpj: string | null;
  filiais: number;
  omie_ids: string[];
  primeira_compra: string | null;
  ultima_compra: string | null;
  /** O código que a carga usa: o do cadastro existente, o do CSV revisado ou o sugerido pelo nome. */
  codigo_sugerido: string;
  /** O código do CSV revisado (--codigos), ou vazio. */
  codigo: string;
  /** O estágio do cadastro existente, ou o da compra para o novo. */
  estagio: CustomerStage;
  acao: AcaoCliente;
  customer_id: string | null;
  customer_code: string | null;
  /** A chave da linha com que esta vai para o mesmo cadastro (ação "juntar"). */
  junto_com: string | null;
  avisos: string[];
  problemas: string[];
  resultado?: Record<string, unknown>;
  erro?: string;
};

export type Operacao =
  | {
      tipo: "criar";
      item: ItemCliente;
      documentId: string;
      estagio: CustomerStage;
      /** Para o cliente, a primeira compra (AAAA-MM-DD): vira o `stage_changed_at`, o "cliente desde". */
      cliente_desde: string | null;
      dados: DadosDoProspect;
    }
  | { tipo: "vincular"; item: ItemCliente; customer_id: string; customer_code: string; antes: string[]; depois: string[] };

export type Plano = { itens: ItemCliente[]; operacoes: Operacao[] };

function mapa(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Os ids da Omie gravados no cadastro, na ordem gravada. */
export function idsOmieDoCadastro(data: Record<string, unknown>): string[] {
  const ids = mapa(data.comercial).omie_ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

function codigoDoCadastro(data: Record<string, unknown>): string {
  return text(data.customer_code) || text(data.code);
}

function nomeDoCadastro(cadastro: CadastroExistente): string {
  return text(cadastro.data.name) || codigoDoCadastro(cadastro.data) || cadastro.id;
}

function mesmoCodigo(a: unknown, b: unknown): boolean {
  const ca = canonicalCustomerCode(a);
  return ca !== "" && ca === canonicalCustomerCode(b);
}

function semRepetir(cadastros: readonly CadastroExistente[]): CadastroExistente[] {
  return [...new Map(cadastros.map((cadastro) => [cadastro.id, cadastro])).values()];
}

/** Tamanho mínimo, já canônico, para um nome conter o outro: "ITAU" conta; "BTG", não. */
const PARECIDO_MIN = 4;

/**
 * Cadastros sem CNPJ cujo código ou nome está dentro de um dos nomes da Omie
 * (ou os contém), comparados sem acento, maiúscula nem separador: "BTG
 * Pactual" (WMS) está em "BANCO BTG PACTUAL S.A.". O cadastro com CNPJ é
 * achado pela raiz; com outra raiz, é outra empresa.
 */
export function cadastrosParecidos(nomes: readonly string[], cadastros: readonly CadastroExistente[]): CadastroExistente[] {
  const nossos = nomes.map(canonicalCustomerCode).filter((nome) => nome.length >= PARECIDO_MIN);
  return cadastros.filter((cadastro) => {
    if (cnpjRoot(cadastro.data.document)) return false;
    const deles = [cadastro.data.code, cadastro.data.customer_code, cadastro.data.name]
      .map(canonicalCustomerCode)
      .filter((nome) => nome.length >= PARECIDO_MIN);
    return deles.some((dele) => nossos.some((nosso) => nosso.includes(dele) || dele.includes(nosso)));
  });
}

/** Como a linha achou o cadastro existente. A raiz da linha achada só pelo código não é a do cadastro. */
type Achado = "ids" | "raiz" | "codigo";

/**
 * Plano da carga: para cada entrada, o cadastro que já existe (pelos ids da
 * Omie, pela raiz do CNPJ ou pelo código canônico) ou o código do cadastro
 * novo; depois junta no mesmo cadastro as entradas com o mesmo destino. Sem
 * banco (dry-run sem --projeto), `cadastros` é null e o plano supõe o
 * cadastro vazio. `nomes` traz os nomes revisados no CSV, que valem só para
 * o cadastro novo.
 */
export function planejar(
  entradas: readonly Entrada[],
  codigos: ReadonlyMap<string, string> | null,
  cadastros: readonly CadastroExistente[] | null,
  nomes: ReadonlyMap<string, string> | null = null,
): Plano {
  const lista = cadastros ?? [];
  const itens: ItemCliente[] = [];
  const porEntrada = new Map<ItemCliente, { entrada: Entrada; existente: CadastroExistente | null; achado: Achado | null }>();
  // A raiz de cada id da Omie desta carga: diz a que empresa um cadastro sem CNPJ já está ligado.
  const raizDoId = new Map<string, string>();
  for (const entrada of entradas) {
    if (entrada.raiz) for (const id of entrada.omie_ids) raizDoId.set(id, entrada.raiz);
  }

  for (const entrada of entradas) {
    const revisado = codigos?.get(entrada.chave) ?? "";
    const nomeRevisado = nomes?.get(entrada.chave) ?? null;
    const nome = nomeRevisado ?? entrada.nome;
    const item: ItemCliente = {
      chave: entrada.chave,
      nome,
      cnpj: entrada.cnpj,
      filiais: entrada.filiais,
      omie_ids: entrada.omie_ids,
      primeira_compra: entrada.primeira_compra,
      ultima_compra: entrada.ultima_compra,
      codigo_sugerido: sugerirCodigo(nome),
      codigo: revisado,
      estagio: entrada.estagio,
      acao: "a_conferir",
      customer_id: null,
      customer_code: null,
      junto_com: null,
      avisos: [...entrada.avisos],
      problemas: [],
    };
    itens.push(item);
    if (revisado === CODIGO_FORA) {
      item.acao = "fora";
      item.avisos.push(`Fora pela revisão ("${CODIGO_FORA}" na coluna codigo).`);
      continue;
    }

    const porIds = lista.filter((cadastro) => idsOmieDoCadastro(cadastro.data).some((id) => entrada.omie_ids.includes(id)));
    const porRaiz = entrada.raiz ? lista.filter((cadastro) => cnpjRoot(cadastro.data.document) === entrada.raiz) : [];
    const fortes = semRepetir([...porIds, ...porRaiz]);

    // A conta do CRM sem CNPJ pode ser uma pessoa (LGPD): só entra com o
    // código escrito na revisão. A que já foi ligada numa carga anterior segue.
    if (!entrada.raiz && !fortes.length && !revisado) {
      item.acao = "fora";
      item.avisos.push("Conta do CRM sem CNPJ: só entra com um código na coluna codigo. Confira antes se é empresa; pessoa física fica fora.");
      continue;
    }
    if (nome.length < NOME_MIN || nome.length > NOME_MAX) {
      item.problemas.push(`Nome com menos de ${NOME_MIN} ou mais de ${NOME_MAX} caracteres: corrija na coluna nome do CSV (--codigos).`);
    }
    if (entrada.razao_social && entrada.razao_social.length > 160) {
      item.problemas.push("Razão social da Omie com mais de 160 caracteres: corrija na Omie.");
    }

    let codigoNovo: string | null = null;
    let erroDoCodigo = "";
    try {
      codigoNovo = codigoDoNovoCadastro(revisado, nome);
    } catch (error) {
      erroDoCodigo = (error as Error).message;
    }

    let existente: CadastroExistente | null = null;
    let achado: Achado | null = null;
    if (fortes.length > 1) {
      item.problemas.push(
        `A Omie aponta para mais de um cadastro (${fortes.map(nomeDoCadastro).join(", ")}): confira em Configurações › Clientes.`,
      );
    } else if (fortes.length === 1) {
      existente = fortes[0];
      achado = porIds.includes(existente) ? "ids" : "raiz";
    } else {
      // O código revisado acha o cadastro mesmo fora do formato do código
      // novo: "BTG Pactual", como o WMS gravou.
      const codigoDeBusca = revisado || codigoNovo;
      const porCodigo = codigoDeBusca
        ? lista.filter((cadastro) => [cadastro.data.code, cadastro.data.customer_code].some((code) => mesmoCodigo(code, codigoDeBusca)))
        : [];
      if (porCodigo.length > 1) {
        item.problemas.push(`Há mais de um cadastro com o código ${codigoDeBusca}: confira em Configurações › Clientes.`);
      } else if (porCodigo.length === 1) {
        const raizDele = cnpjRoot(porCodigo[0].data.document);
        if (raizDele && entrada.raiz && raizDele !== entrada.raiz) {
          item.problemas.push(
            `O código ${codigoDeBusca} já é do cadastro ${nomeDoCadastro(porCodigo[0])}, com outra raiz de CNPJ: informe outro código no CSV (--codigos).`,
          );
        } else {
          existente = porCodigo[0];
          achado = "codigo";
        }
      } else if (!revisado) {
        // Nem ids, nem raiz, nem código: o cadastro sem CNPJ de nome parecido
        // (a BTG do WMS, achada como "BANCO BTG PACTUAL") pede a revisão.
        const parecidos = cadastrosParecidos([nome, ...entrada.nomes], lista);
        if (parecidos.length) {
          const quais = parecidos.map((cadastro) => `${nomeDoCadastro(cadastro)} (código "${codigoDoCadastro(cadastro.data) || cadastro.id}")`);
          item.problemas.push(
            `Parece ser o cadastro ${quais.join(" ou ")}: para ligar a ele, escreva o código dele na coluna codigo; ` +
              `para criar outro cadastro, escreva outro código; para deixar de fora, "${CODIGO_FORA}".`,
          );
        }
      }
    }

    if (existente) {
      const code = codigoDoCadastro(existente.data);
      item.customer_id = existente.id;
      item.customer_code = code;
      item.codigo_sugerido = code;
      item.estagio = customerStage(existente.data.stage);
      if (cadastroArquivado(existente.data)) {
        item.problemas.push(`O cadastro ${code} está arquivado: a carga não mexe nele. Para deixar de fora, use "${CODIGO_FORA}" no CSV.`);
      }
      if (revisado && !mesmoCodigo(revisado, code)) {
        item.avisos.push(`O cadastro já existe com o código ${code}: o código do CSV não vale para ele.`);
      }
      if (nomeRevisado) {
        item.avisos.push(`O cadastro já existe com o nome ${nomeDoCadastro(existente)}: o nome do CSV não vale para ele.`);
      }
      if (entrada.estagio === "cliente" && item.estagio === "prospect") {
        item.avisos.push(`Comprou desde ${COMPRA_DESDE.slice(0, 4)}, mas o cadastro é prospect: marque como cliente na tela.`);
      }
      if (entrada.cnpj && !cnpjRoot(existente.data.document)) {
        item.avisos.push("O cadastro não tem CNPJ: o da Omie não é gravado (a identidade não muda).");
      }
    } else {
      if (nomeRevisado) item.avisos.push(`Nome revisado no CSV (na Omie: ${entrada.nome}).`);
      if (!item.problemas.length) {
        if (!codigoNovo) {
          item.problemas.push(erroDoCodigo || "Sem código: informe no CSV (--codigos).");
        } else {
          item.customer_code = codigoNovo;
          item.customer_id = safeDocId(codigoNovo);
          item.codigo_sugerido = codigoNovo;
        }
      }
    }
    porEntrada.set(item, { entrada, existente, achado });
  }

  // Destinos: o cadastro existente, ou o código novo (canônico). Entradas com o
  // mesmo destino viram um cadastro só.
  const destinos = new Map<string, ItemCliente[]>();
  for (const item of itens) {
    if (item.acao === "fora" || item.problemas.length || !item.customer_id) continue;
    const { existente } = porEntrada.get(item) ?? { existente: null };
    const chave = existente ? `id:${existente.id}` : `novo:${canonicalCustomerCode(item.customer_code)}`;
    destinos.set(chave, [...(destinos.get(chave) ?? []), item]);
  }

  const info = (item: ItemCliente) => porEntrada.get(item) as { entrada: Entrada; existente: CadastroExistente | null; achado: Achado | null };
  const operacoes: Operacao[] = [];
  for (const todos of destinos.values()) {
    let membros = todos;
    const destino = info(todos[0]).existente;
    if (destino) {
      // Um cadastro, uma raiz de CNPJ. As raízes firmes vêm do CNPJ gravado,
      // dos ids que ele já tem e das linhas achadas pelos ids ou pela raiz; a
      // linha achada só pelo código com outra raiz (ou, sem raiz firme, duas
      // raízes pelo código) fica a conferir, como no cadastro novo.
      const firmes = new Set<string>();
      const raizDele = cnpjRoot(destino.data.document);
      if (raizDele) firmes.add(raizDele);
      for (const id of idsOmieDoCadastro(destino.data)) {
        const raiz = raizDoId.get(id);
        if (raiz) firmes.add(raiz);
      }
      for (const item of membros) {
        const { entrada, achado } = info(item);
        if (achado !== "codigo" && entrada.raiz) firmes.add(entrada.raiz);
      }
      const pelosCodigos = membros.filter((item) => info(item).achado === "codigo" && info(item).entrada.raiz);
      const raizesPeloCodigo = new Set(pelosCodigos.map((item) => info(item).entrada.raiz as string));
      const recusados = firmes.size
        ? pelosCodigos.filter((item) => !firmes.has(info(item).entrada.raiz as string))
        : raizesPeloCodigo.size > 1
          ? pelosCodigos
          : [];
      if (recusados.length) {
        const raizes = new Set([...firmes, ...raizesPeloCodigo]).size;
        const code = codigoDoCadastro(destino.data) || destino.id;
        for (const item of recusados) {
          item.problemas.push(
            `O código ${code} levaria ${raizes} raízes de CNPJ ao cadastro ${nomeDoCadastro(destino)}: informe outro código no CSV (--codigos), ou "${CODIGO_FORA}".`,
          );
        }
        membros = membros.filter((item) => !recusados.includes(item));
        if (!membros.length) continue;
      }
    }

    // O principal é o que tem CNPJ; entre iguais, a menor chave.
    const ordenados = [...membros].sort((a, b) => Number(!a.cnpj) - Number(!b.cnpj) || a.chave.localeCompare(b.chave));
    const [principal, ...outros] = ordenados;
    const existente = porEntrada.get(principal)?.existente ?? null;
    const idsDoDestino = ordenarIds(ordenados.flatMap((item) => item.omie_ids));
    for (const outro of outros) {
      outro.junto_com = principal.chave;
      outro.customer_code = principal.customer_code;
      outro.customer_id = principal.customer_id;
      outro.codigo_sugerido = principal.codigo_sugerido;
      outro.avisos.push(`Vai para o mesmo cadastro de ${principal.chave} (${principal.nome}), pelo ${existente ? "cadastro existente" : "código"}.`);
    }

    if (existente) {
      const antes = idsOmieDoCadastro(existente.data);
      const depois = ordenarIds([...antes, ...idsDoDestino]);
      const muda = idsDoDestino.some((id) => !antes.includes(id));
      for (const item of ordenados) item.acao = muda ? "juntar" : "sem_mudanca";
      if (muda) {
        principal.acao = "vincular";
        operacoes.push({
          tipo: "vincular",
          item: principal,
          customer_id: existente.id,
          customer_code: codigoDoCadastro(existente.data),
          antes,
          depois,
        });
      }
      continue;
    }

    const entradasDoDestino = ordenados.map((item) => porEntrada.get(item)?.entrada as Entrada);
    const raizes = new Set(entradasDoDestino.map((entrada) => entrada.raiz).filter(Boolean));
    const code = principal.customer_code as string;
    const documentId = principal.customer_id as string;
    const marcar = (problema: string) => {
      for (const item of ordenados) {
        item.problemas.push(problema);
        item.acao = "a_conferir";
        item.junto_com = null;
      }
    };
    if (raizes.size > 1) {
      marcar(`O código ${code} sairia para ${raizes.size} raízes de CNPJ diferentes: informe códigos diferentes no CSV (--codigos).`);
      continue;
    }
    const principalEntrada = entradasDoDestino[0];
    const estagio: CustomerStage = entradasDoDestino.some((entrada) => entrada.estagio === "cliente") ? "cliente" : "prospect";
    const primeiraCompra = entradasDoDestino.flatMap((entrada) => (entrada.primeira_compra ? [entrada.primeira_compra] : [])).sort()[0] ?? null;
    const document = principalEntrada.cnpj;
    if (lista.some((cadastro) => cadastro.id === documentId)) {
      marcar(`Já existe um cadastro com o id ${documentId}: informe outro código no CSV (--codigos).`);
      continue;
    }
    const conflito = customerIdentityConflict({ code, document, documentId }, lista);
    if (conflito) {
      marcar(`${conflito} Informe outro código no CSV (--codigos).`);
      continue;
    }
    const comCidade = entradasDoDestino.find((entrada) => entrada.uf) ?? principalEntrada;
    for (const item of ordenados) {
      item.estagio = estagio;
      item.acao = "juntar";
    }
    principal.acao = "criar";
    operacoes.push({
      tipo: "criar",
      item: principal,
      documentId,
      estagio,
      cliente_desde: estagio === "cliente" ? primeiraCompra : null,
      dados: {
        code,
        name: principal.nome,
        legal_name: principalEntrada.razao_social,
        document,
        origem: "omie",
        comercial: { responsavel_uid: null, cidade: comCidade.cidade, uf: comCidade.uf, omie_ids: idsDoDestino },
      },
    });
  }

  for (const item of itens) {
    if (item.problemas.length) {
      item.acao = "a_conferir";
      item.junto_com = null;
    }
  }
  return { itens, operacoes };
}

// --- Banco e execução ---------------------------------------------------------------------

/** O cadastro inteiro (centenas de documentos): a unicidade compara com todos, inclusive arquivados. */
export async function lerCadastros(db: Firestore): Promise<CadastroExistente[]> {
  const snapshot = await db.collection(CUSTOMERS_COLLECTION).get();
  return snapshot.docs.map((row) => ({ id: row.id, data: row.data() }));
}

type ResultadoDaGravacao = { ok: true; customer_id: string; customer_code: string; stage: CustomerStage; events: string[] };

/** AAAA-MM-DD da Omie no meio-dia UTC: a data não muda com o fuso de quem lê. */
export function dataDaCompra(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(`${iso}T12:00:00.000Z`));
}

/** Cria o cadastro (prospect ou cliente) com a montagem do prospect das callables, origem "omie". */
async function criarCadastro(
  db: Firestore,
  operacao: Extract<Operacao, { tipo: "criar" }>,
  ator: ComercialActor,
): Promise<ResultadoDaGravacao & { replayed?: true }> {
  const { documentId, dados, estagio, cliente_desde: clienteDesde } = operacao;
  return runIdempotent<ResultadoDaGravacao>(
    db,
    {
      kind: "omie_customer_create",
      scope: { customer_code: dados.code },
      idempotency_key: `carga-clientes-omie:criar:${dados.code}:${digest({ dados, estagio, cliente_desde: clienteDesde })}`,
      input: { dados, estagio, cliente_desde: clienteDesde },
      actor: ator,
    },
    async (transaction, { operationId }) => {
      // Leituras: o cadastro inteiro, para conferir de novo o estado que o plano leu.
      const todos = (await transaction.get(db.collection(CUSTOMERS_COLLECTION))).docs.map((row) => ({ id: row.id, data: row.data() }));
      if (todos.some((row) => row.id === documentId)) {
        throw new HttpsError("already-exists", `O cadastro ${documentId} apareceu depois da leitura: rode a carga de novo.`);
      }
      const conflito = customerIdentityConflict({ code: dados.code, document: dados.document, documentId }, todos);
      if (conflito) throw new HttpsError("already-exists", conflito);
      const ligado = todos.find((row) => idsOmieDoCadastro(row.data).some((id) => dados.comercial.omie_ids.includes(id)));
      if (ligado) {
        throw new HttpsError(
          "failed-precondition",
          `A Omie já está ligada ao cadastro ${codigoDoCadastro(ligado.data) || ligado.id}: rode a carga de novo.`,
        );
      }

      // Escritas. O prospect da callable; quem comprou desde 2024 já nasce
      // cliente (o "vira cliente no fechamento" vale para o prospect novo),
      // cliente desde a primeira compra nos títulos.
      transaction.create(db.collection(CUSTOMERS_COLLECTION).doc(documentId), {
        ...prospectPayload(documentId, dados, ator.uid),
        stage: estagio,
        ...(clienteDesde ? { stage_changed_at: dataDaCompra(clienteDesde) } : {}),
      });
      const event = createComercialEvent(transaction, db, {
        operation_id: operationId,
        type: "commercial_customer.created",
        entity_id: entityIdDoCadastro(documentId),
        customer_code: dados.code,
        payload: { stage: estagio },
        actor: ator,
      });
      return {
        target_id: documentId,
        result: { ok: true, customer_id: documentId, customer_code: dados.code, stage: estagio, events: [event.id] },
      };
    },
  );
}

/** O que falta no mapa `comercial` (o cadastro do WMS não tem nenhum) entra com o padrão do prospect. */
const COMERCIAL_PADRAO = { responsavel_uid: null, cidade: null, uf: null } as const;

/** Liga os ids da Omie ao cadastro existente. Só `comercial.omie_ids`: identidade e estágio não mudam. */
async function vincularCadastro(
  db: Firestore,
  operacao: Extract<Operacao, { tipo: "vincular" }>,
  ator: ComercialActor,
): Promise<ResultadoDaGravacao & { replayed?: true }> {
  const { customer_id: id, antes, depois } = operacao;
  return runIdempotent<ResultadoDaGravacao>(
    db,
    {
      kind: "omie_customer_link",
      scope: { customer_id: id },
      idempotency_key: `carga-clientes-omie:vincular:${id}:${digest({ antes, depois })}`,
      input: { customer_id: id, antes, depois },
      actor: ator,
    },
    async (transaction, { operationId }) => {
      const ref = db.collection(CUSTOMERS_COLLECTION).doc(id);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new HttpsError("not-found", `Cadastro ${operacao.customer_code} não encontrado.`);
      const data = snapshot.data() ?? {};
      const code = codigoDoCadastro(data) || operacao.customer_code;
      if (cadastroArquivado(data)) throw new HttpsError("failed-precondition", `O cadastro ${code} está arquivado.`);
      if (JSON.stringify(idsOmieDoCadastro(data)) !== JSON.stringify(antes)) {
        throw new HttpsError("failed-precondition", `O cadastro ${code} mudou desde a leitura: rode a carga de novo.`);
      }
      const comercial = mapa(data.comercial);
      const campos: Record<string, unknown> = {
        "comercial.omie_ids": depois,
        updated_by: ator.uid,
        updated_at: FieldValue.serverTimestamp(),
      };
      for (const [campo, padrao] of Object.entries(COMERCIAL_PADRAO)) {
        if (!(campo in comercial)) campos[`comercial.${campo}`] = padrao;
      }
      transaction.update(ref, campos);
      const event = createComercialEvent(transaction, db, {
        operation_id: operationId,
        type: "commercial_customer.updated",
        entity_id: entityIdDoCadastro(id),
        customer_code: code,
        payload: { campos: ["ids_omie"] },
        actor: ator,
      });
      return {
        target_id: id,
        result: { ok: true, customer_id: id, customer_code: code, stage: customerStage(data.stage), events: [event.id] },
      };
    },
  );
}

// --- Relatório e entrada -------------------------------------------------------------------

export type Relatorio = {
  carga: "clientes-omie";
  modo: "dry-run" | "executar";
  projeto: string | null;
  comparado_com_o_banco: boolean;
  arquivos: { clientes: string; crm: string; titulos: string; codigos: string | null };
  compra_desde: string;
  gerado_em: string;
  resumo: Record<string, number>;
  invalido: string[];
  avisos: string[];
  fora: ForaDaCarga;
  clientes: ItemCliente[];
};

function resumo(itens: readonly ItemCliente[], operacoes: readonly Operacao[], montagem: Montagem | null, invalido: readonly string[]) {
  const contar = (acao: AcaoCliente) => itens.filter((item) => item.acao === acao).length;
  const criar = operacoes.filter((operacao): operacao is Extract<Operacao, { tipo: "criar" }> => operacao.tipo === "criar");
  return {
    empresas: itens.length,
    criar: contar("criar"),
    criar_cliente: criar.filter((operacao) => operacao.estagio === "cliente").length,
    criar_prospect: criar.filter((operacao) => operacao.estagio === "prospect").length,
    vincular: contar("vincular"),
    juntar: contar("juntar"),
    sem_mudanca: contar("sem_mudanca"),
    a_conferir: contar("a_conferir"),
    fora_pela_revisao: itens.filter((item) => item.acao === "fora" && item.codigo === CODIGO_FORA).length,
    fora_crm_sem_cnpj: itens.filter((item) => item.acao === "fora" && item.codigo !== CODIGO_FORA).length,
    com_erro: itens.filter((item) => Boolean(item.erro)).length,
    fora_pessoa_fisica: montagem?.fora.pessoa_fisica ?? 0,
    fora_teste: montagem?.fora.teste ?? 0,
    fora_sem_tag_cliente: montagem?.fora.sem_tag_cliente ?? 0,
    fora_documento_invalido: montagem?.fora.documento_invalido.length ?? 0,
    titulos_sem_cadastro: montagem?.titulos_sem_cadastro ?? 0,
    invalido: invalido.length,
  };
}

export type DependenciasCarga = {
  /** Banco já aberto (testes). Sem ele, a carga abre o do --projeto. */
  db?: Firestore;
  agora?: () => Date;
  log?: (linha: string) => void;
  /**
   * Roda entre o plano e a gravação. Os testes usam para mudar o banco nesse
   * intervalo e provar que a transação confere o estado de novo; a carga de
   * verdade não passa nada aqui.
   */
  antesDeGravar?: (db: Firestore) => Promise<void>;
};

export type ResultadoCarga = { codigo: number; relatorio: string | null; conteudo: Relatorio | null };

/**
 * Roda a carga. Código 0: tudo certo; 1: arquivo inválido, empresa a
 * conferir ou erro ao gravar (o relatório diz qual); 2: erro de uso, sem ler
 * nada.
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
  const { fontes, problemas } = lerFontes(opcoes);
  const invalido = [...problemas];
  const avisos: string[] = [];
  const montagem = fontes ? montarEntradas(fontes) : null;
  let codigos: Map<string, string> | null = null;
  let nomes: Map<string, string> | null = null;
  if (montagem && opcoes.codigos) {
    let bytes: Uint8Array | null = null;
    try {
      bytes = readFileSync(opcoes.codigos);
    } catch {
      invalido.push(`--codigos: não consegui ler ${basename(opcoes.codigos)}.`);
    }
    if (bytes) {
      const lidos = lerCodigos(bytes, montagem.entradas);
      invalido.push(...lidos.problemas);
      avisos.push(...lidos.avisos);
      codigos = lidos.codigos;
      nomes = lidos.nomes;
    }
  }

  let plano: Plano = { itens: [], operacoes: [] };
  if (montagem && invalido.length === 0) {
    let db = deps.db;
    const app = !db && opcoes.projeto ? initializeApp({ projectId: opcoes.projeto }, `carga-clientes-omie-${agora().getTime()}`) : null;
    if (app) db = getFirestore(app);
    try {
      const cadastros = db && opcoes.projeto ? await lerCadastros(db) : null;
      plano = planejar(montagem.entradas, codigos, cadastros, nomes);
      if (opcoes.executar && db) {
        if (deps.antesDeGravar) await deps.antesDeGravar(db);
        for (const operacao of plano.operacoes) {
          try {
            operacao.item.resultado =
              operacao.tipo === "criar" ? await criarCadastro(db, operacao, ATOR_DA_CARGA) : await vincularCadastro(db, operacao, ATOR_DA_CARGA);
          } catch (error) {
            operacao.item.erro = (error as Error).message;
          }
        }
      }
    } finally {
      if (app) await deleteApp(app);
    }
  }

  const conteudo: Relatorio = {
    carga: "clientes-omie",
    modo,
    projeto: opcoes.projeto,
    comparado_com_o_banco: Boolean(opcoes.projeto) && invalido.length === 0,
    arquivos: {
      clientes: basename(opcoes.clientes),
      crm: basename(opcoes.crm),
      titulos: basename(opcoes.titulos),
      codigos: opcoes.codigos ? basename(opcoes.codigos) : null,
    },
    compra_desde: COMPRA_DESDE,
    gerado_em: agora().toISOString(),
    resumo: resumo(plano.itens, plano.operacoes, montagem, invalido),
    invalido,
    avisos,
    fora: montagem?.fora ?? { pessoa_fisica: 0, teste: 0, sem_tag_cliente: 0, documento_invalido: [] },
    clientes: plano.itens,
  };
  mkdirSync(opcoes.relatorioDir, { recursive: true });
  const carimbo = conteudo.gerado_em.replace(/[:.]/g, "-");
  const base = join(opcoes.relatorioDir, `clientes-omie-${modo}-${opcoes.projeto ?? "sem-projeto"}-${carimbo}`);
  writeFileSync(`${base}.json`, `${JSON.stringify(conteudo, null, 2)}\n`, "utf8");
  if (invalido.length === 0) writeFileSync(`${base}.csv`, csvDeRevisao(plano.itens), "utf8");

  for (const problema of invalido) log(`Arquivo inválido: ${problema}`);
  for (const aviso of avisos) log(`Aviso: ${aviso}`);
  for (const item of plano.itens) {
    const codigo = item.customer_code ?? item.codigo_sugerido;
    log(`${item.chave} ${item.nome}: ${item.acao} (${item.estagio}${codigo ? `, ${codigo}` : ""})`);
    for (const problema of item.problemas) log(`  problema: ${problema}`);
    if (item.erro) log(`  erro: ${item.erro}`);
  }
  const r = conteudo.resumo;
  if (montagem) {
    log(
      `Fora: ${r.fora_pessoa_fisica} pessoa(s) física(s), ${r.fora_teste} conta(s) de teste, ` +
        `${r.fora_sem_tag_cliente} sem a tag Cliente, ${r.fora_documento_invalido} sem CNPJ válido, ` +
        `${r.fora_crm_sem_cnpj} conta(s) do CRM sem CNPJ e sem código na revisão.`,
    );
  }
  if (!opcoes.projeto) log("Dry-run sem --projeto: as ações supõem o cadastro vazio. Com --projeto, a carga compara com o banco.");
  else if (!opcoes.executar) log("Dry-run: nada foi gravado. Revise o CSV e, para gravar, repita com --executar.");
  log(`Relatório: ${base}.json`);
  if (invalido.length === 0) log(`CSV de revisão: ${base}.csv`);

  const falhou = invalido.length > 0 || r.a_conferir > 0 || r.com_erro > 0;
  return { codigo: falhou ? 1 : 0, relatorio: `${base}.json`, conteudo };
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
