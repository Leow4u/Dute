import type { TipoDaDemanda } from "./hoje";

/**
 * Nova demanda direta (docs/plataforma/fase-3-operacao.md, parte 3.5c;
 * docs/mockups/OpDemandaNova.dc.html): o formulário, a conferência antes de
 * mandar e o pedido no formato de `openDirectDemand` (functions/operacao,
 * domain/demanda-direta.ts). A callable confere tudo de novo; aqui é só para
 * a tela dizer antes o que falta. Nunca preço.
 */

/** Até quantas horas corridas a demanda é emergencial (cópia de functions/operacao, travada por teste). */
export const HORAS_DO_EMERGENCIAL = 48;

export const CANAIS_DA_DIRETA = ["telefone", "whatsapp", "email", "portal"] as const;
export type CanalDaDireta = (typeof CANAIS_DA_DIRETA)[number];
export const CANAL_ROTULO: Record<CanalDaDireta, string> = { telefone: "Telefone", whatsapp: "WhatsApp", email: "E-mail", portal: "Portal" };

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const HORA_EM_SAO_PAULO = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * O tipo pela hora do pedido e pela hora pedida: paraquedas no mesmo dia em
 * São Paulo, emergencial até 48 horas corridas, planejada depois. A mesma
 * regra de tipoPelaHora em functions/operacao.
 */
export function tipoPelaHora(recebidaEm: string, executarAte: string): TipoDaDemanda | null {
  const recebida = Date.parse(recebidaEm);
  const prazo = Date.parse(executarAte);
  if (Number.isNaN(recebida) || Number.isNaN(prazo)) return null;
  if (DIA_EM_SAO_PAULO.format(new Date(recebida)) === DIA_EM_SAO_PAULO.format(new Date(prazo))) return "paraquedas";
  if (prazo - recebida <= HORAS_DO_EMERGENCIAL * 3_600_000) return "emergencial";
  return "planejada";
}

/**
 * "AAAA-MM-DD" e "HH:MM" digitados viram o instante com o fuso de São Paulo
 * (−03:00, sem horário de verão desde 2019), o formato que a callable pede.
 */
export function instanteDeSaoPaulo(data: string, hora: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^([01]\d|2[0-3]):[0-5]\d/.test(hora)) return null;
  const valor = `${data}T${hora.slice(0, 5)}-03:00`;
  return Number.isNaN(Date.parse(valor)) ? null : valor;
}

export type ItemDoCatalogo = { id: string; item: string; servico: string | null; unidade: string | null };

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** O item do catálogo (`lpu_items`) que se pede numa demanda: ativo e orçável. Sem preço. */
export function itemDoCatalogo(id: string, data: Record<string, unknown>): ItemDoCatalogo | null {
  const item = texto(data.item);
  if (!item || data.ativo === false || data.orcavel === false) return null;
  return { id, item, servico: texto(data.servico) || null, unidade: texto(data.unidade) || null };
}

function normalizar(valor: string): string {
  return valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
}

/** Até `limite` itens do catálogo que têm todas as palavras buscadas no nome ou no serviço. */
export function buscarNoCatalogo(itens: readonly ItemDoCatalogo[], busca: string, limite = 8): ItemDoCatalogo[] {
  const palavras = normalizar(busca).split(/\s+/).filter(Boolean);
  if (!palavras.length) return [];
  return itens
    .filter((item) => {
      const alvo = normalizar(`${item.item} ${item.servico ?? ""}`);
      return palavras.every((palavra) => alvo.includes(palavra));
    })
    .sort((a, b) => a.item.localeCompare(b.item, "pt-BR"))
    .slice(0, limite);
}

/** A linha do pedido: do catálogo (lpuItemId) ou avulsa (nome e unidade digitados). */
export type LinhaDoPedido = { chave: string; lpuItemId: string | null; item: string; unidade: string; quantidade: string };

export type FormularioDaDemanda = {
  customerCode: string;
  titulo: string;
  canal: CanalDaDireta;
  pedidoPorNome: string;
  pedidoPorTelefone: string;
  recebidaData: string;
  recebidaHora: string;
  executarData: string;
  executarHora: string;
  /** O tipo corrigido pelo coordenador; vazio usa o calculado. */
  tipoCorrigido: TipoDaDemanda | "";
  origemLocalId: string;
  origemComplemento: string;
  destinoLocalId: string;
  destinoComplemento: string;
  linhas: LinhaDoPedido[];
};

/** O formulário vazio: recebida agora; executar até hoje, às 18:00. */
export function formularioVazio(agora: Date): FormularioDaDemanda {
  const hoje = DIA_EM_SAO_PAULO.format(agora);
  return {
    customerCode: "",
    titulo: "",
    canal: "telefone",
    pedidoPorNome: "",
    pedidoPorTelefone: "",
    recebidaData: hoje,
    recebidaHora: HORA_EM_SAO_PAULO.format(agora),
    executarData: hoje,
    executarHora: "18:00",
    tipoCorrigido: "",
    origemLocalId: "",
    origemComplemento: "",
    destinoLocalId: "",
    destinoComplemento: "",
    linhas: [],
  };
}

