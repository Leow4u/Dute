import { formatarData, formatarPlaca } from "./cadastro";

/** A fila do dia (docs/plataforma/fase-3-operacao.md, parte 3). Sem preço. */

export type ItemDaFila = { item: string; quantidade: string };

export type AgendaDaFila = {
  data: string;
  hora: string | null;
  equipe: string[];
  veiculo_id: string;
};

export type OsDaFila = {
  numero: string;
  demanda: string;
  customer_code: string;
  status: "aberta" | "agendada" | "cancelada";
  edicao: number;
  itens: ItemDaFila[];
  agenda: AgendaDaFila | null;
};

export type QuadroDoDia = {
  paraAgendar: OsDaFila[];
  agendadasHoje: OsDaFila[];
  outrosDias: OsDaFila[];
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

export function osDaLeitura(id: string, data: Record<string, unknown>): OsDaFila | null {
  if (data.status !== "aberta" && data.status !== "agendada" && data.status !== "cancelada") return null;
  if (typeof data.edicao !== "number" || !texto(data.customer_code) || !texto(data.demanda)) return null;
  const agendaBruta = data.agenda;
  let agenda: AgendaDaFila | null = null;
  if (agendaBruta && typeof agendaBruta === "object") {
    const agendaData = agendaBruta as Record<string, unknown>;
    if (texto(agendaData.data) && texto(agendaData.veiculo_id) && Array.isArray(agendaData.equipe)) {
      agenda = {
        data: texto(agendaData.data),
        hora: texto(agendaData.hora) || null,
        equipe: agendaData.equipe.filter((item): item is string => typeof item === "string"),
        veiculo_id: texto(agendaData.veiculo_id),
      };
    }
  }
  const itens = Array.isArray(data.itens)
    ? data.itens.flatMap((bruto) => {
        if (!bruto || typeof bruto !== "object") return [];
        const item = bruto as Record<string, unknown>;
        const nome = texto(item.item) || texto(item.descricao);
        if (!nome) return [];
        return [{ item: nome, quantidade: texto(item.quantidade) }];
      })
    : [];
  return {
    numero: id,
    demanda: texto(data.demanda),
    customer_code: texto(data.customer_code),
    status: data.status,
    edicao: data.edicao,
    itens,
    agenda,
  };
}

function porNumero<T extends { numero: string }>(itens: readonly T[]): T[] {
  return [...itens].sort((esquerda, direita) => esquerda.numero.localeCompare(direita.numero, "pt-BR"));
}

export function quadroDoDia(ordens: readonly OsDaFila[], hoje: string): QuadroDoDia {
  return {
    paraAgendar: porNumero(ordens.filter((os) => os.status === "aberta")),
    agendadasHoje: porNumero(ordens.filter((os) => os.status === "agendada" && os.agenda?.data === hoje)),
    outrosDias: porNumero(ordens.filter((os) => os.status === "agendada" && os.agenda?.data !== hoje)),
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

export function agendaDaOs(os: OsDaFila, hoje: string): AgendaEmEdicao {
  return {
    data: os.agenda?.data || hoje,
    hora: os.agenda?.hora ?? "",
    equipe: [...(os.agenda?.equipe ?? [])],
    veiculoId: os.agenda?.veiculo_id ?? "",
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
