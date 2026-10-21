import { normalizarTexto } from "./catalogo.js";
import { dataValida, diasEntre, ultimoDiaDoMes } from "./contratos-datas.js";
import {
  dataDeHoje,
  demandaExecutada,
  problemaDaValidacao,
  rvFechada,
  type EstadoDaDemanda,
  type EtapaDemanda,
} from "./demanda.js";
import { CASAS_DA_QUANTIDADE, ErroDinheiro, formatarReais, lerDecimal, somarCentavos } from "./dinheiro.js";
import { DIA_TIPOS, JANELAS, MARCAS_MEDICAO } from "./events.js";
import { ErroOrcamento, precificarLinhas, type ItemDoCatalogo, type LinhaEntrada } from "./orcamento.js";
import { tabelaVigente, type PrecoDaTabela, type StatusTabela } from "./tabelas.js";

/**
 * A medição mensal no domínio, sem Firestore (docs/plataforma/fase-6-comercial.md,
 * "Medição mensal"; parte 16a).
 *
 * - `medicoes/{contrato_id}_{AAAA-MM}`: as linhas executadas no mês de um
 *   contrato por medição mensal (o Safra), que o cliente aprova antes da NF.
 * - Cada linha é uma OS executada. A data da solicitação é a data-base do
 *   preço da linha: vale a tabela do contrato vigente nela, mesmo que a
 *   tabela mude no meio da competência. O servidor sempre recalcula.
 * - O item de diária diz o dia e a janela da tarifa nos atributos dele (o
 *   serviço ou a descrição: "Diária de ajudante – sábado"). A linha que usa
 *   a tarifa de outro dia fica marcada e, quando a tabela deixa inferir com
 *   segurança, aponta o item esperado; quem troca é a pessoa ("Aplicar").
 * - Situações: rascunho → enviada → aprovada; enviada → contestada →
 *   rascunho (reaberta).
 */

export { DIA_TIPOS, JANELAS, MARCAS_MEDICAO };

export type DiaTipo = (typeof DIA_TIPOS)[number];
export type Janela = (typeof JANELAS)[number];
export type MarcaMedicao = (typeof MARCAS_MEDICAO)[number];

export const MEDICOES_COLLECTION = "medicoes";
export const CLIENT_AUTHORIZATIONS_COLLECTION = "client_authorizations";
export const MEDICAO_SCHEMA_VERSION = 1;
export const CLIENT_AUTHORIZATION_SCHEMA_VERSION = 1;

export const STATUS_MEDICAO = ["rascunho", "enviada", "aprovada", "contestada"] as const;
export type StatusMedicao = (typeof STATUS_MEDICAO)[number];

export const ACOES_MEDICAO = ["send", "approve", "contest", "reopen"] as const;
export type AcaoMedicao = (typeof ACOES_MEDICAO)[number];

/** De onde vem o preço do item da linha. Sem ajuste: a medição só mede. */
export const ORIGENS_ITEM_MEDICAO = ["tabela", "alterado", "avulso"] as const;
export type OrigemItemMedicao = (typeof ORIGENS_ITEM_MEDICAO)[number];

/** Limites da medição: um mês de um contrato. */
export const MAXIMO_DE_LINHAS = 200;
export const MAXIMO_DE_ITENS_POR_LINHA = 20;
export const MAXIMO_DE_DEMANDAS = 100;

export class ErroMedicao extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroMedicao";
  }
}

// --- Competência ------------------------------------------------------------------------

const COMPETENCIA = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function competenciaValida(valor: unknown): valor is string {
  return typeof valor === "string" && COMPETENCIA.test(valor);
}

/** A competência (AAAA-MM) de hoje em São Paulo: 31/10 às 23:30 ainda é outubro. */
export function competenciaAtual(hoje: Date): string {
  return dataDeHoje(hoje).slice(0, 7);
}

/** O primeiro e o último dia da competência (AAAA-MM-DD). */
export function diasDaCompetencia(competencia: string): { de: string; ate: string } {
  const [ano, mes] = competencia.split("-").map(Number);
  return { de: `${competencia}-01`, ate: `${competencia}-${String(ultimoDiaDoMes(ano, mes)).padStart(2, "0")}` };
}

/** O prazo de envio: o primeiro dia do mês seguinte à competência. */
export function envioAte(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  return mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;
}

/** "outubro/2026". */
export function rotuloDaCompetencia(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const nome = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ][mes - 1];
  return `${nome}/${ano}`;
}

/** Id da medição: o contrato e a competência ("safra-2026_2026-10"). Uma por contrato e mês. */
export function medicaoId(contratoId: string, competencia: string): string {
  if (!competenciaValida(competencia)) throw new ErroMedicao(`Competência inválida: ${competencia} (use AAAA-MM).`);
  return `${contratoId}_${competencia}`;
}

/** Id da autorização que a aprovação da medição cria: uma por medição. */
export function autorizacaoDaMedicaoId(medicaoIdValor: string): string {
  return `aut_${medicaoIdValor}`;
}

export type MedicaoParaAlerta = {
  id: string;
  contrato_id?: string;
  customer_code?: string;
  competencia: string;
  status: string;
};