const QUANTIDADE = /^\d{1,9}(\.\d{1,3})?$/;

/** "12,5" → "12.5": a vírgula do teclado vira o ponto do orçamento. */
export function quantidadeDigitada(valor: string): string {
  return valor.trim().replace(",", ".");
}

/** O tipo que vai: o corrigido ou o calculado pela hora. */
export function tipoDoFormulario(form: FormularioDaDemanda): { calculado: TipoDaDemanda | null; tipo: TipoDaDemanda | null } {
  const recebida = instanteDeSaoPaulo(form.recebidaData, form.recebidaHora);
  const prazo = instanteDeSaoPaulo(form.executarData, form.executarHora);
  const calculado = recebida && prazo ? tipoPelaHora(recebida, prazo) : null;
  return { calculado, tipo: form.tipoCorrigido || calculado };
}

/** O que falta ou está errado, na ordem do formulário; vazio quando pode mandar. */
export function problemasDoFormulario(form: FormularioDaDemanda, agora: Date): string[] {
  const problemas: string[] = [];
  if (!form.customerCode) problemas.push("Escolha o cliente.");
  if (form.titulo.trim().length < 2) problemas.push("Informe o título da demanda.");
  if (form.pedidoPorTelefone.trim() && !/^\+?\d{8,15}$/.test(form.pedidoPorTelefone.replace(/[\s().-]/g, ""))) {
    problemas.push("Telefone de quem pediu inválido: use DDD e número.");
  }
  const recebida = instanteDeSaoPaulo(form.recebidaData, form.recebidaHora);
  const prazo = instanteDeSaoPaulo(form.executarData, form.executarHora);
  if (!recebida) problemas.push("Informe quando o pedido foi recebido.");
  else if (Date.parse(recebida) > agora.getTime() + 5 * 60_000) problemas.push("Recebida em não pode ser depois de agora.");
  if (!prazo) problemas.push("Informe até quando executar.");
  else if (recebida && Date.parse(prazo) <= Date.parse(recebida)) problemas.push("Executar até vem depois de quando o pedido foi recebido.");
  if (!form.linhas.length) problemas.push("Inclua ao menos um item.");
  for (const linha of form.linhas) {
    const quantidade = quantidadeDigitada(linha.quantidade);
    if (!QUANTIDADE.test(quantidade) || Number(quantidade) <= 0) problemas.push(`${linha.item || "Item avulso"}: informe a quantidade.`);
    if (!linha.lpuItemId && (!linha.item.trim() || !linha.unidade.trim())) problemas.push("Item avulso: informe o nome e a unidade.");
  }
  return problemas;
}

function local(localId: string, complemento: string) {
  if (!localId && !complemento.trim()) return null;
  return { local_id: localId || null, complemento: complemento.trim() || null };
}

/**
 * O pedido no formato de openDirectDemand. Chame só sem problemas. Com a
 * solicitação do portal (parte 4.4c), vai o id dela no lugar de "recebida
 * em" (a callable usa o instante da solicitação) e o canal é o portal.
 */
export function pedidoDaDemanda(form: FormularioDaDemanda, idempotencyKey: string, solicitacaoId: string | null = null): Record<string, unknown> {
  const { calculado } = tipoDoFormulario(form);
  return {
    idempotency_key: idempotencyKey,
    customer_code: form.customerCode,
    titulo: form.titulo.trim(),
    canal: solicitacaoId ? "portal" : form.canal,
    pedido_por: form.pedidoPorNome.trim() ? { nome: form.pedidoPorNome.trim(), telefone: form.pedidoPorTelefone.trim() || null } : null,
    ...(solicitacaoId ? { solicitacao_id: solicitacaoId } : { recebida_em: instanteDeSaoPaulo(form.recebidaData, form.recebidaHora) }),
    executar_ate: instanteDeSaoPaulo(form.executarData, form.executarHora),
    ...(form.tipoCorrigido && form.tipoCorrigido !== calculado ? { tipo: form.tipoCorrigido } : {}),
    origem: local(form.origemLocalId, form.origemComplemento),
    destino: local(form.destinoLocalId, form.destinoComplemento),
    itens: form.linhas.map((linha) =>
      linha.lpuItemId
        ? { lpu_item_id: linha.lpuItemId, quantidade: quantidadeDigitada(linha.quantidade) }
        : { item: linha.item.trim(), unidade: linha.unidade.trim(), quantidade: quantidadeDigitada(linha.quantidade) },
    ),
  };
}
