import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  getFirestore,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QuerySnapshot,
  type Transaction,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { LPU_ITEMS_COLLECTION, limparTexto, lpuItemDoc, lpuItemId, itemOrcavel, normalizarTexto } from "../domain/catalogo.js";
import { CASAS_DO_PRECO, ErroDinheiro, lerDecimal } from "../domain/dinheiro.js";
import { createComercialEvent } from "../domain/events.js";
import { COMERCIAL_AMBIENTES_LIBERADOS, comercialLiberado } from "../domain/liberacao.js";
import {
  COMERCIAL_OPERATIONS_COLLECTION,
  actorPayload,
  inputHash,
  operationDocId,
  runIdempotent,
  type ComercialActor,
} from "../domain/operations.js";
import {
  ErroTabela,
  MOEDA_DAS_TABELAS,
  PRICE_TABLES_COLLECTION,
  PRICE_TABLE_SCHEMA_VERSION,
  STATUS_TABELA,
  chaveDeVigencia,
  conferirData,
  conferirVariante,
  normalizarVariante,
  planejarVigencia,
  priceTableId,
  type IdentidadeDaTabela,
  type PlanoDeVigencia,
  type PrecoDaTabela,
  type StatusTabela,
  type VigenciaDaTabela,
} from "../domain/tabelas.js";
import { ErroDoCsv, decodificarUtf8, lerCsv } from "./csv.js";

/**
 * Carga de tabela de preço do Comercial (docs/plataforma/comercial-cargas.md).
 *
 *   node functions/comercial/lib/cargas/tabela.js --arquivo <csv> --nome <nome>
 *     --variante <Comercial|Noturna|...> --vigente-de AAAA-MM-DD
 *     [--vigente-ate AAAA-MM-DD] [--cliente <customer_code>] [--contrato <id>]
 *     [--rodape <texto>] [--condicoes <texto>] [--validade-dias <n>]
 *     [--projeto <projeto>] [--executar] [--por <e-mail>]
 *
 * - Lê um CSV UTF-8 com o cabeçalho codigo;categoria;item;servico;descricao;unidade;preco
 *   e o preço em decimal com ponto, até 4 casas (a conta de dinheiro.ts).
 * - Dry-run por padrão: sem --projeto, só confere o arquivo; com --projeto,
 *   lê o banco e mostra o que gravaria. --executar exige --projeto, sem
 *   padrão, e só grava onde o Comercial está liberado (ou no emulador).
 * - Grava numa transação, com recibo em comercial_operations (idempotente
 *   pelo sha256 do arquivo): os itens que faltam em `lpu_items`, a tabela em
 *   `price_tables`, o encerramento da anterior e os eventos, sem preço.
 * - O relatório (com os preços, para conferir contra o PDF) vai para
 *   tmp/comercial/, fora do git.
 */

export const CABECALHO = ["codigo", "categoria", "item", "servico", "descricao", "unidade", "preco"] as const;

/** Linhas de dados aceitas num arquivo. */
export const MAXIMO_DE_LINHAS = 2000;
/** Itens por tabela: cabem numa transação, com a tabela, o encerramento, os eventos e o recibo. */
export const MAXIMO_DE_ITENS = 480;
/** Tamanho do mapa de preços, longe do limite de 1 MiB do documento. */
const MAXIMO_DOS_PRECOS_EM_BYTES = 900_000;

const OPERACAO = "price_table_import";

const PASTA_DO_RELATORIO = fileURLToPath(new URL("../../../../tmp/comercial/", import.meta.url));

export class ErroDaCarga extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDaCarga";
  }
}

// --- Argumentos -----------------------------------------------------------------

export type ArgumentosDaCarga = {
  arquivo: string;
  nome: string;
  cliente: string | null;
  contrato: string | null;
  variante: string;
  vigente_de: string;
  vigente_ate: string | null;
  rodape: string | null;
  condicoes: string | null;
  validade_dias: number | null;
  projeto: string | null;
  executar: boolean;
  por: string | null;
};

const OPCOES = {
  "--arquivo": "arquivo",
  "--nome": "nome",
  "--cliente": "cliente",
  "--contrato": "contrato",
  "--variante": "variante",
  "--vigente-de": "vigente_de",
  "--vigente-ate": "vigente_ate",
  "--rodape": "rodape",
  "--condicoes": "condicoes",
  "--validade-dias": "validade_dias",
  "--projeto": "projeto",
  "--por": "por",
} as const;

type Opcao = keyof typeof OPCOES;

export const USO = [
  "Uso: node functions/comercial/lib/cargas/tabela.js --arquivo <csv> --nome <nome> --variante <variante>",
  "       --vigente-de AAAA-MM-DD [--vigente-ate AAAA-MM-DD] [--cliente <customer_code> [--contrato <id>]]",
  "       [--rodape <texto>] [--condicoes <texto>] [--validade-dias <n>] [--projeto <projeto> [--executar]] [--por <e-mail>]",
  "Sem --executar é dry-run. --executar exige --projeto (não há projeto padrão). Ver docs/plataforma/comercial-cargas.md.",
].join("\n");

const PROJETO = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const CONTRATO = /^[A-Za-z0-9_-]{1,120}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROLE = /\p{Cc}/u;

function texto(opcao: string, valor: string | undefined, maximo: number): string | null {
  if (valor === undefined) return null;
  const limpo = valor.trim();
  if (!limpo) throw new ErroDaCarga(`${opcao} vazio.`);
  if (limpo.length > maximo) throw new ErroDaCarga(`${opcao} passa de ${maximo} caracteres.`);
  return limpo;
}

function obrigatorio(opcao: Opcao, valor: string | null): string {
  if (valor === null) throw new ErroDaCarga(`Falta ${opcao}.`);
  return valor;
}

