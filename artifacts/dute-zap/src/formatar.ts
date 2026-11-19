/** Os mesmos rótulos da prévia gravada pela ingestão (functions/zap). */

export const ROTULO_DO_TIPO: Record<string, string> = {
  text: "Texto",
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localização",
  contacts: "Contato",
  reaction: "Reação",
  interactive: "Mensagem",
  unknown: "Mensagem",
};

const STATUS: Record<string, string> = {
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  played: "Ouvida",
  failed: "Falhou",
};

const horario = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function rotuloDoTipo(tipo: string): string {
  return ROTULO_DO_TIPO[tipo] ?? "Mensagem";
}

export function rotuloDoStatus(status: string | undefined): string | null {
  if (!status) return null;
  return STATUS[status] ?? null;
}

export function formatarHorario(data: Date): string {
  return horario.format(data);
}

/** wa_id com DDI 55 vira o telefone que a operação reconhece. O resto fica em dígitos. */
export function formatarTelefone(waId: string): string {
  const digitos = waId.replace(/\D/g, "");
  if (digitos.startsWith("55") && (digitos.length === 12 || digitos.length === 13)) {
    const resto = digitos.slice(2);
    const ddd = resto.slice(0, 2);
    const numero = resto.slice(2);
    if (numero.length === 9) return `(${ddd}) ${numero.slice(0, 5)}-${numero.slice(5)}`;
    if (numero.length === 8) return `(${ddd}) ${numero.slice(0, 4)}-${numero.slice(4)}`;
  }
  return digitos || waId;
}

export function nomeDoContato(nome: string | undefined, waId: string): string {
  const limpo = nome?.trim();
  return limpo || formatarTelefone(waId);
}
