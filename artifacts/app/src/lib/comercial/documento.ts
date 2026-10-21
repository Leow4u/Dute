import { formatarReais } from "@workspace/dominio";

import { dataBr } from "./clientes";
import { formatarDecimal } from "./montar";
import { ROTA_DOCUMENTO } from "./navegacao";
import { ORIGENS_LINHA, TIPO_RV_ROTULO, TIPOS_RV, diaEmSaoPaulo, rotuloDoOrcamento, type OrigemLinha } from "./orcamentos";

/**
 * O documento A4 do orçamento (docs/mockups/ComDocumento.dc.html; parte 12a
 * de docs/plataforma/fase-6-comercial.md): o que sai na impressão do
 * navegador (Imprimir → Salvar como PDF), como a fatura. Até o envio é a
 * prévia, montada do orçamento ao vivo e marcada "Prévia"; depois do envio,
 * é a cópia congelada em `quotes/{numero}/revisoes/{rv}` (functions/comercial,
 * revisaoCongelada), que não muda mais.
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

// --- Rota ------------------------------------------------------------------------------------

/** O documento de uma RV; `imprimir` abre a impressão quando a cópia congelada chega (depois do envio). */
export function hrefDoDocumento(numero: string, rv?: number | null, opcoes: { imprimir?: boolean } = {}): string {
  const busca = new URLSearchParams({ numero });
  if (typeof rv === "number") busca.set("rv", String(rv));
  if (opcoes.imprimir) busca.set("imprimir", "1");
  return `${ROTA_DOCUMENTO}?${busca.toString()}`;
}

export type ParametrosDoDocumento = { numero: string; rv: number | null; imprimir: boolean };

/** Os parâmetros da busca da URL; número inválido: null. Sem `rv`, a RV atual do orçamento. */
export function parametrosDoDocumento(busca: string): ParametrosDoDocumento | null {
  const params = new URLSearchParams(busca.startsWith("?") ? busca.slice(1) : busca);
  const numero = (params.get("numero") ?? "").trim();
  if (!/^\d{5,8}$/.test(numero)) return null;
  const rvBruto = (params.get("rv") ?? "").trim();
  const rv = /^\d{1,2}$/.test(rvBruto) ? Number(rvBruto) : null;
  return { numero, rv, imprimir: params.get("imprimir") === "1" };
}

/** A impressão abre sozinha só no documento enviado (a cópia congelada), uma vez. */
export function deveImprimir(entrada: { pedido: boolean; congelada: boolean; jaAbriu: boolean }): boolean {
  return entrada.pedido && entrada.congelada && !entrada.jaAbriu;
}

// --- Título e nome do arquivo ------------------------------------------------------------------

/** "Orçamento 10045" na RV 0; "Orçamento 10045 – RV01" em diante. */
export function tituloDoDocumento(rotulo: string): string {
  return `Orçamento ${rotulo}`;
}