function data(opcao: Opcao, valor: string | null): string | null {
  if (valor === null) return null;
  try {
    return conferirData(valor, opcao);
  } catch (erro) {
    if (erro instanceof ErroTabela) throw new ErroDaCarga(`${opcao}: data inválida "${valor}" (use AAAA-MM-DD de um dia que existe).`);
    throw erro;
  }
}

/** Lê os argumentos da linha de comando. Recusa opção desconhecida, repetida ou sem valor. */
export function lerArgumentos(argv: readonly string[]): ArgumentosDaCarga {
  const valores: Partial<Record<Opcao, string>> = {};
  let executar = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new ErroDaCarga(`Argumento solto: "${token}". Use --arquivo <caminho>.`);
    const igual = token.indexOf("=");
    const nome = igual >= 0 ? token.slice(0, igual) : token;
    if (nome === "--executar") {
      if (igual >= 0) throw new ErroDaCarga("--executar não recebe valor.");
      executar = true;
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(OPCOES, nome)) throw new ErroDaCarga(`Opção desconhecida: ${nome}.`);
    const opcao = nome as Opcao;
    if (valores[opcao] !== undefined) throw new ErroDaCarga(`${opcao} repetido.`);
    let valor: string | undefined;
    if (igual >= 0) {
      valor = token.slice(igual + 1);
    } else {
      valor = argv[i + 1];
      if (valor === undefined || valor.startsWith("--")) throw new ErroDaCarga(`${opcao} sem valor.`);
      i += 1;
    }
    valores[opcao] = valor;
  }

  const arquivo = obrigatorio("--arquivo", texto("--arquivo", valores["--arquivo"], 1000));
  const nome = limparTexto(obrigatorio("--nome", texto("--nome", valores["--nome"], 120)));
  const varianteEscrita = obrigatorio("--variante", texto("--variante", valores["--variante"], 200));
  let variante: string;
  try {
    variante = conferirVariante(varianteEscrita);
  } catch (erro) {
    if (erro instanceof ErroTabela) throw new ErroDaCarga(`--variante: ${erro.message}`);
    throw erro;
  }
  const vigenteDe = obrigatorio("--vigente-de", data("--vigente-de", texto("--vigente-de", valores["--vigente-de"], 10)));
  const vigenteAte = data("--vigente-ate", texto("--vigente-ate", valores["--vigente-ate"], 10));
  if (vigenteAte !== null && vigenteAte < vigenteDe) {
    throw new ErroDaCarga(`--vigente-ate (${vigenteAte}) antes do início (--vigente-de ${vigenteDe}).`);
  }

  const cliente = texto("--cliente", valores["--cliente"], 120);
  if (cliente !== null && (cliente.includes("/") || CONTROLE.test(cliente))) {
    throw new ErroDaCarga("--cliente: o customer_code não tem barra nem caractere de controle.");
  }
  const contrato = texto("--contrato", valores["--contrato"], 120);
  if (contrato !== null && !CONTRATO.test(contrato)) {
    throw new ErroDaCarga(`--contrato: "${contrato}" não é id de contrato (letras, números, "_" e "-").`);
  }
  if (contrato !== null && cliente === null) throw new ErroDaCarga("--contrato exige --cliente: a Padrão Dutelog não tem contrato.");

  const validadeTexto = texto("--validade-dias", valores["--validade-dias"], 3);
  let validade: number | null = null;
  if (validadeTexto !== null) {
    validade = /^\d+$/.test(validadeTexto) ? Number(validadeTexto) : NaN;
    if (!Number.isInteger(validade) || validade < 1 || validade > 365) {
      throw new ErroDaCarga("--validade-dias: número inteiro de dias, de 1 a 365.");
    }
  }

  const projeto = texto("--projeto", valores["--projeto"], 30);
  if (projeto !== null && !PROJETO.test(projeto)) throw new ErroDaCarga(`--projeto: "${projeto}" não é id de projeto do Google Cloud.`);
  if (executar && projeto === null) {
    throw new ErroDaCarga("--executar exige --projeto explícito (não há projeto padrão). Ex.: --projeto dute-homolog.");
  }
  const por = texto("--por", valores["--por"], 200);
  if (por !== null && !EMAIL.test(por)) throw new ErroDaCarga(`--por: "${por}" não é e-mail.`);

  return {
    arquivo,
    nome,
    cliente,
    contrato,
    variante,
    vigente_de: vigenteDe,
    vigente_ate: vigenteAte,
    rodape: texto("--rodape", valores["--rodape"], 1000),
    condicoes: texto("--condicoes", valores["--condicoes"], 4000),
    validade_dias: validade,
    projeto,
    executar,
    por,
  };
}

/**
 * Onde a carga pode gravar: projeto com o Comercial liberado
 * (domain/liberacao.ts) ou projeto de emulador ("demo-") com o emulador
 * ligado. Devolve o motivo da recusa, ou null.
 */
export function podeGravarNoProjeto(projeto: string, env: Record<string, string | undefined>): string | null {
  if (comercialLiberado(projeto)) return null;
  if (projeto.startsWith("demo-")) {
    return env.FIRESTORE_EMULATOR_HOST
      ? null
      : `O projeto ${projeto} é de emulador: rode com o emulador do Firestore ligado (FIRESTORE_EMULATOR_HOST).`;
  }
  return (
    `O Comercial não está liberado no projeto ${projeto} (liberado em: ${COMERCIAL_AMBIENTES_LIBERADOS.join(", ")}). ` +
    "A carga só grava onde as callables do Comercial atendem; a produção entra na parte 17, com o OK do Leonardo."
  );
}

// --- Leitura do CSV ---------------------------------------------------------------

