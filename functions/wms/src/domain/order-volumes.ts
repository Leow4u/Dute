/**
 * Volumes de expedição (docs/plataforma/separacao-com-caixas.md, seção 4.4,
 * parte 4a; decisões 4, 11, 12 e 15 de 10/11/2026). A bancada monta os
 * volumes enquanto separa: a linha separada entra no volume aberto, "Fechar
 * volume" fecha com o peso (opcional) e o seguinte abre sozinho; a caixa que
 * sai inteira vira o volume, sem reembalar ("Levar a caixa").
 *
 * Os volumes moram na tarefa de separação (`pick_tasks.volumes`) até a
 * conclusão, que os grava como `packages` com os `package_items` de cada um.
 * A linha guarda em quais volumes foi (`separated_volumes`).
 *
 * Aqui fica a regra sem banco. O volume tem um `id` que não muda (a linha o
 * guarda) e o `number` que a etiqueta mostra. Os números ficam sempre de 1 a
 * N, sem buraco: quando um volume fechado esvazia e sai, o de maior número
 * ocupa o lugar dele, que é o que troca menos etiqueta. O volume fechado de
 * que sai uma parte continua fechado, sem o peso que tinha: a etiqueta dele
 * precisa sair de novo.
 */

type Row = Record<string, unknown>;

export type VolumeDoPedido = {
  /** "v12": não muda; é o que a linha guarda. */
  id: string;
  /** O número que a etiqueta e o romaneio mostram. */
  number: number;
  status: "open" | "closed";
  /** As unidades no volume. */
  units: number;
  /** A caixa que saiu inteira e virou o volume. */
  box_code?: string;
  weight_kg?: number;
  closed_at?: string;
  closed_by?: Row;
};

/** Onde o separado de uma linha foi: o volume e a quantidade. */
export type NoVolume = { volume_id: string; qty: number };

/** O volume fechado que mudou de número: a etiqueta dele precisa ser trocada. */
export type VolumeRenumerado = { id: string; de: number; para: number };

/** O volume fechado de que saiu uma parte: o conteúdo da etiqueta mudou. */
export type VolumeAlterado = { id: string; number: number };

/** O item do pedido dentro de um volume. */
export type ItemDoVolume = { order_item_id: string; qty: number };

/** O que uma linha separou e em quais volumes pôs, para a conclusão. */
export type LinhaNosVolumes = { order_item_id: string; qty: number; volumes: readonly NoVolume[] };

/** O volume como a conclusão o grava: fechado, com os itens. */
export type VolumeConcluido = VolumeDoPedido & { status: "closed"; items: ItemDoVolume[] };

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return value == null ? "" : String(value).trim();
}

