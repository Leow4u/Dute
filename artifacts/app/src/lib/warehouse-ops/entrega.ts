/**
 * A entrega do pedido de saída no WMS (docs/plataforma/fase-4-financeiro.md,
 * parte 4.5c; docs/mockups/WmsExpedicao.dc.html): pela Dutelog (vira demanda
 * e OS na Operação) ou retirada pelo cliente (não gera OS). A callable
 * `setOrderDelivery` (functions/wms, domain/order-delivery.ts) confere tudo
 * de novo; aqui a tela diz antes o que falta. A entrega pela Dutelog salva
 * chama depois `openStorageDemand` (functions/operacao), que lê a entrega do
 * pedido e grava de volta o número da demanda e das OS.
 */

export const MODOS_DE_ENTREGA = ["dutelog", "retirada"] as const;
export type ModoDeEntrega = (typeof MODOS_DE_ENTREGA)[number];
export const MODO_ROTULO: Record<ModoDeEntrega, string> = { dutelog: "Entrega pela Dutelog", retirada: "Retirada pelo cliente" };

export type EntregaDoPedido =
  | {
      modo: "dutelog";
      destino: string;
      data: string;
      hora: string;
      contato: { nome: string; telefone: string | null } | null;
      montagem: boolean;
      retorno: { data: string; hora: string } | null;
      demanda: string | null;
      osNumeros: string[];
    }
  | { modo: "retirada"; data: string; hora: string; quemRetira: string; documento: string | null; placa: string | null };

function texto(valor: unknown): string {
  return typeof valor === "string" || typeof valor === "number" ? String(valor).trim() : "";
}

function registro(valor: unknown): Record<string, unknown> | null {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null;
}

/** A entrega gravada no pedido (`orders/{id}.entrega`), ou null sem ela. */
export function entregaDoPedido(dados: Record<string, unknown> | null | undefined): EntregaDoPedido | null {
  const entrega = registro(dados?.entrega);
  if (!entrega) return null;
  const data = texto(entrega.data);
  const hora = texto(entrega.hora);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^\d{2}:\d{2}$/.test(hora)) return null;
  if (entrega.modo === "retirada") {
    return { modo: "retirada", data, hora, quemRetira: texto(entrega.quem_retira), documento: texto(entrega.documento) || null, placa: texto(entrega.placa) || null };
  }
  if (entrega.modo !== "dutelog") return null;
  const contato = registro(entrega.contato);
  const retorno = registro(entrega.retorno);
  return {
    modo: "dutelog",
    destino: texto(entrega.destino),
    data,
    hora,
    contato: contato && texto(contato.nome) ? { nome: texto(contato.nome), telefone: texto(contato.telefone) || null } : null,
    montagem: entrega.montagem === true,
    retorno: retorno && texto(retorno.data) && texto(retorno.hora) ? { data: texto(retorno.data), hora: texto(retorno.hora) } : null,
    demanda: texto(entrega.demanda) || null,
    osNumeros: Array.isArray(entrega.os_numeros) ? entrega.os_numeros.map(texto).filter(Boolean) : [],
  };
}

const DIA_DA_SEMANA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short" });

/** "Qua 28/10 13:00". */
export function quandoEmTexto(data: string, hora: string): string {
  const semana = DIA_DA_SEMANA.format(new Date(`${data}T12:00:00-03:00`)).replace(".", "");
  const [, mes, dia] = data.split("-");
  return `${semana.charAt(0).toUpperCase()}${semana.slice(1)} ${dia}/${mes} ${hora}`;
}

