/**
 * Os avisos automáticos por modelo (docs/plataforma/fase-4-financeiro.md,
 * parte 4.6a): a OS agendada, iniciada e concluída, a NF emitida e a
 * solicitação do portal recebida viram um aviso no sino do portal do cliente
 * e, para os contatos do cliente que ligaram o modelo no cadastro
 * (`customer_contacts.avisos`, parte 4.6b), um e-mail. O texto sai de um
 * modelo fixo, nunca da IA (a mensagem escrita pela IA é da Fase 5, com
 * aprovação). A fonte é o evento que cada módulo já grava em `events`. O
 * alerta dos itens parados (docs/plataforma/fase-5-memoria.md, parte 5.4f)
 * é o que a coordenação aprovou no núcleo: só o aprovado vira aviso.
 *
 * O aviso vai só ao cliente dono (`customer_code`) e só com o módulo do
 * modelo no contrato (`client_access.modules`). A OS não leva valor. A NF
 * leva o valor, que o cliente vê nas próprias faturas; por e-mail, ela vai só
 * ao contato do próprio cliente que lê valor (gestor ou financeiro), nunca à
 * gerenciadora.
 */

export const MODELOS_DE_AVISO = ["os_agendada", "os_iniciada", "os_concluida", "nf_emitida", "pedido_do_portal", "estoque_parado"] as const;
export type ModeloDeAviso = (typeof MODELOS_DE_AVISO)[number];

export const MODELO_ROTULO: Record<ModeloDeAviso, string> = {
  os_agendada: "OS agendada",
  os_iniciada: "OS em execução",
  os_concluida: "OS concluída",
  nf_emitida: "NF emitida",
  pedido_do_portal: "Solicitação recebida",
  estoque_parado: "Itens parados",
};

/** O módulo que o cliente precisa ter no contrato para receber o modelo. */
export const MODULO_DO_MODELO: Record<ModeloDeAviso, "operacao" | "financeiro" | "wms"> = {
  os_agendada: "operacao",
  os_iniciada: "operacao",
  os_concluida: "operacao",
  nf_emitida: "financeiro",
  pedido_do_portal: "operacao",
  estoque_parado: "wms",
};

/** Os modelos que levam valor: por e-mail, só aos papéis de contato que leem valor. */
export const MODELOS_DE_AVISO_COM_VALOR = ["nf_emitida"] as const;
export const PAPEIS_QUE_LEEM_VALOR = ["gestor_cliente", "financeiro"] as const;

/** Os tipos de evento que dão aviso, com a codebase que grava cada um. A OS planejada com a data já nasce agendada. */
export const FONTE_DO_EVENTO = {
  "os.scheduled": "functions_operacao",
  "os.planned": "functions_operacao",
  "os.started": "functions_operacao",
  "os.completed": "functions_operacao",
  "nf.registered": "functions_financeiro",
  "portal.service_requested": "functions_operacao",
  "estoque_parado.aprovado": "functions_core",
} as const;
export const EVENTOS_DE_AVISO = Object.keys(FONTE_DO_EVENTO) as Array<keyof typeof FONTE_DO_EVENTO>;

export type EventoLido = { id: string; type: string; source: string; customer_code: string | null; payload: Record<string, unknown>; occurred_at: string | null };

function texto(valor: unknown): string {
  return typeof valor === "string" || typeof valor === "number" ? String(valor).trim() : "";
}

function registro(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {};
}

export function eventoLido(id: string, dados: Record<string, unknown>): EventoLido {
  return {
    id,
    type: texto(dados.type),
    source: texto(dados.source),
    customer_code: texto(dados.customer_code) || null,
    payload: registro(dados.payload),
    occurred_at: texto(dados.occurred_at) || null,
  };
}

/** O modelo do evento, ou null quando ele não dá aviso (ou não veio da codebase que grava o tipo). */
export function modeloDoEvento(evento: Pick<EventoLido, "type" | "source" | "payload">): ModeloDeAviso | null {
  if (FONTE_DO_EVENTO[evento.type as keyof typeof FONTE_DO_EVENTO] !== evento.source) return null;
  switch (evento.type) {
    case "os.scheduled":
      return "os_agendada";
    case "os.planned":
      return texto(evento.payload.data) ? "os_agendada" : null;
    case "os.started":
      return "os_iniciada";
    case "os.completed":
      return "os_concluida";
    case "nf.registered":
      return "nf_emitida";
    case "portal.service_requested":
      return "pedido_do_portal";
    case "estoque_parado.aprovado":
      return "estoque_parado";
    default:
      return null;
  }
}

/** O que o modelo precisa ler além do evento: a OS, a NF do portal ou a solicitação. */
export function documentoDoModelo(modelo: ModeloDeAviso, evento: Pick<EventoLido, "payload">): { colecao: string; id: string } | null {
  const id = texto(evento.payload.id);
  if (!id || id.includes("/")) return null;
  if (modelo === "nf_emitida") return { colecao: "client_faturas", id };
  if (modelo === "pedido_do_portal") return { colecao: "service_requests", id };
  if (modelo === "estoque_parado") return { colecao: "ai_stock_alerts", id };
  return { colecao: "service_orders", id };
}

