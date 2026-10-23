/**
 * Solicitar OS pelo portal (docs/plataforma/fase-4-financeiro.md, parte 4.4b;
 * docs/mockups/Portal.dc.html): o formulário do cliente e as solicitações
 * dele em Minhas OS. A callable `requestService` (functions/operacao) confere
 * tudo de novo; aqui a tela diz antes o que falta. As listas e os limites
 * são os de functions/operacao/src/domain/solicitacao.ts (o teste trava).
 */

export const TIPOS_DE_SERVICO = ["transporte", "armazenagem", "servico_em_campo", "mudanca"] as const;
export type TipoDeServico = (typeof TIPOS_DE_SERVICO)[number];

export const TIPO_DE_SERVICO_ROTULO: Record<TipoDeServico, string> = {
  transporte: "Transporte / frete",
  armazenagem: "Armazenagem / movimentação",
  servico_em_campo: "Serviço em campo",
  mudanca: "Mudança / transporte dedicado",
};

export const MAX_ANEXOS = 3;
export const MAX_BYTES_DO_ANEXO = 10 * 1024 * 1024;
export const DIAS_A_FRENTE = 365;
export const MAX_ORIGEM = 160;
export const MAX_DESCRICAO = 1000;
/** A recusada fica na lista por 30 dias, para o cliente ler o motivo. */
export const DIAS_DA_RECUSADA = 30;

/** A extensão de cada tipo aceito (o mesmo do storage.rules). */
const EXTENSAO_DO_TIPO: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export type AnexoEscolhido = { arquivo: File; nome: string; rotulo: string };

export type FormularioDaSolicitacao = {
  tipo: TipoDeServico;
  data: string;
  horario: string;
  origem: string;
  destino: string;
  descricao: string;
  anexos: AnexoEscolhido[];
};