export type ItemDaCarga = {
  id: string;
  categoria: string;
  item: string;
  servico: string;
  unidade: string;
  orcavel: boolean;
  codigo: string;
  descricao_cliente: string;
  /** Preço em texto decimal exato, sem zero à esquerda (as casas ficam como vieram). */
  preco: string;
  /** Linhas do arquivo com este item (mais de uma quando repetido igual). */
  linhas: number[];
};

export type CodigoRepetido = {
  codigo: string;
  itens: Array<{ id: string; item: string; servico: string; unidade: string; linhas: number[] }>;
};

export type LeituraDaTabela = {
  /** Linhas de dados do arquivo (sem o cabeçalho e as linhas vazias). */
  linhas: number;
  itens: ItemDaCarga[];
  erros: string[];
  avisos: string[];
  codigos_repetidos: CodigoRepetido[];
};

const CAMPOS_DE_TEXTO: Array<[keyof Omit<LinhaLida, "preco">, string, number]> = [
  ["codigo", "código", 40],
  ["categoria", "categoria", 80],
  ["item", "item", 200],
  ["servico", "serviço", 80],
  ["descricao", "descrição", 500],
  ["unidade", "unidade", 20],
];

type LinhaLida = { codigo: string; categoria: string; item: string; servico: string; descricao: string; unidade: string; preco: string };

const CODIGO = /^[\p{L}\p{N}](?:[\p{L}\p{N} ._/-]*[\p{L}\p{N}])?$/u;

type PrecoConferido = { texto: string; coeficiente: bigint; casas: number } | { problema: string };

function conferirPreco(valor: string): PrecoConferido {
  if (!valor) return { problema: "preço vazio" };
  try {
    const { coeficiente, casas } = lerDecimal(valor, CASAS_DO_PRECO, "preço");
    if (coeficiente < 0n || valor.startsWith("-")) {
      return { problema: `preço "${valor}" negativo: tabela não tem preço negativo (desconto é ajuste no orçamento)` };
    }
    const [inteiro, fracao] = valor.split(".");
    const textoCanonico = `${inteiro.replace(/^0+(?=\d)/, "")}${fracao === undefined ? "" : `.${fracao}`}`;
    return { texto: textoCanonico, coeficiente, casas };
  } catch (erro) {
    if (!(erro instanceof ErroDinheiro)) throw erro;
    if (erro.codigo === "CASAS_DEMAIS") {
      const casas = valor.split(".")[1]?.length ?? 0;
      const float = casas > 6 ? " (parece número de ponto flutuante do Excel: formate a coluna como texto com até 4 casas)" : "";
      return { problema: `preço "${valor}" com ${casas} casas decimais; o máximo é 4 casas${float}` };
    }
    if (erro.codigo === "FORA_DO_LIMITE") return { problema: `preço "${valor}" grande demais` };
    return { problema: `preço "${valor}" inválido: use número com ponto decimal, sem R$ e sem separador de milhar (ex.: 1234.56)` };
  }
}

/** Valor em décimos de milésimo (4 casas), para comparar preços escritos com casas diferentes. */
function emQuatroCasas(preco: { coeficiente: bigint; casas: number }): bigint {
  return preco.coeficiente * 10n ** BigInt(CASAS_DO_PRECO - preco.casas);
}

function erroDeArquivo(mensagem: string): LeituraDaTabela {
  return { linhas: 0, itens: [], erros: [mensagem], avisos: [], codigos_repetidos: [] };
}

/**
 * Lê o CSV da tabela. Junta todos os erros (com a linha do arquivo) em vez de
 * parar no primeiro, para o relatório mostrar tudo de uma vez:
 * - preço fora do formato exato (vírgula, R$, float, 5 casas, negativo);
 * - campo vazio, longo demais ou com caractere de controle;
 * - a mesma chave (categoria, item, serviço e unidade) duas vezes com preço ou
 *   código diferente. Repetida igual, entra uma vez, com aviso.
 * Código repetido em itens diferentes não é erro: vira itens distintos.
 */
