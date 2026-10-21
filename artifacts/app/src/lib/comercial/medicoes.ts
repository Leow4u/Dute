import { dataValida, diasEntre, formatarReais, lerDecimal, somarCentavos, ultimoDiaDoMes } from "@workspace/dominio";

import { dataBr } from "./clientes";
import type { Contrato } from "./contratos";
import { somarQuantidades } from "./diario";
import { catalogoDaTabela, formatarDecimal, paraDecimal, type ItemDaTabela } from "./montar";
import { dataHoraCurta } from "./orcamentos";

/**
 * Regras puras da tela de Medições do Comercial
 * (docs/mockups/ComMedicaoMensal.dc.html; parte 16b de
 * docs/plataforma/fase-6-comercial.md): a medição lida de `medicoes/` (gravada
 * só por functions/comercial, domain/medicoes.ts), o resumo por item, os
 * anexos dos pedidos, as competências do contrato, o prazo de envio, as marcas
 * da linha, o alerta da virada do mês do Início e as chamadas de saveMedicao
 * e advanceMedicao.
 *
 * O valor que vale é o do servidor: a tela nunca soma preço, só mostra o que
 * a medição gravou (o resumo por item agrupa as linhas já precificadas).
 * Alerta, vigência e competência repetem as funções puras do servidor
 * (domain/medicao.ts); medicoes.test.ts roda as duas lado a lado.
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

function inteiro(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function umDe<T extends string>(lista: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (lista as readonly string[]).includes(value) ? (value as T) : null;
}

// --- Listas (cópia de functions/comercial, domain/medicao.ts e events.ts) ---------------------

export const STATUS_MEDICAO = ["rascunho", "enviada", "aprovada", "contestada"] as const;
export type StatusMedicao = (typeof STATUS_MEDICAO)[number];

export const DIA_TIPOS = ["util", "sabado", "domingo_feriado"] as const;
export type DiaTipo = (typeof DIA_TIPOS)[number];

export const JANELAS = ["diurna", "noturna"] as const;
export type Janela = (typeof JANELAS)[number];

export const MARCAS_MEDICAO = ["dia_nao_bate_tarifa", "rota_fora_da_tabela", "sem_pedido_anexo"] as const;
export type MarcaMedicao = (typeof MARCAS_MEDICAO)[number];

export const ORIGENS_ITEM = ["tabela", "alterado", "avulso"] as const;
export type OrigemItem = (typeof ORIGENS_ITEM)[number];

/** Limite do servidor para o texto de cada item e anexo; a tela só avisa antes. */
export const MAXIMO_DE_ITENS_POR_LINHA = 20;

// --- Leitura ----------------------------------------------------------------------------------

export type CoberturaDaDiaria = { dias: DiaTipo[]; janelas: Janela[] };

export type ClasseDoItem = { diaria: CoberturaDaDiaria | null; veiculo: boolean; ajudante: boolean };

export type ItemDaMedicao = {
  lpu_item_id: string | null;
  item: string;
  descricao: string;
  unidade: string | null;
  quantidade: string;
  preco: string;
  preco_tabela: string | null;
  origem: OrigemItem;
  motivo: string | null;
  total_cents: number;
  /** O que o servidor calculou do item; null na linha gravada antes dela. */
  classe: ClasseDoItem | null;
  dia_nao_bate: boolean;
  trocar_por: string | null;
};

export type Anexo = { nome: string; referencia: string };

export type LinhaDaMedicao = {
  id: string;
  demanda_numero: string | null;
  os: string;
  solicitada_em: string;
  area_solicitante: string;
  executada_em: string;
  dia_tipo: DiaTipo;
  janela: Janela;
  origem: string;
  destino: string;
  mercadoria: string;
  tabela_id: string | null;
  itens: ItemDaMedicao[];
  total_cents: number;
  marcas: MarcaMedicao[];
  anexo: Anexo | null;
};

export type Medicao = {
  id: string;
  contrato_id: string;
  customer_code: string;
  competencia: string;
  variante: string;
  status: StatusMedicao;
  status_desde: string | null;
  /** A edição que a callable confere (expected_edicao). */
  edicao: number;
  linhas: LinhaDaMedicao[];
  total_cents: number;
  enviada_em: string | null;
  aprovada_em: string | null;
  aprovacao: { em: string | null; link: string | null } | null;
  contestacao: { em: string | null; nota: string } | null;
  autorizacao_id: string | null;
  demandas_pendentes: Array<{ numero: string; motivo: string }>;
};

const COMPETENCIA = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function competenciaValida(valor: unknown): valor is string {
  return typeof valor === "string" && COMPETENCIA.test(valor);
}

function coberturaLida(value: unknown): CoberturaDaDiaria | null {
  if (!isRegistro(value)) return null;
  const dias = (Array.isArray(value.dias) ? value.dias : []).filter((dia): dia is DiaTipo => umDe(DIA_TIPOS, dia) !== null);
  const janelas = (Array.isArray(value.janelas) ? value.janelas : []).filter((janela): janela is Janela => umDe(JANELAS, janela) !== null);
  return { dias, janelas };
}

function classeLida(value: unknown): ClasseDoItem | null {
  if (!isRegistro(value)) return null;
  return { diaria: coberturaLida(value.diaria), veiculo: value.veiculo === true, ajudante: value.ajudante === true };
}

function itemLido(value: unknown): ItemDaMedicao | null {
  if (!isRegistro(value)) return null;
  const origem = umDe(ORIGENS_ITEM, value.origem) ?? "tabela";
  const total = inteiro(value.total_cents);
  if (total === null) return null;
  const item = texto(value.item);
  return {
    lpu_item_id: opcional(value.lpu_item_id),
    item,
    descricao: texto(value.descricao) || item,
    unidade: opcional(value.unidade),
    quantidade: texto(value.quantidade) || "0",
    preco: texto(value.preco) || "0",
    preco_tabela: opcional(value.preco_tabela),
    origem,
    motivo: opcional(value.motivo),
    total_cents: total,
    classe: classeLida(value.classe),
    dia_nao_bate: value.dia_nao_bate === true,
    trocar_por: opcional(value.trocar_por),
  };
}

