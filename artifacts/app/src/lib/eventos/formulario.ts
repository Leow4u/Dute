import { LIMITES, formatarReais, problemaDoCronograma } from "@workspace/dominio";

import { cronogramaDasLinhas, formatarDia, linhasDoFormulario, periodoDaEdicao, type LinhaDoCronograma } from "./cronograma";
import { faltasDeSaldo, itemDeEntrada, resumoDosItens, textoDasFaltas, type ItemDeEntrada, type ItemLido, type ProdutoDoEstoque } from "./itens";
import type { EventoView, PrecoDaEdicao } from "./leitura";
import type { ConteudoDaEdicao, CriarEdicao, EdicaoView, MomentoView } from "./tipos";

/**
 * O formulário da edição no portal (docs/mockups/EventosPortalNovo.dc.html;
 * spec, "As telas › Portal"): o estado como a pessoa o vê, o que vai à
 * criação e ao patch de saveEventEdition, o que falta antes do envio, a frase
 * do servidor no campo certo e o resumo ao lado. O patch leva o nome e a
 * descrição da capa, o valor declarado e os itens só quando mudaram em
 * relação ao que foi gravado: duas edições abertas do mesmo evento não
 * desfazem a renomeação uma da outra, o rascunho reaberto não apaga o valor e
 * cada gravação não relê os 100 itens no servidor.
 */

export type FormularioDaEdicao = {
  nome: string;
  /** O evento da edição: o escolhido em "Edição de" ou o da edição já nascida; null no evento novo. */
  eventoId: string | null;
  descricao: string;
  onde: { local: string; endereco: string; contatoNome: string; contatoTelefone: string };
  cronograma: LinhaDoCronograma[];
  itens: ItemLido[];
  coleta: { onde: string; quantidade: string; valorDeclarado: string };
  observacoes: string;
};

/** O que foi gravado por último (ou lido na adoção do documento vivo): o patch só leva o que mudou disso. */
export type GravadoDaEdicao = {
  nome: string;
  descricao: string | null;
  valorDeclaradoCents: number | null;
  itens: ItemDeEntrada[];
};

export type CampoDoFormulario = "nome" | "onde.local" | "cronograma" | "itens" | "coleta" | "observacoes";

/** O salvamento automático espera um segundo sem mudança. */
export const ATRASO_DO_AUTOSAVE_MS = 1000;

const NUMERO = new Intl.NumberFormat("pt-BR");

const texto = (valor: string): string | null => valor.trim() || null;

export function formularioVazio(): FormularioDaEdicao {
  return {
    nome: "",
    eventoId: null,
    descricao: "",
    onde: { local: "", endereco: "", contatoNome: "", contatoTelefone: "" },
    cronograma: linhasDoFormulario([]),
    itens: [],
    coleta: { onde: "", quantidade: "", valorDeclarado: "" },
    observacoes: "",
  };
}

/** O formulário de uma edição lida: o nome e a descrição são os da capa (client_events), não o event_name da edição. */
export function formularioDaEdicao(edicao: EdicaoView, evento: EventoView | null, preco: PrecoDaEdicao | null): FormularioDaEdicao {
  return {
    nome: evento?.name ?? edicao.event_name,
    eventoId: edicao.event_id || null,
    descricao: evento?.description ?? "",
    onde: {
      local: edicao.onde.local ?? "",
      endereco: edicao.onde.endereco ?? "",
      contatoNome: edicao.onde.contato.nome ?? "",
      contatoTelefone: edicao.onde.contato.telefone ?? "",
    },
    cronograma: linhasDoFormulario(edicao.cronograma),
    itens: edicao.itens,
    coleta: {
      onde: edicao.coleta.onde ?? "",
      quantidade: edicao.coleta.quantidade > 0 ? NUMERO.format(edicao.coleta.quantidade) : "",
      valorDeclarado: preco?.valor_declarado_cents != null ? formatarReais(preco.valor_declarado_cents) : "",
    },
    observacoes: edicao.observacoes ?? "",
  };
}

/** O gravado da adoção do documento vivo: a capa, o preço e os itens dele. */
export function gravadoDaEdicao(edicao: EdicaoView, evento: EventoView | null, preco: PrecoDaEdicao | null): GravadoDaEdicao {
  return {
    nome: evento?.name ?? edicao.event_name,
    descricao: evento ? evento.description : null,
    valorDeclaradoCents: preco?.valor_declarado_cents ?? null,
    itens: edicao.itens.map(itemDeEntrada),
  };
}

