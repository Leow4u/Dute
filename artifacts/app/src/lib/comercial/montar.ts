import {
  CASAS_DA_QUANTIDADE,
  CASAS_DO_PRECO,
  centavosDaLinha,
  formatarReais,
  lerDecimal,
  somarCentavos,
} from "@workspace/dominio";

import { contratosDoCliente, type ContatoResumo, type ContratoResumo } from "./clientes";
import { dataHoraCurta, type EtapaDemanda, type OrigemLinha, type StatusOrcamento } from "./orcamentos";

/**
 * Regras puras da tela de montar orçamento do Comercial
 * (docs/mockups/ComOrcamento.dc.html; parte 11 de
 * docs/plataforma/fase-6-comercial.md): o formulário a partir da demanda e do
 * orçamento gravados, a grade no jeito do Excel (busca de item da tabela pelo
 * teclado, sugestão dos outros serviços do mesmo item), a linha alterada,
 * avulsa e de ajuste com motivo, a prévia dos totais e as chamadas de
 * saveQuote e advanceQuote (functions/comercial, domain/quotes.ts).
 *
 * A prévia usa a conta de lib/dominio (dinheiro.ts); o valor que vale é o
 * que o servidor devolve, porque ele sempre recalcula pela tabela da
 * data-base.
 */

type Registro = Record<string, unknown>;

