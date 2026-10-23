import { formatarData, formatarPlaca } from "./cadastro";

/** A fila do dia (docs/plataforma/fase-3-operacao.md, parte 3). Sem preço. */

/** O item da OS: o nome, a fatia planejada e o id da linha do escopo (a chave do saldo). */
export type ItemDaFila = { item: string; quantidade: string; id?: string };

/** A janela, a equipe e os veículos da OS (parte 3.4b), ou a agenda de antes dela. */
export type AgendaDaFila = {
  data: string;
  /** O início da janela. */
  hora: string | null;
  fim: string | null;
  /** Os ids do cadastro de quem está na equipe. */
  equipe: string[];
  /** Os ids do cadastro dos veículos (zero, um ou vários). */
  veiculos: string[];
};

/** A demanda perdida ou cancelada no Comercial: a OS dela não se agenda, só se cancela. */
export type DemandaFora = "perdida" | "cancelada";

export const STATUS_DA_OS = ["aberta", "agendada", "em_execucao", "em_revisao", "revisada", "cancelada"] as const;
export type StatusDaOs = (typeof STATUS_DA_OS)[number];

/** Quem está na OS, com o nome e o papel copiados no agendamento (parte 3.4b). */
export type PessoaNaOs = { id: string; nome: string; papel: string | null };

export type OsDaFila = {
  numero: string;
  demanda: string;
  customer_code: string;
  status: StatusDaOs;
  edicao: number;
  itens: ItemDaFila[];
  agenda: AgendaDaFila | null;
  /** A equipe copiada na OS; na OS de antes da parte 3.4, vazia (o nome vem do cadastro). */
  pessoas?: PessoaNaOs[];
  /** As placas copiadas na OS. */
  placas?: string[];
  /** Os serviços derivados dos itens (transporte, montagem...). */
  servicos?: string[];
  /** Serviço ou vistoria (parte 3.11a); a OS de antes é de serviço. */
  tipo?: "servico" | "vistoria";
  /** "Origem → Destino", pelo nome do local ou pelo complemento. */
  rota?: string | null;
  demandaFora?: DemandaFora | null;
};

export type DemandaParaAbrir = {
  numero: string;
  customer_code: string;
  titulo: string | null;
  os_numeros: string[];
};

export type AgendaEmEdicao = {
  data: string;
  hora: string;
  equipe: string[];
  veiculoId: string;
  motivo: string;
};

export function hojeIso(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function idsDe(valor: unknown, campo: string): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((item) => {
    if (typeof item === "string") return item ? [item] : [];
    if (item && typeof item === "object") {
      const id = texto((item as Record<string, unknown>)[campo]);
      return id ? [id] : [];
    }
    return [];
  });
}

/**
 * A agenda da OS: a janela com a equipe e os veículos (parte 3.4b) ou, na OS
 * de antes dela, `agenda` { data, hora, equipe, veiculo_id }.
 */
function agendaDaLeitura(data: Record<string, unknown>): AgendaDaFila | null {
  const janela = data.janela && typeof data.janela === "object" ? (data.janela as Record<string, unknown>) : null;
  if (janela && texto(janela.data)) {
    return {
      data: texto(janela.data),
      hora: texto(janela.inicio) || null,
      fim: texto(janela.fim) || null,
      equipe: idsDe(data.equipe, "colaborador_id"),
      veiculos: idsDe(data.veiculos, "veiculo_id"),
    };
  }
  const antiga = data.agenda && typeof data.agenda === "object" ? (data.agenda as Record<string, unknown>) : null;
  if (!antiga || !texto(antiga.data)) return null;
  return {
    data: texto(antiga.data),
    hora: texto(antiga.hora) || null,
    fim: null,
    equipe: idsDe(antiga.equipe, "colaborador_id"),
    veiculos: texto(antiga.veiculo_id) ? [texto(antiga.veiculo_id)] : [],
  };
}

function pessoasDaOs(valor: unknown): PessoaNaOs[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((bruto) => {
    if (!bruto || typeof bruto !== "object") return [];
    const pessoa = bruto as Record<string, unknown>;
    const id = texto(pessoa.colaborador_id);
    const nome = texto(pessoa.nome);
    return id && nome ? [{ id, nome, papel: texto(pessoa.papel) || null }] : [];
  });
}

function placasDaOs(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((bruto) => {
    if (!bruto || typeof bruto !== "object") return [];
    const placa = texto((bruto as Record<string, unknown>).placa);
    return placa ? [formatarPlaca(placa)] : [];
  });
}

function nomeDoLocal(valor: unknown): string | null {
  if (!valor || typeof valor !== "object") return null;
  const local = valor as Record<string, unknown>;
  return texto(local.nome) || texto(local.complemento) || texto(local.endereco) || null;
}

/** "Faria Lima → Centro Empresarial", ou só um dos dois. */
function rotaDaOs(valor: unknown): string | null {
  if (!valor || typeof valor !== "object") return null;
  const locais = valor as Record<string, unknown>;
  const partes = [nomeDoLocal(locais.origem), nomeDoLocal(locais.destino)].filter((parte): parte is string => Boolean(parte));
  return partes.length ? partes.join(" → ") : null;
}