function diaSeguinte(dia: string): string {
  const data = new Date(`${dia}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + 1);
  return data.toISOString().slice(0, 10);
}

/** O formulário vazio: transporte, amanhã às 08:00 (como no desenho). */
export function formularioInicial(hoje: string): FormularioDaSolicitacao {
  return { tipo: "transporte", data: diaSeguinte(hoje), horario: "08:00", origem: "", destino: "", descricao: "", anexos: [] };
}

/** A data e o horário em São Paulo (sem horário de verão desde 2019), em milissegundos; NaN fora do formato. */
export function instanteDesejado(data: string, horario: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(horario)) return Number.NaN;
  return Date.parse(`${data}T${horario}:00-03:00`);
}

/** O nome do arquivo no Storage: `an_` e 16 hex aleatórios, com a extensão do tipo. */
export function nomeDoAnexo(tipo: string, aleatorio: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(8))): string | null {
  const extensao = EXTENSAO_DO_TIPO[tipo];
  if (!extensao) return null;
  const hex = [...aleatorio()].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
  return `an_${hex}.${extensao}`;
}

/** Os anexos escolhidos somados aos que já estavam, ou o problema do primeiro que não vale. */
export function escolherAnexos(arquivos: readonly File[], atuais: readonly AnexoEscolhido[]): { anexos: AnexoEscolhido[]; problema: string | null } {
  const anexos = [...atuais];
  for (const arquivo of arquivos) {
    if (anexos.length >= MAX_ANEXOS) return { anexos, problema: `Anexe até ${MAX_ANEXOS} arquivos.` };
    const nome = nomeDoAnexo(arquivo.type);
    if (!nome) return { anexos, problema: `${arquivo.name}: use PDF, JPG, PNG ou WEBP.` };
    if (arquivo.size <= 0 || arquivo.size > MAX_BYTES_DO_ANEXO) return { anexos, problema: `${arquivo.name}: o arquivo passa de 10 MB.` };
    anexos.push({ arquivo, nome, rotulo: arquivo.name.trim().replace(/\s+/g, " ").slice(0, 120) || nome });
  }
  return { anexos, problema: null };
}

export type ProblemasDaSolicitacao = Partial<Record<"quando" | "origem" | "descricao", string>>;

/** O que falta antes de enviar, por campo (a mesma régua da callable). */
export function problemasDaSolicitacao(form: FormularioDaSolicitacao, agora: Date): ProblemasDaSolicitacao {
  const problemas: ProblemasDaSolicitacao = {};
  const quando = instanteDesejado(form.data, form.horario);
  if (Number.isNaN(quando)) problemas.quando = "Informe a data e o horário.";
  else if (quando <= agora.getTime()) problemas.quando = "A data e o horário já passaram.";
  else if (quando > agora.getTime() + DIAS_A_FRENTE * 86_400_000) problemas.quando = `Peça com até ${DIAS_A_FRENTE} dias de antecedência.`;
  const origem = form.origem.trim();
  if (origem.length < 3) problemas.origem = "Informe a origem.";
  else if (origem.length > MAX_ORIGEM) problemas.origem = `Use até ${MAX_ORIGEM} caracteres.`;
  const descricao = form.descricao.trim();
  if (descricao.length < 3) problemas.descricao = "Diga o que será feito.";
  else if (descricao.length > MAX_DESCRICAO) problemas.descricao = `Use até ${MAX_DESCRICAO} caracteres.`;
  return problemas;
}

export function podeEnviar(form: FormularioDaSolicitacao, agora: Date): boolean {
  return Object.keys(problemasDaSolicitacao(form, agora)).length === 0;
}

/** O que vai para `requestService`. */
export function pedidoDaSolicitacao(form: FormularioDaSolicitacao, chave: string): Record<string, unknown> {
  return {
    idempotency_key: chave,
    tipo_servico: form.tipo,
    data: form.data,
    horario: form.horario,
    origem: form.origem.trim(),
    destino: form.destino.trim() || null,
    descricao: form.descricao.trim(),
    anexos: form.anexos.map((anexo) => ({ arquivo: anexo.nome, nome: anexo.rotulo })),
  };
}

/** Onde o anexo sobe (o caminho do storage.rules). */
export function caminhoDoAnexo(customerCode: string, nome: string): string {
  return `portal/${customerCode}/solicitacoes/${nome}`;
}

// --- As solicitações do cliente ------------------------------------------------------------

export type SituacaoDaSolicitacao = "aguardando" | "em_planejamento" | "nao_atendida";

export const SITUACAO_DA_SOLICITACAO_ROTULO: Record<SituacaoDaSolicitacao, string> = {
  aguardando: "Aguardando a Dutelog",
  em_planejamento: "Em planejamento",
  nao_atendida: "Não atendida",
};

export type SolicitacaoDoPortal = {
  id: string;
  tipo: TipoDeServico;
  situacao: SituacaoDaSolicitacao;
  /** "24/10/2026 08:00". */
  quando: string;
  origem: string;
  destino: string | null;
  descricao: string;
  anexos: string[];
  demanda: string | null;
  motivo: string | null;
  recebidaEm: string;
  /** O dia da recusa (aaaa-mm-dd), para tirar da lista depois de 30 dias. */
  recusadaEm: string | null;
};

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

/** A solicitação de `service_requests`, como o portal mostra. */
export function solicitacaoDoPortal(id: string, dados: Record<string, unknown>): SolicitacaoDoPortal | null {
  const tipo = texto(dados.tipo_servico) as TipoDeServico;
  if (!(TIPOS_DE_SERVICO as readonly string[]).includes(tipo)) return null;
  const status = texto(dados.status);
  const situacao: SituacaoDaSolicitacao | null = status === "recebida" ? "aguardando" : status === "aceita" ? "em_planejamento" : status === "recusada" ? "nao_atendida" : null;
  const data = texto(dados.data);
  const horario = texto(dados.horario);
  if (!situacao || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  const recusa = dados.recusa && typeof dados.recusa === "object" ? (dados.recusa as Record<string, unknown>) : null;
  const recusadaEm = texto(recusa?.em);
  return {
    id,
    tipo,
    situacao,
    quando: [data.split("-").reverse().join("/"), horario].filter(Boolean).join(" "),
    origem: texto(dados.origem),
    destino: texto(dados.destino) || null,
    descricao: texto(dados.descricao),
    anexos: (Array.isArray(dados.anexos) ? dados.anexos : []).flatMap((anexo) => {
      const nome = anexo && typeof anexo === "object" ? texto((anexo as Record<string, unknown>).nome) : "";
      return nome ? [nome] : [];
    }),
    demanda: texto(dados.demanda) || null,
    motivo: situacao === "nao_atendida" ? texto(recusa?.motivo) || null : null,
    recebidaEm: texto(dados.recebida_em),
    recusadaEm: recusadaEm && !Number.isNaN(Date.parse(recusadaEm)) ? DIA_EM_SAO_PAULO.format(new Date(recusadaEm)) : null,
  };
}

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
}

/**
 * As solicitações que ainda dizem algo ao cliente, a mais recente primeiro:
 * as que aguardam a Dutelog, as atendidas cuja demanda ainda não tem OS na
 * lista (depois, a OS conta a história) e as não atendidas dos últimos 30
 * dias.
 */
export function solicitacoesEmAberto(lista: readonly SolicitacaoDoPortal[], demandasComOs: ReadonlySet<string>, hoje: string): SolicitacaoDoPortal[] {
  return lista
    .filter((item) => {
      if (item.situacao === "aguardando") return true;
      if (item.situacao === "em_planejamento") return !item.demanda || !demandasComOs.has(item.demanda);
      return item.recusadaEm !== null && diasEntre(item.recusadaEm, hoje) <= DIAS_DA_RECUSADA;
    })
    .sort((a, b) => b.recebidaEm.localeCompare(a.recebidaEm));
}

/** "Transporte / frete · 24/10/2026 08:00". */
export function tituloDaSolicitacao(item: Pick<SolicitacaoDoPortal, "tipo" | "quando">): string {
  return `${TIPO_DE_SERVICO_ROTULO[item.tipo]} · ${item.quando}`;
}

/** "Demanda 10050" na atendida; o motivo na não atendida. */
export function detalheDaSolicitacao(item: SolicitacaoDoPortal): string | null {
  if (item.situacao === "em_planejamento") return item.demanda ? `Demanda ${item.demanda}` : null;
  if (item.situacao === "nao_atendida") return item.motivo;
  return null;
}