function texto(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function opcional(value: unknown): string | null {
  return texto(value) || null;
}

function isRegistro(value: unknown): value is Registro {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Sem acento e em minúsculas. */
function semAcento(value: unknown): string {
  return texto(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** As variantes da alternância do cabeçalho (só em rascunho). */
export const VARIANTES = ["Comercial", "Noturna"] as const;
export const VARIANTE_PADRAO = VARIANTES[0];

// --- Números ---------------------------------------------------------------------------

/**
 * O número como a pessoa digita ("1.234,56", "1,5", "38.50", "R$ 400") em
 * decimal com ponto ("1234.56"), o formato que lib/dominio e a callable
 * aceitam. Com vírgula, ela é a decimal e os pontos são milhar; sem vírgula,
 * "1.234" é milhar e "38.50" é decimal. Texto que não é número: null.
 */
export function paraDecimal(valor: string): string | null {
  let bruto = String(valor ?? "")
    .replace(/R\$/gi, "")
    .replace(/[\s ]/g, "")
    .replace(/−/g, "-");
  if (!bruto) return null;
  let sinal = "";
  if (bruto.startsWith("-")) {
    sinal = "-";
    bruto = bruto.slice(1);
  }
  if (!bruto || bruto.includes("-")) return null;
  let inteiro: string;
  let fracao: string | undefined;
  if (bruto.includes(",")) {
    const partes = bruto.split(",");
    if (partes.length !== 2) return null;
    if (!/^(?:\d{1,3}(?:\.\d{3})*|\d*)$/.test(partes[0]) || !/^\d+$/.test(partes[1])) return null;
    inteiro = partes[0].replace(/\./g, "");
    fracao = partes[1];
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(bruto)) {
    inteiro = bruto.replace(/\./g, "");
  } else {
    const partes = /^(\d*)(?:\.(\d+))?$/.exec(bruto);
    if (!partes || (!partes[1] && !partes[2])) return null;
    inteiro = partes[1];
    fracao = partes[2];
  }
  return `${sinal}${inteiro || "0"}${fracao !== undefined ? `.${fracao}` : ""}`;
}

/** Decimal com ponto em pt-BR, com as casas mínimas: "1234.5" → "1.234,50". */
export function formatarDecimal(decimal: string, minCasas = 0): string {
  const partes = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(decimal ?? "").trim());
  if (!partes) return String(decimal ?? "");
  const [, sinal, inteiroBruto, fracaoBruta = ""] = partes;
  const inteiro = inteiroBruto.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fracao = fracaoBruta.replace(/0+$/, "").padEnd(minCasas, "0");
  return `${sinal}${inteiro}${fracao ? `,${fracao}` : ""}`;
}

function semSinal(decimal: string): string {
  return decimal.replace(/^-/, "");
}

/** O valor do ajuste é sempre desconto: negativo, digitado com ou sem o sinal. */
function negativo(decimal: string): string {
  return `-${semSinal(decimal)}`;
}

function decimalValido(decimal: string | null, casas: number): { coeficiente: bigint } | null {
  if (!decimal) return null;
  try {
    return lerDecimal(decimal, casas, "valor");
  } catch {
    return null;
  }
}

/** Dois preços são o mesmo número ("38.5", "38.50", "38.5000"). */
function mesmoPreco(a: string, b: string): boolean {
  try {
    const x = lerDecimal(a, CASAS_DO_PRECO, "preço");
    const y = lerDecimal(b, CASAS_DO_PRECO, "preço");
    const casas = Math.max(x.casas, y.casas);
    return x.coeficiente * 10n ** BigInt(casas - x.casas) === y.coeficiente * 10n ** BigInt(casas - y.casas);
  } catch {
    return false;
  }
}

// --- Catálogo da tabela --------------------------------------------------------------------

/** O item de `lpu_items` (sem preço). */
export type ItemDoCatalogoDoc = {
  item: string;
  categoria: string;
  servico: string;
  unidade: string;
  descricao: string;
  orcavel: boolean;
  ativo: boolean;
};

export function itemDoCatalogoDoDocumento(data: Registro): ItemDoCatalogoDoc {
  return {
    item: texto(data.item),
    categoria: texto(data.categoria),
    servico: texto(data.servico),
    unidade: texto(data.unidade),
    descricao: texto(data.descricao),
    orcavel: data.orcavel !== false,
    ativo: data.ativo !== false,
  };
}

/** Um item da tabela do orçamento, com o código e o preço dela. */
export type ItemDaTabela = {
  lpuItemId: string;
  codigo: string | null;
  item: string;
  categoria: string;
  servico: string;
  unidade: string;
  descricao: string;
  /** Preço unitário da tabela, decimal com ponto. */
  preco: string;
};

/**
 * Os itens que se orçam pela tabela (`price_tables/{id}.precos`), com o nome,
 * o serviço e a unidade do catálogo. Armazenagem (não se orça) e item inativo
 * ficam fora; item que o catálogo não trouxe entra com a descrição da tabela.
 */
export function catalogoDaTabela(precos: unknown, itens: ReadonlyMap<string, ItemDoCatalogoDoc>): ItemDaTabela[] {
  if (!isRegistro(precos)) return [];
  const catalogo: ItemDaTabela[] = [];
  for (const [id, valor] of Object.entries(precos)) {
    if (!isRegistro(valor) || !texto(valor.preco)) continue;
    const doc = itens.get(id);
    if (doc && (!doc.orcavel || !doc.ativo)) continue;
    catalogo.push({
      lpuItemId: id,
      codigo: opcional(valor.codigo),
      item: doc?.item || texto(valor.descricao_cliente) || id,
      categoria: doc?.categoria ?? "",
      servico: doc?.servico ?? "",
      unidade: doc?.unidade ?? "",
      descricao: texto(valor.descricao_cliente) || doc?.descricao || "",
      preco: texto(valor.preco),
    });
  }
  return catalogo.sort(
    (a, b) =>
      (a.codigo ?? "￿").localeCompare(b.codigo ?? "￿", "pt-BR", { numeric: true }) ||
      a.item.localeCompare(b.item, "pt-BR"),
  );
}

const SEPARADORES = /[\s–—\-/(),;:]+/;

/**
 * Os pedaços do texto, sem acento: a vírgula entre dígitos é a decimal da
 * medida ("1,20" fica "1.20", um pedaço só), não um separador.
 */
function pedacos(value: string): string[] {
  return semAcento(value)
    .replace(/(\d),(?=\d)/g, "$1.")
    .split(SEPARADORES)
    .filter(Boolean);
}

/** As palavras do item: os pedaços e, na medida "1.20x1.20m", também cada lado ("1.20", "1.20m"). */
function palavras(value: string): string[] {
  return pedacos(value).flatMap((pedaco) => (/\dx\d/.test(pedaco) ? [pedaco, ...pedaco.split(/(?<=\d)x(?=\d)/)] : [pedaco]));
}

/**
 * Busca de item da tabela pelo teclado: cada termo digitado começa o código
 * ou, pedaço a pedaço, palavras do código, do item, do serviço, da unidade ou
 * da descrição ("3.0", "estacao montagem", "estacao 1,20", "1,40x1,20"). O
 * código que começa com o termo vem antes. `total` é quantos acharam, além
 * dos `limite` que a lista mostra.
 */
export function buscaNaTabela(
  catalogo: readonly ItemDaTabela[],
  termo: string,
  limite = 8,
): { itens: ItemDaTabela[]; total: number } {
  const termos = semAcento(termo)
    .split(/\s+/)
    .map((bruto) => ({ bruto, partes: pedacos(bruto) }))
    .filter((t) => t.partes.length > 0);
  if (!termos.length) return { itens: [], total: 0 };
  const achados = catalogo.filter((item) => {
    const codigo = semAcento(item.codigo);
    const alvo = palavras([item.codigo, item.item, item.servico, item.unidade, item.descricao, item.categoria].filter(Boolean).join(" "));
    return termos.every(
      ({ bruto, partes }) => codigo.startsWith(bruto) || partes.every((parte) => alvo.some((palavra) => palavra.startsWith(parte))),
    );
  });
  const peloCodigo = (item: ItemDaTabela) => Number(semAcento(item.codigo).startsWith(termos[0].bruto));
  const itens = achados
    .map((item, indice) => ({ item, indice }))
    .sort((a, b) => peloCodigo(b.item) - peloCodigo(a.item) || a.indice - b.indice)
    .slice(0, limite)
    .map(({ item }) => item);
  return { itens, total: achados.length };
}

/** Os itens que a lista da busca mostra (buscaNaTabela). */
export function buscarItensDaTabela(catalogo: readonly ItemDaTabela[], termo: string, limite = 8): ItemDaTabela[] {
  return buscaNaTabela(catalogo, termo, limite).itens;
}

/** A ordem dos serviços na sugestão: o caminho do móvel. */
const ORDEM_DOS_SERVICOS = ["desmontagem", "transporte", "montagem"];

function chaveDoItem(item: { categoria?: string; item: string }): string {
  return `${semAcento(item.categoria ?? "")}|${semAcento(item.item)}`;
}

/**
 * Os outros serviços do mesmo item (transporte, desmontagem, montagem) que
 * estão na tabela e ainda não entraram no orçamento.
 */
export function servicosIrmaos(
  origem: ItemDaTabela,
  catalogo: readonly ItemDaTabela[],
  linhas: readonly LinhaForm[],
): ItemDaTabela[] {
  const presentes = new Set(linhas.map((linha) => linha.lpuItemId).filter(Boolean));
  const chave = chaveDoItem(origem);
  const ordem = (item: ItemDaTabela) => {
    const posicao = ORDEM_DOS_SERVICOS.indexOf(semAcento(item.servico));
    return posicao < 0 ? ORDEM_DOS_SERVICOS.length : posicao;
  };
  return catalogo
    .filter((item) => item.lpuItemId !== origem.lpuItemId && chaveDoItem(item) === chave && !presentes.has(item.lpuItemId))
    .sort((a, b) => ordem(a) - ordem(b) || a.servico.localeCompare(b.servico, "pt-BR"));
}

// --- Linhas do formulário -----------------------------------------------------------------

/** Tipo da linha na grade; "alterado" sai do preço digitado (origemDaLinha). */
export type TipoDaLinha = "tabela" | "avulso" | "ajuste";

export type LinhaForm = {
  /** Chave da linha na tela: o id do servidor, ou uma chave nova até salvar. */
  chave: string;
  /** Id da linha no servidor; a linha nova vai sem id. */
  id: string | null;
  origem: TipoDaLinha;
  lpuItemId: string | null;
  codigo: string | null;
  item: string;
  descricao: string;
  servico: string;
  unidade: string;
  /** Como a pessoa digitou (pt-BR). */
  quantidade: string;
  /** Como a pessoa digitou (pt-BR); no ajuste, o valor do desconto, sem o sinal. */
  preco: string;
  /** Preço da tabela (decimal com ponto), ao lado da linha alterada. */
  precoTabela: string | null;
  motivo: string;
  origemLocal: string | null;
  destinoLocal: string | null;
};

function linhaVazia(chave: string, origem: TipoDaLinha): LinhaForm {
  return {
    chave,
    id: null,
    origem,
    lpuItemId: null,
    codigo: null,
    item: "",
    descricao: "",
    servico: "",
    unidade: "",
    quantidade: "1",
    preco: "",
    precoTabela: null,
    motivo: "",
    origemLocal: null,
    destinoLocal: null,
  };
}

/** Linha de item fora da tabela: item, serviço, unidade, preço e motivo digitados. */
export function linhaAvulsa(chave: string): LinhaForm {
  return linhaVazia(chave, "avulso");
}

/** Linha de ajuste: desconto com motivo, quantidade 1. */
export function linhaDeAjuste(chave: string): LinhaForm {
  return linhaVazia(chave, "ajuste");
}

/** Linha nova de um item da tabela, com o preço dela. */
export function linhaDaTabela(item: ItemDaTabela, chave: string, quantidade = "1"): LinhaForm {
  return {
    ...linhaVazia(chave, "tabela"),
    lpuItemId: item.lpuItemId,
    codigo: item.codigo,
    item: item.item,
    descricao: item.descricao,
    servico: item.servico,
    unidade: item.unidade,
    quantidade,
    preco: formatarDecimal(item.preco, 2),
    precoTabela: item.preco,
  };
}

/** A linha gravada (`quotes/{numero}.linhas`) como a grade mostra. */
export function linhaDoServidor(linha: Registro): LinhaForm {
  const origemGravada = texto(linha.origem);
  const origem: TipoDaLinha = origemGravada === "avulso" || origemGravada === "ajuste" ? origemGravada : "tabela";
  const id = opcional(linha.id);
  const preco = texto(linha.preco);
  return {
    chave: id ?? `servidor-${texto(linha.lpu_item_id)}-${texto(linha.quantidade)}`,
    id,
    origem,
    lpuItemId: opcional(linha.lpu_item_id),
    codigo: opcional(linha.codigo),
    item: texto(linha.item),
    descricao: texto(linha.descricao) || (origem === "tabela" ? "" : texto(linha.item)),
    servico: texto(linha.servico),
    unidade: texto(linha.unidade),
    quantidade: formatarDecimal(texto(linha.quantidade), 0),
    preco: formatarDecimal(origem === "ajuste" ? semSinal(preco) : preco, 2),
    precoTabela: opcional(linha.preco_tabela),
    motivo: texto(linha.motivo),
    origemLocal: opcional(linha.origem_local),
    destinoLocal: opcional(linha.destino_local),
  };
}

/** A origem do preço que a linha vai ter: a de tabela com outro preço é "alterado". */
export function origemDaLinha(linha: LinhaForm): OrigemLinha {
  if (linha.origem !== "tabela") return linha.origem;
  const preco = paraDecimal(linha.preco);
  if (!preco || !linha.precoTabela) return "tabela";
  return mesmoPreco(preco, linha.precoTabela) ? "tabela" : "alterado";
}

/** Adiciona o item da tabela no fim; o foco vai para a quantidade da linha nova. */
export function adicionarDaTabela(
  linhas: readonly LinhaForm[],
  item: ItemDaTabela,
  chave: string,
  quantidade = "1",
): { linhas: LinhaForm[]; foco: string } {
  return { linhas: [...linhas, linhaDaTabela(item, chave, quantidade)], foco: chave };
}

/**
 * Adiciona o serviço sugerido com a mesma quantidade da linha de origem, logo
 * depois dela (e dos serviços do mesmo item que já vieram atrás).
 */
export function adicionarSugestao(
  linhas: readonly LinhaForm[],
  origemChave: string,
  item: ItemDaTabela,
  chave: string,
): { linhas: LinhaForm[]; foco: string } {
  const indice = linhas.findIndex((linha) => linha.chave === origemChave);
  if (indice < 0) return adicionarDaTabela(linhas, item, chave);
  const origem = linhas[indice];
  let posicao = indice + 1;
  while (posicao < linhas.length && linhas[posicao].lpuItemId && semAcento(linhas[posicao].item) === semAcento(origem.item)) {
    posicao += 1;
  }
  const nova = linhaDaTabela(item, chave, origem.quantidade);
  return { linhas: [...linhas.slice(0, posicao), nova, ...linhas.slice(posicao)], foco: chave };
}

/** Campo que recebe o foco depois de adicionar a linha. */
export type CampoDoFoco = "quantidade" | "descricao";

/** Item avulso no fim; o foco vai para a descrição (o item) da linha nova. */
export function adicionarAvulsa(
  linhas: readonly LinhaForm[],
  chave: string,
): { linhas: LinhaForm[]; foco: string; campo: CampoDoFoco } {
  return { linhas: [...linhas, linhaAvulsa(chave)], foco: chave, campo: "descricao" };
}

/** Ajuste no fim; o foco vai para a descrição da linha nova. */
export function adicionarAjuste(
  linhas: readonly LinhaForm[],
  chave: string,
): { linhas: LinhaForm[]; foco: string; campo: CampoDoFoco } {
  return { linhas: [...linhas, linhaDeAjuste(chave)], foco: chave, campo: "descricao" };
}

export function removerLinha(linhas: readonly LinhaForm[], chave: string): LinhaForm[] {
  return linhas.filter((linha) => linha.chave !== chave);
}

/**
 * A tecla na busca de item: as setas andam pela lista (dando a volta), Enter
 * adiciona o destacado e Esc fecha a lista.
 */
export function teclaNaBusca(
  tecla: string,
  estado: { destacado: number; total: number },
): { destacado: number; acao: "adicionar" | "fechar" | null } {
  const { destacado, total } = estado;
  if (tecla === "ArrowDown" && total > 0) return { destacado: (destacado + 1) % total, acao: null };
  if (tecla === "ArrowUp" && total > 0) return { destacado: (destacado - 1 + total) % total, acao: null };
  if (tecla === "Enter") return { destacado, acao: total > 0 ? "adicionar" : null };
  if (tecla === "Escape") return { destacado: 0, acao: "fechar" };
  return { destacado, acao: null };
}

// --- Prévia e validação -------------------------------------------------------------------

export type Previa = {
  /** Centavos de cada linha pela chave; null quando a linha ainda não tem número válido. */
  porLinha: Record<string, number | null>;
  subtotalCents: number;
  ajustesCents: number;
  totalCents: number;
  /** Todas as linhas têm valor: o total é o que o servidor deve devolver. */
  completa: boolean;
};

function centavosDaLinhaDoForm(linha: LinhaForm): number | null {
  const preco = paraDecimal(linha.preco);
  if (!preco) return null;
  try {
    if (linha.origem === "ajuste") return centavosDaLinha("1", negativo(preco), { ajuste: true });
    const quantidade = paraDecimal(linha.quantidade);
    if (!quantidade) return null;
    return centavosDaLinha(quantidade, preco);
  } catch {
    return null;
  }
}

/** Prévia dos totais pela conta de lib/dominio (por linha, arredondada na linha). */
export function previaDosTotais(linhas: readonly LinhaForm[]): Previa {
  const porLinha: Record<string, number | null> = {};
  const itens: number[] = [];
  const ajustes: number[] = [];
  for (const linha of linhas) {
    const centavos = centavosDaLinhaDoForm(linha);
    porLinha[linha.chave] = centavos;
    if (centavos === null) continue;
    (linha.origem === "ajuste" ? ajustes : itens).push(centavos);
  }
  const subtotalCents = somarCentavos(itens);
  const ajustesCents = somarCentavos(ajustes);
  return {
    porLinha,
    subtotalCents,
    ajustesCents,
    totalCents: somarCentavos([subtotalCents, ajustesCents]),
    completa: Object.values(porLinha).every((valor) => valor !== null),
  };
}

/**
 * Limites do schema da saveQuote (functions/comercial, quotes.ts,
 * `linhaEntrada`), travados por montar.test.ts: o motivo até 300; o item
 * avulso vai também como `item`, que aceita até 200.
 */
export const MOTIVO_MAXIMO = 300;
export const ITEM_AVULSO_MAXIMO = 200;
/** A descrição do ajuste (`descricao`, até 300). */
export const DESCRICAO_MAXIMA = 300;

/** O que falta na linha para salvar (o servidor confere de novo). */
export function problemasDaLinha(linha: LinhaForm): string[] {
  const problemas: string[] = [];
  if (linha.origem !== "ajuste") {
    const quantidade = decimalValido(paraDecimal(linha.quantidade), CASAS_DA_QUANTIDADE);
    if (!quantidade || quantidade.coeficiente <= 0n) problemas.push("Quantidade inválida.");
  }
  const preco = decimalValido(paraDecimal(linha.preco), CASAS_DO_PRECO);
  if (linha.origem === "tabela") {
    if (!preco || preco.coeficiente < 0n) problemas.push("Valor unitário inválido.");
    else if (origemDaLinha(linha) === "alterado" && !linha.motivo.trim()) {
      problemas.push("Informe o motivo do preço diferente da tabela.");
    }
  }
  if (linha.origem === "avulso") {
    if (linha.descricao.trim().length < 2) problemas.push("Informe o item.");
    else if (linha.descricao.trim().length > ITEM_AVULSO_MAXIMO) {
      problemas.push(`O item avulso aceita até ${ITEM_AVULSO_MAXIMO} caracteres.`);
    }
    if (!preco || preco.coeficiente < 0n) problemas.push("Informe o valor.");
    if (!linha.motivo.trim()) problemas.push("Informe o motivo do item avulso.");
  }
  if (linha.origem === "ajuste") {
    if (!preco || preco.coeficiente === 0n) problemas.push("Informe o valor do ajuste.");
    if (!linha.motivo.trim()) problemas.push("Informe o motivo do ajuste.");
  }
  if (linha.motivo.trim().length > MOTIVO_MAXIMO) problemas.push(`O motivo aceita até ${MOTIVO_MAXIMO} caracteres.`);
  return problemas;
}

// --- Formulário -------------------------------------------------------------------------------

export type ModoExecucao = "data" | "intervalo" | "a_definir";

export type LocalForm = { localId: string; complemento: string };

/**
 * Canais do pedido que a pessoa escolhe (CANAIS_DEMANDA de functions/comercial,
 * events.ts: portal e WMS são de sistema). Sem canal gravado, o servidor usa
 * e-mail.
 */
export const CANAIS_DO_PEDIDO = [
  { valor: "email", rotulo: "E-mail" },
  { valor: "telefone", rotulo: "Telefone" },
  { valor: "whatsapp", rotulo: "WhatsApp" },
] as const;
export const CANAL_PADRAO = "email";

export type FormOrcamento = {
  /** Como o pedido chegou (CANAIS_DO_PEDIDO; portal e WMS só se já vieram assim). */
  canal: string;
  /** O "Para": contato do cliente ("" sem contato). */
  contatoId: string;
  refCliente: string;
  titulo: string;
  /** "AAAA-MM-DDTHH:mm" em São Paulo (campo datetime-local). */
  recebidaEm: string;
  emailAssunto: string;
  emailLink: string;
  execucao: { modo: ModoExecucao; data: string; de: string; ate: string; visitaTecnica: string };
  origem: LocalForm;
  destino: LocalForm;
  linhas: LinhaForm[];
  condicoes: string;
  observacoes: string;
};

const FUSO = "America/Sao_Paulo";
/** São Paulo não tem horário de verão desde 2019: o fuso é sempre -03:00. */
const DESLOCAMENTO_DE_SAO_PAULO = "-03:00";

const PARTES_DA_DATA = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Instante ISO em "AAAA-MM-DDTHH:mm" de São Paulo, para o campo datetime-local. */
export function dataHoraLocal(iso: string | null | undefined): string {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(ms)) return "";
  const partes = Object.fromEntries(PARTES_DA_DATA.formatToParts(new Date(ms)).map((parte) => [parte.type, parte.value]));
  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}`;
}

/** "AAAA-MM-DDTHH:mm" de São Paulo com o fuso, como a callable pede (2026-10-14T09:42-03:00). */
export function instanteComFuso(local: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local.trim()) ? `${local.trim()}${DESLOCAMENTO_DE_SAO_PAULO}` : null;
}

function localDoForm(value: unknown): LocalForm {
  const local = isRegistro(value) ? value : {};
  return { localId: texto(local.local_id), complemento: texto(local.complemento) };
}

function execucaoDoForm(value: unknown): FormOrcamento["execucao"] {
  const exec = isRegistro(value) ? value : {};
  const datas = Array.isArray(exec.datas) ? exec.datas.map(texto).filter(Boolean) : [];
  const de = texto(exec.de);
  const ate = texto(exec.ate);
  let modo: ModoExecucao = "a_definir";
  if (exec.a_definir !== true) {
    if (de || ate) modo = "intervalo";
    else if (datas.length) modo = "data";
  }
  return {
    modo,
    data: modo === "data" ? datas[0] : "",
    de: modo === "intervalo" ? de : "",
    ate: modo === "intervalo" ? ate : "",
    visitaTecnica: texto(exec.visita_tecnica),
  };
}

/** O formulário como abre: a demanda e o orçamento gravados. */
export function formDoOrcamento(demanda: Registro, quote: Registro): FormOrcamento {
  const solicitante = isRegistro(demanda.solicitante) ? demanda.solicitante : {};
  return {
    canal: texto(demanda.canal) || CANAL_PADRAO,
    contatoId: texto(solicitante.contato_id),
    refCliente: texto(demanda.ref_cliente),
    titulo: texto(demanda.titulo),
    recebidaEm: dataHoraLocal(opcional(demanda.recebida_em)),
    emailAssunto: texto(demanda.email_assunto),
    emailLink: texto(demanda.email_link),
    execucao: execucaoDoForm(demanda.execucao),
    origem: localDoForm(demanda.origem),
    destino: localDoForm(demanda.destino),
    linhas: Array.isArray(quote.linhas) ? quote.linhas.filter(isRegistro).map(linhaDoServidor) : [],
    condicoes: texto(quote.condicoes),
    observacoes: texto(quote.observacoes_internas),
  };
}

/** As linhas como a callable recebe: preço e motivo só na alterada, na avulsa e no ajuste. */
export function entradasDasLinhas(linhas: readonly LinhaForm[]): Registro[] {
  return linhas.map((linha) => {
    const base: Registro = linha.id ? { id: linha.id } : {};
    const locais = { origem_local: linha.origemLocal, destino_local: linha.destinoLocal };
    const quantidade = paraDecimal(linha.quantidade) ?? linha.quantidade.trim();
    const preco = paraDecimal(linha.preco) ?? linha.preco.trim();
    const motivo = linha.motivo.trim();
    const origem = origemDaLinha(linha);
    switch (origem) {
      case "tabela":
        return { ...base, origem, lpu_item_id: linha.lpuItemId, quantidade, ...locais };
      case "alterado":
        return { ...base, origem, lpu_item_id: linha.lpuItemId, quantidade, preco, motivo, ...locais };
      case "avulso": {
        const descricao = linha.descricao.trim();
        return {
          ...base,
          origem,
          lpu_item_id: linha.lpuItemId,
          quantidade,
          preco,
          motivo,
          descricao,
          item: descricao,
          servico: opcional(linha.servico),
          unidade: opcional(linha.unidade),
          ...locais,
        };
      }
      case "ajuste":
        return { ...base, origem, quantidade: "1", preco: negativo(preco), motivo, descricao: opcional(linha.descricao), ...locais };
    }
  });
}

function execucaoDoPayload(execucao: FormOrcamento["execucao"]): Registro {
  const visita = execucao.visitaTecnica || null;
  if (execucao.modo === "data" && execucao.data) {
    return { datas: [execucao.data], de: null, ate: null, a_definir: false, visita_tecnica: visita };
  }
  if (execucao.modo === "intervalo" && (execucao.de || execucao.ate)) {
    return { datas: [], de: execucao.de || null, ate: execucao.ate || null, a_definir: false, visita_tecnica: visita };
  }
  return { datas: [], de: null, ate: null, a_definir: true, visita_tecnica: visita };
}

function localDoPayload(local: LocalForm): Registro | null {
  if (!local.localId && !local.complemento.trim()) return null;
  return { local_id: local.localId || null, complemento: opcional(local.complemento) };
}

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * saveQuote, update: a edição que a tela viu e só o que mudou desde a
 * abertura (as linhas, só quando mudaram: sem elas, o servidor reprecifica as
 * gravadas). A troca de variante vai junto.
 */
export function payloadSalvar(entrada: {
  original: FormOrcamento;
  form: FormOrcamento;
  numero: string;
  edicao: number;
  chave: string;
  variante?: string;
}): Registro {
  const { original, form } = entrada;
  const payload: Registro = {
    action: "update",
    request_id: entrada.chave,
    numero: entrada.numero,
    expected_edicao: entrada.edicao,
  };
  if (form.canal && form.canal !== original.canal) payload.canal = form.canal;
  if (form.contatoId !== original.contatoId) payload.contato_id = form.contatoId || null;
  if (texto(form.refCliente) !== texto(original.refCliente)) payload.ref_cliente = opcional(form.refCliente);
  if (texto(form.titulo) !== texto(original.titulo)) payload.titulo = opcional(form.titulo);
  if (form.recebidaEm !== original.recebidaEm) {
    const recebida = instanteComFuso(form.recebidaEm);
    if (recebida) payload.recebida_em = recebida;
  }
  if (texto(form.emailAssunto) !== texto(original.emailAssunto)) payload.email_assunto = opcional(form.emailAssunto);
  if (texto(form.emailLink) !== texto(original.emailLink)) payload.email_link = opcional(form.emailLink);
  const execucao = execucaoDoPayload(form.execucao);
  if (!igual(execucao, execucaoDoPayload(original.execucao))) payload.execucao = execucao;
  const origem = localDoPayload(form.origem);
  if (!igual(origem, localDoPayload(original.origem))) payload.origem = origem;
  const destino = localDoPayload(form.destino);
  if (!igual(destino, localDoPayload(original.destino))) payload.destino = destino;
  const linhas = entradasDasLinhas(form.linhas);
  if (!igual(linhas, entradasDasLinhas(original.linhas))) payload.linhas = linhas;
  if (texto(form.condicoes) !== texto(original.condicoes)) payload.condicoes = opcional(form.condicoes);
  if (texto(form.observacoes) !== texto(original.observacoes)) payload.observacoes_internas = opcional(form.observacoes);
  if (entrada.variante) payload.variante = entrada.variante;
  return payload;
}

/** A pessoa mudou algo desde a abertura (ou o último salvamento). */
export function formSujo(original: FormOrcamento, form: FormOrcamento): boolean {
  return Object.keys(payloadSalvar({ original, form, numero: "", edicao: 0, chave: "" })).length > 4;
}

/** O que falta no formulário para salvar: os problemas das linhas, o total e o link do e-mail. */
export function problemasDoFormulario(form: FormOrcamento): string[] {
  const problemas = form.linhas.flatMap((linha, indice) =>
    problemasDaLinha(linha).map((problema) => `Linha ${indice + 1}: ${problema}`),
  );
  const previa = previaDosTotais(form.linhas);
  if (previa.completa && previa.totalCents < 0) problemas.push("O ajuste passa do valor dos itens.");
  const link = form.emailLink.trim();
  if (link && !/^https?:\/\/\S+$/i.test(link)) problemas.push("Link do e-mail: use o endereço que começa com https://.");
  return problemas;
}

/** O que falta para enviar para aprovação: Para, título e uma linha (como o servidor, orcamento.ts). */
export function pendenciasParaEnviar(form: FormOrcamento): string[] {
  const faltam: string[] = [];
  if (!form.contatoId) faltam.push("Para");
  if (!form.titulo.trim()) faltam.push("título");
  if (!form.linhas.length) faltam.push("uma linha");
  return faltam;
}

/** saveQuote, create: o cliente, o contrato (opcional) e a variante; o servidor dá o número. */
export function payloadCriar(
  entrada: { customerCode: string; contratoId: string | null; variante: string },
  chave: string,
): Registro {
  return {
    action: "create",
    request_id: chave,
    customer_code: entrada.customerCode,
    contrato_id: entrada.contratoId,
    variante: entrada.variante,
  };
}

/** As ações de advanceQuote que a tela usa; o envio ao cliente (send, approve_and_send) é de lib/comercial/envio.ts. */
export type AcaoDeAvanco = "submit" | "return" | "approve" | "edit" | "send" | "approve_and_send";

/** advanceQuote com a situação e a edição que a tela viu; a nota só na devolução. */
export function payloadAvancar(
  acao: AcaoDeAvanco,
  orcamento: { numero: string; status: StatusOrcamento | string; edicao: number },
  chave: string,
  nota?: string | null,
): Registro {
  const payload: Registro = {
    action: acao,
    request_id: chave,
    numero: orcamento.numero,
    expected_status: orcamento.status,
    expected_edicao: orcamento.edicao,
  };
  const texto_ = (nota ?? "").trim();
  if (texto_) payload.nota = texto_;
  return payload;
}

/** saveQuote, duplicate: orçamento novo com a data-base de hoje. */
export function payloadDuplicar(numero: string, chave: string): Registro {
  return { action: "duplicate", request_id: chave, origem_numero: numero };
}

// --- Ações da tela ---------------------------------------------------------------------------

/** "enviar": para aprovação (submit); "enviar_cliente": o aprovado ao cliente (send, parte 12a). */
export type AcaoPrincipal = "enviar" | "aprovar" | "enviar_cliente";
export type AcaoSecundaria = "salvar" | "duplicar" | "editar" | "devolver" | "aprovar_e_enviar";
export type AcoesDoOrcamento = {
  editavel: boolean;
  principal: AcaoPrincipal | null;
  secundarias: AcaoSecundaria[];
  /** O link do documento A4: a prévia até o envio; depois, o PDF da RV enviada. */
  documento: "previa" | "enviado";
};

/**
 * O que a tela oferece. Rascunho: montar, com "Enviar para aprovação". Para
 * aprovar: só leitura; o owner aprova (principal), devolve (com nota) e tem
 * "Aprovar e enviar"; quem montou puxa de volta com "Editar". Aprovado:
 * "Enviar ao cliente" (grava e só então abre o documento) e "Editar" volta ao
 * rascunho. Enviado, perdido ou cancelado: só leitura (aceite e perda são da
 * parte 10). Duplicar vale sempre; o documento também (prévia até o envio).
 */
export function acoesDoOrcamento(entrada: {
  status: StatusOrcamento | string;
  role: string | null | undefined;
  uid: string | null | undefined;
  autorUid: string | null | undefined;
  etapa?: EtapaDemanda;
}): AcoesDoOrcamento {
  const documento = entrada.status === "enviado" ? "enviado" : "previa";
  if (entrada.etapa === "perdida" || entrada.etapa === "cancelada") {
    return { editavel: false, principal: null, secundarias: ["duplicar"], documento };
  }
  switch (entrada.status) {
    case "rascunho":
      return { editavel: true, principal: "enviar", secundarias: ["salvar", "duplicar"], documento };
    case "para_aprovar": {
      const owner = entrada.role === "owner";
      const autor = Boolean(entrada.uid) && entrada.uid === entrada.autorUid;
      const secundarias: AcaoSecundaria[] = [];
      if (autor) secundarias.push("editar");
      else if (owner) secundarias.push("devolver");
      if (owner) secundarias.push("aprovar_e_enviar");
      secundarias.push("duplicar");
      return { editavel: false, principal: owner ? "aprovar" : null, secundarias, documento };
    }
    case "aprovado":
      return { editavel: false, principal: "enviar_cliente", secundarias: ["editar", "duplicar"], documento };
    default:
      return { editavel: false, principal: null, secundarias: ["duplicar"], documento };
  }
}

/**
 * As recusas de concorrência de quotes.ts (functions/comercial), pela
 * mensagem: o servidor usa failed-precondition e not-found também para
 * recusas de entrada (contato inativo, tabela sobreposta, local que sumiu),
 * que não pedem recarga. Os modelos das mensagens estão travados por
 * montar.test.ts.
 */
const ORCAMENTO_MUDOU = [
  /^O orçamento mudou desde que foi aberto \(edição /,
  /^O orçamento \S+ mudou: está /,
  /^O orçamento \S+ está .+: só o rascunho se edita\.$/,
];
const ORCAMENTO_SUMIU = /^Orçamento \S+ não encontrado\.$/;

/**
 * O erro da callable para a tela: situação divergente, edição velha ou
 * orçamento que sumiu recarregam o orçamento (o que a pessoa digitou é
 * descartado); qualquer outra recusa só mostra a mensagem e mantém o
 * formulário.
 */
export function classificarErro(error: unknown): { mensagem: string; recarregar: boolean } {
  const registro = (error ?? {}) as { codigo?: unknown; code?: unknown };
  const codigo = String(registro.codigo ?? registro.code ?? "").replace(/^functions\//, "");
  const mensagem = error instanceof Error && error.message ? error.message : "Não foi possível concluir. Tente de novo.";
  const recarregar =
    (codigo === "failed-precondition" && ORCAMENTO_MUDOU.some((modelo) => modelo.test(mensagem))) ||
    (codigo === "not-found" && ORCAMENTO_SUMIU.test(mensagem));
  return { mensagem, recarregar };
}

/**
 * A situação ao lado das ações do cabeçalho: "Com o aprovador · 21/10 09:05"
 * enquanto espera a aprovação; "Aprovado por Leonardo · 21/10 08:50" depois
 * (o nome só quando quem lê pode ver o perfil de quem aprovou); "Enviado ·
 * 21/10 10:02" depois do envio ao cliente.
 */
export function situacaoDoCabecalho(entrada: {
  status: string;
  passoEm: string | null;
  aprovacao: { em: string | null } | null;
  aprovador: string | null;
  envio?: { em: string | null } | null;
}): string | null {
  if (entrada.status === "para_aprovar") return ["Com o aprovador", dataHoraCurta(entrada.passoEm)].filter(Boolean).join(" · ");
  if (entrada.status === "enviado") return ["Enviado", dataHoraCurta(entrada.envio?.em ?? entrada.passoEm)].filter(Boolean).join(" · ");
  if (entrada.status === "aprovado" && entrada.aprovacao) {
    return [entrada.aprovador ? `Aprovado por ${entrada.aprovador}` : "Aprovado", dataHoraCurta(entrada.aprovacao.em)]
      .filter(Boolean)
      .join(" · ");
  }
  return null;
}

/** O total do servidor diferente da prévia: avisa com o valor que vale. */
export function avisoDeRecalculo(previaCents: number | null, servidorCents: number): string | null {
  if (previaCents === null || previaCents === servidorCents) return null;
  return `O servidor recalculou o total: ${formatarReais(servidorCents)} (a prévia era ${formatarReais(previaCents)}).`;
}

// --- O formulário e o servidor ao vivo ---------------------------------------------------------

/** O orçamento como o onSnapshot entregou: a versão (edição, situação, etapa) e o formulário dela. */
export type VersaoDoServidor = {
  versao: string;
  edicao: number;
  status: string;
  original: FormOrcamento;
};

/**
 * O estado da tela de montar. `servidor` é o último que o onSnapshot
 * entregou; `base` é a versão em que o formulário se baseia: a edição e a
 * situação dela são as que vão para a callable (expected_edicao e
 * expected_status), nunca as do snapshot mais novo, para o servidor recusar
 * a gravação feita sobre uma edição velha em vez de apagar a de outra
 * pessoa. `aguardar` é a gravação desta tela que ainda não chegou pelo
 * onSnapshot.
 */
export type Sincronia = {
  servidor: VersaoDoServidor | null;
  base: VersaoDoServidor | null;
  form: FormOrcamento | null;
  aguardar: { edicao: number; status: string } | null;
};

export type EventoDaSincronia =
  | { tipo: "servidor"; servidor: VersaoDoServidor }
  | { tipo: "editar"; muda: (form: FormOrcamento) => FormOrcamento }
  | { tipo: "gravou"; edicao: number; status: string }
  | { tipo: "recarregar" };

export const SINCRONIA_INICIAL: Sincronia = { servidor: null, base: null, form: null, aguardar: null };

function carregar(servidor: VersaoDoServidor): Sincronia {
  return { servidor, base: servidor, form: servidor.original, aguardar: null };
}

/**
 * A gravação desta tela já está no servidor: a edição passou, ou é a mesma
 * com a situação esperada (o avanço não muda a edição), ou o servidor já não
 * é a versão em que o formulário se baseava (quem grava confere a edição e a
 * situação: depois da resposta, qualquer versão nova inclui a gravação).
 */
function chegou(estado: Sincronia, servidor: VersaoDoServidor, aguardar: { edicao: number; status: string }): boolean {
  if (servidor.edicao > aguardar.edicao) return true;
  if (servidor.edicao === aguardar.edicao && servidor.status === aguardar.status) return true;
  return estado.base !== null && servidor.versao !== estado.base.versao;
}

/**
 * Como o formulário acompanha o servidor. Sem mudança na tela, o que chega
 * entra; no meio de uma mudança, o formulário fica (e a tela avisa que está
 * desatualizado); a gravação desta tela, quando chega, volta o formulário
 * ao que está gravado; a recarga depois de um erro usa o último que chegou.
 */
export function sincronia(estado: Sincronia, evento: EventoDaSincronia): Sincronia {
  switch (evento.tipo) {
    case "servidor": {
      const { servidor } = evento;
      if (!estado.base || !estado.form) return carregar(servidor);
      if (estado.aguardar) return chegou(estado, servidor, estado.aguardar) ? carregar(servidor) : { ...estado, servidor };
      if (servidor.versao === estado.base.versao) return { ...estado, servidor };
      return formSujo(estado.base.original, estado.form) ? { ...estado, servidor } : carregar(servidor);
    }
    case "editar":
      return estado.form ? { ...estado, form: evento.muda(estado.form) } : estado;
    case "gravou": {
      const aguardar = { edicao: evento.edicao, status: evento.status };
      if (estado.servidor && chegou(estado, estado.servidor, aguardar)) return carregar(estado.servidor);
      return { ...estado, aguardar };
    }
    case "recarregar":
      return estado.servidor ? carregar(estado.servidor) : estado;
  }
}

/** O servidor mudou enquanto a pessoa editava: salvar vai ser recusado (edição velha). */
export function desatualizado(estado: Sincronia): boolean {
  return Boolean(estado.base && estado.servidor && !estado.aguardar && estado.base.versao !== estado.servidor.versao);
}

// --- Sair sem salvar --------------------------------------------------------------------------------

/**
 * O clique no link sai desta tela para outra do app (aba, menu, fila): com
 * mudança não salva, a tela pede confirmação. Link externo abre fora (e o
 * navegador avisa pelo beforeunload); a mesma tela e âncora não saem.
 */
export function saidaPedeConfirmacao(
  href: string | null | undefined,
  atual: { origin: string; pathname: string; search: string },
): boolean {
  if (!href || href.startsWith("#")) return false;
  let destino: URL;
  try {
    destino = new URL(href, `${atual.origin}${atual.pathname}${atual.search}`);
  } catch {
    return false;
  }
  if (destino.origin !== atual.origin) return false;
  return destino.pathname !== atual.pathname || destino.search !== atual.search;
}

/** Ctrl+S (Cmd+S no Mac), sem Alt nem Shift: o Salvar da tela. */
export function ehAtalhoDeSalvar(evento: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): boolean {
  return (evento.ctrlKey || evento.metaKey) && !evento.altKey && !evento.shiftKey && evento.key.toLowerCase() === "s";
}

// --- Cliente, contrato e contato ----------------------------------------------------------------

/** Contratos que o orçamento pode usar: os do cliente que não estão encerrados. */
export function contratosParaOrcamento(contratos: readonly ContratoResumo[], customerCode: string): ContratoResumo[] {
  return contratosDoCliente(contratos, customerCode).filter((contrato) => contrato.status !== "encerrado");
}

/** As opções do "Para": os contatos ativos por nome, e o atual mesmo inativo. */
export function opcoesDoPara(contatos: readonly ContatoResumo[], atual: string): ContatoResumo[] {
  return contatos
    .filter((contato) => contato.ativo || contato.id === atual)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
}

/** "Renata Moraes · Souza & Lopes". */
export function rotuloDoContato(contato: Pick<ContatoResumo, "nome" | "empresa">): string {
  return [contato.nome, contato.empresa].filter(Boolean).join(" · ");
}