const SERVICO_ROTULO: Record<string, string> = {
  vistoria: "Vistoria",
  desmontagem: "Desmontagem",
  embalagem: "Embalagem",
  transporte: "Transporte",
  montagem: "Montagem",
  armazenagem: "Armazenagem",
};

const TIPO_DE_SERVICO_ROTULO: Record<string, string> = {
  transporte: "Transporte / frete",
  armazenagem: "Armazenagem / movimentação",
  servico_em_campo: "Serviço em campo",
  mudanca: "Mudança / transporte dedicado",
};

function servicosEmTexto(valor: unknown): string | null {
  const rotulos = (Array.isArray(valor) ? valor : []).map((item) => SERVICO_ROTULO[texto(item)]).filter(Boolean);
  if (!rotulos.length) return null;
  const [primeiro, ...resto] = rotulos;
  const frase = [primeiro, ...resto.map((rotulo) => rotulo.toLocaleLowerCase("pt-BR"))];
  return frase.length === 1 ? frase[0] : `${frase.slice(0, -1).join(", ")} e ${frase.at(-1)}`;
}

function dataBr(dia: string): string {
  const [ano, mes, dd] = dia.split("-");
  return dd && mes && ano ? `${dd}/${mes}/${ano}` : dia;
}

const DIA_E_HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false });

function instanteBr(iso: string): string {
  return Number.isNaN(Date.parse(iso)) ? iso : DIA_E_HORA.format(new Date(iso)).replace(",", "");
}

function reais(centavos: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100).replace(/\u00a0/g, " ");
}

export type Aviso = {
  modelo: ModeloDeAviso;
  customer_code: string;
  titulo: string;
  texto: string;
  /** A tela do portal que o aviso abre. */
  link: string;
  /** A entidade do aviso: a OS, a NF ou a solicitação. */
  entidade: string;
};

/**
 * O aviso do evento, com o texto do modelo e o que o documento lido diz. Sem
 * o documento (apagado, ilegível) ou sem o cliente, não há aviso.
 */
export function avisoDoEvento(evento: EventoLido, documento: Record<string, unknown> | null): Aviso | null {
  const modelo = modeloDoEvento(evento);
  const customerCode = evento.customer_code;
  if (!modelo || !customerCode || !documento) return null;
  if (texto(documento.customer_code) && texto(documento.customer_code) !== customerCode) return null;
  const id = texto(evento.payload.id);
  switch (modelo) {
    case "os_agendada": {
      if (documento.tipo === "vistoria") return null;
      const janela = registro(documento.janela);
      const dia = texto(janela.data) || texto(evento.payload.data);
      const quando = [dia ? dataBr(dia) : null, [texto(janela.inicio), texto(janela.fim)].filter(Boolean).join("–") || null].filter(Boolean).join(" ");
      return {
        modelo,
        customer_code: customerCode,
        titulo: `OS ${id} agendada`,
        texto: [servicosEmTexto(documento.servicos), quando || null].filter(Boolean).join(" · "),
        link: `/portal/servicos?os=${encodeURIComponent(id)}`,
        entidade: id,
      };
    }
    case "os_iniciada": {
      if (documento.tipo === "vistoria") return null;
      const instante = texto(evento.payload.instante);
      return {
        modelo,
        customer_code: customerCode,
        titulo: `OS ${id} em execução`,
        texto: [servicosEmTexto(documento.servicos), instante && !Number.isNaN(Date.parse(instante)) ? `desde ${HORA.format(new Date(instante))}` : null].filter(Boolean).join(" · "),
        link: `/portal/servicos?os=${encodeURIComponent(id)}`,
        entidade: id,
      };
    }
    case "os_concluida": {
      if (documento.tipo === "vistoria") return null;
      const instante = texto(evento.payload.instante);
      return {
        modelo,
        customer_code: customerCode,
        titulo: `OS ${id} concluída`,
        texto: [servicosEmTexto(documento.servicos), instante ? `concluída em ${instanteBr(instante)}` : null].filter(Boolean).join(" · "),
        // O comprovante do portal (parte 4.3d): o feito, quem recebeu, a assinatura e as fotos do final, para salvar em PDF.
        link: `/portal/servicos/comprovante?os=${encodeURIComponent(id)}`,
        entidade: id,
      };
    }
    case "nf_emitida": {
      const nf = registro(documento.nf);
      const numero = texto(nf.numero);
      if (!numero) return null;
      const valor = typeof documento.valor_cents === "number" && Number.isSafeInteger(documento.valor_cents) ? documento.valor_cents : null;
      const vencimento = texto(documento.vencimento);
      return {
        modelo,
        customer_code: customerCode,
        titulo: `NF ${numero} emitida`,
        texto: [valor !== null ? reais(valor) : null, vencimento ? `vence ${dataBr(vencimento)}` : null].filter(Boolean).join(" · "),
        link: "/portal/faturas",
        entidade: id,
      };
    }
    case "pedido_do_portal": {
      const tipo = TIPO_DE_SERVICO_ROTULO[texto(documento.tipo_servico)] ?? "Serviço";
      const dia = texto(documento.data);
      return {
        modelo,
        customer_code: customerCode,
        titulo: "Solicitação recebida",
        texto: [tipo, dia ? [dataBr(dia), texto(documento.horario)].filter(Boolean).join(" ") : null].filter(Boolean).join(" · "),
        link: "/portal/servicos",
        entidade: id,
      };
    }
    case "estoque_parado": {
      // Só o alerta aprovado, com os itens que a coordenação escolheu.
      if (documento.status !== "aprovada") return null;
      const itens = (Array.isArray(documento.itens_enviados) ? documento.itens_enviados : []).map(registro).filter((item) => texto(item.sku_code));
      if (!itens.length) return null;
      const dias = Number(registro(documento.regra).parado_dias) || 90;
      const codigos = itens.map((item) => texto(item.client_item_code) || texto(item.sku_code));
      return {
        modelo,
        customer_code: customerCode,
        titulo: itens.length === 1 ? "1 item parado no estoque" : `${itens.length} itens parados no estoque`,
        texto: [`Sem movimento há ${dias} dias ou mais`, codigosEmTexto(codigos)].join(" · "),
        link: "/portal/estoque",
        entidade: id,
      };
    }
  }
}

