import { nomeComTamanho } from "@workspace/dominio";

import type { WarehouseTaskItem } from "./model";

/**
 * Os volumes de expedição do pedido (docs/plataforma/separacao-com-caixas.md,
 * seção 4.4, parte 4; docs/mockups/WmsSepararBancada.dc.html,
 * WmsSepararConcluido.dc.html e WmsSepararRomaneio.dc.html). Só leitura e
 * texto: quem monta, fecha e grava os volumes é o servidor (functions/wms,
 * domain/order-volumes.ts e pick-progress.ts).
 *
 * Durante a separação, os volumes moram na tarefa (`pick_tasks.volumes`) e
 * cada linha diz em quais foi (`separated_volumes`). Depois de concluída,
 * cada volume é um `packages`, com os `package_items` dele.
 */

/** O volume como a tarefa de separação o guarda. */
export type VolumeDaTarefa = {
  id: string;
  number: number;
  status: "open" | "closed";
  units: number;
  box_code?: string;
  weight_kg?: number;
  closed_at?: string;
};

/** O item dentro do volume, na ordem das linhas do pedido: o nome com o tamanho, o código do cliente e a quantidade. */
export type ItemDoVolume = { nome: string; codigo: string; quantidade: number };

/** O volume como a bancada, a etiqueta e o romaneio o mostram. */
export type VolumeDoPedido = {
  id: string;
  numero: number;
  aberto: boolean;
  unidades: number;
  /** A caixa que saiu inteira e virou o volume. Só a equipe vê: a etiqueta e o romaneio não a citam. */
  caixa: string | null;
  pesoKg: number | null;
  /** Quando fechou, em ISO. */
  fechadoEm: string | null;
  itens: ItemDoVolume[];
};

const numero = new Intl.NumberFormat("pt-BR");
const quilos = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });

function texto(valor: unknown): string {
  return String(valor ?? "").trim();
}

function positivo(valor: unknown): number {
  const lido = Number(valor ?? 0);
  return Number.isFinite(lido) && lido > 0 ? lido : 0;
}

/** O instante de um carimbo do Firestore, ou de um texto, em ISO; sem data válida, null. */
function instante(valor: unknown): string | null {
  if (!valor) return null;
  if (typeof valor === "string") return valor.trim() || null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.toISOString();
  const carimbo = valor as { toDate?: () => Date; seconds?: unknown; _seconds?: unknown };
  if (typeof carimbo.toDate === "function") return carimbo.toDate().toISOString();
  const segundos = Number(carimbo.seconds ?? carimbo._seconds);
  return Number.isFinite(segundos) ? new Date(segundos * 1000).toISOString() : null;
}

/** Os volumes como a tarefa os guarda (`pick_tasks.volumes`), na ordem do número. */
export function volumesDaTarefa(valor: unknown): VolumeDaTarefa[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .flatMap((entrada): VolumeDaTarefa[] => {
      const volume = entrada && typeof entrada === "object" ? (entrada as Record<string, unknown>) : null;
      const id = texto(volume?.id);
      const number = Math.floor(positivo(volume?.number));
      if (!volume || !id || !number) return [];
      return [
        {
          id,
          number,
          status: texto(volume.status) === "closed" ? "closed" : "open",
          units: positivo(volume.units),
          ...(texto(volume.box_code) ? { box_code: texto(volume.box_code).toUpperCase() } : {}),
          ...(positivo(volume.weight_kg) ? { weight_kg: positivo(volume.weight_kg) } : {}),
          ...(texto(volume.closed_at) ? { closed_at: texto(volume.closed_at) } : {}),
        },
      ];
    })
    .sort((esquerda, direita) => esquerda.number - direita.number);
}

/** Em quais volumes a linha foi, como ela guarda (`separated_volumes`). */
export function volumesDaLinhaGravados(valor: unknown): Array<{ volume_id: string; qty: number }> | undefined {
  if (!Array.isArray(valor)) return undefined;
  const entradas = valor.flatMap((entrada) => {
    const linha = entrada && typeof entrada === "object" ? (entrada as Record<string, unknown>) : null;
    const volume_id = texto(linha?.volume_id);
    const qty = positivo(linha?.qty);
    return volume_id && qty > 0 ? [{ volume_id, qty }] : [];
  });
  return entradas.length ? entradas : undefined;
}

/** O item com a linha do pedido de onde veio, para a ordem. */
type ItemDaLinha = ItemDoVolume & { linha: number };

/** O nome e o código de uma linha do pedido, como o volume os mostra. */
function itemDaLinha(
  item: Pick<WarehouseTaskItem, "name" | "product_name" | "client_item_code" | "sku_code" | "sku" | "size" | "line_number">,
  quantidade: number,
): ItemDaLinha {
  const nome = texto(item.name ?? item.product_name);
  return {
    nome: nomeComTamanho({ nome, codigo: item.client_item_code, tamanho: item.size }) || nome || texto(item.sku_code ?? item.sku),
    // O código do cliente; sem ele, o SKU.
    codigo: texto(item.client_item_code) || texto(item.sku_code ?? item.sku),
    quantidade,
    linha: Number(item.line_number) || Number.MAX_SAFE_INTEGER,
  };
}