export function osDaLeitura(id: string, data: Record<string, unknown>): OsDaFila | null {
  if (!(STATUS_DA_OS as readonly string[]).includes(String(data.status))) return null;
  if (typeof data.edicao !== "number" || !texto(data.customer_code) || !texto(data.demanda)) return null;
  const agenda = agendaDaLeitura(data);
  const itens = Array.isArray(data.itens)
    ? data.itens.flatMap((bruto) => {
        if (!bruto || typeof bruto !== "object") return [];
        const item = bruto as Record<string, unknown>;
        const nome = texto(item.item) || texto(item.descricao);
        if (!nome) return [];
        // A fatia da OS (parte 3.4b) está em `planejado`; antes, em `quantidade`.
        // Revisada, o saldo conta o consumido (parte 3.10a), como a callable.
        const linha = texto(item.id);
        return [{ item: nome, quantidade: texto(item.consumido) || texto(item.planejado) || texto(item.quantidade), ...(linha ? { id: linha } : {}) }];
      })
    : [];
  return {
    numero: id,
    demanda: texto(data.demanda),
    customer_code: texto(data.customer_code),
    status: data.status as StatusDaOs,
    edicao: data.edicao,
    itens,
    agenda,
    pessoas: pessoasDaOs(data.equipe),
    placas: placasDaOs(data.veiculos),
    servicos: Array.isArray(data.servicos) ? data.servicos.filter((servico): servico is string => typeof servico === "string") : [],
    rota: rotaDaOs(data.locais),
    tipo: data.tipo === "vistoria" ? "vistoria" : "servico",
  };
}



function numeros(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function demandaParaAbrir(id: string, data: Record<string, unknown>): DemandaParaAbrir | null {
  if (data.etapa !== "para_planejar" || !texto(data.customer_code)) return null;
  return {
    numero: id,
    customer_code: texto(data.customer_code),
    titulo: texto(data.titulo) || null,
    os_numeros: numeros(data.os_numeros),
  };
}

function preenchido(valor: unknown): boolean {
  return valor !== undefined && valor !== null && valor !== false;
}

export type DemandaDaFila = { numero: string; fora: DemandaFora | null; paraAbrir: DemandaParaAbrir | null };

/** A demanda como a fila usa: a que vira OS e a que saiu (a mesma regra de functions/operacao, problemaParaAgendarOs). */
export function demandaDaFila(id: string, data: Record<string, unknown>): DemandaDaFila {
  const fora: DemandaFora | null = preenchido(data.cancelamento) ? "cancelada" : preenchido(data.perda) ? "perdida" : null;
  return { numero: id, fora, paraAbrir: demandaParaAbrir(id, data) };
}

/** Marca na OS a demanda perdida ou cancelada no Comercial. */
export function comDemanda(ordens: readonly OsDaFila[], demandas: readonly DemandaDaFila[]): OsDaFila[] {
  const fora = new Map(demandas.flatMap((demanda) => (demanda.fora ? [[demanda.numero, demanda.fora] as const] : [])));
  return ordens.map((os) => ({ ...os, demandaFora: fora.get(os.demanda) ?? null }));
}

export function rotuloDaDemandaFora(fora: DemandaFora): string {
  return fora === "perdida" ? "Demanda perdida" : "Demanda cancelada";
}

export function agendaDaOs(os: OsDaFila, hoje: string): AgendaEmEdicao {
  return {
    data: os.agenda?.data || hoje,
    hora: os.agenda?.hora ?? "",
    equipe: [...(os.agenda?.equipe ?? [])],
    veiculoId: os.agenda?.veiculos[0] ?? "",
    motivo: "",
  };
}

export function nomeDe(id: string, nomes: Readonly<Record<string, string>>): string {
  return nomes[id] || id;
}

export function equipeDe(ids: readonly string[], nomes: Readonly<Record<string, string>>): string {
  const primeiroId = ids[0];
  if (!primeiroId) return "";
  const primeiro = nomeDe(primeiroId, nomes);
  return ids.length === 1 ? primeiro : `${primeiro} +${ids.length - 1}`;
}

export type ClienteDaFila = { code: string; nome: string };

export function clienteDaLeitura(id: string, data: Record<string, unknown>): ClienteDaFila | null {
  const code = texto(data.customer_code) || texto(data.code) || texto(id);
  if (!code) return null;
  return { code, nome: texto(data.name) || code };
}

export function nomesPorCodigo(clientes: readonly ClienteDaFila[]): Record<string, string> {
  return Object.fromEntries(clientes.map((cliente) => [cliente.code, cliente.nome]));
}

export function quando(agenda: AgendaDaFila): string {
  const dia = formatarData(agenda.data);
  return agenda.hora ? `${dia} ${agenda.hora}` : dia;
}

export function placaDe(id: string, placas: Readonly<Record<string, string>>): string {
  const placa = placas[id];
  return placa ? formatarPlaca(placa) : id;
}

export function placasDe(ids: readonly string[], placas: Readonly<Record<string, string>>): string {
  return ids.map((id) => placaDe(id, placas)).join(", ");
}

/** O que o agendamento manda à callable (parte 3.4b): janela, equipe e veículos. */
export function pedidoDeAgenda(agenda: Pick<AgendaEmEdicao, "data" | "hora" | "equipe" | "veiculoId">) {
  return {
    // O campo de hora do navegador pode trazer segundos (HH:MM:SS); a callable aceita HH:MM.
    janela: { data: agenda.data, inicio: agenda.hora.trim().slice(0, 5) || null },
    equipe: agenda.equipe.map((colaborador_id) => ({ colaborador_id })),
    veiculos: agenda.veiculoId ? [agenda.veiculoId] : [],
  };
}