/** "POLO-M", "POLO-M e JAQ-G", "POLO-M, JAQ-G, CAL-42 e mais 2". */
function codigosEmTexto(codigos: readonly string[]): string {
  if (codigos.length > 3) return `${codigos.slice(0, 3).join(", ")} e mais ${codigos.length - 3}`;
  return codigos.length === 1 ? (codigos[0] ?? "") : `${codigos.slice(0, -1).join(", ")} e ${codigos.at(-1)}`;
}

/** O módulo está no contrato do cliente? `modulos` é o que vale de `client_access.modules`. */
export function clienteRecebeOModelo(modelo: ModeloDeAviso, modulos: readonly string[]): boolean {
  return modulos.includes(MODULO_DO_MODELO[modelo]);
}

/** O contato pode ligar o modelo? O que leva valor, só quem lê valor. */
export function contatoPodeReceber(modelo: ModeloDeAviso, papel: unknown): boolean {
  return !(MODELOS_DE_AVISO_COM_VALOR as readonly string[]).includes(modelo) || (PAPEIS_QUE_LEEM_VALOR as readonly unknown[]).includes(papel);
}

/** Os contatos do cliente que recebem o modelo por e-mail: ativos, com e-mail, com o modelo ligado e, no que leva valor, que leem valor. */
export function destinatariosDoModelo(modelo: ModeloDeAviso, contatos: ReadonlyArray<Record<string, unknown>>): string[] {
  const emails = contatos.flatMap((contato) => {
    if (contato.ativo === false || !contatoPodeReceber(modelo, contato.papel)) return [];
    const email = texto(contato.email).toLowerCase();
    const avisos = Array.isArray(contato.avisos) ? contato.avisos : [];
    return email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && avisos.includes(modelo) ? [email] : [];
  });
  return [...new Set(emails)].sort();
}

export type EmailDoAviso = { to: string[]; subject: string; text: string };

/** O que o link do e-mail abre, quando não é só a tela do portal. */
const CHAMADA_DO_LINK: Partial<Record<ModeloDeAviso, string>> = {
  os_concluida: "O comprovante, com a assinatura e as fotos do final, está no portal:",
};

/** O e-mail do aviso, ou null sem destinatário: o e-mail só sai com o modelo ligado no cadastro. */
export function emailDoAviso(aviso: Aviso, destinatarios: readonly string[], origem: string): EmailDoAviso | null {
  if (!destinatarios.length) return null;
  const endereco = origem.replace(/\/$/, "");
  const chamada = CHAMADA_DO_LINK[aviso.modelo] ?? null;
  return {
    to: [...destinatarios],
    subject: `${aviso.titulo} · Dutelog`,
    text: [aviso.titulo, aviso.texto, "", chamada, `${endereco}${aviso.link}`, "", "Dutelog Soluções Logísticas"]
      .filter((linha): linha is string => linha !== null)
      .filter((linha, indice, linhas) => linha || linhas[indice - 1])
      .join("\n"),
  };
}

/** O id do aviso e do e-mail sai do evento: o mesmo evento nunca dá dois. */
export function idDoAviso(eventoId: string): string {
  return `ntf_${eventoId}`;
}

export function idDoEmail(eventoId: string): string {
  return `mail_${eventoId}`;
}

/** O endereço do app que o e-mail cita, por ambiente. Fora da lista, a rotina não roda. */
export const ENDERECO_DO_APP: Readonly<Record<string, string>> = {
  "dute-prod": "https://app.dutelog.com.br",
  "dute-homolog": "https://dute-app-368642218894.southamerica-east1.run.app",
};

export function enderecoDoApp(projectId: string | null | undefined): string | null {
  return ENDERECO_DO_APP[String(projectId ?? "").trim()] ?? null;
}

/** O remetente dos avisos; o domínio precisa estar verificado no provedor. */
export const REMETENTE_DOS_AVISOS = "Dutelog <avisos@dutelog.com.br>";
