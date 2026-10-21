import {
  MESES_PAGAMENTO,
  STATUS_CONTRATO,
  TIPOS_PAGAMENTO,
  TIPOS_REAJUSTE,
  TIPOS_RENOVACAO,
  alertasDoContrato,
  dataValida,
  diasEntre,
  mesDiaValido,
  pagamentoPrevisto,
  prazoDeRenovacao,
  problemaDasFaixas,
  somarDias,
  type AlertaContrato,
  type FaixaPagamento,
  type MesPagamento,
  type StatusContrato,
  type TipoAlerta,
  type TipoPagamento,
  type TipoReajuste,
  type TipoRenovacao,
} from "@workspace/dominio";

import { dataBr, type CadastroComercial } from "./clientes";

/**
 * Regras puras da aba Contratos do Comercial (docs/mockups/ComContrato.dc.html;
 * docs/plataforma/fase-6-comercial.md, parte 14): o contrato lido de
 * `contracts` (functions/comercial, domain/contratos.ts), a lista com o selo
 * de situação, a ficha (vigência, condições, tabelas, aditivos e alertas), os
 * itens do Início e as entradas das callables saveContract e recordAditivo.
 *
 * As datas (alertas, prazo de renovação, pagamento) vêm de lib/dominio, a
 * mesma conta das Functions. A tela lê pelo Firestore (canReadPrices: owner,
 * admin e comercial) e grava só pelas callables.
 */

type Registro = Record<string, unknown>;

// --- Listas das callables (travadas contra functions/comercial em contratos.test.ts) --------

/** Tipo do número do contrato (contratos.ts, TIPOS_NUMERO_CONTRATO). */
export const TIPOS_NUMERO_CONTRATO = ["contrato", "sistema_cliente", "outro"] as const;
export type TipoNumeroContrato = (typeof TIPOS_NUMERO_CONTRATO)[number];

/** Autorização de faturamento (contratos.ts, TIPOS_AUTORIZACAO). */
export const TIPOS_AUTORIZACAO = ["pedido_aceite", "medicao_aprovada", "portal", "nenhuma"] as const;
export type TipoAutorizacao = (typeof TIPOS_AUTORIZACAO)[number];

/** Regime de cobrança por serviço (events.ts, REGIMES_COBRANCA). */
export const REGIMES_COBRANCA = ["por_demanda", "medicao_mensal", "wms"] as const;
export type RegimeCobranca = (typeof REGIMES_COBRANCA)[number];

/** Tipos de aditivo (events.ts, TIPOS_ADITIVO). */
export const TIPOS_ADITIVO = ["formalizacao", "prorrogacao", "preco", "escopo", "outro"] as const;
export type TipoAditivo = (typeof TIPOS_ADITIVO)[number];

/** Aditivos que trazem vigência nova (contratos.ts, ADITIVOS_COM_VIGENCIA). */
export const ADITIVOS_COM_VIGENCIA: readonly TipoAditivo[] = ["prorrogacao", "preco"];

export const ROTULO_DO_NUMERO: Record<TipoNumeroContrato, string> = {
  contrato: "Contrato",
  sistema_cliente: "Nº no cliente",
  outro: "Nº",
};

export const ROTULO_DA_RENOVACAO: Record<TipoRenovacao, string> = {
  aditivo: "Por aditivo",
  automatica: "Automática",
  novo_documento: "Por novo contrato",
  indeterminado: "Prazo indeterminado",
};

export const ROTULO_DO_REAJUSTE: Record<TipoReajuste, string> = {
  negociado: "Negociado na renovação",
  indice: "Por índice",
  nenhum: "Sem reajuste",
};

export const ROTULO_DO_REGIME: Record<RegimeCobranca, string> = {
  por_demanda: "Por demanda",
  medicao_mensal: "Medição mensal",
  wms: "Fatura do WMS",
};

export const ROTULO_DA_AUTORIZACAO: Record<TipoAutorizacao, string> = {
  pedido_aceite: "Pedido e aceite",
  medicao_aprovada: "Medição aprovada",
  portal: "Portal do fornecedor",
  nenhuma: "Sem autorização",
};

export const ROTULO_DO_PAGAMENTO: Record<TipoPagamento, string> = {
  faixas_do_dia_da_nf: "Faixas do dia da NF",
  dias_apos_nf: "Dias depois da NF",
  texto: "Outra regra",
};

export const ROTULO_DO_ADITIVO: Record<TipoAditivo, string> = {
  formalizacao: "Formalização",
  prorrogacao: "Prorrogação",
  preco: "Preço",
  escopo: "Escopo",
  outro: "Outro",
};

// --- Leitura ---------------------------------------------------------------------------