export function lerTabelaCsv(bytes: Uint8Array): LeituraDaTabela {
  let registros;
  try {
    registros = lerCsv(decodificarUtf8(bytes));
  } catch (erro) {
    if (erro instanceof ErroDoCsv) return erroDeArquivo(erro.message);
    throw erro;
  }
  const [cabecalho, ...dados] = registros;
  const esperado = CABECALHO.join(";");
  if (!cabecalho) return erroDeArquivo(`O arquivo está vazio: falta o cabeçalho ${esperado}.`);
  if (cabecalho.campos.length === 1 && cabecalho.campos[0].includes(",")) {
    return erroDeArquivo(`O separador das colunas é ";" (ponto e vírgula), não vírgula. Cabeçalho esperado: ${esperado}.`);
  }
  const lido = cabecalho.campos.map(normalizarTexto).join(";");
  if (lido !== esperado) {
    return erroDeArquivo(`O cabeçalho é diferente do esperado: "${cabecalho.campos.join(";")}". Use exatamente: ${esperado}.`);
  }
  if (dados.length === 0) return erroDeArquivo("O arquivo não tem nenhuma linha de preço.");
  if (dados.length > MAXIMO_DE_LINHAS) return erroDeArquivo(`O arquivo tem ${dados.length} linhas; o máximo é ${MAXIMO_DE_LINHAS}.`);

  const erros: string[] = [];
  const avisos: string[] = [];
  const porId = new Map<string, ItemDaCarga & { valor: bigint }>();

  for (const registro of dados) {
    const numero = registro.numero;
    if (registro.campos.length !== CABECALHO.length) {
      erros.push(`linha ${numero}: ${registro.campos.length} colunas; o arquivo tem ${CABECALHO.length} colunas (${esperado}).`);
      continue;
    }
    const [codigo, categoria, item, servico, descricao, unidade, precoEscrito] = registro.campos.map(limparTexto);
    const linha: LinhaLida = { codigo, categoria, item, servico, descricao, unidade, preco: precoEscrito };
    const problemas: string[] = [];
    for (const [campo, rotulo, maximo] of CAMPOS_DE_TEXTO) {
      const valor = linha[campo];
      if (!valor) problemas.push(`${rotulo} vazio`);
      else if (valor.length > maximo) problemas.push(`${rotulo} com mais de ${maximo} caracteres`);
      else if (CONTROLE.test(valor)) problemas.push(`${rotulo} com caractere de controle`);
    }
    if (codigo && codigo.length <= 40 && !CODIGO.test(codigo)) {
      problemas.push(`código "${codigo}" fora do formato (letras, números, espaço, ponto, hífen e barra)`);
    }
    const preco = conferirPreco(precoEscrito);
    if ("problema" in preco) problemas.push(preco.problema);
    if (problemas.length > 0 || "problema" in preco) {
      erros.push(`linha ${numero}: ${problemas.join("; ")}.`);
      continue;
    }

    const id = lpuItemId({ categoria, item, servico, unidade });
    const valor = emQuatroCasas(preco);
    const existente = porId.get(id);
    if (existente) {
      const onde = `linhas ${existente.linhas[0]} e ${numero}`;
      const qual = `${existente.item} · ${existente.servico} · ${existente.unidade}`;
      if (existente.valor !== valor) {
        erros.push(`${onde}: o mesmo item (${qual}) com preços diferentes (${existente.preco} e ${preco.texto}).`);
      } else if (normalizarTexto(existente.codigo) !== normalizarTexto(codigo)) {
        erros.push(`${onde}: o mesmo item (${qual}) com códigos diferentes (${existente.codigo} e ${codigo}).`);
      } else {
        existente.linhas.push(numero);
        avisos.push(`${onde}: o mesmo item (${qual}, ${codigo}) repetido com o mesmo preço; entra uma vez.`);
      }
      continue;
    }
    if (valor === 0n) avisos.push(`linha ${numero}: preço zero (${codigo}).`);
    porId.set(id, {
      id,
      categoria,
      item,
      servico,
      unidade,
      orcavel: itemOrcavel({ categoria, servico }),
      codigo,
      descricao_cliente: descricao,
      preco: preco.texto,
      linhas: [numero],
      valor,
    });
  }

  const itens = [...porId.values()].map(({ valor: _valor, ...item }) => item);
  if (itens.length > MAXIMO_DE_ITENS) {
    erros.push(`A tabela tem ${itens.length} itens; o máximo por carga é ${MAXIMO_DE_ITENS} (uma transação).`);
  }

  const porCodigo = new Map<string, ItemDaCarga[]>();
  for (const item of itens) {
    const chave = normalizarTexto(item.codigo);
    porCodigo.set(chave, [...(porCodigo.get(chave) ?? []), item]);
  }
  const codigosRepetidos: CodigoRepetido[] = [];
  for (const grupo of porCodigo.values()) {
    if (grupo.length < 2) continue;
    codigosRepetidos.push({
      codigo: grupo[0].codigo,
      itens: grupo.map(({ id, item, servico, unidade, linhas }) => ({ id, item, servico, unidade, linhas })),
    });
    avisos.push(
      `código ${grupo[0].codigo} em ${grupo.length} itens distintos, separados por item, serviço e unidade ` +
        `(linhas ${grupo.map((item) => item.linhas[0]).join(", ")}).`,
    );
  }

  return { linhas: dados.length, itens, erros, avisos, codigos_repetidos: codigosRepetidos };
}

// --- Plano da carga ------------------------------------------------------------------

export type PlanoDaCarga = {
  args: ArgumentosDaCarga;
  fonte: { arquivo: string; sha256: string; linhas: number };
  leitura: LeituraDaTabela;
  identidade: IdentidadeDaTabela;
  tabela_id: string;
  chave_vigencia: string;
  variante_chave: string;
  precos: Record<string, PrecoDaTabela>;
  soma_dos_precos: string;
  por_categoria: Record<string, number>;
  nao_orcaveis: number;
  erros: string[];
  avisos: string[];
};

/** Soma exata dos preços, com as casas do preço que tem mais casas. */
function somaDosPrecos(itens: readonly ItemDaCarga[]): string {
  const lidos = itens.map((item) => lerDecimal(item.preco, CASAS_DO_PRECO));
  const casas = Math.max(0, ...lidos.map((lido) => lido.casas));
  const total = lidos.reduce((soma, lido) => soma + lido.coeficiente * 10n ** BigInt(casas - lido.casas), 0n);
  if (casas === 0) return total.toString();
  const digitos = total.toString().padStart(casas + 1, "0");
  return `${digitos.slice(0, -casas)}.${digitos.slice(-casas)}`;
}

/** Tudo o que se sabe só com o arquivo e os parâmetros, sem o banco. */
export function planejarCarga(args: ArgumentosDaCarga, arquivo: { nome: string; bytes: Uint8Array }): PlanoDaCarga {
  const sha256 = createHash("sha256").update(arquivo.bytes).digest("hex");
  const leitura = lerTabelaCsv(arquivo.bytes);
  const identidade: IdentidadeDaTabela = { customer_code: args.cliente, contract_id: args.contrato, variante: args.variante };
  const precos: Record<string, PrecoDaTabela> = {};
  const categorias = new Map<string, { rotulo: string; itens: number }>();
  for (const item of leitura.itens) {
    precos[item.id] = { codigo: item.codigo, descricao_cliente: item.descricao_cliente, preco: item.preco };
    const chave = normalizarTexto(item.categoria);
    const categoria = categorias.get(chave) ?? { rotulo: item.categoria, itens: 0 };
    categoria.itens += 1;
    categorias.set(chave, categoria);
  }
  const erros = [...leitura.erros];
  if (leitura.erros.length === 0 && Buffer.byteLength(JSON.stringify(precos), "utf8") > MAXIMO_DOS_PRECOS_EM_BYTES) {
    erros.push("Os preços passam do tamanho de um documento do Firestore; divida a tabela.");
  }
  return {
    args,
    fonte: { arquivo: arquivo.nome, sha256, linhas: leitura.linhas },
    leitura,
    identidade,
    tabela_id: priceTableId(identidade, args.vigente_de),
    chave_vigencia: chaveDeVigencia(identidade),
    variante_chave: normalizarVariante(args.variante),
    precos,
    soma_dos_precos: leitura.erros.length === 0 ? somaDosPrecos(leitura.itens) : "",
    por_categoria: Object.fromEntries([...categorias.values()].map(({ rotulo, itens }) => [rotulo, itens])),
    nao_orcaveis: leitura.itens.filter((item) => !item.orcavel).length,
    erros,
    avisos: [...leitura.avisos],
  };
}