/** Caracteres que o Windows não aceita em nome de arquivo. */
const PROIBIDOS_NO_ARQUIVO = /[\\/:*?"<>|]+/g;

/**
 * O nome do PDF (o document.title, que o navegador sugere ao salvar):
 * "Orçamento 10045 – RV01 – CE8977 – Mudança de layout". Sem referência ou
 * título, a parte fica de fora.
 */
export function nomeDoArquivo(entrada: { rotulo: string; refCliente: string | null; titulo: string | null }): string {
  const partes = [tituloDoDocumento(entrada.rotulo), entrada.refCliente, entrada.titulo]
    .map((parte) => texto(parte).replace(PROIBIDOS_NO_ARQUIVO, "-").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return partes.join(" – ").slice(0, 180).trim();
}

// --- Linhas gravadas ----------------------------------------------------------------------------

/** A linha como o servidor grava (`quotes/{numero}.linhas`, LinhaDoOrcamento de functions/comercial). */
export type LinhaGravada = {
  id: string;
  origem: OrigemLinha;
  codigo: string | null;
  item: string;
  descricao: string;
  servico: string | null;
  unidade: string | null;
  /** Decimal com ponto. */
  quantidade: string;
  /** Preço unitário, decimal com ponto (no ajuste, negativo). */
  preco: string;
  precoTabela: string | null;
  motivo: string | null;
  totalCents: number;
};

export function linhasGravadas(value: unknown): LinhaGravada[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((linha, indice) => {
    if (!isRegistro(linha)) return [];
    const origem = texto(linha.origem);
    const total = inteiro(linha.total_cents);
    if (!(ORIGENS_LINHA as readonly string[]).includes(origem) || total === null) return [];
    return [
      {
        id: texto(linha.id) || `linha-${indice}`,
        origem: origem as OrigemLinha,
        codigo: opcional(linha.codigo),
        item: texto(linha.item),
        descricao: texto(linha.descricao),
        servico: opcional(linha.servico),
        unidade: opcional(linha.unidade),
        quantidade: texto(linha.quantidade),
        preco: texto(linha.preco),
        precoTabela: opcional(linha.preco_tabela),
        motivo: opcional(linha.motivo),
        totalCents: total,
      },
    ];
  });
}

/** "1.108,80": o valor da grade, sem o R$ (como a montagem e o Excel). */
export function valorSemMoeda(centavos: number): string {
  return formatarReais(centavos).replace(/^(-?)R\$\s/, "$1");
}

// --- Fonte: prévia ou cópia congelada -----------------------------------------------------------

export type FonteDoDocumento =
  | { estado: "carregando" }
  | { estado: "nao_encontrado" }
  | {
      estado: "pronto";
      /** A cópia congelada no envio (revisoes/{rv}); senão, a prévia do orçamento ao vivo. */
      congelada: boolean;
      rv: number;
      orcamento: Registro;
      demanda: Registro;
      enviadoEm: string | null;
    };

/**
 * De onde o documento sai. A RV enviada (revisoes/{rv} com enviado_em) é a
 * cópia congelada, que vale para sempre; a RV em curso ainda não enviada é a
 * prévia, do orçamento e da demanda ao vivo. RV antiga sem envio não tem
 * documento. undefined: ainda carregando; null: não existe.
 */
export function fonteDoDocumento(entrada: {
  rv: number | null;
  quote: Registro | null | undefined;
  demanda: Registro | null | undefined;
  revisao: Registro | null | undefined;
}): FonteDoDocumento {
  const { quote, demanda, revisao } = entrada;
  if (quote === null) return { estado: "nao_encontrado" };
  if (quote === undefined || revisao === undefined) return { estado: "carregando" };
  const rvAtual = inteiro(quote.rv) ?? 0;
  const rv = entrada.rv ?? rvAtual;
  const enviadoEm = revisao ? opcional(revisao.enviado_em) : null;
  if (revisao && enviadoEm) {
    return {
      estado: "pronto",
      congelada: true,
      rv,
      orcamento: revisao,
      demanda: isRegistro(revisao.demanda) ? revisao.demanda : {},
      enviadoEm,
    };
  }
  if (rv !== rvAtual) return { estado: "nao_encontrado" };
  if (demanda === undefined) return { estado: "carregando" };
  if (demanda === null) return { estado: "nao_encontrado" };
  return { estado: "pronto", congelada: false, rv, orcamento: quote, demanda, enviadoEm: null };
}

/** O contato, o local e o contrato que o documento mostra pelo nome (lidos à parte). */
export function referenciasDoDocumento(fonte: FonteDoDocumento): {
  contatoId: string | null;
  origemLocalId: string | null;
  destinoLocalId: string | null;
  contratoId: string | null;
} {
  if (fonte.estado !== "pronto") return { contatoId: null, origemLocalId: null, destinoLocalId: null, contratoId: null };
  const { demanda } = fonte;
  const solicitante = isRegistro(demanda.solicitante) ? demanda.solicitante : {};
  const origem = isRegistro(demanda.origem) ? demanda.origem : {};
  const destino = isRegistro(demanda.destino) ? demanda.destino : {};
  return {
    contatoId: opcional(solicitante.contato_id),
    origemLocalId: opcional(origem.local_id),
    destinoLocalId: opcional(destino.local_id),
    contratoId: opcional(demanda.contrato_id),
  };
}

// --- O documento ------------------------------------------------------------------------------------

export type LinhaDoDocumento = {
  chave: string;
  codigo: string;
  item: string;
  servico: string;
  unidade: string;
  valorUnitario: string;
  quantidade: string;
  total: string;
};

export type CampoDoDocumento = { rotulo: string; valor: string; largura: 1 | 2 | 3 | 4 | 6 };

export type DocumentoDoOrcamento = {
  numero: string;
  rv: number;
  rotulo: string;
  /** "Orçamento 10045 – RV01". */
  titulo: string;
  /** O document.title: o nome que o navegador sugere para o PDF. */
  nomeDoArquivo: string;
  /** "Proposta", "Aditivo", "Execução". */
  tipo: string;
  /** Até o envio: marca "Prévia". */
  previa: boolean;
  /** Os dados do quadro, na ordem do mockup (cada um com a largura em sextos). */
  campos: CampoDoDocumento[];
  linhas: LinhaDoDocumento[];
  /** "R$ 7.982,80". */
  total: string;
  condicoes: string[];
  /** Quem montou: "Orçamento elaborado por <nome>". */
  autor: string | null;
};

function periodo(de: string | null, ate: string | null): string | null {
  if (de && ate && de !== ate) return `${dataBr(de)} a ${dataBr(ate)}`;
  const dia = de ?? ate;
  return dia ? dataBr(dia) : null;
}

/** A data (ou o período) da execução: a executada na RV de execução; senão, a pedida; sem data, "A definir". */
export function textoDaExecucao(demanda: Registro, tipoRv: string): string {
  if (tipoRv === "execucao") {
    const executado = periodo(opcional(demanda.executado_de), opcional(demanda.executado_ate));
    if (executado) return executado;
  }
  const execucao = isRegistro(demanda.execucao) ? demanda.execucao : {};
  if (execucao.a_definir === true) return "A definir";
  const datas = Array.isArray(execucao.datas) ? execucao.datas.map(texto).filter(Boolean) : [];
  if (datas.length) return datas.map(dataBr).join(", ");
  return periodo(opcional(execucao.de), opcional(execucao.ate)) ?? "A definir";
}

/** As condições, uma por linha (o marcador de lista digitado sai: o documento põe o dele). */
export function linhasDasCondicoes(condicoes: unknown): string[] {
  return texto(condicoes)
    .split(/\r?\n/)
    .map((linha) => linha.trim().replace(/^[-•*]\s+/, ""))
    .filter(Boolean);
}

function linhaDoDocumento(linha: LinhaGravada): LinhaDoDocumento {
  if (linha.origem === "ajuste") {
    return {
      chave: linha.id,
      codigo: "",
      item: linha.descricao || linha.item || "Ajuste",
      servico: "Ajuste",
      unidade: "",
      valorUnitario: "",
      quantidade: "",
      total: valorSemMoeda(linha.totalCents),
    };
  }
  return {
    chave: linha.id,
    codigo: linha.codigo ?? "",
    item: linha.item || linha.descricao,
    servico: linha.servico ?? "",
    unidade: linha.unidade ?? "",
    valorUnitario: linha.preco ? formatarDecimal(linha.preco, 2) : "",
    quantidade: linha.quantidade ? formatarDecimal(linha.quantidade, 0) : "",
    total: valorSemMoeda(linha.totalCents),
  };
}

function comComplemento(nome: string | null, local: unknown): string | null {
  const complemento = isRegistro(local) ? opcional(local.complemento) : null;
  const partes = [nome, complemento].filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}

/**
 * O documento a partir da fonte (prévia ou cópia congelada) e do que se lê
 * pelo nome: o contato do "Para", os locais, o contrato e, para o orçamento
 * gravado antes de `autor_nome`, o nome de quem montou.
 */
export function documentoDoOrcamento(
  fonte: Extract<FonteDoDocumento, { estado: "pronto" }>,
  contexto: {
    numero: string;
    agora: Date;
    contato: { nome: string; empresa: string | null } | null;
    origem: string | null;
    destino: string | null;
    contrato: { nome: string; numeros: readonly string[] } | null;
    autorNome: string | null;
  },
): DocumentoDoOrcamento {
  const { orcamento, demanda, rv } = fonte;
  const rotulo = opcional(orcamento.rotulo) ?? rotuloDoOrcamento(contexto.numero, rv);
  const tipoRv = (TIPOS_RV as readonly string[]).includes(texto(orcamento.tipo_rv)) ? texto(orcamento.tipo_rv) : "proposta";
  const refCliente = opcional(demanda.ref_cliente);
  const tituloDaDemanda = opcional(demanda.titulo);
  const solicitante = isRegistro(demanda.solicitante) ? demanda.solicitante : {};
  const empresa = opcional(solicitante.empresa) ?? contexto.contato?.empresa ?? null;
  const para = [contexto.contato?.nome ?? null, empresa].filter(Boolean).join(" · ") || null;
  const tabela = isRegistro(orcamento.tabela) ? orcamento.tabela : null;
  const tabelaRotulo = tabela ? [opcional(tabela.nome), opcional(tabela.variante)].filter(Boolean).join(" · ") || null : null;
  const dataBase = opcional(orcamento.data_base);
  const emissao = fonte.enviadoEm ? new Date(fonte.enviadoEm) : contexto.agora;
  const contrato = contexto.contrato;

  const campos: CampoDoDocumento[] = [
    { rotulo: "Emissão", valor: dataBr(diaEmSaoPaulo(Number.isNaN(emissao.getTime()) ? contexto.agora : emissao)), largura: 2 },
    { rotulo: "Data-base de preço", valor: dataBase ? dataBr(dataBase) : "—", largura: 2 },
    { rotulo: "Data de execução", valor: textoDaExecucao(demanda, tipoRv), largura: 2 },
    {
      rotulo: "Cliente",
      valor: texto(demanda.customer_name) || texto(orcamento.customer_code) || "—",
      largura: contrato ? 2 : 3,
    },
  ];
  if (contrato) {
    campos.push(
      contrato.numeros.length
        ? { rotulo: "Contrato nº", valor: contrato.numeros.join(" · "), largura: 1 }
        : { rotulo: "Contrato", valor: contrato.nome, largura: 1 },
    );
  }
  campos.push({ rotulo: "Tabela", valor: tabelaRotulo ?? "Sem tabela", largura: 3 });
  campos.push({ rotulo: "Para", valor: para ?? "—", largura: 4 });
  campos.push({ rotulo: "Referência do cliente", valor: refCliente ?? "—", largura: 2 });
  if (tituloDaDemanda) campos.push({ rotulo: "Descrição da atividade", valor: tituloDaDemanda, largura: 6 });
  const origem = comComplemento(contexto.origem, demanda.origem);
  const destino = comComplemento(contexto.destino, demanda.destino);
  if (origem || destino) {
    campos.push({ rotulo: "Origem", valor: origem ?? "—", largura: 3 });
    campos.push({ rotulo: "Destino", valor: destino ?? "—", largura: 3 });
  }

  return {
    numero: contexto.numero,
    rv,
    rotulo,
    titulo: tituloDoDocumento(rotulo),
    nomeDoArquivo: nomeDoArquivo({ rotulo, refCliente, titulo: tituloDaDemanda }),
    tipo: TIPO_RV_ROTULO[tipoRv as keyof typeof TIPO_RV_ROTULO],
    previa: !fonte.congelada,
    campos,
    linhas: linhasGravadas(orcamento.linhas).map(linhaDoDocumento),
    total: formatarReais(inteiro(orcamento.total_cents) ?? 0),
    condicoes: linhasDasCondicoes(orcamento.condicoes),
    autor: opcional(orcamento.autor_nome) ?? contexto.autorNome,
  };
}