/** "Entrega pela Dutelog · Qua 28/10 13:00 · montagem · retorno Sex 30/10 18:00"; "Retirada pelo cliente · Sáb 24/10 09:00 · Carlos Lima". */
export function resumoDaEntrega(entrega: EntregaDoPedido): string {
  if (entrega.modo === "retirada") return [MODO_ROTULO.retirada, quandoEmTexto(entrega.data, entrega.hora), entrega.quemRetira || null].filter(Boolean).join(" · ");
  return [
    MODO_ROTULO.dutelog,
    quandoEmTexto(entrega.data, entrega.hora),
    entrega.montagem ? "montagem" : null,
    entrega.retorno ? `retorno ${quandoEmTexto(entrega.retorno.data, entrega.retorno.hora)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "Demanda 10050 · OS 10050-01 e 10050-02", ou null antes da Operação abrir. */
export function naOperacao(entrega: EntregaDoPedido | null): string | null {
  if (!entrega || entrega.modo !== "dutelog" || !entrega.demanda) return null;
  const os = entrega.osNumeros;
  const lista = os.length > 1 ? `${os.slice(0, -1).join(", ")} e ${os.at(-1)}` : os[0];
  return [`Demanda ${entrega.demanda}`, lista ? `OS ${lista}` : null].filter(Boolean).join(" · ");
}

/** A entrega pela Dutelog salva sem a demanda ainda: falta abrir na Operação. */
export function faltaAbrirNaOperacao(entrega: EntregaDoPedido | null): boolean {
  return Boolean(entrega && entrega.modo === "dutelog" && !entrega.demanda);
}

// --- O formulário --------------------------------------------------------------------------

export type FormularioDaEntrega = {
  modo: ModoDeEntrega;
  destino: string;
  data: string;
  hora: string;
  contatoNome: string;
  contatoTelefone: string;
  montagem: boolean;
  comRetorno: boolean;
  retornoData: string;
  retornoHora: string;
  quemRetira: string;
  documento: string;
  placa: string;
};

/** O formulário pela entrega gravada, ou vazio: pela Dutelog, hoje às 13:00. */
export function formularioDaEntrega(entrega: EntregaDoPedido | null, hoje: string): FormularioDaEntrega {
  const vazio: FormularioDaEntrega = {
    modo: "dutelog",
    destino: "",
    data: hoje,
    hora: "13:00",
    contatoNome: "",
    contatoTelefone: "",
    montagem: false,
    comRetorno: false,
    retornoData: hoje,
    retornoHora: "18:00",
    quemRetira: "",
    documento: "",
    placa: "",
  };
  if (!entrega) return vazio;
  if (entrega.modo === "retirada") {
    return { ...vazio, modo: "retirada", data: entrega.data, hora: entrega.hora, quemRetira: entrega.quemRetira, documento: entrega.documento ?? "", placa: entrega.placa ?? "" };
  }
  return {
    ...vazio,
    destino: entrega.destino,
    data: entrega.data,
    hora: entrega.hora,
    contatoNome: entrega.contato?.nome ?? "",
    contatoTelefone: entrega.contato?.telefone ?? "",
    montagem: entrega.montagem,
    comRetorno: Boolean(entrega.retorno),
    retornoData: entrega.retorno?.data ?? entrega.data,
    retornoHora: entrega.retorno?.hora ?? "18:00",
  };
}

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

function instante(data: string, hora: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return Number.NaN;
  return Date.parse(`${data}T${hora}:00-03:00`);
}

export type ProblemasDaEntrega = Partial<Record<"destino" | "quando" | "contato" | "retorno" | "quemRetira" | "placa", string>>;

/** O que falta, por campo (a mesma régua de setOrderDelivery). */
export function problemasDaEntrega(form: FormularioDaEntrega, agora: Date): ProblemasDaEntrega {
  const problemas: ProblemasDaEntrega = {};
  const quando = instante(form.data, form.hora);
  if (Number.isNaN(quando)) problemas.quando = "Informe a data e a hora.";
  else if (form.data < DIA_EM_SAO_PAULO.format(agora)) problemas.quando = "A data da entrega já passou.";
  if (form.modo === "dutelog") {
    const destino = form.destino.trim();
    if (destino.length < 3) problemas.destino = "Informe o destino.";
    else if (destino.length > 160) problemas.destino = "Use até 160 caracteres.";
    if (form.contatoTelefone.trim() && !/^\+?\d{8,15}$/.test(form.contatoTelefone.replace(/[\s().-]/g, ""))) problemas.contato = "Telefone inválido: use DDD e número.";
    else if (form.contatoTelefone.trim() && form.contatoNome.trim().length < 2) problemas.contato = "Informe o nome do contato.";
    if (form.comRetorno) {
      const volta = instante(form.retornoData, form.retornoHora);
      if (Number.isNaN(volta)) problemas.retorno = "Informe a data e a hora do retorno.";
      else if (!Number.isNaN(quando) && volta <= quando) problemas.retorno = "O retorno vem depois da entrega.";
    }
  } else {
    if (form.quemRetira.trim().length < 2) problemas.quemRetira = "Informe quem retira.";
    const placa = form.placa.replace(/[\s-]/g, "").toUpperCase();
    if (placa && !/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa)) problemas.placa = "Placa inválida: use ABC1D23 ou ABC1234.";
  }
  return problemas;
}

/** O que vai para `setOrderDelivery`. Chame só sem problemas. */
export function pedidoDaEntrega(form: FormularioDaEntrega, orderId: string, chave: string): Record<string, unknown> {
  if (form.modo === "retirada") {
    return {
      idempotency_key: chave,
      order_id: orderId,
      entrega: {
        modo: "retirada",
        data: form.data,
        hora: form.hora,
        quem_retira: form.quemRetira.trim(),
        documento: form.documento.trim() || null,
        placa: form.placa.trim() || null,
      },
    };
  }
  return {
    idempotency_key: chave,
    order_id: orderId,
    entrega: {
      modo: "dutelog",
      destino: form.destino.trim(),
      data: form.data,
      hora: form.hora,
      contato: form.contatoNome.trim() ? { nome: form.contatoNome.trim(), telefone: form.contatoTelefone.trim() || null } : null,
      montagem: form.montagem,
      retorno: form.comRetorno ? { data: form.retornoData, hora: form.retornoHora } : null,
    },
  };
}

/** Na retirada, quem leva e a placa da saída vêm da entrega; o resto segue como hoje. */
export function saidaPelaEntrega(entrega: EntregaDoPedido | null): { motorista: string; placa: string } | null {
  if (!entrega || entrega.modo !== "retirada") return null;
  return { motorista: entrega.quemRetira, placa: entrega.placa ?? "" };
}