// --- Banco -------------------------------------------------------------------------------

type Leitor = {
  doc(ref: DocumentReference): Promise<DocumentSnapshot>;
  consulta(query: Query): Promise<QuerySnapshot>;
  varios(refs: DocumentReference[]): Promise<DocumentSnapshot[]>;
};

function leitorDireto(db: Firestore): Leitor {
  return {
    doc: (ref) => ref.get(),
    consulta: (query) => query.get(),
    varios: (refs) => (refs.length ? db.getAll(...refs) : Promise.resolve([])),
  };
}

function leitorDaTransacao(transaction: Transaction): Leitor {
  return {
    doc: (ref) => transaction.get(ref),
    consulta: (query) => transaction.get(query),
    varios: (refs) => (refs.length ? transaction.getAll(...refs) : Promise.resolve([])),
  };
}

type TabelaGravada = VigenciaDaTabela & { ref: DocumentReference };

type EstadoDoBanco = {
  /** null quando a tabela é a Padrão (sem cliente). */
  cliente_no_cadastro: boolean | null;
  /** null quando a tabela não tem contrato. */
  contrato: { existe: boolean; customer_code: string | null } | null;
  tabelas: TabelaGravada[];
  itens_existentes: Set<string>;
};

function textoOuNull(valor: unknown): string | null {
  return typeof valor === "string" ? valor : null;
}

async function lerEstado(db: Firestore, leitor: Leitor, plano: PlanoDaCarga): Promise<EstadoDoBanco> {
  const { cliente, contrato } = plano.args;
  let clienteNoCadastro: boolean | null = null;
  if (cliente !== null) {
    const customers = db.collection("customers");
    const [porCodigo, porCampoAntigo] = await Promise.all([
      leitor.consulta(customers.where("customer_code", "==", cliente).limit(1)),
      leitor.consulta(customers.where("code", "==", cliente).limit(1)),
    ]);
    clienteNoCadastro = !porCodigo.empty || !porCampoAntigo.empty;
  }
  let contratoLido: EstadoDoBanco["contrato"] = null;
  if (contrato !== null) {
    const snapshot = await leitor.doc(db.collection("contracts").doc(contrato));
    contratoLido = { existe: snapshot.exists, customer_code: textoOuNull(snapshot.get("customer_code")) };
  }
  const tabelasSnapshot = await leitor.consulta(
    db.collection(PRICE_TABLES_COLLECTION).where("chave_vigencia", "==", plano.chave_vigencia),
  );
  const tabelas: TabelaGravada[] = tabelasSnapshot.docs.map((doc) => {
    const dados = doc.data();
    return {
      ref: doc.ref,
      id: doc.id,
      customer_code: textoOuNull(dados.customer_code),
      contract_id: textoOuNull(dados.contract_id),
      variante: String(dados.variante ?? ""),
      vigente_de: String(dados.vigente_de ?? ""),
      vigente_ate: textoOuNull(dados.vigente_ate),
      status: (STATUS_TABELA as readonly string[]).includes(dados.status) ? (dados.status as StatusTabela) : "ativa",
    };
  });
  const itens = await leitor.varios(plano.leitura.itens.map((item) => db.collection(LPU_ITEMS_COLLECTION).doc(item.id)));
  return {
    cliente_no_cadastro: clienteNoCadastro,
    contrato: contratoLido,
    tabelas,
    itens_existentes: new Set(itens.filter((item) => item.exists).map((item) => item.id)),
  };
}

type EstadoConferido = { vigencia: PlanoDeVigencia | null; erros: string[]; avisos: string[] };

function conferirEstado(plano: PlanoDaCarga, estado: EstadoDoBanco): EstadoConferido {
  const erros: string[] = [];
  const avisos: string[] = [];
  const { cliente, contrato } = plano.args;
  if (cliente !== null && estado.cliente_no_cadastro === false) {
    erros.push(`O cliente ${cliente} não está no cadastro (customers). Cadastre o cliente antes de carregar a tabela dele.`);
  }
  if (contrato !== null && estado.contrato) {
    if (!estado.contrato.existe) {
      avisos.push(`O contrato ${contrato} ainda não está em contracts: confira o id antes de executar.`);
    } else if (estado.contrato.customer_code !== cliente) {
      erros.push(`O contrato ${contrato} é de outro cliente (${estado.contrato.customer_code ?? "sem cliente"}).`);
    }
  }
  let vigencia: PlanoDeVigencia | null = null;
  try {
    vigencia = planejarVigencia(
      { ...plano.identidade, vigente_de: plano.args.vigente_de, vigente_ate: plano.args.vigente_ate },
      estado.tabelas,
    );
  } catch (erro) {
    if (!(erro instanceof ErroTabela)) throw erro;
    erros.push(erro.message);
  }
  return { vigencia, erros, avisos };
}

