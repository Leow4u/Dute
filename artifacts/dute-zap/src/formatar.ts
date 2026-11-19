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

const fuso = "America/Sao_Paulo";

function diaNoFuso(data: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(data);
}

function horaCurta(data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit" }).format(data);
}

/** Hoje mostra a hora; ontem, a palavra; o resto, o dia e o mês. */
export function horaDaLista(data: Date, agora = new Date()): string {
  const desse = diaNoFuso(data);
  if (desse === diaNoFuso(agora)) return horaCurta(data);
  if (desse === diaNoFuso(new Date(agora.getTime() - 86_400_000))) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit" }).format(data);
}

export function rotuloDoDia(data: Date, agora = new Date()): string {
  const desse = diaNoFuso(data);
  if (desse === diaNoFuso(agora)) return "Hoje";
  if (desse === diaNoFuso(new Date(agora.getTime() - 86_400_000))) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit", year: "numeric" }).format(data);
}

export function horaDaBolha(data: Date): string {
  return horaCurta(data);
}

/** Mantém o DDI, o DDD e os quatro últimos dígitos. O meio sai. */
export function mascararTelefone(waId: string): string {
  const digitos = waId.replace(/\D/g, "");
  if (digitos.startsWith("55") && digitos.length === 13) return `+55 ${digitos.slice(2, 4)} ${digitos.slice(4, 5)}XXXX-${digitos.slice(9)}`;
  if (digitos.startsWith("55") && digitos.length === 12) return `+55 ${digitos.slice(2, 4)} XXXX-${digitos.slice(8)}`;
  if (digitos.length <= 4) return digitos || waId;
  return `${digitos.slice(0, 2)}…${digitos.slice(-4)}`;
}

export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  const primeira = partes[0][0] ?? "";
  const ultima = partes[partes.length - 1][0] ?? "";
  return `${primeira}${ultima}`.toUpperCase();
}

const CORES_DE_AVATAR = ["#0054CE", "#E71C23", "#3F403F", "#6a4fb3", "#0e8f8a", "#b45309"];

export function corDoAvatar(nome: string): string {
  let soma = 0;
  for (const letra of nome) soma += letra.charCodeAt(0);
  return CORES_DE_AVATAR[soma % CORES_DE_AVATAR.length] ?? CORES_DE_AVATAR[0];
}

/** Sem as mensagens carregadas, a lista só sabe se a última é de entrada e ainda não foi vista. */
export function contagemNaoLida(
  ultimaDirecao: "in" | "out",
  ultimaEm: number | null,
  vistoEm: number,
  mensagens?: { direction: "in" | "out"; em: number }[],
): number {
  if (mensagens) return mensagens.filter((mensagem) => mensagem.direction === "in" && mensagem.em > vistoEm).length;
  if (ultimaDirecao === "in" && ultimaEm !== null && ultimaEm > vistoEm) return 1;
  return 0;
}