function linhaLida(value: unknown): LinhaDaMedicao | null {
  if (!isRegistro(value)) return null;
  const id = texto(value.id);
  const total = inteiro(value.total_cents);
  if (!id || total === null) return null;
  const anexo = isRegistro(value.anexo) && (texto(value.anexo.nome) || texto(value.anexo.referencia)) ? value.anexo : null;
  return {
    id,
    demanda_numero: opcional(value.demanda_numero),
    os: texto(value.os),
    solicitada_em: texto(value.solicitada_em),
    area_solicitante: texto(value.area_solicitante),
    executada_em: texto(value.executada_em),
    dia_tipo: umDe(DIA_TIPOS, value.dia_tipo) ?? "util",
    janela: umDe(JANELAS, value.janela) ?? "diurna",
    origem: texto(value.origem),
    destino: texto(value.destino),
    mercadoria: texto(value.mercadoria),
    tabela_id: opcional(value.tabela_id),
    itens: (Array.isArray(value.itens) ? value.itens : []).map(itemLido).filter((item): item is ItemDaMedicao => item !== null),
    total_cents: total,
    marcas: (Array.isArray(value.marcas) ? value.marcas : []).filter((marca): marca is MarcaMedicao => umDe(MARCAS_MEDICAO, marca) !== null),
    anexo: anexo ? { nome: texto(anexo.nome), referencia: texto(anexo.referencia) } : null,
  };
}

/** Instante gravado como o Firestore devolve (texto ISO do servidor). */
function instante(value: unknown): string | null {
  const iso = texto(value);
  return iso && !Number.isNaN(Date.parse(iso)) ? iso : null;
}

/** Documento de `medicoes/{contrato_id}_{AAAA-MM}` como a tela usa. Sem contrato, competência ou situação válidos, fica fora. */
export function medicaoDoRegistro(id: string, data: Registro): Medicao | null {
  const contratoId = texto(data.contrato_id);
  const status = umDe(STATUS_MEDICAO, data.status);
  if (!contratoId || !competenciaValida(data.competencia) || !status) return null;
  const aprovacao = isRegistro(data.aprovacao) ? data.aprovacao : null;
  const contestacao = isRegistro(data.contestacao) ? data.contestacao : null;
  return {
    id,
    contrato_id: contratoId,
    customer_code: texto(data.customer_code),
    competencia: data.competencia,
    variante: texto(data.variante) || "Comercial",
    status,
    status_desde: instante(data.status_desde),
    edicao: inteiro(data.edicao) ?? 1,
    linhas: (Array.isArray(data.linhas) ? data.linhas : []).map(linhaLida).filter((linha): linha is LinhaDaMedicao => linha !== null),
    total_cents: inteiro(data.total_cents) ?? 0,
    enviada_em: instante(data.enviada_em),
    aprovada_em: instante(data.aprovada_em),
    aprovacao: aprovacao ? { em: instante(aprovacao.em), link: opcional(aprovacao.link) } : null,
    contestacao: contestacao ? { em: instante(contestacao.em), nota: texto(contestacao.nota) } : null,
    autorizacao_id: opcional(data.autorizacao_id),
    demandas_pendentes: (Array.isArray(data.demandas_pendentes) ? data.demandas_pendentes : [])
      .filter(isRegistro)
      .map((pendente) => ({ numero: texto(pendente.numero), motivo: texto(pendente.motivo) }))
      .filter((pendente) => pendente.numero),
  };
}

// --- Datas -------------------------------------------------------------------------------------

const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/** "Outubro/2026". */
export function rotuloDaCompetencia(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  return `${MESES[mes - 1]}/${ano}`;
}

export function competenciaAtual(hoje: string): string {
  return hoje.slice(0, 7);
}