/** Entrada da operação: o que, com o mesmo arquivo, faz a carga ser a mesma. */
function entradaDaOperacao(plano: PlanoDaCarga) {
  const { args } = plano;
  return {
    sha256: plano.fonte.sha256,
    customer_code: args.cliente,
    contract_id: args.contrato,
    variante: args.variante,
    vigente_de: args.vigente_de,
    vigente_ate: args.vigente_ate,
    nome: args.nome,
    rodape: args.rodape,
    condicoes: args.condicoes,
    validade_dias: args.validade_dias,
  };
}

function operacaoDaCarga(plano: PlanoDaCarga, actor: ComercialActor) {
  return {
    kind: OPERACAO,
    scope: { sha256: plano.fonte.sha256 },
    idempotency_key: plano.fonte.sha256,
    input: entradaDaOperacao(plano),
    actor,
  };
}

type Recibo = { situacao: "nenhum" } | { situacao: "mesmo" | "outro"; tabela_id: string | null };

async function lerRecibo(db: Firestore, plano: PlanoDaCarga, actor: ComercialActor): Promise<Recibo> {
  const operacao = operacaoDaCarga(plano, actor);
  const id = operationDocId(operacao.kind, operacao.scope, operacao.idempotency_key);
  const snapshot = await db.collection(COMERCIAL_OPERATIONS_COLLECTION).doc(id).get();
  if (!snapshot.exists) return { situacao: "nenhum" };
  const tabelaId = textoOuNull(snapshot.get("result.tabela_id")) ?? textoOuNull(snapshot.get("target_id"));
  return { situacao: snapshot.get("input_hash") === inputHash(operacao.input) ? "mesmo" : "outro", tabela_id: tabelaId };
}

class ErroDeEstado extends Error {
  readonly erros: string[];

  constructor(erros: string[]) {
    super(erros.join(" "));
    this.name = "ErroDeEstado";
    this.erros = erros;
  }
}

type Gravado = {
  ok: true;
  tabela_id: string;
  status: StatusTabela;
  itens_novos: number;
  encerrou: string | null;
  events: string[];
};

async function gravar(db: Firestore, plano: PlanoDaCarga, actor: ComercialActor): Promise<Gravado & { replayed?: true }> {
  return runIdempotent<Gravado>(db, operacaoDaCarga(plano, actor), async (transaction, { operationId }) => {
    // Todas as leituras antes das escritas, dentro da transação.
    const estado = await lerEstado(db, leitorDaTransacao(transaction), plano);
    const conferido = conferirEstado(plano, estado);
    if (conferido.erros.length > 0 || !conferido.vigencia) throw new ErroDeEstado(conferido.erros);
    const vigencia = conferido.vigencia;
    const { args } = plano;

    const novos = plano.leitura.itens.filter((item) => !estado.itens_existentes.has(item.id));
    for (const item of novos) {
      const documento = lpuItemDoc({ ...item, descricao: item.descricao_cliente, origem_tabela_id: plano.tabela_id });
      transaction.create(db.collection(LPU_ITEMS_COLLECTION).doc(item.id), {
        ...documento,
        created_at: FieldValue.serverTimestamp(),
      });
    }

    if (vigencia.encerrar) {
      const anterior = estado.tabelas.find((tabela) => tabela.id === vigencia.encerrar?.id);
      if (!anterior) throw new ErroDeEstado([`A tabela ${vigencia.encerrar.id} sumiu durante a carga.`]);
      transaction.update(anterior.ref, {
        status: "encerrada",
        vigente_ate: vigencia.encerrar.vigente_ate,
        encerrada_por: plano.tabela_id,
        encerrada_em: FieldValue.serverTimestamp(),
      });
    }

    transaction.create(db.collection(PRICE_TABLES_COLLECTION).doc(plano.tabela_id), {
      id: plano.tabela_id,
      nome: args.nome,
      customer_code: args.cliente,
      contract_id: args.contrato,
      variante: args.variante,
      variante_chave: plano.variante_chave,
      chave_vigencia: plano.chave_vigencia,
      vigente_de: args.vigente_de,
      vigente_ate: args.vigente_ate,
      status: vigencia.status,
      substitui: vigencia.substitui,
      rodape: args.rodape,
      condicoes: args.condicoes,
      validade_dias: args.validade_dias,
      moeda: MOEDA_DAS_TABELAS,
      precos: plano.precos,
      fonte: plano.fonte,
      importado_por: actorPayload(actor),
      importado_em: FieldValue.serverTimestamp(),
      operation_id: operationId,
      schema_version: PRICE_TABLE_SCHEMA_VERSION,
    });

    const events = [
      createComercialEvent(transaction, db, {
        operation_id: operationId,
        type: "price_table.imported",
        entity_id: plano.tabela_id,
        customer_code: args.cliente,
        payload: {
          tabela_id: plano.tabela_id,
          variante: plano.variante_chave,
          linhas: plano.leitura.itens.length,
          itens_novos: novos.length,
          vigencia_inicio: args.vigente_de,
          vigencia_fim: args.vigente_ate,
          contrato_id: args.contrato,
          substitui: vigencia.substitui,
        },
        actor,
      }).id,
    ];
    if (vigencia.encerrar) {
      events.push(
        createComercialEvent(transaction, db, {
          operation_id: operationId,
          type: "price_table.closed",
          entity_id: vigencia.encerrar.id,
          customer_code: args.cliente,
          payload: {
            tabela_id: vigencia.encerrar.id,
            variante: plano.variante_chave,
            vigencia_fim: vigencia.encerrar.vigente_ate,
            substituida_por: plano.tabela_id,
            contrato_id: args.contrato,
          },
          actor,
        }).id,
      );
    }

    return {
      target_id: plano.tabela_id,
      result: {
        ok: true,
        tabela_id: plano.tabela_id,
        status: vigencia.status,
        itens_novos: novos.length,
        encerrou: vigencia.encerrar?.id ?? null,
        events,
      },
    };
  });
}

