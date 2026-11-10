import { textoDoParaQuandoComAno } from "../order-queue";
import type { VolumeDoPedido } from "./volumes-do-pedido";

/**
 * O romaneio do pedido (docs/plataforma/separacao-com-caixas.md, seção 4.4,
 * parte 4c; docs/mockups/WmsSepararRomaneio.dc.html): o conteúdo completo de
 * cada volume, com o código do cliente, a quantidade e o peso; o lacre e o
 * total de volumes. Vai ao cliente: não cita caixa (`CX-`), posição nem
 * valor. Os textos chegam prontos: o papel só os mostra.
 */

export type FolhaDoRomaneio = {
  numero: string;
  cliente: string;
  destino: string;
  /** "Seg 16/11/2026 11:36"; "" sem prazo. */
  paraQuando: string;
  lacre: string;
  /** "10/11 a 13/11/2026"; "" sem as datas. */
  separado: string;
  por: string;
  unidades: number;
  volumes: VolumeDoPedido[];
};

function texto(valor: unknown): string {
  return String(valor ?? "").trim();
}

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });

function dia(valor: string | null | undefined): { dia: string; mes: string; ano: string } | null {
  const instante = valor ? new Date(valor) : null;
  if (!instante || Number.isNaN(instante.getTime())) return null;
  const partes = Object.fromEntries(DIA_EM_SAO_PAULO.formatToParts(instante).map((parte) => [parte.type, parte.value]));
  return { dia: partes.day!, mes: partes.month!, ano: partes.year! };
}

/**
 * "10/11 a 13/11/2026": de quando a quando o pedido separou, no horário de
 * São Paulo. No mesmo dia, só a data; de um ano para o outro, os dois anos.
 */
export function periodoDaSeparacao(de: string | null | undefined, ate: string | null | undefined): string {
  const inicio = dia(de);
  const fim = dia(ate);
  const inteiro = (data: { dia: string; mes: string; ano: string }) => `${data.dia}/${data.mes}/${data.ano}`;
  if (!inicio && !fim) return "";
  if (!inicio || !fim) return inteiro((inicio ?? fim)!);
  if (inteiro(inicio) === inteiro(fim)) return inteiro(fim);
  return `${inicio.ano === fim.ano ? `${inicio.dia}/${inicio.mes}` : inteiro(inicio)} a ${inteiro(fim)}`;
}

export function folhaDoRomaneio(dados: {
  numero: string;
  cliente?: string | null;
  destino?: string | null;
  /** O `due_at` da solicitação que originou o pedido. */
  paraQuando?: unknown;
  lacre?: string | null;
  separadoDe?: string | null;
  separadoAte?: string | null;
  por?: string | null;
  volumes: readonly VolumeDoPedido[];
}): FolhaDoRomaneio {
  const volumes = [...dados.volumes].sort((esquerda, direita) => esquerda.numero - direita.numero);
  return {
    numero: texto(dados.numero),
    cliente: texto(dados.cliente),
    destino: texto(dados.destino),
    paraQuando: textoDoParaQuandoComAno(dados.paraQuando),
    lacre: texto(dados.lacre),
    separado: periodoDaSeparacao(dados.separadoDe, dados.separadoAte),
    por: texto(dados.por),
    unidades: volumes.reduce((soma, volume) => soma + volume.unidades, 0),
    volumes,
  };
}

/** O endereço do romaneio para imprimir: o pedido vai na busca, como na lista. */
export const ROTA_DO_ROMANEIO = "/pedidos/romaneio";

export function hrefDoRomaneio(pedido: string): string {
  return `${ROTA_DO_ROMANEIO}?pedido=${encodeURIComponent(pedido)}`;
}