function texto(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function textoOuNull(value: unknown): string | null {
  return texto(value) || null;
}

function inteiroOuNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function isRegistro(value: unknown): value is Registro {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function registro(value: unknown): Registro {
  return isRegistro(value) ? value : {};
}

function umDe<T extends string>(lista: readonly T[], value: unknown, padrao: T): T {
  return typeof value === "string" && (lista as readonly string[]).includes(value) ? (value as T) : padrao;
}

function lista(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Os dados do contrato, no formato da entrada de saveContract (CONTRATO_DADOS, sem preço). */
export type ContratoDados = {
  customer_code: string;
  nome: string;
  numeros: Array<{ tipo: TipoNumeroContrato; numero: string }>;
  objeto: string;
  vigente_de: string;
  /** null: prazo indeterminado. */
  vigente_ate: string | null;
  renovacao: { tipo: TipoRenovacao; aviso_dias: number | null; oposicao_ate_dias: number | null };
  reajuste: { tipo: TipoReajuste; indice: string | null; data_base: string | null };
  regimes: Array<{ servico: string; regime: RegimeCobranca }>;
  regime_padrao: RegimeCobranca;
  autorizacao: { tipo: TipoAutorizacao; prazo_perda_dias: number | null };
  pagamento: { tipo: TipoPagamento; faixas: FaixaPagamento[]; dias: number | null; texto: string | null };
  impostos: { inclusos: boolean | null; texto: string | null };
  codigo_servico: string | null;
  documentos: Array<{ nome: string; referencia: string }>;
  status: StatusContrato;
};

/** Contrato lido de `contracts/{id}`: os dados e a edição (o estado que a edição confere). */
export type Contrato = { id: string; edicao: number; dados: ContratoDados };

function faixaLida(value: unknown): FaixaPagamento | null {
  const faixa = registro(value);
  const de = inteiroOuNull(faixa.de);
  const ate = inteiroOuNull(faixa.ate);
  const dia = inteiroOuNull(faixa.dia);
  if (de === null || ate === null || dia === null) return null;
  return { de, ate, dia, mes: umDe<MesPagamento>(MESES_PAGAMENTO, faixa.mes, "mesmo") };
}

/** Documento de `contracts` como a tela usa. Sem cliente ou sem início válido, fica fora. */
export function contratoDoRegistro(id: string, data: Registro): Contrato | null {
  const customerCode = texto(data.customer_code);
  const vigenteDe = texto(data.vigente_de);
  if (!customerCode || !dataValida(vigenteDe)) return null;
  const vigenteAte = texto(data.vigente_ate);
  const renovacao = registro(data.renovacao);
  const reajuste = registro(data.reajuste);
  const autorizacao = registro(data.autorizacao);
  const pagamento = registro(data.pagamento);
  const impostos = registro(data.impostos);
  const codigo = texto(data.codigo_servico);
  return {
    id,
    edicao: inteiroOuNull(data.edicao) ?? 1,
    dados: {
      customer_code: customerCode,
      nome: texto(data.nome) || id,
      numeros: lista(data.numeros)
        .map((item) => {
          const numero = registro(item);
          return { tipo: umDe<TipoNumeroContrato>(TIPOS_NUMERO_CONTRATO, numero.tipo, "outro"), numero: texto(numero.numero) };
        })
        .filter((numero) => numero.numero),
      objeto: texto(data.objeto),
      vigente_de: vigenteDe,
      vigente_ate: dataValida(vigenteAte) ? vigenteAte : null,
      renovacao: {
        tipo: umDe<TipoRenovacao>(TIPOS_RENOVACAO, renovacao.tipo, "aditivo"),
        aviso_dias: inteiroOuNull(renovacao.aviso_dias),
        oposicao_ate_dias: inteiroOuNull(renovacao.oposicao_ate_dias),
      },
      reajuste: {
        tipo: umDe<TipoReajuste>(TIPOS_REAJUSTE, reajuste.tipo, "negociado"),
        indice: textoOuNull(reajuste.indice),
        data_base: mesDiaValido(reajuste.data_base) ? reajuste.data_base : null,
      },
      regimes: lista(data.regimes)
        .map((item) => {
          const regime = registro(item);
          return { servico: texto(regime.servico), regime: umDe<RegimeCobranca>(REGIMES_COBRANCA, regime.regime, "por_demanda") };
        })
        .filter((regime) => regime.servico),
      regime_padrao: umDe<RegimeCobranca>(REGIMES_COBRANCA, data.regime_padrao, "por_demanda"),
      autorizacao: {
        tipo: umDe<TipoAutorizacao>(TIPOS_AUTORIZACAO, autorizacao.tipo, "nenhuma"),
        prazo_perda_dias: inteiroOuNull(autorizacao.prazo_perda_dias),
      },
      pagamento: {
        tipo: umDe<TipoPagamento>(TIPOS_PAGAMENTO, pagamento.tipo, "texto"),
        faixas: lista(pagamento.faixas)
          .map(faixaLida)
          .filter((faixa): faixa is FaixaPagamento => faixa !== null),
        dias: inteiroOuNull(pagamento.dias),
        texto: textoOuNull(pagamento.texto),
      },
      impostos: {
        inclusos: typeof impostos.inclusos === "boolean" ? impostos.inclusos : null,
        texto: textoOuNull(impostos.texto),
      },
      codigo_servico: codigo || null,
      documentos: lista(data.documentos)
        .map((item) => {
          const documento = registro(item);
          return { nome: texto(documento.nome), referencia: texto(documento.referencia) };
        })
        .filter((documento) => documento.nome || documento.referencia),
      status: umDe<StatusContrato>(STATUS_CONTRATO, data.status, "vigente"),
    },
  };
}

/** Aditivo do histórico (`contracts/{id}/aditivos/{numero}`), imutável. */
export type Aditivo = {
  id: string;
  numero: number;
  tipo: TipoAditivo;
  assinadoEm: string | null;
  vigenteDe: string | null;
  vigenteAte: string | null;
  tabelas: number;
  documento: { nome: string; referencia: string } | null;
  observacao: string;
};

export function aditivoDoRegistro(id: string, data: Registro): Aditivo | null {
  const numero = inteiroOuNull(data.numero) ?? (/^\d+$/.test(id) ? Number(id) : null);
  if (numero === null) return null;
  const documento = isRegistro(data.documento) ? data.documento : null;
  const data_ = (value: unknown) => (dataValida(value) ? value : null);
  return {
    id,
    numero,
    tipo: umDe<TipoAditivo>(TIPOS_ADITIVO, data.tipo, "outro"),
    assinadoEm: data_(data.assinado_em),
    vigenteDe: data_(data.vigente_de),
    vigenteAte: data_(data.vigente_ate),
    tabelas: lista(data.tabela_ids).length,
    documento: documento ? { nome: texto(documento.nome), referencia: texto(documento.referencia) } : null,
    observacao: texto(data.observacao),
  };
}

/** Tabela de preço ligada ao contrato (`price_tables` com `contract_id`). A lista de preços fica fora. */
export type TabelaDoContrato = {
  id: string;
  nome: string;
  variante: string;
  vigenteDe: string;
  vigenteAte: string | null;
  encerrada: boolean;
  itens: number;
};

export function tabelaDoRegistro(id: string, data: Registro): TabelaDoContrato | null {
  const vigenteDe = texto(data.vigente_de);
  if (!dataValida(vigenteDe)) return null;
  const vigenteAte = texto(data.vigente_ate);
  return {
    id,
    nome: texto(data.nome) || id,
    variante: texto(data.variante),
    vigenteDe,
    vigenteAte: dataValida(vigenteAte) ? vigenteAte : null,
    encerrada: texto(data.status) === "encerrada",
    itens: Object.keys(registro(data.precos)).length,
  };
}

// --- Situação e lista -----------------------------------------------------------------

export type TomDoSelo = "ok" | "atencao" | "critico" | "neutro";

export type SeloDoContrato = { rotulo: string; tom: TomDoSelo };

function emDias(dias: number): string {
  return dias === 1 ? "1 dia" : `${dias} dias`;
}

/** Renovação automática que passou do fim sem encerrar: renovou, e o novo período ainda não foi registrado. */
function renovouSemRegistro(dados: ContratoDados, hoje: string): boolean {
  return dados.renovacao.tipo === "automatica" && dados.vigente_ate !== null && diasEntre(hoje, dados.vigente_ate) < 0;
}

/**
 * Situação de hoje: encerrado e a iniciar pelo status e pelas datas; depois
 * do fim, vencido (ou, na renovação automática, "Renovação a registrar");
 * "Renovação em N dias" quando o prazo de renovação ou o fim entram nos
 * alertas (120 dias antes), contando até a data mais próxima que ainda não
 * passou, e crítica quando o prazo de aviso ou de oposição já passou ou falta
 * 30 dias ou menos; vigente no resto. A `ordem` põe o que pede ação primeiro.
 */
export function seloDoContrato(dados: ContratoDados, hoje: string): SeloDoContrato & { ordem: number; dias: number | null } {
  if (dados.status === "encerrado") return { rotulo: "Encerrado", tom: "neutro", ordem: 5, dias: null };
  if (diasEntre(hoje, dados.vigente_de) > 0) return { rotulo: "A iniciar", tom: "neutro", ordem: 4, dias: null };
  const fim = dados.vigente_ate;
  if (fim !== null && diasEntre(hoje, fim) < 0) {
    const rotulo = renovouSemRegistro(dados, hoje) ? "Renovação a registrar" : "Vencido";
    return { rotulo, tom: "critico", ordem: 0, dias: diasEntre(hoje, fim) };
  }
  const prazos = alertasDoContrato(dados, hoje).filter((alerta) => alerta.tipo !== "reajuste");
  const futuros = prazos.filter((alerta) => alerta.dias >= 0).map((alerta) => alerta.dias);
  const perdido = prazos.some((alerta) => alerta.dias < 0);
  // Aviso (ou oposição) de mais de 120 dias já perdido, com o fim ainda fora dos alertas: conta até o fim.
  if (futuros.length || (perdido && fim !== null)) {
    const dias = futuros.length ? Math.min(...futuros) : diasEntre(hoje, fim!);
    const critico = perdido || dias <= 30;
    return {
      rotulo: dias === 0 ? "Renovação hoje" : `Renovação em ${emDias(dias)}`,
      tom: critico ? "critico" : "atencao",
      ordem: critico ? 1 : 2,
      dias,
    };
  }
  return { rotulo: "Vigente", tom: "ok", ordem: 3, dias: null };
}

/** "vence 30/06/2027", "renova 31/12/2026" (e "renovou" depois do fim), "sem prazo" ou, no encerrado, "até 29/06/2026". */
export function vencimentoDoContrato(dados: ContratoDados, hoje: string): string {
  const fim = dados.vigente_ate;
  if (dados.status === "encerrado") return fim ? `até ${dataBr(fim)}` : "encerrado";
  if (fim === null) return "sem prazo";
  if (diasEntre(hoje, fim) < 0) return renovouSemRegistro(dados, hoje) ? `renovou ${dataBr(fim)}` : `venceu ${dataBr(fim)}`;
  return dados.renovacao.tipo === "automatica" ? `renova ${dataBr(fim)}` : `vence ${dataBr(fim)}`;
}

export const FILTROS_DA_LISTA = ["vigentes", "encerrados"] as const;
export type FiltroDaLista = (typeof FILTROS_DA_LISTA)[number];

export type ItemDaLista = {
  contrato: Contrato;
  cliente: string;
  selo: SeloDoContrato;
  vencimento: string;
};

function doFiltro(contrato: Contrato, filtro: FiltroDaLista): boolean {
  return filtro === "encerrados" ? contrato.dados.status === "encerrado" : contrato.dados.status !== "encerrado";
}

export function contarFiltros(contratos: readonly Contrato[]): Record<FiltroDaLista, number> {
  return {
    vigentes: contratos.filter((contrato) => doFiltro(contrato, "vigentes")).length,
    encerrados: contratos.filter((contrato) => doFiltro(contrato, "encerrados")).length,
  };
}

/** Nome de cada cliente pelo código, do cadastro (`customers`). */
export function nomesDosClientes(cadastros: readonly CadastroComercial[]): Map<string, string> {
  return new Map(cadastros.map((cadastro) => [cadastro.code, cadastro.nome]));
}

/** Nome do cliente pelo código; sem cadastro (ou arquivado), o próprio código. */
export function nomeDoCliente(nomes: ReadonlyMap<string, string>, customerCode: string): string {
  return nomes.get(customerCode) ?? customerCode;
}

/**
 * A lista da esquerda. Vigentes: o que precisa de ação primeiro (vencido ou
 * renovação a registrar, depois a renovação crítica e a que pede atenção, a
 * mais próxima antes), depois o vencimento mais próximo (sem prazo por último)
 * e os a iniciar. Encerrados: o fim mais recente primeiro. Empate pelo nome
 * do cliente.
 */
export function listaDeContratos(
  contratos: readonly Contrato[],
  nomes: ReadonlyMap<string, string>,
  filtro: FiltroDaLista,
  hoje: string,
): ItemDaLista[] {
  const itens = contratos
    .filter((contrato) => doFiltro(contrato, filtro))
    .map((contrato) => {
      const { ordem, dias, ...selo } = seloDoContrato(contrato.dados, hoje);
      return {
        item: {
          contrato,
          cliente: nomeDoCliente(nomes, contrato.dados.customer_code),
          selo,
          vencimento: vencimentoDoContrato(contrato.dados, hoje),
        },
        ordem,
        dias,
      };
    });
  const fim = (contrato: Contrato) => contrato.dados.vigente_ate ?? "9999-12-31";
  itens.sort((a, b) => {
    const porNome =
      a.item.cliente.localeCompare(b.item.cliente, "pt-BR", { sensitivity: "base" }) ||
      a.item.contrato.id.localeCompare(b.item.contrato.id);
    if (filtro === "encerrados") return fim(b.item.contrato).localeCompare(fim(a.item.contrato)) || porNome;
    return (
      a.ordem - b.ordem ||
      (a.dias ?? 0) - (b.dias ?? 0) ||
      fim(a.item.contrato).localeCompare(fim(b.item.contrato)) ||
      porNome
    );
  });
  return itens.map(({ item }) => item);
}

/** O contrato da ficha: o da URL, quando existe; senão o primeiro do filtro. */
export function contratoEscolhido(itens: readonly ItemDaLista[], todos: readonly Contrato[], id: string | null): Contrato | null {
  if (id) {
    const daUrl = todos.find((contrato) => contrato.id === id);
    if (daUrl) return daUrl;
  }
  return itens[0]?.contrato ?? null;
}

// --- Ficha ------------------------------------------------------------------------------

/** "Contrato CT-0001", "Nº Itaú 4600008821" (com o nome do cliente; sem ele, "Nº no cliente"). */
export function numerosDoContrato(dados: ContratoDados, cliente?: string): string[] {
  return dados.numeros.map((numero) => {
    const rotulo = numero.tipo === "sistema_cliente" && cliente ? `Nº ${cliente}` : ROTULO_DO_NUMERO[numero.tipo];
    return `${rotulo} ${numero.numero}`;
  });
}

/** Referência de documento que abre como link: só endereço https, sem espaço. O resto (caminho de pasta) fica como texto. */
export function linkDoDocumento(referencia: string): string | null {
  return /^https:\/\/\S+$/.test(referencia) ? referencia : null;
}

export type Vigencia = {
  periodo: string;
  restante: string;
  /** Posição de hoje na barra, de 0 a 100; null sem prazo. */
  hoje: number | null;
  /** O prazo de renovação na barra, quando cai dentro da vigência: o aviso de denúncia ou, na automática, a oposição. */
  renovacao: { data: string; posicao: number; rotulo: "Aviso" | "Oposição" } | null;
};

function posicao(de: string, ate: string, data: string): number {
  const total = diasEntre(de, ate);
  if (total <= 0) return 100;
  const valor = (diasEntre(de, data) / total) * 100;
  return Math.round(Math.min(100, Math.max(0, valor)) * 10) / 10;
}

export function vigenciaDoContrato(dados: ContratoDados, hoje: string): Vigencia {
  const { vigente_de: de, vigente_ate: ate } = dados;
  if (ate === null) {
    return { periodo: `Desde ${dataBr(de)}`, restante: "prazo indeterminado", hoje: null, renovacao: null };
  }
  const periodo = `${dataBr(de)} – ${dataBr(ate)}`;
  const faltam = diasEntre(hoje, ate);
  const comeca = diasEntre(hoje, de);
  let restante: string;
  if (dados.status === "encerrado") restante = "encerrado";
  else if (comeca > 0) restante = `começa em ${emDias(comeca)}`;
  else if (faltam > 0) restante = faltam === 1 ? "falta 1 dia" : `faltam ${faltam} dias`;
  else if (faltam === 0) restante = "vence hoje";
  else restante = renovouSemRegistro(dados, hoje) ? `renovou há ${emDias(-faltam)}` : `venceu há ${emDias(-faltam)}`;
  const prazo = prazoDeRenovacao(dados, ate);
  const rotulo = dados.renovacao.tipo === "automatica" ? "Oposição" : "Aviso";
  const renovacao: Vigencia["renovacao"] = prazo && diasEntre(de, prazo) >= 0 ? { data: prazo, posicao: posicao(de, ate, prazo), rotulo } : null;
  return { periodo, restante, hoje: posicao(de, ate, hoje), renovacao };
}

/** "07-01" → "01/07". */
export function dataBaseParaTela(dataBase: string | null): string {
  if (!dataBase || !mesDiaValido(dataBase)) return "";
  const [mes, dia] = dataBase.split("-");
  return `${dia}/${mes}`;
}

/** "01/07" (ou "1/7") → "07-01"; fora do formato, null. */
export function dataBaseDaTela(valor: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(valor.trim());
  if (!match) return null;
  const mesDia = `${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return mesDiaValido(mesDia) ? mesDia : null;
}

function diasAntes(dias: number | null): string {
  if (dias === null) return "—";
  return dias === 0 ? "Até o fim" : `${emDias(dias)} antes do fim`;
}

function textoDaFaixa(faixa: FaixaPagamento): { quando: string; paga: string } {
  return {
    quando: `NF recebida dia ${faixa.de} a ${faixa.ate}`,
    paga: faixa.mes === "seguinte" ? `Paga dia ${faixa.dia} do mês seguinte` : `Paga dia ${faixa.dia}`,
  };
}

/** "Fatura do WMS" → "fatura do WMS": só a primeira letra, a sigla fica. */
function inicialMinuscula(texto: string): string {
  return texto.charAt(0).toLocaleLowerCase("pt-BR") + texto.slice(1);
}

export type Condicoes = {
  campos: Array<[string, string]>;
  pagamento: { faixas: Array<{ quando: string; paga: string }>; regra: string | null; previsto: string | null };
};

/** Condições da ficha, em rótulo e valor, e a regra de pagamento com a previsão de uma NF recebida hoje. */
export function condicoesDoContrato(dados: ContratoDados, hoje: string): Condicoes {
  const { renovacao, reajuste, autorizacao, pagamento, impostos } = dados;
  const campos: Array<[string, string]> = [["Renovação", ROTULO_DA_RENOVACAO[renovacao.tipo]]];
  if (renovacao.tipo === "automatica") campos.push(["Oposição", diasAntes(renovacao.oposicao_ate_dias)]);
  if (renovacao.tipo !== "automatica" || renovacao.aviso_dias !== null) campos.push(["Aviso de denúncia", diasAntes(renovacao.aviso_dias)]);
  campos.push([
    "Reajuste",
    reajuste.tipo === "indice"
      ? [reajuste.indice, reajuste.data_base ? `em ${dataBaseParaTela(reajuste.data_base)}` : ""].filter(Boolean).join(" ")
      : ROTULO_DO_REAJUSTE[reajuste.tipo],
  ]);
  campos.push(["Regime de cobrança", ROTULO_DO_REGIME[dados.regime_padrao]]);
  if (dados.regimes.length) {
    campos.push([
      "Regime por serviço",
      dados.regimes.map((item) => `${item.servico}: ${inicialMinuscula(ROTULO_DO_REGIME[item.regime])}`).join(" · "),
    ]);
  }
  campos.push(["Autorização de faturamento", ROTULO_DA_AUTORIZACAO[autorizacao.tipo]]);
  if (autorizacao.prazo_perda_dias !== null) campos.push(["Prazo de perda", emDias(autorizacao.prazo_perda_dias)]);
  campos.push(["Código de serviço", dados.codigo_servico ?? "—"]);
  const inclusos = impostos.inclusos === null ? null : impostos.inclusos ? "Inclusos no preço" : "Não inclusos no preço";
  campos.push(["Impostos", [inclusos, impostos.texto].filter(Boolean).join(" · ") || "—"]);

  const faixas = pagamento.tipo === "faixas_do_dia_da_nf" ? pagamento.faixas.map(textoDaFaixa) : [];
  let regra: string | null = null;
  if (pagamento.tipo === "dias_apos_nf") regra = pagamento.dias === null ? "—" : `${emDias(pagamento.dias)} depois de receber a NF`;
  if (pagamento.tipo === "texto") regra = pagamento.texto ?? "—";
  const previsto = pagamentoPrevisto(dados, hoje);
  return { campos, pagamento: { faixas, regra, previsto: previsto ? dataBr(previsto) : null } };
}

export type SituacaoDaTabela = SeloDoContrato & { ordem: number };

export function situacaoDaTabela(tabela: TabelaDoContrato, hoje: string): SituacaoDaTabela {
  const fim = tabela.vigenteAte;
  if (tabela.encerrada || (fim !== null && diasEntre(hoje, fim) < 0)) {
    return { rotulo: fim ? `Encerrada em ${dataBr(fim)}` : "Encerrada", tom: "neutro", ordem: 2 };
  }
  if (diasEntre(hoje, tabela.vigenteDe) > 0) return { rotulo: `A partir de ${dataBr(tabela.vigenteDe)}`, tom: "atencao", ordem: 1 };
  return { rotulo: "Vigente", tom: "ok", ordem: 0 };
}

export function periodoDaTabela(tabela: TabelaDoContrato): string {
  return tabela.vigenteAte ? `${dataBr(tabela.vigenteDe)} – ${dataBr(tabela.vigenteAte)}` : `desde ${dataBr(tabela.vigenteDe)}`;
}

/** Vigentes primeiro, depois as que vão começar e as encerradas; a mais nova antes. */
export function tabelasEmOrdem(tabelas: readonly TabelaDoContrato[], hoje: string): TabelaDoContrato[] {
  return [...tabelas].sort(
    (a, b) =>
      situacaoDaTabela(a, hoje).ordem - situacaoDaTabela(b, hoje).ordem ||
      b.vigenteDe.localeCompare(a.vigenteDe) ||
      a.variante.localeCompare(b.variante, "pt-BR") ||
      a.id.localeCompare(b.id),
  );
}

/** O mais novo em cima, como a linha do tempo do mockup. */
export function aditivosEmOrdem(aditivos: readonly Aditivo[]): Aditivo[] {
  return [...aditivos].sort((a, b) => b.numero - a.numero);
}

export type LinhaDoAditivo = {
  titulo: string;
  tipo: string;
  detalhes: string[];
  /** O documento do aditivo; `href` só com endereço https (linkDoDocumento). */
  documento: { nome: string; href: string | null } | null;
  observacao: string;
};

export function linhaDoAditivo(aditivo: Aditivo): LinhaDoAditivo {
  const comVigencia = aditivo.vigenteAte !== null;
  const formalizacao = aditivo.tipo === "formalizacao";
  // A formalização é o próprio contrato (o termo), não um aditivo numerado.
  const tipo = formalizacao ? "Contrato" : aditivo.tipo === "preco" && comVigencia ? "Preço e vigência" : ROTULO_DO_ADITIVO[aditivo.tipo];
  const detalhes = [
    aditivo.assinadoEm ? `assinado ${dataBr(aditivo.assinadoEm)}` : "sem data de assinatura",
    comVigencia && aditivo.vigenteDe ? `vigência ${dataBr(aditivo.vigenteDe)} – ${dataBr(aditivo.vigenteAte!)}` : "",
    aditivo.tabelas ? (aditivo.tabelas === 1 ? "1 tabela" : `${aditivo.tabelas} tabelas`) : "",
    aditivo.documento ? "" : "documento não localizado",
  ].filter(Boolean);
  const documento = aditivo.documento
    ? { nome: aditivo.documento.nome || aditivo.documento.referencia, href: linkDoDocumento(aditivo.documento.referencia) }
    : null;
  return {
    titulo: formalizacao ? "Termo de formalização" : `Aditivo ${aditivo.numero}`,
    tipo,
    detalhes,
    documento,
    observacao: aditivo.observacao,
  };
}

/** O último aditivo (o de maior número), para o selo da ficha. */
export function ultimoAditivo(aditivos: readonly Aditivo[]): Aditivo | null {
  return aditivosEmOrdem(aditivos).find((aditivo) => aditivo.tipo !== "formalizacao") ?? null;
}

// --- Alertas (ficha e Início) ----------------------------------------------------------------

export type TextoDoAlerta = { titulo: string; quando: string; tom: Extract<TomDoSelo, "atencao" | "critico"> };

export function quandoEmDias(dias: number): string {
  if (dias === 0) return "hoje";
  return dias > 0 ? `em ${emDias(dias)}` : `há ${emDias(-dias)}`;
}

/**
 * O que o alerta diz: a data e o que fazer nela; crítico quando a data passou
 * ou falta 30 dias ou menos. O prazo de renovação é o último dia do aviso de
 * denúncia (fim menos `aviso_dias`) ou, na automática, da oposição; começar a
 * renovar é o alerta do fim, que aparece 120 dias antes. Na automática, depois
 * do fim, o contrato renovou: falta registrar o novo período (aditivo).
 */
export function textoDoAlerta(alerta: AlertaContrato, dados: ContratoDados): TextoDoAlerta {
  const data = dataBr(alerta.data);
  const automatica = dados.renovacao.tipo === "automatica";
  const titulos: Record<TipoAlerta, string> = {
    fim_vigencia: automatica && alerta.dias < 0 ? `Registrar a renovação de ${data}` : `Fim da vigência em ${data}`,
    renovacao: automatica ? `Oposição à renovação até ${data}` : `Aviso de denúncia até ${data}`,
    reajuste: ["Reajuste", dados.reajuste.indice, `em ${data}`].filter(Boolean).join(" "),
  };
  return {
    titulo: titulos[alerta.tipo],
    quando: quandoEmDias(alerta.dias),
    tom: alerta.dias < 0 || alerta.marco === 30 ? "critico" : "atencao",
  };
}

export type AlertaDoInicio = {
  contratoId: string;
  tipo: TipoAlerta;
  data: string;
  dias: number;
  cliente: string;
  contrato: string;
} & TextoDoAlerta;

/**
 * Alertas de todos os contratos para o "Precisa de você" do Início: fim da
 * vigência, renovação e reajuste (alertasDoContrato), o mais próximo primeiro.
 */
export function alertasParaOInicio(
  contratos: readonly Contrato[],
  nomes: ReadonlyMap<string, string>,
  hoje: string,
): AlertaDoInicio[] {
  return contratos
    .flatMap((contrato) =>
      alertasDoContrato(contrato.dados, hoje).map((alerta) => ({
        contratoId: contrato.id,
        tipo: alerta.tipo,
        data: alerta.data,
        dias: alerta.dias,
        cliente: nomeDoCliente(nomes, contrato.dados.customer_code),
        contrato: contrato.dados.nome,
        ...textoDoAlerta(alerta, contrato.dados),
      })),
    )
    .sort((a, b) => a.data.localeCompare(b.data) || a.cliente.localeCompare(b.cliente, "pt-BR") || a.contratoId.localeCompare(b.contratoId));
}

// --- Registrar aditivo (recordAditivo) ------------------------------------------------------

export type FormAditivo = {
  numero: string;
  tipo: TipoAditivo;
  assinadoEm: string;
  vigenteDe: string;
  vigenteAte: string;
  tabelaIds: string[];
  documentoNome: string;
  documentoReferencia: string;
  observacao: string;
};

/** Formulário do próximo aditivo: o número seguinte e, na prorrogação, a vigência a partir do dia seguinte ao fim. */
export function formNovoAditivo(contrato: Contrato, aditivos: readonly Aditivo[]): FormAditivo {
  const numero = aditivos.reduce((maior, aditivo) => Math.max(maior, aditivo.numero), 0) + 1;
  const fim = contrato.dados.vigente_ate;
  return {
    numero: String(numero),
    tipo: "prorrogacao",
    assinadoEm: "",
    vigenteDe: fim ? somarDias(fim, 1) : "",
    vigenteAte: "",
    tabelaIds: [],
    documentoNome: "",
    documentoReferencia: "",
    observacao: "",
  };
}

export type AditivoDados = {
  numero: number;
  assinado_em: string | null;
  tipo: TipoAditivo;
  vigente_de: string | null;
  vigente_ate: string | null;
  tabela_ids: string[];
  documento: { nome: string; referencia: string } | null;
  observacao: string;
};

export type Conferido<T> = { ok: true; valor: T } | { ok: false; problema: string };

/** O aditivo do formulário, com as regras da callable (o servidor confere de novo). */
export function aditivoDoForm(form: FormAditivo, aditivos: readonly Aditivo[]): Conferido<AditivoDados> {
  const falha = (problema: string): Conferido<AditivoDados> => ({ ok: false, problema });
  if (!/^\d{1,3}$/.test(form.numero.trim())) return falha("Número do aditivo: inteiro de 0 a 999.");
  const numero = Number(form.numero.trim());
  if (aditivos.some((aditivo) => aditivo.numero === numero)) return falha(`O aditivo ${numero} já está no histórico.`);
  const assinado = form.assinadoEm.trim();
  if (assinado && !dataValida(assinado)) return falha("Data de assinatura inválida.");

  const comVigencia = ADITIVOS_COM_VIGENCIA.includes(form.tipo);
  const de = comVigencia ? form.vigenteDe.trim() : "";
  const ate = comVigencia ? form.vigenteAte.trim() : "";
  if (de || ate) {
    if (!dataValida(de) || !dataValida(ate)) return falha("Vigência nova precisa de início e fim.");
    if (diasEntre(de, ate) < 0) return falha("O fim da vigência vem antes do início.");
  } else if (form.tipo === "prorrogacao") {
    return falha("Prorrogação precisa da vigência nova.");
  }

  const tabelas = form.tipo === "preco" ? Array.from(new Set(form.tabelaIds)) : [];
  if (form.tipo === "preco" && tabelas.length === 0) return falha("Aditivo de preço liga ao menos uma tabela.");

  const nome = form.documentoNome.trim();
  const referencia = form.documentoReferencia.trim();
  if (Boolean(nome) !== Boolean(referencia)) return falha("Documento: informe o nome e a referência.");
  const observacao = form.observacao.trim();
  if (observacao.length > 2000) return falha("Observação: até 2000 caracteres.");

  return {
    ok: true,
    valor: {
      numero,
      assinado_em: assinado || null,
      tipo: form.tipo,
      vigente_de: de || null,
      vigente_ate: ate || null,
      tabela_ids: tabelas,
      documento: nome ? { nome, referencia } : null,
      observacao,
    },
  };
}

/** Entrada de recordAditivo: o servidor recusa o número que já está no histórico (o estado esperado). */
export function payloadAditivo(contratoId: string, aditivo: AditivoDados, idempotencyKey: string): Registro {
  return { idempotency_key: idempotencyKey, contrato_id: contratoId, aditivo };
}

// --- Novo contrato e Editar (saveContract) ---------------------------------------------------

export type FormFaixa = { de: string; ate: string; dia: string; mes: MesPagamento };

export type FormContrato = {
  customerCode: string;
  nome: string;
  numeros: Array<{ tipo: TipoNumeroContrato; numero: string }>;
  objeto: string;
  vigenteDe: string;
  vigenteAte: string;
  semPrazo: boolean;
  renovacao: TipoRenovacao;
  avisoDias: string;
  oposicaoDias: string;
  reajuste: TipoReajuste;
  indice: string;
  dataBase: string;
  regimePadrao: RegimeCobranca;
  regimes: Array<{ servico: string; regime: RegimeCobranca }>;
  autorizacao: TipoAutorizacao;
  prazoPerdaDias: string;
  pagamento: TipoPagamento;
  faixas: FormFaixa[];
  pagamentoDias: string;
  pagamentoTexto: string;
  impostosInclusos: "" | "sim" | "nao";
  impostosTexto: string;
  codigoServico: string;
  documentos: Array<{ nome: string; referencia: string }>;
  status: StatusContrato;
};

const numeroOuVazio = (valor: number | null) => (valor === null ? "" : String(valor));

/** Formulário vazio (novo contrato) ou com o contrato de quando o diálogo abriu (editar). */
export function formDoContrato(contrato: Contrato | null, customerCode = ""): FormContrato {
  if (!contrato) {
    return {
      customerCode,
      nome: "",
      numeros: [],
      objeto: "",
      vigenteDe: "",
      vigenteAte: "",
      semPrazo: false,
      renovacao: "aditivo",
      avisoDias: "",
      oposicaoDias: "",
      reajuste: "negociado",
      indice: "",
      dataBase: "",
      regimePadrao: "por_demanda",
      regimes: [],
      autorizacao: "nenhuma",
      prazoPerdaDias: "",
      pagamento: "texto",
      faixas: [],
      pagamentoDias: "",
      pagamentoTexto: "",
      impostosInclusos: "",
      impostosTexto: "",
      codigoServico: "",
      documentos: [],
      status: "vigente",
    };
  }
  const dados = contrato.dados;
  return {
    customerCode: dados.customer_code,
    nome: dados.nome,
    numeros: dados.numeros.map((numero) => ({ ...numero })),
    objeto: dados.objeto,
    vigenteDe: dados.vigente_de,
    vigenteAte: dados.vigente_ate ?? "",
    semPrazo: dados.vigente_ate === null,
    renovacao: dados.renovacao.tipo,
    avisoDias: numeroOuVazio(dados.renovacao.aviso_dias),
    oposicaoDias: numeroOuVazio(dados.renovacao.oposicao_ate_dias),
    reajuste: dados.reajuste.tipo,
    indice: dados.reajuste.indice ?? "",
    dataBase: dataBaseParaTela(dados.reajuste.data_base),
    regimePadrao: dados.regime_padrao,
    regimes: dados.regimes.map((regime) => ({ ...regime })),
    autorizacao: dados.autorizacao.tipo,
    prazoPerdaDias: numeroOuVazio(dados.autorizacao.prazo_perda_dias),
    pagamento: dados.pagamento.tipo,
    faixas: dados.pagamento.faixas.map((faixa) => ({
      de: String(faixa.de),
      ate: String(faixa.ate),
      dia: String(faixa.dia),
      mes: faixa.mes,
    })),
    pagamentoDias: numeroOuVazio(dados.pagamento.dias),
    pagamentoTexto: dados.pagamento.texto ?? "",
    impostosInclusos: dados.impostos.inclusos === null ? "" : dados.impostos.inclusos ? "sim" : "nao",
    impostosTexto: dados.impostos.texto ?? "",
    codigoServico: dados.codigo_servico ?? "",
    documentos: dados.documentos.map((documento) => ({ ...documento })),
    status: dados.status,
  };
}

/** A próxima faixa do dia da NF: começa no dia seguinte ao fim da última e vai até 31. */
export function proximaFaixa(faixas: readonly FormFaixa[]): FormFaixa {
  const ultimo = Number(faixas.at(-1)?.ate);
  const de = Number.isInteger(ultimo) && ultimo >= 1 && ultimo < 31 ? ultimo + 1 : 1;
  return { de: String(de), ate: "31", dia: "", mes: "seguinte" };
}

/** Dias inteiros de 0 a 3650 ou vazio (null); outro texto é problema. */
function diasDoCampo(valor: string, rotulo: string): Conferido<number | null> {
  const limpo = valor.trim();
  if (!limpo) return { ok: true, valor: null };
  if (!/^\d{1,4}$/.test(limpo) || Number(limpo) > 3650) return { ok: false, problema: `${rotulo}: dias inteiros de 0 a 3650.` };
  return { ok: true, valor: Number(limpo) };
}

/** Os dados do contrato do formulário, com as regras de CONTRATO_DADOS (o servidor confere de novo). */
export function contratoDoForm(form: FormContrato): Conferido<ContratoDados> {
  const falha = (problema: string): Conferido<ContratoDados> => ({ ok: false, problema });
  const customerCode = form.customerCode.trim();
  if (!customerCode) return falha("Escolha o cliente.");
  const nome = form.nome.trim();
  if (!nome) return falha("Informe o nome do contrato.");
  if (nome.length > 160) return falha("Nome: até 160 caracteres.");

  const numeros = form.numeros
    .map((item) => ({ tipo: item.tipo, numero: item.numero.trim() }))
    .filter((item) => item.numero);
  const de = form.vigenteDe.trim();
  if (!dataValida(de)) return falha("Informe o início da vigência.");
  const ate = form.semPrazo ? null : form.vigenteAte.trim();
  if (ate !== null && !dataValida(ate)) return falha("Informe o fim da vigência ou marque prazo indeterminado.");
  if (ate !== null && diasEntre(de, ate) < 0) return falha("O fim da vigência vem antes do início.");

  const aviso = diasDoCampo(form.avisoDias, "Aviso");
  if (!aviso.ok) return falha(aviso.problema);
  const oposicao = form.renovacao === "automatica" ? diasDoCampo(form.oposicaoDias, "Oposição") : ({ ok: true, valor: null } as const);
  if (!oposicao.ok) return falha(oposicao.problema);

  let indice: string | null = null;
  let dataBase: string | null = null;
  if (form.reajuste === "indice") {
    indice = form.indice.trim() || null;
    if (!indice) return falha("Informe o índice do reajuste (ex.: IPCA).");
    if (indice.length > 40) return falha("Índice: até 40 caracteres.");
    dataBase = dataBaseDaTela(form.dataBase);
    if (!dataBase) return falha("Data-base do reajuste: dia/mês (ex.: 01/07).");
  }

  const regimes = form.regimes
    .map((item) => ({ servico: item.servico.trim(), regime: item.regime }))
    .filter((item) => item.servico);
  const servicos = regimes.map((item) => item.servico.toLocaleLowerCase("pt-BR"));
  const repetido = regimes.find((_, index) => servicos.indexOf(servicos[index]) !== index);
  if (repetido) return falha(`Serviço repetido nos regimes: ${repetido.servico}.`);

  const prazoPerda = diasDoCampo(form.prazoPerdaDias, "Prazo de perda");
  if (!prazoPerda.ok) return falha(prazoPerda.problema);

  let faixas: FaixaPagamento[] = [];
  let diasDoPagamento: number | null = null;
  let textoDoPagamento: string | null = null;
  if (form.pagamento === "faixas_do_dia_da_nf") {
    const lidas = form.faixas.map((faixa) => ({ de: Number(faixa.de), ate: Number(faixa.ate), dia: Number(faixa.dia), mes: faixa.mes }));
    const fora = lidas.findIndex((faixa) => [faixa.de, faixa.ate, faixa.dia].some((dia) => !Number.isInteger(dia) || dia < 1 || dia > 31));
    if (fora >= 0) return falha(`Faixa ${fora + 1}: dias de 1 a 31.`);
    const problema = problemaDasFaixas(lidas);
    if (problema) return falha(problema);
    faixas = lidas;
  } else if (form.pagamento === "dias_apos_nf") {
    const dias = diasDoCampo(form.pagamentoDias, "Pagamento");
    if (!dias.ok) return falha(dias.problema);
    if (dias.valor === null) return falha("Informe os dias depois da NF.");
    diasDoPagamento = dias.valor;
  } else {
    textoDoPagamento = form.pagamentoTexto.trim() || null;
    if (!textoDoPagamento) return falha("Descreva a regra de pagamento.");
  }

  const codigo = form.codigoServico.trim();
  if (codigo && !/^\d{3,5}$/.test(codigo)) return falha("Código de serviço: 3 a 5 algarismos (ex.: 1602).");

  const documentos = form.documentos
    .map((item) => ({ nome: item.nome.trim(), referencia: item.referencia.trim() }))
    .filter((item) => item.nome || item.referencia);
  const incompleto = documentos.findIndex((item) => !item.nome || !item.referencia);
  if (incompleto >= 0) return falha(`Documento ${incompleto + 1}: informe o nome e a referência.`);

  return {
    ok: true,
    valor: {
      customer_code: customerCode,
      nome,
      numeros,
      objeto: form.objeto.trim(),
      vigente_de: de,
      vigente_ate: ate,
      renovacao: { tipo: form.renovacao, aviso_dias: aviso.valor, oposicao_ate_dias: oposicao.valor },
      reajuste: { tipo: form.reajuste, indice, data_base: dataBase },
      regimes,
      regime_padrao: form.regimePadrao,
      autorizacao: { tipo: form.autorizacao, prazo_perda_dias: prazoPerda.valor },
      pagamento: { tipo: form.pagamento, faixas, dias: diasDoPagamento, texto: textoDoPagamento },
      impostos: {
        inclusos: form.impostosInclusos === "" ? null : form.impostosInclusos === "sim",
        texto: form.impostosTexto.trim() || null,
      },
      codigo_servico: codigo || null,
      documentos,
      status: form.status,
    },
  };
}

/** Entrada de saveContract para criar: sem id (o servidor gera um interno, sem o número do cliente). */
export function payloadNovoContrato(dados: ContratoDados, idempotencyKey: string): Registro {
  return { idempotency_key: idempotencyKey, acao: "criar", contrato: { ...dados, status: "vigente" } };
}

/**
 * Entrada de saveContract para atualizar: o contrato inteiro e a edição lida
 * na abertura do diálogo (o estado esperado). Se outra pessoa gravou antes, o
 * servidor recusa e pede para abrir de novo.
 */
export function payloadEdicaoContrato(contrato: Contrato, dados: ContratoDados, idempotencyKey: string): Registro {
  return {
    idempotency_key: idempotencyKey,
    acao: "atualizar",
    contrato_id: contrato.id,
    edicao: contrato.edicao,
    contrato: { ...dados, customer_code: contrato.dados.customer_code },
  };
}