export function competenciaAnterior(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  return mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, "0")}`;
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

const DIAS_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

/** "qui" para 2026-10-01. */
export function diaDaSemana(data: string): string {
  const [ano, mes, dia] = data.split("-").map(Number);
  return DIAS_DA_SEMANA[new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()];
}

/** "01/10" de AAAA-MM-DD. */
function diaMes(data: string): string {
  return dataBr(data).slice(0, 5);
}

/** O dia e o mês de um instante, em São Paulo ("01/09"). */
function diaMesDoInstante(iso: string | null): string | null {
  return dataHoraCurta(iso)?.split(" ")[0] ?? null;
}

/** "01/10 · qui": o dia do frete. */
export function rotuloDoFrete(linha: Pick<LinhaDaMedicao, "executada_em">): string {
  return `${diaMes(linha.executada_em)} · ${diaDaSemana(linha.executada_em)}`;
}

export type PrazoDeEnvio = { data: string; rotulo: string; quando: string; atrasado: boolean };

/** O prazo de envio da competência (a virada do mês), em relação a hoje. */
export function prazoDeEnvio(competencia: string, hoje: string): PrazoDeEnvio {
  const data = envioAte(competencia);
  const dias = diasEntre(hoje, data);
  let quando: string;
  if (dias > 1) quando = `em ${dias} dias`;
  else if (dias === 1) quando = "amanhã";
  else if (dias === 0) quando = "hoje";
  else quando = dias === -1 ? "há 1 dia" : `há ${-dias} dias`;
  return { data, rotulo: dataBr(data), quando, atrasado: dias < 0 };
}

// --- Selo --------------------------------------------------------------------------------------

export type TomDaMedicao = "neutro" | "info" | "ok" | "atencao" | "critico";
export type SituacaoDaCompetencia = StatusMedicao | "nao_aberta";

const SELOS: Record<SituacaoDaCompetencia, { rotulo: string; tom: TomDaMedicao }> = {
  rascunho: { rotulo: "Rascunho", tom: "neutro" },
  enviada: { rotulo: "Aguardando aprovação", tom: "info" },
  aprovada: { rotulo: "Aprovada", tom: "ok" },
  contestada: { rotulo: "Contestada", tom: "critico" },
  nao_aberta: { rotulo: "Não aberta", tom: "neutro" },
};

export function seloDaMedicao(situacao: SituacaoDaCompetencia): { rotulo: string; tom: TomDaMedicao } {
  return SELOS[situacao];
}

// --- Competências do contrato -------------------------------------------------------------------

export type ChipDeCompetencia = {
  competencia: string;
  rotulo: string;
  situacao: SituacaoDaCompetencia;
  /** "Enviada 01/09 · R$ 16.940,00". */
  resumo: string;
  medicaoId: string | null;
};

function resumoDaMedicao(medicao: Medicao): string {
  const total = formatarReais(medicao.total_cents);
  const quando =
    medicao.status === "enviada"
      ? diaMesDoInstante(medicao.enviada_em)
      : medicao.status === "aprovada"
        ? diaMesDoInstante(medicao.aprovada_em)
        : medicao.status === "contestada"
          ? diaMesDoInstante(medicao.contestacao?.em ?? null)
          : null;
  const nome = medicao.status === "rascunho" ? "Rascunho" : seloDeVerbo(medicao.status);
  return [quando ? `${nome} ${quando}` : nome, total].join(" · ");
}

function seloDeVerbo(status: StatusMedicao): string {
  return { rascunho: "Rascunho", enviada: "Enviada", aprovada: "Aprovada", contestada: "Contestada" }[status];
}

/**
 * Os chips de competência de um contrato, do mais antigo ao mais novo: as
 * medições que existem e, se faltam, o mês de hoje e o anterior como "não
 * aberta" (o mês que passou ainda se abre até o envio, e o de hoje começa a
 * medir). Mês futuro nunca.
 */
export function competenciasDoContrato(medicoes: readonly Medicao[], hoje: string): ChipDeCompetencia[] {
  const atual = competenciaAtual(hoje);
  const chips = new Map<string, ChipDeCompetencia>();
  for (const medicao of medicoes) {
    chips.set(medicao.competencia, {
      competencia: medicao.competencia,
      rotulo: rotuloDaCompetencia(medicao.competencia),
      situacao: medicao.status,
      resumo: resumoDaMedicao(medicao),
      medicaoId: medicao.id,
    });
  }
  for (const competencia of [competenciaAnterior(atual), atual]) {
    if (chips.has(competencia)) continue;
    chips.set(competencia, {
      competencia,
      rotulo: rotuloDaCompetencia(competencia),
      situacao: "nao_aberta",
      resumo: `Prazo de envio ${diaMes(envioAte(competencia))}`,
      medicaoId: null,
    });
  }
  return [...chips.values()].sort((a, b) => a.competencia.localeCompare(b.competencia));
}

/** A competência aberta: a da URL, se está entre os chips; senão a última com medição; sem nenhuma, a de hoje. */
export function competenciaEscolhida(chips: readonly ChipDeCompetencia[], daUrl: string | null, hoje: string): string {
  if (daUrl && chips.some((chip) => chip.competencia === daUrl)) return daUrl;
  const abertas = chips.filter((chip) => chip.situacao !== "nao_aberta");
  return abertas.length ? abertas[abertas.length - 1].competencia : competenciaAtual(hoje);
}

// --- Resumo por item ----------------------------------------------------------------------------

export type ItemDoResumo = { rotulo: string; quantidade: string; preco: string; total_cents: number };
export type GrupoDoResumo = { titulo: string; itens: ItemDoResumo[]; total_cents: number };

const TITULOS = { ajudante: "Diárias de ajudante", veiculo: "Viagens", outros: "Outros itens" } as const;
type ChaveDoGrupo = keyof typeof TITULOS;

function grupoDoItem(item: ItemDaMedicao): ChaveDoGrupo {
  if (item.classe?.veiculo) return "veiculo";
  if (item.classe?.ajudante) return "ajudante";
  return "outros";
}

/**
 * O resumo por item da tabela: diárias de ajudante, viagens e o resto, com a
 * quantidade e o preço unitário de cada um. O mesmo item com outro preço
 * (alterado) é outra linha do resumo. A soma dos grupos é o total da medição.
 */
export function resumoPorItem(linhas: readonly LinhaDaMedicao[]): GrupoDoResumo[] {
  const porGrupo = new Map<ChaveDoGrupo, Map<string, { rotulo: string; quantidades: string[]; preco: string; total: number[] }>>();
  for (const linha of linhas) {
    for (const item of linha.itens) {
      const grupo = grupoDoItem(item);
      const itens = porGrupo.get(grupo) ?? new Map();
      const chave = `${item.lpu_item_id ?? `avulso:${item.descricao}`}|${item.preco}|${item.origem}`;
      const atual = itens.get(chave) ?? { rotulo: item.descricao || item.item, quantidades: [], preco: item.preco, total: [] };
      atual.quantidades.push(item.quantidade);
      atual.total.push(item.total_cents);
      itens.set(chave, atual);
      porGrupo.set(grupo, itens);
    }
  }
  return (Object.keys(TITULOS) as ChaveDoGrupo[])
    .filter((grupo) => porGrupo.has(grupo))
    .map((grupo) => {
      const itens = [...porGrupo.get(grupo)!.values()]
        .map((item) => ({
          rotulo: item.rotulo,
          quantidade: somarQuantidades(item.quantidades),
          preco: formatarDecimal(item.preco, 2),
          total_cents: somarCentavos(item.total),
        }))
        .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR", { numeric: true }));
      return { titulo: TITULOS[grupo], itens, total_cents: somarCentavos(itens.map((item) => item.total_cents)) };
    });
}

// --- Anexos -------------------------------------------------------------------------------------

export type AnexoDaMedicao = { linhaId: string; os: string; nome: string; referencia: string; data: string };

export type AnexosDaMedicao = {
  total: number;
  anexados: number;
  completo: boolean;
  itens: AnexoDaMedicao[];
  faltando: Array<{ linhaId: string; os: string }>;
};

/** Os pedidos anexados (quantos de quantos) e o que falta. A data é a da solicitação. */
export function anexosDaMedicao(linhas: readonly LinhaDaMedicao[]): AnexosDaMedicao {
  const itens: AnexoDaMedicao[] = [];
  const faltando: AnexosDaMedicao["faltando"] = [];
  for (const linha of linhas) {
    if (linha.anexo) {
      itens.push({ linhaId: linha.id, os: linha.os, nome: linha.anexo.nome, referencia: linha.anexo.referencia, data: linha.solicitada_em });
    } else {
      faltando.push({ linhaId: linha.id, os: linha.os });
    }
  }
  return { total: linhas.length, anexados: itens.length, completo: linhas.length > 0 && faltando.length === 0, itens, faltando };
}

/** O link do anexo, se a referência for um endereço da web. */
export function linkDoAnexo(referencia: string): string | null {
  return /^https?:\/\/\S+$/i.test(referencia.trim()) ? referencia.trim() : null;
}

// --- Marcas e linha -----------------------------------------------------------------------------

const ROTULO_DO_DIA: Record<DiaTipo, string> = { util: "dia útil", sabado: "sábado", domingo_feriado: "domingo/feriado" };
const ROTULO_CURTO_DO_DIA: Record<DiaTipo, string> = { util: "seg–sex", sabado: "sábado", domingo_feriado: "dom/feriado" };

function maiuscula(valor: string): string {
  return valor.charAt(0).toLocaleUpperCase("pt-BR") + valor.slice(1);
}

function textoDoDiaQueNaoBate(linha: LinhaDaMedicao): string {
  const item = linha.itens.find((candidato) => candidato.dia_nao_bate);
  const diaria = item?.classe?.diaria ?? null;
  if (diaria?.dias.length && !diaria.dias.includes(linha.dia_tipo)) {
    return `${maiuscula(ROTULO_DO_DIA[linha.dia_tipo])} na tarifa de ${diaria.dias.map((dia) => ROTULO_DO_DIA[dia]).join(" ou ")}`;
  }
  if (diaria?.janelas.length && !diaria.janelas.includes(linha.janela)) {
    return `Execução ${linha.janela} na tarifa ${diaria.janelas.join(" e ")}`;
  }
  return "Tarifa diferente do dia da execução";
}

export type MarcaDaLinha = { marca: MarcaMedicao; texto: string; tom: "critico" | "atencao" };

/** As marcas da linha em texto: o que a pessoa corrige ou confere antes de enviar. */
export function marcasDaLinha(linha: LinhaDaMedicao): MarcaDaLinha[] {
  return linha.marcas.map((marca) => {
    if (marca === "dia_nao_bate_tarifa") return { marca, texto: textoDoDiaQueNaoBate(linha), tom: "critico" };
    if (marca === "rota_fora_da_tabela") return { marca, texto: "Rota fora da tabela", tom: "atencao" };
    return { marca, texto: "Sem pedido anexo", tom: "atencao" };
  });
}

/** A tarifa de diária de um item ("seg–sex"), ou o dia da execução da linha. */
function tarifaDoItem(item: ItemDaMedicao, linha: LinhaDaMedicao): string {
  const dias = item.classe?.diaria?.dias ?? [];
  return ROTULO_CURTO_DO_DIA[dias.length === 1 ? dias[0] : linha.dia_tipo];
}

/** "VUC × 1" e "2 ajudantes · seg–sex": o que a coluna Veículo · ajudantes mostra. */
export function veiculoEAjudantes(linha: LinhaDaMedicao): { veiculo: string | null; ajudantes: string | null; outros: string | null } {
  const veiculos = linha.itens.filter((item) => item.classe?.veiculo);
  const ajudantes = linha.itens.filter((item) => !item.classe?.veiculo && item.classe?.ajudante);
  const outros = linha.itens.filter((item) => !item.classe?.veiculo && !item.classe?.ajudante);
  const quantidade = (itens: readonly ItemDaMedicao[]) => somarQuantidades(itens.map((item) => item.quantidade));
  const totalDeAjudantes = ajudantes.length ? quantidade(ajudantes) : null;
  const tarifas = [...new Set(ajudantes.map((item) => tarifaDoItem(item, linha)))];
  return {
    veiculo: veiculos.length ? veiculos.map((item) => `${item.descricao} × ${formatarDecimal(item.quantidade.replace(",", "."))}`).join(" + ") : null,
    ajudantes: totalDeAjudantes
      ? `${totalDeAjudantes} ${totalDeAjudantes === "1" ? "ajudante" : "ajudantes"} · ${tarifas.join(" + ")}`
      : null,
    outros: outros.length ? outros.map((item) => `${item.descricao} × ${formatarDecimal(item.quantidade.replace(",", "."))}`).join(" + ") : null,
  };
}

/** "Aplicar sábado": o botão da marca de dia que não bate, quando o servidor deu o item certo. */
export function itemParaAplicar(linha: LinhaDaMedicao): ItemDaMedicao | null {
  return linha.itens.find((item) => item.dia_nao_bate && item.trocar_por) ?? null;
}

export function rotuloDoAplicar(linha: LinhaDaMedicao): string {
  return `Aplicar ${ROTULO_CURTO_DO_DIA[linha.dia_tipo]}`;
}

export function rotuloDoDia(dia: DiaTipo): string {
  return ROTULO_DO_DIA[dia];
}

// --- Ações por situação ---------------------------------------------------------------------------

export type AcaoDaMedicao = "enviar" | "aprovar" | "contestar" | "reabrir" | "exportar";

export type AcoesDaMedicao = {
  /** A única ação principal da situação; null quando não há passo seguinte. */
  principal: Exclude<AcaoDaMedicao, "exportar"> | null;
  secundarias: AcaoDaMedicao[];
  /** Só o rascunho se edita (linhas, itens, anexos). */
  editavel: boolean;
  podeEnviar: boolean;
};

export function acoesDaMedicao(status: StatusMedicao, linhas: number): AcoesDaMedicao {
  switch (status) {
    case "rascunho":
      return { principal: "enviar", secundarias: ["exportar"], editavel: true, podeEnviar: linhas > 0 };
    case "enviada":
      return { principal: "aprovar", secundarias: ["contestar", "exportar"], editavel: false, podeEnviar: false };
    case "contestada":
      return { principal: "reabrir", secundarias: ["exportar"], editavel: false, podeEnviar: false };
    case "aprovada":
      return { principal: null, secundarias: ["exportar"], editavel: false, podeEnviar: false };
  }
}

// --- Contratos de medição ---------------------------------------------------------------------------

/** O contrato cobra por medição mensal: no regime padrão ou no de algum serviço. */
export function contratoComMedicaoMensal(dados: { regime_padrao?: unknown; regimes?: unknown }): boolean {
  if (dados.regime_padrao === "medicao_mensal") return true;
  return Array.isArray(dados.regimes) && dados.regimes.some((regime) => (regime as { regime?: unknown } | null)?.regime === "medicao_mensal");
}

/** Os contratos que têm medição mensal, vigentes primeiro, depois por cliente. */
export function contratosDeMedicao(contratos: readonly Contrato[], nomes?: ReadonlyMap<string, string>): Contrato[] {
  return contratos
    .filter((contrato) => contratoComMedicaoMensal(contrato.dados))
    .sort(
      (a, b) =>
        Number(a.dados.status === "encerrado") - Number(b.dados.status === "encerrado") ||
        (nomes?.get(a.dados.customer_code) ?? "").localeCompare(nomes?.get(b.dados.customer_code) ?? "", "pt-BR") ||
        a.id.localeCompare(b.id),
    );
}

// --- Alerta da virada do mês ----------------------------------------------------------------------

export type PeriodoDeVigencia = { de: string | null; ate: string | null };

function dataOuNull(valor: unknown): string | null {
  return dataValida(valor) ? valor : null;
}

/** Os períodos anteriores do contrato, pelos aditivos (vigencia_anterior e a vigência do próprio aditivo). */
export function periodosDosAditivos(
  aditivos: readonly { vigencia_anterior?: unknown; vigente_de?: unknown; vigente_ate?: unknown }[],
): PeriodoDeVigencia[] {
  const periodos: PeriodoDeVigencia[] = [];
  for (const aditivo of aditivos) {
    const anterior = aditivo.vigencia_anterior as { de?: unknown; ate?: unknown } | null | undefined;
    if (anterior && dataValida(anterior.de)) periodos.push({ de: anterior.de, ate: dataOuNull(anterior.ate) });
    if (dataValida(aditivo.vigente_de) && dataValida(aditivo.vigente_ate)) periodos.push({ de: aditivo.vigente_de, ate: aditivo.vigente_ate });
  }
  return periodos;
}

/** A competência cabe em algum período de vigência (o atual ou um anterior). */
function competenciaNaVigencia(periodos: readonly PeriodoDeVigencia[], competencia: string): boolean {
  const { de, ate } = diasDaCompetencia(competencia);
  return periodos.some((periodo) => !(periodo.de && ate < periodo.de) && !(periodo.ate && de > periodo.ate));
}

export type MedicaoParaAlerta = {
  id: string;
  contrato_id?: string;
  customer_code?: string;
  competencia: string;
  status: string;
};

export type ContratoParaAlertaDeMedicao = {
  id: string;
  customer_code?: string | null;
  status?: unknown;
  regime_padrao?: unknown;
  regimes?: unknown;
  vigente_de?: unknown;
  vigente_ate?: unknown;
  vigencias_anteriores?: readonly PeriodoDeVigencia[];
};

export type AlertaMedicao = {
  medicao_id: string;
  contrato_id: string | null;
  customer_code: string | null;
  competencia: string;
  /** rascunho: aberta e não enviada; nao_aberta: o contrato por medição mensal está sem a medição do mês que passou. */
  situacao: "rascunho" | "nao_aberta";
  envio_ate: string;
  /** 0 no dia do prazo (a virada do mês). */
  dias_de_atraso: number;
};

/**
 * A virada do mês, para o Início, a partir do primeiro dia do mês seguinte
 * (a mesma regra de alertaMedicaoNaoEnviada em functions/comercial,
 * domain/medicao.ts): a medição de uma competência anterior ainda em
 * rascunho e o contrato por medição mensal, vigente no mês que passou, sem a
 * medição dele (só a competência anterior).
 */
export function alertaMedicaoNaoEnviada(
  hoje: string,
  medicoes: readonly MedicaoParaAlerta[],
  contratos: readonly ContratoParaAlertaDeMedicao[] = [],
): AlertaMedicao[] {
  const atual = competenciaAtual(hoje);
  const anterior = competenciaAnterior(atual);
  const atraso = (competencia: string) => Math.max(0, diasEntre(envioAte(competencia), hoje));
  const rascunhos: AlertaMedicao[] = medicoes
    .filter((medicao) => medicao.status === "rascunho" && competenciaValida(medicao.competencia) && medicao.competencia < atual)
    .map((medicao) => ({
      medicao_id: medicao.id,
      contrato_id: medicao.contrato_id ?? null,
      customer_code: medicao.customer_code ?? null,
      competencia: medicao.competencia,
      situacao: "rascunho",
      envio_ate: envioAte(medicao.competencia),
      dias_de_atraso: atraso(medicao.competencia),
    }));
  const abertas = new Set(medicoes.map((medicao) => `${medicao.contrato_id ?? ""}|${medicao.competencia}`));
  const naoAbertas: AlertaMedicao[] = contratos
    .filter(
      (contrato) =>
        contrato.status !== "encerrado" &&
        contratoComMedicaoMensal(contrato) &&
        competenciaNaVigencia(
          [{ de: dataOuNull(contrato.vigente_de), ate: dataOuNull(contrato.vigente_ate) }, ...(contrato.vigencias_anteriores ?? [])],
          anterior,
        ) &&
        !abertas.has(`${contrato.id}|${anterior}`),
    )
    .map((contrato) => ({
      medicao_id: `${contrato.id}_${anterior}`,
      contrato_id: contrato.id,
      customer_code: contrato.customer_code ?? null,
      competencia: anterior,
      situacao: "nao_aberta",
      envio_ate: envioAte(anterior),
      dias_de_atraso: atraso(anterior),
    }));
  return [...rascunhos, ...naoAbertas].sort((a, b) => a.competencia.localeCompare(b.competencia) || a.medicao_id.localeCompare(b.medicao_id));
}

/** O alerta como o Início mostra: o cliente e o contrato pelo nome. */
export type AlertaDeMedicaoDoInicio = {
  medicaoId: string;
  contratoId: string;
  competencia: string;
  situacao: AlertaMedicao["situacao"];
  /** AAAA-MM-DD. */
  envioAte: string;
  diasDeAtraso: number;
  cliente: string;
  contrato: string;
};

export function alertasDeMedicaoParaOInicio(
  alertas: readonly AlertaMedicao[],
  contratos: readonly Contrato[],
  nomes: ReadonlyMap<string, string>,
): AlertaDeMedicaoDoInicio[] {
  const porId = new Map(contratos.map((contrato) => [contrato.id, contrato]));
  return alertas.flatMap((alerta) => {
    const contrato = alerta.contrato_id ? porId.get(alerta.contrato_id) : undefined;
    if (!contrato) return [];
    return [
      {
        medicaoId: alerta.medicao_id,
        contratoId: contrato.id,
        competencia: alerta.competencia,
        situacao: alerta.situacao,
        envioAte: alerta.envio_ate,
        diasDeAtraso: alerta.dias_de_atraso,
        cliente: nomes.get(contrato.dados.customer_code) ?? contrato.dados.customer_code,
        contrato: contrato.dados.nome,
      },
    ];
  });
}

// --- Tabela da linha ----------------------------------------------------------------------------------

/** A tabela do contrato como o diálogo da linha a usa (com a lista de preços). */
export type TabelaDaLinha = {
  id: string;
  nome: string;
  variante: string;
  vigente_de: string;
  vigente_ate: string | null;
  status: string;
  precos: Registro;
};

export function tabelaDaLinhaDoRegistro(id: string, data: Registro): TabelaDaLinha | null {
  const vigenteDe = texto(data.vigente_de);
  if (!dataValida(vigenteDe)) return null;
  const vigenteAte = texto(data.vigente_ate);
  return {
    id,
    nome: texto(data.nome) || id,
    variante: texto(data.variante),
    vigente_de: vigenteDe,
    vigente_ate: dataValida(vigenteAte) ? vigenteAte : null,
    status: texto(data.status),
    precos: isRegistro(data.precos) ? data.precos : {},
  };
}

function semAcento(valor: string): string {
  return valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/**
 * A tabela do contrato para escolher os itens: a vigente na data da
 * solicitação na variante da medição; a linha noturna usa a Noturna do
 * contrato quando ela existe na data (a mesma regra do servidor,
 * tabelaDaLinha em domain/medicao.ts, que é quem precifica de verdade).
 */
export function tabelaParaALinha(
  tabelas: readonly TabelaDaLinha[],
  solicitadaEm: string,
  janela: Janela,
  variante: string,
): TabelaDaLinha | null {
  const vigente = (nome: string) =>
    tabelas
      .filter(
        (tabela) =>
          semAcento(tabela.variante) === semAcento(nome) &&
          tabela.vigente_de <= solicitadaEm &&
          (tabela.vigente_ate === null || solicitadaEm <= tabela.vigente_ate),
      )
      .sort((a, b) => b.vigente_de.localeCompare(a.vigente_de))[0] ?? null;
  if (janela === "noturna" && semAcento(variante) !== "noturna") {
    const noturna = vigente("Noturna");
    if (noturna) return noturna;
  }
  return vigente(variante);
}

export { catalogoDaTabela };
export type { ItemDaTabela };

// --- Formulário da linha ---------------------------------------------------------------------------------

export type FormItem = {
  chave: string;
  origem: OrigemItem;
  lpuItemId: string | null;
  /** O nome do item, para mostrar. */
  rotulo: string;
  quantidade: string;
  preco: string;
  motivo: string;
  descricao: string;
};

export type FormLinha = {
  id: string | null;
  demanda: string;
  os: string;
  solicitadaEm: string;
  area: string;
  executadaEm: string;
  diaTipo: "" | DiaTipo;
  janela: Janela;
  origem: string;
  destino: string;
  mercadoria: string;
  anexoNome: string;
  anexoReferencia: string;
  itens: FormItem[];
};

export function formNovaLinha(competencia: string, _chave: string): FormLinha {
  void competencia;
  return {
    id: null,
    demanda: "",
    os: "",
    solicitadaEm: "",
    area: "",
    executadaEm: "",
    diaTipo: "",
    janela: "diurna",
    origem: "",
    destino: "",
    mercadoria: "",
    anexoNome: "",
    anexoReferencia: "",
    itens: [],
  };
}

export function itemDeTabela(item: ItemDaTabela, chave: string): FormItem {
  return {
    chave,
    origem: "tabela",
    lpuItemId: item.lpuItemId,
    rotulo: item.descricao || item.item,
    quantidade: "1",
    preco: "",
    motivo: "",
    descricao: "",
  };
}

export function itemAvulso(chave: string): FormItem {
  return { chave, origem: "avulso", lpuItemId: null, rotulo: "Item avulso", quantidade: "1", preco: "", motivo: "", descricao: "" };
}

/** "Alterar preço": o item da tabela passa a alterado, com o preço da tabela de partida (pt-BR) e o motivo a preencher. */
export function itemComPrecoAlterado(item: FormItem, precoDaTabela: string | null): FormItem {
  return { ...item, origem: "alterado", preco: precoDaTabela ? formatarDecimal(precoDaTabela, 2) : "", motivo: "" };
}

/** Volta ao preço da tabela: o preço e o motivo do alterado saem. */
export function itemComPrecoDaTabela(item: FormItem): FormItem {
  return { ...item, origem: "tabela", preco: "", motivo: "" };
}

/** A linha gravada de volta ao formulário (editar); o preço só vem no alterado e no avulso. */
export function formDaLinha(linha: LinhaDaMedicao, chave: string): FormLinha {
  return {
    id: linha.id,
    demanda: linha.demanda_numero ?? "",
    os: linha.os,
    solicitadaEm: linha.solicitada_em,
    area: linha.area_solicitante,
    executadaEm: linha.executada_em,
    diaTipo: linha.dia_tipo,
    janela: linha.janela,
    origem: linha.origem,
    destino: linha.destino,
    mercadoria: linha.mercadoria,
    anexoNome: linha.anexo?.nome ?? "",
    anexoReferencia: linha.anexo?.referencia ?? "",
    itens: linha.itens.map((item, indice) => ({
      chave: `${chave}-${indice}`,
      origem: item.origem,
      lpuItemId: item.lpu_item_id,
      rotulo: item.descricao || item.item,
      quantidade: item.quantidade,
      preco: item.origem === "tabela" ? "" : item.preco,
      motivo: item.motivo ?? "",
      descricao: item.origem === "avulso" ? item.descricao : "",
    })),
  };
}

function quantidadeValida(valor: string): boolean {
  const decimal = paraDecimal(valor);
  if (!decimal) return false;
  try {
    return lerDecimal(decimal, 3, "quantidade").coeficiente > 0n;
  } catch {
    return false;
  }
}

function precoValido(valor: string): boolean {
  const decimal = paraDecimal(valor);
  if (!decimal) return false;
  try {
    return lerDecimal(decimal, 4, "preço").coeficiente >= 0n;
  } catch {
    return false;
  }
}

/** Os problemas que o servidor também recusaria, antes de gravar (a lista vazia: pode salvar). */
export function problemasDaLinha(form: FormLinha, competencia: string, hoje: string): string[] {
  const problemas: string[] = [];
  if (!form.os.trim()) problemas.push("Informe a OS.");
  if (!form.area.trim()) problemas.push("Informe a área solicitante.");
  if (!form.origem.trim()) problemas.push("Informe a origem.");
  if (!form.destino.trim()) problemas.push("Informe o destino.");
  if (!form.mercadoria.trim()) problemas.push("Informe a mercadoria.");
  if (!dataValida(form.solicitadaEm)) problemas.push("Informe a data da solicitação.");
  if (!dataValida(form.executadaEm)) {
    problemas.push("Informe a data da execução.");
  } else {
    if (form.executadaEm.slice(0, 7) !== competencia) {
      problemas.push(
        `A execução (${dataBr(form.executadaEm)}) é de outro mês: a linha entra na medição de ${rotuloDaCompetencia(form.executadaEm.slice(0, 7))}.`,
      );
    } else if (form.executadaEm > hoje) {
      problemas.push("A execução não pode ser depois de hoje.");
    }
    if (dataValida(form.solicitadaEm) && form.solicitadaEm > form.executadaEm) problemas.push("A solicitação vem antes da execução.");
  }
  if (form.demanda.trim() && !/^\d{5,8}$/.test(form.demanda.trim())) problemas.push("Número da demanda inválido.");
  if (form.itens.length === 0) problemas.push("Informe ao menos um item.");
  if (form.itens.length > MAXIMO_DE_ITENS_POR_LINHA) problemas.push(`Use até ${MAXIMO_DE_ITENS_POR_LINHA} itens por linha.`);
  form.itens.forEach((item, indice) => {
    const n = indice + 1;
    if (item.origem === "tabela" && !item.lpuItemId) problemas.push(`Item ${n}: escolha o item da tabela.`);
    if (item.origem === "avulso" && !item.descricao.trim()) problemas.push(`Item ${n}: informe a descrição.`);
    if (!quantidadeValida(item.quantidade)) problemas.push(`Item ${n}: quantidade inválida.`);
    if (item.origem !== "tabela") {
      if (!item.preco.trim()) problemas.push(`Item ${n}: informe o preço.`);
      else if (!precoValido(item.preco)) problemas.push(`Item ${n}: preço inválido.`);
      if (!item.motivo.trim()) problemas.push(`Item ${n}: informe o motivo.`);
    }
  });
  if (form.anexoNome.trim() && !form.anexoReferencia.trim()) problemas.push("Informe a referência do anexo (o e-mail ou a pasta).");
  if (!form.anexoNome.trim() && form.anexoReferencia.trim()) problemas.push("Informe o nome do anexo.");
  return problemas;
}

// --- Chamadas das callables -----------------------------------------------------------------------------

function itemDoForm(item: FormItem): Registro {
  const quantidade = paraDecimal(item.quantidade) ?? item.quantidade.trim();
  if (item.origem === "tabela") return { lpu_item_id: item.lpuItemId, quantidade, origem: "tabela" };
  const preco = paraDecimal(item.preco) ?? item.preco.trim();
  if (item.origem === "alterado") {
    return { lpu_item_id: item.lpuItemId, quantidade, origem: "alterado", preco, motivo: item.motivo.trim() };
  }
  return {
    lpu_item_id: null,
    quantidade,
    origem: "avulso",
    preco,
    motivo: item.motivo.trim(),
    descricao: item.descricao.trim(),
  };
}

function entradaDoForm(form: FormLinha): Registro {
  const anexo = form.anexoNome.trim() && form.anexoReferencia.trim() ? { nome: form.anexoNome.trim(), referencia: form.anexoReferencia.trim() } : null;
  return {
    ...(form.id ? { id: form.id } : {}),
    demanda_numero: form.demanda.trim() || null,
    os: form.os.trim(),
    solicitada_em: form.solicitadaEm,
    area_solicitante: form.area.trim(),
    executada_em: form.executadaEm,
    ...(form.diaTipo ? { dia_tipo: form.diaTipo } : {}),
    janela: form.janela,
    origem: form.origem.trim(),
    destino: form.destino.trim(),
    mercadoria: form.mercadoria.trim(),
    itens: form.itens.map(itemDoForm),
    anexo,
  };
}

function itemGravadoComoEntrada(item: ItemDaMedicao): Registro {
  if (item.origem === "tabela") return { lpu_item_id: item.lpu_item_id, quantidade: item.quantidade, origem: "tabela" };
  if (item.origem === "alterado") {
    return { lpu_item_id: item.lpu_item_id, quantidade: item.quantidade, origem: "alterado", preco: item.preco, motivo: item.motivo ?? "" };
  }
  return {
    lpu_item_id: null,
    quantidade: item.quantidade,
    origem: "avulso",
    preco: item.preco,
    motivo: item.motivo ?? "",
    descricao: item.descricao,
  };
}

/** A linha gravada como entrada do servidor: o mesmo dia da tarifa, a janela e o anexo. */
function entradaDaLinha(linha: LinhaDaMedicao): Registro {
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
    itens: linha.itens.map(itemGravadoComoEntrada),
    anexo: linha.anexo,
  };
}

function gravarLinha(medicao: Medicao, linha: Registro, chave: string): Registro {
  return { action: "upsert_line", request_id: chave, medicao_id: medicao.id, expected_edicao: medicao.edicao, linha };
}

/** Abrir a medição do mês de um contrato por medição mensal (saveMedicao create). */
export function payloadCriar(contratoId: string, competencia: string, chave: string): Registro {
  return { action: "create", request_id: chave, contrato_id: contratoId, competencia };
}

/** Incluir ou atualizar uma linha (saveMedicao upsert_line), na edição que a tela viu. */
export function payloadSalvarLinha(medicao: Medicao, form: FormLinha, chave: string): Registro {
  return gravarLinha(medicao, entradaDoForm(form), chave);
}

export function payloadRetirarLinha(medicao: Medicao, linhaId: string, chave: string): Registro {
  return { action: "remove_line", request_id: chave, medicao_id: medicao.id, expected_edicao: medicao.edicao, linha_id: linhaId };
}

/** "Aplicar sábado": o item de diária que não bate vira o que a tabela tem para o dia (trocar_por). */
export function payloadAplicarTarifa(medicao: Medicao, linha: LinhaDaMedicao, lpuItemId: string, chave: string): Registro {
  const entrada = entradaDaLinha(linha);
  const itens = linha.itens.map((item) =>
    item.lpu_item_id === lpuItemId && item.trocar_por
      ? { lpu_item_id: item.trocar_por, quantidade: item.quantidade, origem: "tabela" }
      : itemGravadoComoEntrada(item),
  );
  return gravarLinha(medicao, { ...entrada, itens }, chave);
}

/** "Anexar": o pedido da linha (o nome e a referência: o e-mail ou a pasta). */
export function payloadAnexar(medicao: Medicao, linha: LinhaDaMedicao, anexo: Anexo, chave: string): Registro {
  return gravarLinha(medicao, { ...entradaDaLinha(linha), anexo: { nome: anexo.nome.trim(), referencia: anexo.referencia.trim() } }, chave);
}

export type AcaoDeAvanco = "send" | "approve" | "contest" | "reopen";

/** advanceMedicao: a situação e a edição que a tela viu. */
export function payloadAvancar(
  medicao: Medicao,
  acao: AcaoDeAvanco,
  chave: string,
  extra: { link?: string; em?: string; nota?: string } = {},
): Registro {
  const base: Registro = {
    action: acao,
    request_id: chave,
    medicao_id: medicao.id,
    expected_status: medicao.status,
    expected_edicao: medicao.edicao,
  };
  const link = extra.link?.trim();
  const em = extra.em?.trim();
  if (acao === "approve") return { ...base, ...(link ? { link } : {}), ...(em ? { em } : {}) };
  if (acao === "contest") return { ...base, nota: (extra.nota ?? "").trim(), ...(em ? { em } : {}) };
  return base;
}

const MEDICAO_MUDOU = [/^A medição \S+ mudou/, /^A medição está /, /^A medição foi contestada/];
const MEDICAO_SUMIU = /^Medição \S+ não encontrada\.$/;

/**
 * O erro da callable para a tela: medição que mudou (situação ou edição
 * diferente da que a tela viu) ou que sumiu recarrega; qualquer outra recusa
 * só mostra a mensagem e mantém o que a pessoa digitou.
 */
export function classificarErroDaMedicao(error: unknown): { mensagem: string; recarregar: boolean } {
  const registro = (error ?? {}) as { codigo?: unknown; code?: unknown };
  const codigo = String(registro.codigo ?? registro.code ?? "").replace(/^functions\//, "");
  const mensagem = error instanceof Error && error.message ? error.message : "Não foi possível concluir. Tente de novo.";
  const recarregar =
    (codigo === "failed-precondition" && MEDICAO_MUDOU.some((modelo) => modelo.test(mensagem))) ||
    (codigo === "not-found" && MEDICAO_SUMIU.test(mensagem));
  return { mensagem, recarregar };
}
