export const API_BASE = "/api";

export const GRUPOS: Record<string, { label: string; emoji: string }> = {
  armazenamento: { label: "Armazenamento", emoji: "📦" },
  ad_valorem: { label: "Ad Valorem", emoji: "💰" },
  recebimento: { label: "Recebimento", emoji: "📥" },
  expedicao: { label: "Expedição", emoji: "📤" },
  servicos: { label: "Serviços de Valor Agregado", emoji: "⚙️" },
  transporte: { label: "Abastecimento / Transporte", emoji: "🚚" },
};

export const AUTO_LABELS: Record<string, string> = {
  ad_valorem: "% do estoque",
  mov_entrada_pecas: "Entradas (peças)",
  mov_saida_pecas: "Saídas (peças)",
  mov_count: "Nº de movimentações",
};

export const STATUS_META: Record<string, { label: string; className: string }> = {
  aberto: { label: "Em aberto", className: "bg-amber-100 text-amber-800 border-amber-200" },
  emitido: { label: "Emitida", className: "bg-blue-100 text-blue-800 border-blue-200" },
  pago: { label: "Paga", className: "bg-green-100 text-green-800 border-green-200" },
};

export const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);
export const fmtNum = (n: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(n || 0);

export function currentCompetencia(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function competenciaLabel(competencia: string): string {
  const [y, m] = competencia.split("-").map(Number);
  const meses = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];
  if (!m || !meses[m - 1]) return competencia;
  return `${meses[m - 1]} de ${y}`;
}