// --- Relatório -----------------------------------------------------------------------------

export type ResultadoDaCarga = {
  ok: boolean;
  modo: "dry-run" | "executar";
  gravou: boolean;
  replayed: boolean;
  tabela_id: string | null;
  status: StatusTabela | null;
  itens_novos: number | null;
  encerrou: string | null;
  erros: string[];
  avisos: string[];
  relatorio: string | null;
};

function celula(valor: unknown): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

function escreverRelatorio(
  pasta: string,
  agora: Date,
  plano: PlanoDaCarga,
  resultado: ResultadoDaCarga,
  extra: { vigencia: PlanoDeVigencia | null; itens_existentes: Set<string> | null },
): string {
  mkdirSync(pasta, { recursive: true });
  const carimbo = agora.toISOString().replace(/[:.]/g, "-");
  const base = join(pasta, `tabela-${carimbo}-${plano.fonte.sha256.slice(0, 8)}-${resultado.modo}`);
  const { args } = plano;
  const relatorio = {
    gerado_em: agora.toISOString(),
    modo: resultado.modo,
    projeto: args.projeto,
    parametros: {
      nome: args.nome,
      cliente: args.cliente,
      contrato: args.contrato,
      variante: args.variante,
      vigente_de: args.vigente_de,
      vigente_ate: args.vigente_ate,
      rodape: args.rodape,
      condicoes: args.condicoes,
      validade_dias: args.validade_dias,
    },
    fonte: plano.fonte,
    tabela: {
      id: plano.tabela_id,
      chave_vigencia: plano.chave_vigencia,
      status: extra.vigencia?.status ?? null,
      substitui: extra.vigencia?.substitui ?? null,
      encerrar: extra.vigencia?.encerrar ?? null,
    },
    itens: {
      total: plano.leitura.itens.length,
      novos: extra.itens_existentes ? plano.leitura.itens.filter((item) => !extra.itens_existentes?.has(item.id)).length : null,
      nao_orcaveis: plano.nao_orcaveis,
      por_categoria: plano.por_categoria,
    },
    soma_dos_precos: plano.soma_dos_precos,
    codigos_repetidos: plano.leitura.codigos_repetidos,
    avisos: resultado.avisos,
    erros: resultado.erros,
    resultado: {
      ok: resultado.ok,
      gravou: resultado.gravou,
      replayed: resultado.replayed,
      tabela_id: resultado.tabela_id,
      status: resultado.status,
      itens_novos: resultado.itens_novos,
      encerrou: resultado.encerrou,
    },
  };
  writeFileSync(`${base}.json`, `${JSON.stringify(relatorio, null, 2)}\n`, "utf8");
  const linhas = [
    "id;codigo;categoria;item;servico;unidade;orcavel;preco;linhas;novo",
    ...plano.leitura.itens.map((item) =>
      [
        item.id,
        item.codigo,
        item.categoria,
        item.item,
        item.servico,
        item.unidade,
        item.orcavel ? "sim" : "nao",
        item.preco,
        item.linhas.join(" "),
        extra.itens_existentes ? (extra.itens_existentes.has(item.id) ? "nao" : "sim") : "",
      ]
        .map(celula)
        .join(";"),
    ),
  ];
  writeFileSync(`${base}.csv`, `﻿${linhas.join("\r\n")}\r\n`, "utf8");
  return `${base}.json`;
}

// --- Execução ---------------------------------------------------------------------------------

export type Dependencias = {
  /** Abre o Firestore do projeto. Padrão: firebase-admin com as credenciais da máquina. */
  abrirBanco?: (projeto: string) => Firestore;
  /** Padrão: tmp/comercial/ na raiz do repositório. */
  pastaDoRelatorio?: string;
  agora?: () => Date;
  env?: Record<string, string | undefined>;
  log?: (linha: string) => void;
};

function abrirBancoPadrao(projeto: string): Firestore {
  return getFirestore(initializeApp({ projectId: projeto }, `carga-tabela-${projeto}`));
}

function atorDaCarga(args: ArgumentosDaCarga): ComercialActor {
  let usuario = "";
  try {
    usuario = userInfo().username;
  } catch {
    usuario = "";
  }
  return {
    uid: "carga-tabela",
    role: "carga",
    ...(args.por ? { email: args.por } : {}),
    ...(usuario ? { name: usuario } : {}),
  };
}

/**
 * Roda a carga. Erro de argumento, de projeto ou de leitura do arquivo é
 * ErroDaCarga (nada lido do banco). Erro do arquivo ou do estado do banco
 * volta em `erros`, com `ok: false` e o relatório gravado.
 */