export type AlertaMedicao = {
  medicao_id: string;
  contrato_id: string | null;
  customer_code: string | null;
  competencia: string;
  envio_ate: string;
  /** 0 no dia do prazo (a virada do mês). */
  dias_de_atraso: number;
};

/**
 * A virada do mês com a medição de uma competência anterior ainda em
 * rascunho: alerta para o Início, a partir do primeiro dia do mês seguinte,
 * com os dias desde o prazo.
 */
export function alertaMedicaoNaoEnviada(hoje: Date, medicoes: readonly MedicaoParaAlerta[]): AlertaMedicao[] {
  const atual = competenciaAtual(hoje);
  const dia = dataDeHoje(hoje);
  return medicoes
    .filter((medicao) => medicao.status === "rascunho" && competenciaValida(medicao.competencia) && medicao.competencia < atual)
    .map((medicao) => ({
      medicao_id: medicao.id,
      contrato_id: medicao.contrato_id ?? null,
      customer_code: medicao.customer_code ?? null,
      competencia: medicao.competencia,
      envio_ate: envioAte(medicao.competencia),
      dias_de_atraso: Math.max(0, diasEntre(envioAte(medicao.competencia), dia)),
    }))
    .sort((a, b) => a.competencia.localeCompare(b.competencia) || a.medicao_id.localeCompare(b.medicao_id));
}

// --- Contrato -----------------------------------------------------------------------------

/** O contrato cobra por medição mensal: no regime padrão ou no de algum serviço. */
export function contratoComMedicaoMensal(contrato: { regime_padrao?: unknown; regimes?: unknown }): boolean {
  if (contrato.regime_padrao === "medicao_mensal") return true;
  return Array.isArray(contrato.regimes) && contrato.regimes.some((regime) => (regime as { regime?: unknown })?.regime === "medicao_mensal");
}

/** Por que não cabe medição deste contrato nesta competência, ou null. */
export function problemaDaCompetencia(
  contrato: { vigente_de?: unknown; vigente_ate?: unknown },
  competencia: string,
  hoje: Date,
): string | null {
  if (!competenciaValida(competencia)) return `Competência inválida: ${competencia} (use AAAA-MM).`;
  if (competencia > competenciaAtual(hoje)) return `A competência ${rotuloDaCompetencia(competencia)} ainda não começou.`;
  const { de, ate } = diasDaCompetencia(competencia);
  const inicio = typeof contrato.vigente_de === "string" ? contrato.vigente_de : null;
  const fim = typeof contrato.vigente_ate === "string" ? contrato.vigente_ate : null;
  if ((inicio && ate < inicio) || (fim && de > fim)) {
    return `A competência ${rotuloDaCompetencia(competencia)} está fora da vigência do contrato.`;
  }
  return null;
}

// --- Dia e janela --------------------------------------------------------------------------

const DIA_ROTULO: Record<DiaTipo, string> = { util: "seg–sex", sabado: "sábado", domingo_feriado: "dom/feriado" };

export function rotuloDoDiaTipo(dia: DiaTipo): string {
  return DIA_ROTULO[dia];
}

/** O dia da tarifa pela data: sábado, domingo ou dia útil. O feriado em dia de semana quem diz é a pessoa. */
export function diaTipoDaData(data: string): DiaTipo {
  if (!dataValida(data)) throw new ErroMedicao(`Data inválida: ${data}.`);
  const [ano, mes, dia] = data.split("-").map(Number);
  const semana = new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
  if (semana === 6) return "sabado";
  if (semana === 0) return "domingo_feriado";
  return "util";
}

/**
 * Por que o dia informado não cabe na data, ou null. Feriado (domingo_feriado)
 * cabe em qualquer dia; sábado só no sábado; dia útil só de segunda a sexta.
 */