/** Os itens do volume na ordem das linhas do pedido, com as linhas do mesmo produto somadas. */
function itensEmOrdem(itens: readonly ItemDaLinha[]): ItemDoVolume[] {
  const juntos = new Map<string, ItemDaLinha>();
  for (const item of [...itens].sort((esquerda, direita) => esquerda.linha - direita.linha)) {
    const chave = `${item.codigo}|${item.nome}`;
    const atual = juntos.get(chave);
    juntos.set(chave, atual ? { ...atual, quantidade: atual.quantidade + item.quantidade } : item);
  }
  return [...juntos.values()].map(({ linha: _linha, ...item }) => item);
}

/**
 * Os volumes da separação em andamento: a tarefa diz quais são, e as linhas,
 * o que cada um leva. As unidades são as dos itens lidos; enquanto as linhas
 * não chegam, vale o que a tarefa diz.
 */
export function volumesDaSeparacao(volumes: readonly VolumeDaTarefa[], linhas: readonly WarehouseTaskItem[]): VolumeDoPedido[] {
  const porVolume = new Map<string, ItemDaLinha[]>();
  for (const linha of linhas) {
    for (const entrada of linha.separated_volumes ?? []) {
      porVolume.set(entrada.volume_id, [...(porVolume.get(entrada.volume_id) ?? []), itemDaLinha(linha, entrada.qty)]);
    }
  }
  return volumes.map((volume) => {
    const itens = itensEmOrdem(porVolume.get(volume.id) ?? []);
    return {
      id: volume.id,
      numero: volume.number,
      aberto: volume.status === "open",
      unidades: itens.length ? itens.reduce((soma, item) => soma + item.quantidade, 0) : volume.units,
      caixa: volume.box_code ?? null,
      pesoKg: volume.weight_kg ?? null,
      fechadoEm: volume.closed_at ?? null,
      itens,
    };
  });
}

/**
 * Os volumes do pedido concluído: um `packages` por volume, com os
 * `package_items` dele. O volume cancelado não entra.
 */
export function volumesDaRemessa(pacotes: ReadonlyArray<Record<string, unknown>>, itens: ReadonlyArray<Record<string, unknown>>): VolumeDoPedido[] {
  const porPacote = new Map<string, ItemDaLinha[]>();
  for (const item of itens) {
    const pacote = texto(item.package_id);
    const quantidade = positivo(item.qty_packed);
    if (!pacote || !quantidade || texto(item.status) === "cancelled") continue;
    porPacote.set(pacote, [
      ...(porPacote.get(pacote) ?? []),
      itemDaLinha(
        { product_name: texto(item.product_name), client_item_code: texto(item.client_item_code), sku_code: texto(item.sku_code), line_number: Number(item.line_number) || undefined },
        quantidade,
      ),
    ]);
  }
  return pacotes
    .filter((pacote) => texto(pacote.status) !== "cancelled" && texto(pacote.id))
    .map((pacote) => {
      const doVolume = itensEmOrdem(porPacote.get(texto(pacote.id)) ?? []);
      return {
        id: texto(pacote.id),
        numero: Math.floor(positivo(pacote.volume_number)) || 1,
        aberto: false,
        unidades: doVolume.length ? doVolume.reduce((soma, item) => soma + item.quantidade, 0) : positivo(pacote.packed_units),
        caixa: texto(pacote.box_code).toUpperCase() || null,
        pesoKg: positivo(pacote.weight_kg) || null,
        fechadoEm: instante(pacote.closed_at) ?? instante(pacote.created_at),
        itens: doVolume,
      };
    })
    .sort((esquerda, direita) => esquerda.numero - direita.numero);
}

/**
 * O volume aberto da bancada: o que a tarefa tem aberto ou, sem ele, o
 * seguinte, ainda vazio (ele abre sozinho na próxima linha separada).
 */
export function volumeAberto(volumes: readonly VolumeDoPedido[]): VolumeDoPedido {
  const aberto = volumes.find((volume) => volume.aberto);
  if (aberto) return aberto;
  const proximo = Math.max(0, ...volumes.map((volume) => volume.numero)) + 1;
  return { id: "", numero: proximo, aberto: true, unidades: 0, caixa: null, pesoKg: null, fechadoEm: null, itens: [] };
}

/** Os volumes fechados, o mais recente primeiro: é o que a bancada lista. */
export function volumesFechados(volumes: readonly VolumeDoPedido[]): VolumeDoPedido[] {
  return volumes.filter((volume) => !volume.aberto).sort((esquerda, direita) => direita.numero - esquerda.numero);
}

/** Quantos volumes o pedido vai ter ao concluir: os fechados e o aberto com alguma coisa dentro. */
export function volumesAoConcluir(volumes: readonly VolumeDoPedido[]): number {
  return volumes.filter((volume) => !volume.aberto || volume.unidades > 0).length;
}