export async function rodarCarga(argv: readonly string[], deps: Dependencias = {}): Promise<ResultadoDaCarga> {
  const log = deps.log ?? ((linha: string) => console.log(linha));
  const env = deps.env ?? process.env;
  const args = lerArgumentos(argv);
  if (args.executar) {
    const problema = podeGravarNoProjeto(args.projeto as string, env);
    if (problema) throw new ErroDaCarga(problema);
  }
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(args.arquivo);
  } catch {
    throw new ErroDaCarga(`Não consegui ler o arquivo ${args.arquivo}.`);
  }

  const plano = planejarCarga(args, { nome: basename(args.arquivo), bytes });
  const actor = atorDaCarga(args);
  const resultado: ResultadoDaCarga = {
    ok: false,
    modo: args.executar ? "executar" : "dry-run",
    gravou: false,
    replayed: false,
    tabela_id: plano.tabela_id,
    status: null,
    itens_novos: null,
    encerrou: null,
    erros: [...plano.erros],
    avisos: [...plano.avisos],
    relatorio: null,
  };
  const extra: { vigencia: PlanoDeVigencia | null; itens_existentes: Set<string> | null } = {
    vigencia: null,
    itens_existentes: null,
  };

  if (resultado.erros.length === 0 && args.projeto !== null) {
    const db = (deps.abrirBanco ?? abrirBancoPadrao)(args.projeto);
    const recibo = await lerRecibo(db, plano, actor);
    if (recibo.situacao === "outro") {
      resultado.erros.push(
        `Este arquivo (sha256 ${plano.fonte.sha256.slice(0, 12)}…) já foi carregado com outros parâmetros ` +
          `(tabela ${recibo.tabela_id ?? "?"}). Um arquivo é uma tabela só.`,
      );
    } else if (recibo.situacao === "mesmo") {
      resultado.tabela_id = recibo.tabela_id ?? plano.tabela_id;
      resultado.avisos.push(`Este arquivo já foi carregado com estes parâmetros (tabela ${resultado.tabela_id}): nada a gravar.`);
    } else {
      const estado = await lerEstado(db, leitorDireto(db), plano);
      const conferido = conferirEstado(plano, estado);
      resultado.erros.push(...conferido.erros);
      resultado.avisos.push(...conferido.avisos);
      extra.vigencia = conferido.vigencia;
      extra.itens_existentes = estado.itens_existentes;
      resultado.status = conferido.vigencia?.status ?? null;
      resultado.encerrou = conferido.vigencia?.encerrar?.id ?? null;
      resultado.itens_novos = plano.leitura.itens.filter((item) => !estado.itens_existentes.has(item.id)).length;
    }

    if (args.executar && resultado.erros.length === 0) {
      try {
        const gravado = await gravar(db, plano, actor);
        resultado.replayed = gravado.replayed === true;
        resultado.gravou = !resultado.replayed;
        resultado.tabela_id = gravado.tabela_id;
        resultado.status = gravado.status;
        resultado.itens_novos = gravado.itens_novos;
        resultado.encerrou = gravado.encerrou;
      } catch (erro) {
        if (erro instanceof ErroDeEstado) {
          resultado.erros.push(...erro.erros);
        } else if (erro instanceof HttpsError && erro.code === "already-exists") {
          resultado.erros.push(
            `Este arquivo (sha256 ${plano.fonte.sha256.slice(0, 12)}…) já foi carregado com outros parâmetros. Um arquivo é uma tabela só.`,
          );
        } else {
          throw erro;
        }
      }
    }
  }

  resultado.ok = resultado.erros.length === 0;
  resultado.relatorio = escreverRelatorio(deps.pastaDoRelatorio ?? PASTA_DO_RELATORIO, (deps.agora ?? (() => new Date()))(), plano, resultado, extra);
  imprimirResumo(log, plano, resultado, env);
  return resultado;
}

function imprimirResumo(
  log: (linha: string) => void,
  plano: PlanoDaCarga,
  resultado: ResultadoDaCarga,
  env: Record<string, string | undefined>,
): void {
  const { args } = plano;
  const emulador = env.FIRESTORE_EMULATOR_HOST ? ` (emulador ${env.FIRESTORE_EMULATOR_HOST})` : "";
  log(`Carga de tabela: ${resultado.modo}, ${args.projeto ? `projeto ${args.projeto}${emulador}` : "sem projeto (só o arquivo)"}`);
  const plural = (quantidade: number, um: string, varios: string) => `${quantidade} ${quantidade === 1 ? um : varios}`;
  log(
    `Arquivo: ${plano.fonte.arquivo} (sha256 ${plano.fonte.sha256.slice(0, 12)}…), ${plural(plano.fonte.linhas, "linha", "linhas")}, ` +
      `${plural(plano.leitura.itens.length, "item", "itens")}, ${plural(plano.nao_orcaveis, "não orçável", "não orçáveis")}`,
  );
  log(
    `Tabela ${plano.tabela_id}: ${args.nome} · ${args.cliente ?? "Padrão Dutelog"}${args.contrato ? ` · contrato ${args.contrato}` : ""} · ` +
      `${args.variante} · ${args.vigente_de} a ${args.vigente_ate ?? "em aberto"}`,
  );
  if (resultado.status) {
    log(`Vigência: entra ${resultado.status}${resultado.encerrou ? `, encerra ${resultado.encerrou}` : ""}${resultado.itens_novos !== null ? `; ${resultado.itens_novos} itens novos no catálogo` : ""}`);
  }
  for (const aviso of resultado.avisos) log(`Aviso: ${aviso}`);
  for (const erro of resultado.erros) log(`Erro: ${erro}`);
  log(`Relatório: ${resultado.relatorio}`);
  if (!resultado.ok) log("Resultado: nada gravado (corrija os erros acima).");
  else if (resultado.gravou) log("Resultado: gravado.");
  else if (resultado.replayed) log("Resultado: já estava gravado; nada mudou.");
  else log("Resultado: nada gravado (dry-run). Para gravar: --projeto <projeto> --executar.");
}

export async function main(argv: readonly string[]): Promise<number> {
  try {
    const resultado = await rodarCarga(argv);
    return resultado.ok ? 0 : 1;
  } catch (erro) {
    if (erro instanceof ErroDaCarga) {
      console.error(`Erro: ${erro.message}`);
      console.error(USO);
      return 2;
    }
    console.error(erro);
    return 1;
  } finally {
    await Promise.all(getApps().map((app) => deleteApp(app)));
  }
}

function executadoDireto(): boolean {
  const script = process.argv[1];
  if (!script) return false;
  const chamado = resolve(script);
  const este = fileURLToPath(import.meta.url);
  return process.platform === "win32" ? chamado.toLowerCase() === este.toLowerCase() : chamado === este;
}

if (executadoDireto()) {
  void main(process.argv.slice(2)).then((codigo) => {
    process.exitCode = codigo;
  });
}