function quantity(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function clean<T extends Row>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/** Os volumes como a tarefa os guarda, na ordem do número. */
export function volumesDaTarefa(value: unknown): VolumeDoPedido[] {
  if (!Array.isArray(value)) return [];
  return (value as Row[])
    .map((volume) =>
      clean({
        id: text(volume.id),
        number: Math.floor(quantity(volume.number)),
        status: text(volume.status) === "closed" ? ("closed" as const) : ("open" as const),
        units: quantity(volume.units),
        box_code: text(volume.box_code) || undefined,
        weight_kg: quantity(volume.weight_kg) || undefined,
        closed_at: text(volume.closed_at) || undefined,
        closed_by: volume.closed_by && typeof volume.closed_by === "object" ? (volume.closed_by as Row) : undefined,
      }),
    )
    .filter((volume) => volume.id && volume.number > 0)
    .sort((left, right) => left.number - right.number);
}

/** Em quais volumes a linha foi, como ela guarda. */
export function volumesDaLinha(value: unknown): NoVolume[] {
  if (!Array.isArray(value)) return [];
  return (value as Row[]).map((entry) => ({ volume_id: text(entry.volume_id), qty: quantity(entry.qty) })).filter((entry) => entry.volume_id && entry.qty > 0);
}

/** O próximo `id` de volume da tarefa: o contador não volta, mesmo que um volume saia. */
function proximoId(volumes: readonly VolumeDoPedido[], seq: number): { id: string; seq: number } {
  const usados = volumes.map((volume) => Number(volume.id.replace(/^v/, "")) || 0);
  const next = Math.max(seq, ...usados, 0) + 1;
  return { id: `v${next}`, seq: next };
}

function proximoNumero(volumes: readonly VolumeDoPedido[]): number {
  return Math.max(0, ...volumes.map((volume) => volume.number)) + 1;
}

export type EstadoDosVolumes = { volumes: VolumeDoPedido[]; seq: number };

/** Põe as unidades no volume aberto; sem volume aberto, abre o seguinte. */
export function porNoVolumeAberto(estado: EstadoDosVolumes, qty: number): EstadoDosVolumes & { volume_id: string } {
  const aberto = estado.volumes.find((volume) => volume.status === "open");
  if (aberto) {
    return {
      seq: estado.seq,
      volumes: estado.volumes.map((volume) => (volume.id === aberto.id ? { ...volume, units: volume.units + qty } : volume)),
      volume_id: aberto.id,
    };
  }
  const { id, seq } = proximoId(estado.volumes, estado.seq);
  return { seq, volumes: [...estado.volumes, { id, number: proximoNumero(estado.volumes), status: "open", units: qty }], volume_id: id };
}

/** "Levar a caixa": a caixa que sai inteira vira um volume fechado, com o peso que ela tinha na entrada. */
export function caixaViraVolume(
  estado: EstadoDosVolumes,
  caixa: { box_code: string; qty: number; weight_kg?: number; at: string; by: Row },
): EstadoDosVolumes & { volume_id: string } {
  const { id, seq } = proximoId(estado.volumes, estado.seq);
  const volume: VolumeDoPedido = clean({
    id,
    number: proximoNumero(estado.volumes),
    status: "closed" as const,
    units: caixa.qty,
    box_code: caixa.box_code,
    weight_kg: quantity(caixa.weight_kg) || undefined,
    closed_at: caixa.at,
    closed_by: caixa.by,
  });
  return { seq, volumes: [...estado.volumes, volume], volume_id: id };
}

/**
 * Tira dos volumes o que uma linha tinha posto neles (o "Desfazer", ou a
 * linha que muda de quantidade). O volume que fica sem unidades sai; para os
 * números continuarem de 1 a N, o de maior número ocupa o lugar do que saiu.
 * Devolve o fechado que mudou de número, para trocar a etiqueta dele, e o
 * fechado de que saiu só uma parte, que perde o peso e pede etiqueta nova.
 */
export function tirarDosVolumes(
  estado: EstadoDosVolumes,
  entradas: readonly NoVolume[],
): EstadoDosVolumes & { renumerados: VolumeRenumerado[]; alterados: VolumeAlterado[] } {
  const tirar = new Map<string, number>();
  for (const entrada of entradas) tirar.set(entrada.volume_id, (tirar.get(entrada.volume_id) ?? 0) + entrada.qty);
  const antes = new Map(estado.volumes.map((volume) => [volume.id, volume.number]));
  const mudaram = new Set<string>();
  let volumes = estado.volumes.map((volume) => {
    const sai = tirar.get(volume.id) ?? 0;
    if (!(sai > 0)) return volume;
    const units = Math.max(0, volume.units - sai);
    if (volume.status !== "closed" || units <= 0) return { ...volume, units };
    // O peso era do volume inteiro: sem uma parte dele, deixa de valer.
    mudaram.add(volume.id);
    const { weight_kg: _peso, ...semPeso } = volume;
    return { ...semPeso, units };
  });
  // Um de cada vez, do maior número para o menor: o lugar vago é ocupado pelo último.
  const vazios = volumes.filter((volume) => tirar.has(volume.id) && volume.units <= 0).sort((left, right) => right.number - left.number);
  for (const vazio of vazios) {
    volumes = volumes.filter((volume) => volume.id !== vazio.id);
    const ultimo = volumes.reduce<VolumeDoPedido | undefined>((maior, volume) => (!maior || volume.number > maior.number ? volume : maior), undefined);
    if (!ultimo || ultimo.number < vazio.number) continue;
    volumes = volumes.map((volume) => (volume.id === ultimo.id ? { ...volume, number: vazio.number } : volume));
  }
  // Só o fechado tem etiqueta para trocar; o aberto ainda não foi etiquetado.
  const renumerados = volumes
    .filter((volume) => volume.status === "closed" && antes.get(volume.id) !== volume.number)
    .map((volume) => ({ id: volume.id, de: antes.get(volume.id) ?? volume.number, para: volume.number }));
  const alterados = volumes.filter((volume) => mudaram.has(volume.id)).map((volume) => ({ id: volume.id, number: volume.number }));
  return { seq: estado.seq, volumes: volumes.sort((left, right) => left.number - right.number), renumerados, alterados };
}

/** Por que o volume não fecha, ou null. */
export function problemaParaFechar(volumes: readonly VolumeDoPedido[], volumeId: string): string | null {
  const volume = volumes.find((candidate) => candidate.id === volumeId);
  if (!volume) return "Volume não encontrado. Atualize e tente de novo.";
  if (volume.status === "closed") return `O volume ${volume.number} já está fechado.`;
  if (volume.units <= 0) return `O volume ${volume.number} está vazio: separe uma linha antes de fechar.`;
  return null;
}

/** "Fechar volume": o peso é opcional (decisão 15). */
export function fecharVolume(estado: EstadoDosVolumes, volumeId: string, fechamento: { weight_kg?: number; at: string; by: Row }): EstadoDosVolumes {
  return {
    seq: estado.seq,
    volumes: estado.volumes.map((volume) =>
      volume.id === volumeId
        ? clean({ ...volume, status: "closed" as const, weight_kg: quantity(fechamento.weight_kg) || undefined, closed_at: fechamento.at, closed_by: fechamento.by })
        : volume,
    ),
  };
}

/**
 * Os volumes para a conclusão, com os itens de cada um. O aberto fecha
 * junto, sem peso; o que uma linha separou e não está em volume nenhum (a
 * linha separada antes dos volumes) vai no aberto ou, sem aberto, num volume
 * a mais; o volume sem item sai, e os números vão de 1 a N. Sem volume e sem
 * linha em volume, devolve vazio: o pedido fecha no volume único de sempre.
 */
export function volumesParaConcluir(estado: EstadoDosVolumes, linhas: readonly LinhaNosVolumes[], fechamento: { at: string; by: Row }): VolumeConcluido[] {
  if (!estado.volumes.length) return [];
  const itens = new Map<string, Map<string, number>>(estado.volumes.map((volume) => [volume.id, new Map<string, number>()]));
  const por = (volumeId: string, orderItemId: string, qty: number) => {
    const doVolume = itens.get(volumeId)!;
    doVolume.set(orderItemId, (doVolume.get(orderItemId) ?? 0) + qty);
  };
  const semVolume: ItemDoVolume[] = [];
  for (const linha of linhas) {
    let falta = quantity(linha.qty);
    for (const entrada of linha.volumes) {
      if (falta <= 0) break;
      if (!itens.has(entrada.volume_id)) continue;
      const qty = Math.min(falta, quantity(entrada.qty));
      if (!qty) continue;
      por(entrada.volume_id, linha.order_item_id, qty);
      falta -= qty;
    }
    if (falta > 0) semVolume.push({ order_item_id: linha.order_item_id, qty: falta });
  }
  let volumes = [...estado.volumes];
  if (semVolume.length) {
    let aberto = volumes.find((volume) => volume.status === "open");
    if (!aberto) {
      aberto = { id: proximoId(volumes, estado.seq).id, number: proximoNumero(volumes), status: "open", units: 0 };
      volumes = [...volumes, aberto];
      itens.set(aberto.id, new Map());
    }
    for (const item of semVolume) por(aberto.id, item.order_item_id, item.qty);
  }
  return volumes
    .map((volume) => ({ volume, items: [...itens.get(volume.id)!].map(([order_item_id, qty]) => ({ order_item_id, qty })) }))
    .filter(({ items }) => items.length > 0)
    .sort((left, right) => left.volume.number - right.volume.number)
    .map(({ volume, items }, index) =>
      clean({
        ...volume,
        number: index + 1,
        status: "closed" as const,
        // As unidades do volume são as dos itens dele: é o que a embalagem confere.
        units: items.reduce((soma, item) => soma + item.qty, 0),
        closed_at: volume.status === "open" ? fechamento.at : (volume.closed_at ?? fechamento.at),
        closed_by: volume.status === "open" ? fechamento.by : (volume.closed_by ?? fechamento.by),
        items,
      }),
    );
}

/** "Volume 12"; depois da conclusão, com o total: "Volume 12 de 42". */
export function nomeDoVolume(number: number, total?: number): string {
  return total ? `Volume ${number} de ${total}` : `Volume ${number}`;
}