/** "Volume 12"; com o total (depois de concluir), "Volume 12 de 42". */
export function nomeDoVolume(numeroDoVolume: number, total?: number | null): string {
  return total ? `Volume ${numero.format(numeroDoVolume)} de ${numero.format(total)}` : `Volume ${numero.format(numeroDoVolume)}`;
}

/** "6,3 kg"; sem peso, null. */
export function pesoDoVolume(pesoKg: number | null | undefined): string | null {
  return pesoKg && pesoKg > 0 ? `${quilos.format(pesoKg)} kg` : null;
}

/** "CX-000029 · 25 un. · 6,3 kg": a linha do volume fechado, para a equipe. */
export function textoDoVolume(volume: Pick<VolumeDoPedido, "caixa" | "unidades" | "pesoKg">): string {
  return [volume.caixa, `${numero.format(volume.unidades)} un.`, pesoDoVolume(volume.pesoKg)].filter(Boolean).join(" · ");
}

/** "aberto · 2 un.": o volume aberto na barra do celular. */
export function textoDoAberto(volume: Pick<VolumeDoPedido, "unidades">): string {
  return `aberto · ${numero.format(volume.unidades)} un.`;
}

/** "11 fechados"; sem volume fechado, null. */
export function textoDosFechados(fechados: number): string | null {
  if (fechados <= 0) return null;
  return `${numero.format(fechados)} ${fechados === 1 ? "fechado" : "fechados"}`;
}

/** "42 volumes · 3.335 un." */
export function resumoDosVolumes(volumes: readonly Pick<VolumeDoPedido, "unidades">[]): string {
  const unidades = volumes.reduce((soma, volume) => soma + volume.unidades, 0);
  return `${textoDeVolumes(volumes.length)} · ${numero.format(unidades)} un.`;
}

/** "42 volumes"; "1 volume". */
export function textoDeVolumes(volumes: number): string {
  return `${numero.format(volumes)} ${volumes === 1 ? "volume" : "volumes"}`;
}

/** "Ver os 11 volumes" */
export function textoVerVolumes(volumes: number): string {
  return volumes === 1 ? "Ver o volume" : `Ver os ${numero.format(volumes)} volumes`;
}

/** "30 × Calça Social Masculino Preta · 40 · 12 × Calça Social Masculino Preta · 42": o conteúdo do volume numa linha. */
export function conteudoDoVolume(volume: Pick<VolumeDoPedido, "itens">): string {
  return volume.itens.map((item) => `${numero.format(item.quantidade)} × ${item.nome}`).join(" · ");
}

/** Em quais volumes a linha separada está: "Volume 12", na ordem do número. */
export function volumesDaLinha(item: Pick<WarehouseTaskItem, "separated_volumes">, volumes: readonly Pick<VolumeDoPedido, "id" | "numero">[]): string[] {
  const numeros = new Map(volumes.map((volume) => [volume.id, volume.numero]));
  return [...new Set((item.separated_volumes ?? []).flatMap((entrada) => numeros.get(entrada.volume_id) ?? []))].sort((esquerda, direita) => esquerda - direita).map((numeroDoVolume) => nomeDoVolume(numeroDoVolume));
}

/** O peso digitado em "Peso (kg)": "11,6" vira 11.6; vazio, undefined (o peso é opcional); inválido, null. */
export function pesoDigitado(valor: string): number | undefined | null {
  const limpo = valor.trim().replace(/\s/g, "").replace(",", ".");
  if (!limpo) return undefined;
  if (!/^\d+(\.\d{1,3})?$/.test(limpo)) return null;
  const peso = Number(limpo);
  return peso > 0 && peso <= PESO_DO_VOLUME_MAXIMO_KG ? peso : null;
}

/** O mesmo teto do servidor (pick-progress.ts). */
export const PESO_DO_VOLUME_MAXIMO_KG = 2000;

/**
 * "O volume 12 passou a ser o volume 5. Troque a etiqueta dele.": o que o
 * desfazer avisa. O volume fechado que esvaziou e saiu vem antes (parte 7a):
 * "O volume 16 saiu. Tire a etiqueta dele."
 */
export function avisoDosVolumes(resposta: {
  removed_volumes?: Array<{ number: number }>;
  renumbered_volumes?: Array<{ from: number; to: number }>;
  changed_volumes?: Array<{ number: number }>;
}): string | null {
  const frases = [
    ...(resposta.removed_volumes ?? []).map((volume) => `O volume ${numero.format(volume.number)} saiu. Tire a etiqueta dele.`),
    ...(resposta.renumbered_volumes ?? []).map((volume) => `O volume ${numero.format(volume.from)} passou a ser o volume ${numero.format(volume.to)}. Troque a etiqueta dele.`),
    ...(resposta.changed_volumes ?? []).map((volume) => `O volume ${numero.format(volume.number)} mudou. Imprima a etiqueta dele de novo.`),
  ];
  return frases.length ? frases.join(" ") : null;
}