/** A quantidade da coleta digitada ("2.190"): 0 no vazio; null no inválido ou acima do limite. */
export function quantidadeDaColeta(digitada: string): number | null {
  const limpo = digitada.replace(/[\s.]/g, "");
  if (!limpo) return 0;
  if (!/^\d+$/.test(limpo)) return null;
  const quantidade = Number(limpo);
  return quantidade <= LIMITES.quantidade ? quantidade : null;
}

/** O valor declarado digitado ("R$ 100.000,00", "100000,5"): null no vazio; undefined no inválido. */
export function centavosDoValorDeclarado(digitado: string): number | null | undefined {
  const limpo = digitado.replace(/R\$/gi, "").replace(/\s/g, "");
  if (!limpo) return null;
  const partes = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(limpo);
  if (!partes) return undefined;
  const reais = Number(partes[1].replace(/\./g, ""));
  const centavos = Number((partes[2] ?? "").padEnd(2, "0"));
  const total = reais * 100 + centavos;
  return Number.isSafeInteger(total) ? total : undefined;
}

function iguais(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function coletaDoFormulario(form: FormularioDaEdicao, gravado: GravadoDaEdicao | null): ConteudoDaEdicao["coleta"] | undefined {
  const quantidade = quantidadeDaColeta(form.coleta.quantidade);
  // A coleta com a quantidade inválida não vai: o erro fica no campo, e o gravado não se perde.
  if (quantidade === null) return undefined;
  const valor = centavosDoValorDeclarado(form.coleta.valorDeclarado);
  const levaValor = valor !== undefined && (gravado === null || valor !== gravado.valorDeclaradoCents);
  return { onde: texto(form.coleta.onde), quantidade, ...(levaValor ? { valor_declarado_cents: valor } : {}) };
}

/** O que muda na capa: o nome (não vazio) e a descrição que diferem do gravado. */
function eventoDoFormulario(form: FormularioDaEdicao, gravado: { nome: string; descricao: string | null }): ConteudoDaEdicao["evento"] | undefined {
  const nome = form.nome.trim();
  const descricao = texto(form.descricao);
  const evento: NonNullable<ConteudoDaEdicao["evento"]> = {};
  if (nome && nome !== gravado.nome) evento.name = nome;
  if (descricao !== gravado.descricao) evento.description = descricao;
  return Object.keys(evento).length ? evento : undefined;
}

function conteudoDoFormulario(form: FormularioDaEdicao, gravado: GravadoDaEdicao | null): ConteudoDaEdicao {
  const itens = form.itens.map(itemDeEntrada);
  const coleta = coletaDoFormulario(form, gravado);
  return {
    onde: {
      local: texto(form.onde.local),
      endereco: texto(form.onde.endereco),
      contato: { nome: texto(form.onde.contatoNome), telefone: texto(form.onde.contatoTelefone) },
    },
    cronograma: cronogramaDasLinhas(form.cronograma),
    ...(gravado === null ? (itens.length ? { itens } : {}) : iguais(itens, gravado.itens) ? {} : { itens }),
    ...(coleta ? { coleta } : {}),
    observacoes: texto(form.observacoes),
  };
}

/**
 * O patch do rascunho: onde, o cronograma (pelo id de cada momento, a hora
 * vazia em null), a coleta, as observações e, quando mudaram desde o
 * gravado, o evento, o valor declarado e os itens (os seis campos de
 * entrada). Sem label: o servidor dá o padrão.
 */
export function patchDoFormulario(form: FormularioDaEdicao, gravado: GravadoDaEdicao): ConteudoDaEdicao {
  const evento = eventoDoFormulario(form, gravado);
  return { ...conteudoDoFormulario(form, gravado), ...(evento ? { evento } : {}) };
}

/**
 * A criação: o evento escolhido em "Edição de" (com o que a pessoa mudou no
 * nome e na descrição dele) ou o evento novo, pelo nome; o resto do
 * formulário vai no patch.
 */
export function criacaoDoFormulario(
  form: FormularioDaEdicao,
  chave: string,
  capa: { id: string; nome: string; descricao: string | null } | null,
): CriarEdicao {
  const patch = conteudoDoFormulario(form, null);
  if (capa) {
    const evento = eventoDoFormulario(form, capa);
    return { idempotency_key: chave, event_id: capa.id, patch: { ...patch, ...(evento ? { evento } : {}) } };
  }
  return { idempotency_key: chave, name: form.nome.trim(), description: texto(form.descricao), patch };
}

/** O que falta antes de enviar, por campo; a falta de saldo fica nos itens. */
export function problemasDoFormulario(form: FormularioDaEdicao, produtos: readonly ProdutoDoEstoque[]): Partial<Record<CampoDoFormulario, string>> {
  const problemas: Partial<Record<CampoDoFormulario, string>> = {};
  if (!form.nome.trim()) problemas.nome = "Informe o nome do evento";
  if (!form.onde.local.trim()) problemas["onde.local"] = "Informe o local";
  const digitada = form.coleta.quantidade.replace(/[\s.]/g, "");
  const quantidade = quantidadeDaColeta(form.coleta.quantidade);
  if (quantidade === null) {
    problemas.coleta = /^\d+$/.test(digitada) ? `A quantidade da coleta passa de ${NUMERO.format(LIMITES.quantidade)}` : "A quantidade da coleta inválida";
  } else if (centavosDoValorDeclarado(form.coleta.valorDeclarado) === undefined) {
    problemas.coleta = "O valor declarado inválido";
  }
  const comItensDoEstoque = form.itens.length > 0;
  const comColeta = (quantidade ?? 0) > 0;
  if (!comItensDoEstoque && !comColeta && !problemas.coleta) problemas.itens = "Escolha ao menos um item ou informe a coleta no cliente";
  const cronograma = problemaDoCronograma(cronogramaDasLinhas(form.cronograma), { comItensDoEstoque, comColeta });
  if (cronograma) problemas.cronograma = cronograma;
  if (comItensDoEstoque) {
    const falta = textoDasFaltas(faltasDeSaldo(form.itens, produtos));
    if (falta) problemas.itens = falta;
  }
  return problemas;
}

/** O campo da frase do servidor, ou null (o toast). A do cronograma vem antes da do local: "Entrega no local já tem registro…". */
export function campoDaMensagem(mensagem: string): CampoDoFormulario | null {
  if (/^Escolha ao menos um item/.test(mensagem)) return "itens";
  if (
    /já tem registro e não sai do cronograma|está antes de|momento|cronograma|^Informe a data|^(A|O) (data|hora final|hora|local|observação) (de|do) /.test(mensagem)
  ) {
    return "cronograma";
  }
  if (/coleta|valor declarado/.test(mensagem)) return "coleta";
  if (/local|endereço|contato|telefone|lugar do evento/.test(mensagem)) return "onde.local";
  if (/nome do evento|descrição do evento/.test(mensagem)) return "nome";
  if (/Saldo insuficiente|itens|item|quantidade/.test(mensagem)) return "itens";
  if (/observações/.test(mensagem)) return "observacoes";
  return null;
}

/** A linha como a leitura a entrega, para o período do resumo. */
function comoMomento(linha: LinhaDoCronograma): MomentoView {
  return {
    id: linha.id ?? "",
    tipo: linha.tipo,
    rotulo: linha.rotulo || null,
    previsto: { data: linha.data, hora: linha.hora || null, ate: linha.ate || null, local: linha.local || null, observacao: linha.observacao || null },
    feito: null,
  };
}

function diaEHora(linhas: readonly LinhaDoCronograma[], tipo: LinhaDoCronograma["tipo"]): string | null {
  const linha = linhas.find((item) => item.tipo === tipo && item.data);
  if (!linha) return null;
  return linha.hora ? `${formatarDia(linha.data)} ${linha.hora}` : formatarDia(linha.data);
}

export type ResumoDaEdicao = {
  nome: string;
  dias: string | null;
  local: string | null;
  estoque: string;
  coleta: string | null;
  entrega: string | null;
  retorno: string | null;
  pedido: string | null;
};

/** O "Resumo da edição" ao lado do formulário. */
export function resumoDaEdicao(form: FormularioDaEdicao, _produtos: readonly ProdutoDoEstoque[], _hoje: string): ResumoDaEdicao {
  const quantidade = quantidadeDaColeta(form.coleta.quantidade) ?? 0;
  const itens = form.itens.length;
  return {
    nome: form.nome.trim(),
    dias: periodoDaEdicao(form.cronograma.filter((linha) => linha.data).map(comoMomento)),
    local: texto(form.onde.local),
    estoque: resumoDosItens(form.itens),
    coleta: quantidade > 0 ? `${NUMERO.format(quantidade)} ${quantidade === 1 ? "produto" : "produtos"}` : null,
    entrega: diaEHora(form.cronograma, "entrega_no_local"),
    retorno: diaEHora(form.cronograma, "retorno_ao_estoque"),
    pedido: itens ? (itens === 1 ? "Pedido PED com 1 item" : `Pedido PED com os ${NUMERO.format(itens)} itens`) : null,
  };
}