export function problemaDoDiaTipo(data: string, informado: DiaTipo): string | null {
  const daData = diaTipoDaData(data);
  if (informado === daData || informado === "domingo_feriado") return null;
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano} é ${DIA_ROTULO[daData]}: o dia da tarifa não pode ser ${DIA_ROTULO[informado]}.`;
}

// --- Classificação do item -------------------------------------------------------------------

/** Os atributos de um item: o do catálogo (lpu_items) e a descrição do cliente na tabela. */
export type AtributosDoItem = {
  lpu_item_id?: string | null;
  categoria?: string | null;
  item?: string | null;
  servico?: string | null;
  descricao?: string | null;
  descricao_cliente?: string | null;
};

export type ClasseDoItem = {
  /** Item de diária, com os dias e as janelas que a tarifa cobre (vazio: o item não diz). */
  diaria: { dias: DiaTipo[]; janelas: Janela[] } | null;
  veiculo: boolean;
  ajudante: boolean;
};

const DIARIA = /\bdiarias?\b/;
const SABADO = /\bsab(?:ado)?s?\b/;
const DOMINGO_FERIADO = /\bdom(?:ingo)?s?\b|\bferiados?\b/;
const UTIL = /\bdias? uteis\b|\bdia util\b|\buteis\b|\bseg(?:unda)?(?:-feira)?\.?\s*(?:-|a|ate|\/)\s*sex(?:ta)?\b/;
const NOTURNA = /\bnoturn[oa]s?\b/;
const DIURNA = /\bdiurn[oa]s?\b|\bhorario comercial\b/;
const VEICULO = /\b(?:vuc|truck|bitruck|toco|carreta|caminhao|caminhoes|van|fiorino|utilitario|veiculos?)\b|\b3\/4\b/;
const AJUDANTE = /\bajudantes?\b|\bcarregador(?:es)?\b|\bmontador(?:es)?\b|\bmao de obra\b/;

/** Texto comparado: sem acento nem maiúscula, com os travessões como hífen. */
function textoComparado(valores: readonly (string | null | undefined)[]): string {
  return normalizarTexto(valores.filter(Boolean).join(" ")).replace(/[‐-―−]/g, "-");
}

/** O que o item é, pelos atributos: diária (com dia e janela), veículo, ajudante. */
export function classificarItem(atributos: AtributosDoItem): ClasseDoItem {
  const texto = textoComparado([
    atributos.categoria,
    atributos.item,
    atributos.servico,
    atributos.descricao,
    atributos.descricao_cliente,
  ]);
  const veiculo = VEICULO.test(texto);
  const ehDiaria = DIARIA.test(texto);
  const diaria = ehDiaria
    ? {
        dias: DIA_TIPOS.filter((dia) => ({ util: UTIL, sabado: SABADO, domingo_feriado: DOMINGO_FERIADO })[dia].test(texto)),
        janelas: JANELAS.filter((janela) => ({ diurna: DIURNA, noturna: NOTURNA })[janela].test(texto)),
      }
    : null;
  return { diaria, veiculo, ajudante: AJUDANTE.test(texto) || (ehDiaria && !veiculo) };
}

/** A família da diária ("ajudante", "motorista"): o nome do item sem diária, dia nem janela. */
function familia(atributos: AtributosDoItem): string {
  return textoComparado([atributos.item])
    .replace(new RegExp(DIARIA.source, "g"), " ")
    .replace(new RegExp(UTIL.source, "g"), " ")
    .replace(new RegExp(SABADO.source, "g"), " ")
    .replace(new RegExp(DOMINGO_FERIADO.source, "g"), " ")
    .replace(new RegExp(NOTURNA.source, "g"), " ")
    .replace(new RegExp(DIURNA.source, "g"), " ")
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\b(?:de|da|do|e|a|o)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cobre(classe: NonNullable<ClasseDoItem["diaria"]>, linha: { dia_tipo: DiaTipo; janela: Janela }): boolean {
  return (
    (classe.dias.length === 0 || classe.dias.includes(linha.dia_tipo)) &&
    (classe.janelas.length === 0 || classe.janelas.includes(linha.janela))
  );
}

/**
 * O item de diária que a tabela tem para o dia e a janela da execução, da
 * mesma família do item usado (ajudante com ajudante, veículo com veículo).
 * Ganha o que diz o dia e a janela da linha; empate ou nenhum é null: sem
 * segurança, ninguém aponta item.
 */
export function diariaEsperada(
  linha: { dia_tipo: DiaTipo; janela: Janela },
  itensDaTabela: readonly (AtributosDoItem & { lpu_item_id: string })[],
  atual: AtributosDoItem | null = null,
): string | null {
  const familiaAtual = atual ? familia(atual) : "";
  const veiculoAtual = atual ? classificarItem(atual).veiculo : null;
  const candidatos = itensDaTabela
    .map((item) => ({ item, classe: classificarItem(item) }))
    .filter(({ item, classe }) => {
      if (!classe.diaria || !cobre(classe.diaria, linha)) return false;
      if (veiculoAtual !== null && classe.veiculo !== veiculoAtual) return false;
      return !familiaAtual || familia(item) === familiaAtual;
    })
    .map(({ item, classe }) => ({
      id: item.lpu_item_id,
      pontos: (classe.diaria!.dias.length > 0 ? 2 : 0) + (classe.diaria!.janelas.length > 0 ? 1 : 0),
    }));
  if (candidatos.length === 0) return null;
  const melhor = Math.max(...candidatos.map((candidato) => candidato.pontos));
  const vencedores = [...new Set(candidatos.filter((candidato) => candidato.pontos === melhor).map((candidato) => candidato.id))];
  return vencedores.length === 1 ? vencedores[0] : null;
}

/**
 * A diária usada bate com o dia e a janela da execução? Marca quando a tarifa
 * do item não cobre o dia ou a janela da linha, ou quando a tabela tem outro
 * item que cobre melhor (a diária genérica num sábado com tarifa de sábado).
 * Só aponta o item esperado (trocar_por) quando dá para inferir com
 * segurança; nunca troca o item.
 */
export function conferenciaDaDiaria(
  linha: { dia_tipo: DiaTipo; janela: Janela },
  item: AtributosDoItem,
  itensDaTabela: readonly (AtributosDoItem & { lpu_item_id: string })[],
): { dia_nao_bate: boolean; trocar_por: string | null } {
  const classe = classificarItem(item);
  if (!classe.diaria) return { dia_nao_bate: false, trocar_por: null };
  const fora = !cobre(classe.diaria, linha);
  const esperado = diariaEsperada(linha, itensDaTabela, item);
  const outro = esperado !== null && esperado !== (item.lpu_item_id ?? null);
  return { dia_nao_bate: fora || outro, trocar_por: outro ? esperado : null };
}

// --- Linha da medição ------------------------------------------------------------------------

/** O item da linha como o app manda: quantidade e item; preço e motivo só no alterado e no avulso. */
export type ItemEntrada = {
  lpu_item_id?: string | null;
  quantidade: string;
  origem: OrigemItemMedicao;
  preco?: string | null;
  motivo?: string | null;
  descricao?: string | null;
};

export type Anexo = { nome: string; referencia: string };

export type LinhaEntradaDaMedicao = {
  demanda_numero?: string | null;
  os: string;
  solicitada_em: string;
  area_solicitante: string;
  executada_em: string;
  dia_tipo?: DiaTipo;
  janela: Janela;
  origem: string;
  destino: string;
  mercadoria: string;
  itens: readonly ItemEntrada[];
  anexo?: Anexo | null;
};

export type ItemDaMedicao = {
  lpu_item_id: string | null;
  codigo: string | null;
  categoria: string | null;
  item: string;
  descricao: string;
  servico: string | null;
  unidade: string | null;
  quantidade: string;
  /** Preço unitário em texto decimal exato. */
  preco: string;
  /** O preço da tabela ao lado do alterado; null no avulso. */
  preco_tabela: string | null;
  origem: OrigemItemMedicao;
  motivo: string | null;
  total_cents: number;
  /** A tarifa de diária não cobre o dia ou a janela da execução. */
  dia_nao_bate: boolean;
  /** O item de diária que a tabela tem para o dia e a janela, quando dá para inferir. */
  trocar_por: string | null;
};

export type LinhaDaMedicao = {
  id: string;
  demanda_numero: string | null;
  os: string;
  /** A data-base do preço da linha. */
  solicitada_em: string;
  area_solicitante: string;
  executada_em: string;
  dia_tipo: DiaTipo;
  janela: Janela;
  origem: string;
  destino: string;
  mercadoria: string;
  /** A tabela do contrato vigente na data da solicitação; null sem tabela (só avulso). */
  tabela_id: string | null;
  itens: ItemDaMedicao[];
  total_cents: number;
  marcas: MarcaMedicao[];
  anexo: Anexo | null;
};

/** A tabela como a medição lê de `price_tables`. */
export type TabelaDaMedicao = {
  id: string;
  customer_code: string | null;
  contract_id: string | null;
  variante: string;
  vigente_de: string;
  vigente_ate: string | null;
  status: StatusTabela;
  precos: Record<string, PrecoDaTabela>;
};

/** O item do catálogo, com a categoria (para reconhecer diária e veículo). */
export type ItemDoCatalogoDaMedicao = ItemDoCatalogo & { categoria?: string | null };

export type ContextoDaMedicao = {
  customer_code: string;
  contrato_id: string;
  variante: string;
  /** As tabelas do cliente (de qualquer contrato e variante). */
  tabelas: readonly TabelaDaMedicao[];
  /** Os itens do catálogo citados pelas linhas e, para achar a diária esperada, os das tabelas. */
  catalogo: ReadonlyMap<string, ItemDoCatalogoDaMedicao>;
  /** O item já estava na linha gravada: vale mesmo se depois ficou inativo no catálogo. */
  herdado?: (lpuItemId: string) => boolean;
};

/**
 * A tabela do contrato da medição, na variante dela, vigente na data da
 * solicitação; null sem tabela. Nunca a Padrão Dutelog: a medição cobra pela
 * tabela do contrato. Duas tabelas valendo no mesmo dia é ErroTabela (o
 * cadastro das tabelas está errado, não a linha).
 */
export function tabelaDaLinha(contexto: Omit<ContextoDaMedicao, "catalogo">, solicitadaEm: string): TabelaDaMedicao | null {
  const escolhida = tabelaVigente(
    contexto.tabelas.filter((tabela) => tabela.customer_code !== null),
    { customer_code: contexto.customer_code, contract_id: contexto.contrato_id, variante: contexto.variante, data: solicitadaEm },
  );
  return escolhida?.origem === "cliente" ? escolhida.tabela : null;
}

/** Os itens da tabela com os atributos do catálogo, para achar a diária esperada. */
export function itensDaTabela(
  tabela: TabelaDaMedicao | null,
  catalogo: ReadonlyMap<string, ItemDoCatalogoDaMedicao>,
): Array<AtributosDoItem & { lpu_item_id: string }> {
  if (!tabela) return [];
  return Object.keys(tabela.precos).map((id) => {
    const item = catalogo.get(id);
    return {
      lpu_item_id: id,
      categoria: item?.categoria ?? null,
      item: item?.item ?? null,
      servico: item?.servico ?? null,
      descricao: item?.descricao ?? null,
      descricao_cliente: tabela.precos[id]?.descricao_cliente ?? null,
    };
  });
}

/** As marcas da linha: diária que não bate, item avulso (rota fora da tabela) e pedido sem anexo. */
export function marcasDaLinha(linha: { itens: readonly Pick<ItemDaMedicao, "origem" | "dia_nao_bate">[]; anexo: Anexo | null }): MarcaMedicao[] {
  const marcas: MarcaMedicao[] = [];
  if (linha.itens.some((item) => item.dia_nao_bate)) marcas.push("dia_nao_bate_tarifa");
  if (linha.itens.some((item) => item.origem === "avulso")) marcas.push("rota_fora_da_tabela");
  if (!linha.anexo) marcas.push("sem_pedido_anexo");
  return marcas;
}

function textoLimpo(valor: unknown): string {
  return typeof valor === "string" ? valor.normalize("NFC").replace(/\s+/g, " ").trim() : "";
}

/**
 * Preço, marcas e total de uma linha, pela tabela do contrato vigente na data
 * da solicitação (orcamento.ts faz a conta de cada item: tabela, alterado com
 * motivo e avulso com preço e motivo). Recusa (ErroMedicao, com a OS e o
 * número do item) o que foge das regras.
 */
export function precificarLinhaDaMedicao(
  entrada: LinhaEntradaDaMedicao & { id: string },
  contexto: ContextoDaMedicao,
): LinhaDaMedicao {
  const os = textoLimpo(entrada.os);
  const falha = (mensagem: string) => new ErroMedicao(`OS ${os}: ${mensagem}`);
  if (!dataValida(entrada.solicitada_em) || !dataValida(entrada.executada_em)) throw falha("data inválida.");
  const diaTipo = entrada.dia_tipo ?? diaTipoDaData(entrada.executada_em);
  const problemaDoDia = problemaDoDiaTipo(entrada.executada_em, diaTipo);
  if (problemaDoDia) throw falha(problemaDoDia);
  if (entrada.itens.length === 0) throw falha("a linha precisa de ao menos um item.");
  if (entrada.itens.length > MAXIMO_DE_ITENS_POR_LINHA) throw falha(`use até ${MAXIMO_DE_ITENS_POR_LINHA} itens por linha.`);

  const tabela = tabelaDaLinha(contexto, entrada.solicitada_em);
  const entradas: LinhaEntrada[] = entrada.itens.map((item) => ({
    origem: item.origem,
    lpu_item_id: item.lpu_item_id ?? null,
    quantidade: item.quantidade,
    preco: item.preco ?? null,
    motivo: item.motivo ?? null,
    descricao: item.descricao ?? null,
  }));
  let precificado;
  try {
    precificado = precificarLinhas(entradas, {
      tabela: tabela ? { id: tabela.id, precos: tabela.precos } : null,
      itens: contexto.catalogo,
      novoId: (indice) => `${entrada.id}_${indice + 1}`,
      herdada: (_linhaId, lpuItemId) => contexto.herdado?.(lpuItemId) ?? false,
    });
  } catch (error) {
    if (error instanceof ErroOrcamento || error instanceof ErroDinheiro) {
      // "Linha 2: ..." do orçamento é o item 2 da linha da medição.
      const mensagem = error.message
        .replace(/^Linha (\d+): /, "item $1: ")
        .replace("o orçamento está sem tabela", "não há tabela do contrato na data da solicitação");
      throw new ErroMedicao(`OS ${os}, ${mensagem}`);
    }
    throw error;
  }

  const daTabela = itensDaTabela(tabela, contexto.catalogo);
  const linha = { dia_tipo: diaTipo, janela: entrada.janela };
  const itens: ItemDaMedicao[] = precificado.linhas.map((item) => {
    const doCatalogo = item.lpu_item_id ? contexto.catalogo.get(item.lpu_item_id) : undefined;
    const categoria = textoLimpo(doCatalogo?.categoria) || null;
    const conferencia = conferenciaDaDiaria(
      linha,
      {
        lpu_item_id: item.lpu_item_id,
        categoria,
        item: item.item,
        servico: item.servico,
        descricao: doCatalogo?.descricao ?? item.descricao,
        descricao_cliente: item.lpu_item_id && tabela?.precos[item.lpu_item_id] ? tabela.precos[item.lpu_item_id].descricao_cliente : item.descricao,
      },
      daTabela,
    );
    return {
      lpu_item_id: item.lpu_item_id,
      codigo: item.codigo,
      categoria,
      item: item.item,
      descricao: item.descricao,
      servico: item.servico,
      unidade: item.unidade,
      quantidade: item.quantidade,
      preco: item.preco,
      preco_tabela: item.preco_tabela,
      origem: item.origem as OrigemItemMedicao,
      motivo: item.motivo,
      total_cents: item.total_cents,
      ...conferencia,
    };
  });
  const anexo = entrada.anexo ? { nome: textoLimpo(entrada.anexo.nome), referencia: textoLimpo(entrada.anexo.referencia) } : null;
  return {
    id: entrada.id,
    demanda_numero: entrada.demanda_numero ?? null,
    os,
    solicitada_em: entrada.solicitada_em,
    area_solicitante: textoLimpo(entrada.area_solicitante),
    executada_em: entrada.executada_em,
    dia_tipo: diaTipo,
    janela: entrada.janela,
    origem: textoLimpo(entrada.origem),
    destino: textoLimpo(entrada.destino),
    mercadoria: textoLimpo(entrada.mercadoria),
    tabela_id: tabela?.id ?? null,
    itens,
    total_cents: precificado.total_cents,
    marcas: marcasDaLinha({ itens, anexo }),
    anexo,
  };
}

/** A linha gravada de volta como entrada (para precificar de novo): o item de tabela perde o preço, que a tabela dá. */
export function entradaDaLinhaGravada(linha: LinhaDaMedicao): LinhaEntradaDaMedicao & { id: string } {
  return {
    id: linha.id,
    demanda_numero: linha.demanda_numero,
    os: linha.os,
    solicitada_em: linha.solicitada_em,
    area_solicitante: linha.area_solicitante,
    executada_em: linha.executada_em,
    dia_tipo: linha.dia_tipo,
    janela: linha.janela,
    origem: linha.origem,
    destino: linha.destino,
    mercadoria: linha.mercadoria,
    anexo: linha.anexo,
    itens: linha.itens.map((item) => ({
      lpu_item_id: item.lpu_item_id,
      quantidade: item.quantidade,
      origem: item.origem,
      preco: item.origem === "tabela" ? null : item.preco,
      motivo: item.motivo,
      descricao: item.origem === "avulso" ? item.descricao : null,
    })),
  };
}

/** Total da medição: a soma das linhas, já arredondadas item a item. */
export function totalDaMedicao(linhas: readonly Pick<LinhaDaMedicao, "total_cents">[]): number {
  return somarCentavos(linhas.map((linha) => linha.total_cents));
}

/** As demandas da medição, sem repetir, em ordem. */
export function demandasDaMedicao(linhas: readonly Pick<LinhaDaMedicao, "demanda_numero">[]): string[] {
  return [...new Set(linhas.map((linha) => linha.demanda_numero).filter((numero): numero is string => Boolean(numero)))].sort();
}

/** Quantas linhas têm cada marca. */
export function contagemDeMarcas(linhas: readonly Pick<LinhaDaMedicao, "marcas">[]): Record<MarcaMedicao, number> {
  const contagem = Object.fromEntries(MARCAS_MEDICAO.map((marca) => [marca, 0])) as Record<MarcaMedicao, number>;
  for (const linha of linhas) for (const marca of linha.marcas) contagem[marca] += 1;
  return contagem;
}

/** Quantas linhas mudaram de preço ao precificar de novo (o total, a tabela ou o preço de algum item). */
export function linhasReprecificadas(antes: readonly LinhaDaMedicao[], depois: readonly LinhaDaMedicao[]): number {
  const anteriores = new Map(antes.map((linha) => [linha.id, linha]));
  return depois.filter((linha) => {
    const anterior = anteriores.get(linha.id);
    if (!anterior) return false;
    const precos = (valor: LinhaDaMedicao) => JSON.stringify(valor.itens.map((item) => [item.preco, item.origem, item.total_cents]));
    return anterior.total_cents !== linha.total_cents || anterior.tabela_id !== linha.tabela_id || precos(anterior) !== precos(linha);
  }).length;
}

/**
 * Por que a linha não cabe nesta competência, ou null: executada no mês da
 * competência, até hoje, e solicitada antes de ser executada.
 */
export function problemaDasDatasDaLinha(
  linha: { solicitada_em: string; executada_em: string },
  competencia: string,
  hoje: Date,
): string | null {
  if (!dataValida(linha.solicitada_em) || !dataValida(linha.executada_em)) return "Data inválida (AAAA-MM-DD).";
  if (linha.executada_em.slice(0, 7) !== competencia) {
    return `A execução (${linha.executada_em}) é de outro mês: a linha entra na medição de ${rotuloDaCompetencia(linha.executada_em.slice(0, 7))}.`;
  }
  if (linha.executada_em > dataDeHoje(hoje)) return "A execução não pode ser depois de hoje.";
  if (linha.solicitada_em > linha.executada_em) return "A solicitação vem antes da execução.";
  return null;
}

// --- Situação --------------------------------------------------------------------------------

export const TRANSICOES_MEDICAO: Record<AcaoMedicao, { de: StatusMedicao; para: StatusMedicao }> = {
  send: { de: "rascunho", para: "enviada" },
  approve: { de: "enviada", para: "aprovada" },
  contest: { de: "enviada", para: "contestada" },
  reopen: { de: "contestada", para: "rascunho" },
};

const STATUS_ROTULO: Record<StatusMedicao, string> = {
  rascunho: "em rascunho",
  enviada: "enviada ao cliente",
  aprovada: "aprovada pelo cliente",
  contestada: "contestada pelo cliente",
};

export function rotuloDoStatus(status: StatusMedicao): string {
  return STATUS_ROTULO[status];
}

const ACAO_ROTULO: Record<AcaoMedicao, string> = {
  send: "enviar ao cliente",
  approve: "registrar a aprovação do cliente",
  contest: "registrar a contestação do cliente",
  reopen: "reabrir",
};

/** Por que a ação não cabe na situação atual, ou null. Medição sem linha não se envia. */
export function problemaDaAcaoNaMedicao(acao: AcaoMedicao, status: StatusMedicao, medicao: { linhas: number }): string | null {
  const { de } = TRANSICOES_MEDICAO[acao];
  if (status !== de) return `A medição está ${STATUS_ROTULO[status]}: só dá para ${ACAO_ROTULO[acao]} com ela ${STATUS_ROTULO[de]}.`;
  if (acao === "send" && medicao.linhas === 0) return "A medição está sem linhas: inclua as OS do mês antes de enviar.";
  return null;
}

/** A ação já foi feita sobre a situação que a tela viu: repetir só devolve o estado. */
export function acaoDaMedicaoJaFeita(acao: AcaoMedicao, esperado: StatusMedicao, atual: StatusMedicao): boolean {
  const transicao = TRANSICOES_MEDICAO[acao];
  return esperado === transicao.de && atual === transicao.para;
}

/** Só o rascunho se edita. */
export function problemaDaEdicao(status: StatusMedicao): string | null {
  if (status === "rascunho") return null;
  return status === "contestada"
    ? "A medição foi contestada pelo cliente: reabra (reopen) antes de ajustar."
    : `A medição está ${STATUS_ROTULO[status]}: só o rascunho se edita.`;
}

// --- Demandas da medição ----------------------------------------------------------------------

/** Por que a demanda não entra nesta medição, ou null. */
export function problemaDaDemandaNaMedicao(
  numero: string,
  demanda: { customer_code?: unknown; contrato_id?: unknown; etapa?: unknown; medicao_id?: unknown; perda?: unknown; cancelamento?: unknown },
  medicao: { id: string; customer_code: string; contrato_id: string },
): string | null {
  if (demanda.customer_code !== medicao.customer_code) return `A demanda ${numero} é de outro cliente.`;
  if (demanda.contrato_id !== medicao.contrato_id) return `A demanda ${numero} não é do contrato desta medição.`;
  if (demanda.cancelamento || demanda.etapa === "cancelada") return `A demanda ${numero} está cancelada.`;
  if (demanda.perda || demanda.etapa === "perdida") return `A demanda ${numero} está perdida: reabra antes de medir.`;
  if (typeof demanda.medicao_id === "string" && demanda.medicao_id && demanda.medicao_id !== medicao.id) {
    return `A demanda ${numero} já está na medição ${demanda.medicao_id}.`;
  }
  return null;
}

/** O período executado de uma demanda nas linhas da medição: a primeira e a última execução. */
export function execucaoNasLinhas(
  numero: string,
  linhas: readonly Pick<LinhaDaMedicao, "demanda_numero" | "executada_em">[],
): { de: string; ate: string } | null {
  const datas = linhas
    .filter((linha) => linha.demanda_numero === numero)
    .map((linha) => linha.executada_em)
    .sort();
  return datas.length === 0 ? null : { de: datas[0], ate: datas[datas.length - 1] };
}

export type DestinoNaAprovacao =
  /** Já está a faturar (validada pelo orçamento, com a medição pendente): só a pendência sai. */
  | { tipo: "ja_a_faturar" }
  /** Esperava a autorização do cliente: a medição aprovada é ela. */
  | { tipo: "autorizar" }
  /** A medição aprovada valida a RV (a fechada, sem desvio, ou a de execução enviada); registra a execução se faltava. */
  | { tipo: "validar"; rv: number; registrar_execucao: { de: string; ate: string } | null }
  /** Fica como está, para alguém resolver. */
  | { tipo: "pendente"; motivo: string };

/**
 * O que a aprovação da medição faz com a demanda ligada a ela: leva a "a
 * faturar" quando o cliente já disse sim a ela (o fechamento ou a RV de
 * execução enviada); a demanda perdida, sem fechamento ou com uma RV em
 * montagem fica pendente, com o motivo.
 */
export function destinoNaAprovacaoDaMedicao(
  demanda: EstadoDaDemanda & { etapa: EtapaDemanda },
  orcamento: { status: string; tipo_rv: string; rv: number } | null,
  execucao: { de: string; ate: string } | null,
): DestinoNaAprovacao {
  const etapa = demanda.etapa;
  if (etapa === "perdida" || etapa === "cancelada") return { tipo: "pendente", motivo: `demanda ${etapa}` };
  if (etapa === "a_faturar") return { tipo: "ja_a_faturar" };
  if (etapa === "aguardando_autorizacao") return { tipo: "autorizar" };
  if (!orcamento || orcamento.status !== "enviado") return { tipo: "pendente", motivo: "RV em montagem, sem envio ao cliente" };
  if (!demandaExecutada(demanda)) {
    if (etapa === "para_planejar" && rvFechada(demanda) === orcamento.rv && execucao) {
      return { tipo: "validar", rv: orcamento.rv, registrar_execucao: execucao };
    }
    return { tipo: "pendente", motivo: etapa === "aguardando_cliente" ? "proposta sem fechamento" : `demanda ${etapa}` };
  }
  if (problemaDaValidacao(demanda, orcamento) === null) return { tipo: "validar", rv: orcamento.rv, registrar_execucao: null };
  return { tipo: "pendente", motivo: `demanda ${etapa}` };
}

// --- Diário de Bordo ---------------------------------------------------------------------------

/** As colunas do Diário de Bordo, na ordem do arquivo que o cliente pede. */
export const COLUNAS_DO_DIARIO = [
  "OS",
  "Data da solicitação",
  "Solicitante",
  "Data do frete",
  "Tipo de veículo",
  "Qtd. de veículos",
  "Horário",
  "Qtd. de ajudantes",
  "Origem",
  "Destino",
  "Mercadoria",
  "Valor",
] as const;

export type LinhaDoDiario = {
  os: string;
  data_solicitacao: string;
  solicitante: string;
  data_frete: string;
  veiculo_tipo: string;
  veiculo_quantidade: string;
  horario: string;
  ajudantes_quantidade: string;
  origem: string;
  destino: string;
  mercadoria: string;
  valor_cents: number;
  /** Na coluna: "1.180,00" (sem o R$). */
  valor: string;
  /** As células, na ordem de COLUNAS_DO_DIARIO. */
  colunas: string[];
};

/** Soma quantidades em texto decimal sem passar por float ("1.5" + "2" = "3.5"). */
export function somarQuantidades(quantidades: readonly string[]): string {
  let soma = 0n;
  for (const quantidade of quantidades) {
    const valor = lerDecimal(quantidade, CASAS_DA_QUANTIDADE, "quantidade");
    soma += valor.coeficiente * 10n ** BigInt(CASAS_DA_QUANTIDADE - valor.casas);
  }
  const divisor = 10n ** BigInt(CASAS_DA_QUANTIDADE);
  const inteiro = soma / divisor;
  const fracao = (soma % divisor).toString().padStart(CASAS_DA_QUANTIDADE, "0").replace(/0+$/, "");
  return fracao ? `${inteiro},${fracao}` : String(inteiro);
}

function dataBr(data: string): string {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

/**
 * As linhas da medição no formato de colunas do Diário de Bordo (OS, data da
 * solicitação, solicitante, data do frete, tipo e quantidade de veículos,
 * horário e quantidade de ajudantes, origem, destino, mercadoria e valor),
 * em ordem de execução, para o app gerar o arquivo. O solicitante é a área,
 * nunca o nome da pessoa. A tabela completa a descrição dos itens.
 */
export function exportarDiarioDeBordo(
  medicao: { linhas: readonly LinhaDaMedicao[] },
  tabela: { precos: Record<string, Pick<PrecoDaTabela, "descricao_cliente">> } | null,
): LinhaDoDiario[] {
  return [...medicao.linhas]
    .sort((a, b) => a.executada_em.localeCompare(b.executada_em) || a.os.localeCompare(b.os, "pt-BR"))
    .map((linha) => {
      const classes = linha.itens.map((item) => ({
        item,
        classe: classificarItem({
          categoria: item.categoria,
          item: item.item,
          servico: item.servico,
          descricao: item.descricao,
          descricao_cliente: item.lpu_item_id ? tabela?.precos[item.lpu_item_id]?.descricao_cliente ?? null : null,
        }),
      }));
      const veiculos = classes.filter(({ classe }) => classe.veiculo);
      const ajudantes = classes.filter(({ classe }) => !classe.veiculo && classe.ajudante);
      const veiculoTipo = [...new Set(veiculos.map(({ item }) => item.item))].join(" + ");
      const horario = `${linha.janela === "noturna" ? "Noturno" : "Diurno"} (${DIA_ROTULO[linha.dia_tipo]})`;
      // Sem o "R$" (e o espaço que não quebra depois dele): a coluna é o número.
      const valor = formatarReais(linha.total_cents).replace(/^(-?)R\$\s/, "$1");
      const saida = {
        os: linha.os,
        data_solicitacao: dataBr(linha.solicitada_em),
        solicitante: linha.area_solicitante,
        data_frete: dataBr(linha.executada_em),
        veiculo_tipo: veiculoTipo,
        veiculo_quantidade: veiculos.length ? somarQuantidades(veiculos.map(({ item }) => item.quantidade)) : "0",
        horario,
        ajudantes_quantidade: ajudantes.length ? somarQuantidades(ajudantes.map(({ item }) => item.quantidade)) : "0",
        origem: linha.origem,
        destino: linha.destino,
        mercadoria: linha.mercadoria,
        valor_cents: linha.total_cents,
        valor,
      };
      return {
        ...saida,
        colunas: [
          saida.os,
          saida.data_solicitacao,
          saida.solicitante,
          saida.data_frete,
          saida.veiculo_tipo,
          saida.veiculo_quantidade,
          saida.horario,
          saida.ajudantes_quantidade,
          saida.origem,
          saida.destino,
          saida.mercadoria,
          saida.valor,
        ],
      };
    });
}
