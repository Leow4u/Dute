import type { CaixaDaLinha } from "@workspace/dominio";

import type { LinhaDaLista } from "./lista-de-separacao";
import type { WarehouseTaskItem } from "./model";
import { estadoDaLinha } from "./separacao";
import { pesoDigitado, type VolumeDaTarefa } from "./volumes-do-pedido";

/**
 * "Dividir em volumes" (docs/plataforma/separacao-com-caixas.md, seção 11;
 * decisões 27 a 30 de 11/11/2026; docs/mockups/WmsDividirVolumes.dc.html,
 * WmsDividirComItens.dc.html e WmsDividirCelular.dc.html): a linha que não
 * cabe num volume se reparte em dois ou mais, a partir do volume aberto.
 * Cada volume do diálogo, menos o último, fecha ao confirmar, com o peso
 * opcional no computador; o último fica aberto, com o resto, para as
 * próximas linhas. Na linha por separar, o diálogo separa e divide; na já
 * separada (decisão 30), só divide o que ela pôs no volume aberto.
 *
 * Aqui fica a conta da tela, sem banco: os números que o servidor vai dar,
 * as linhas do começo (um volume por caixa de onde a linha sai, decisão 27)
 * e a edição em que a soma sempre fecha (decisão 28). Quem divide e grava é
 * o servidor (functions/wms, domain/pick-progress.ts, `split_volumes`), que
 * confere tudo de novo.
 */

/** De 2 a 20 volumes de uma vez, como o servidor (pick-progress.ts). */
export const PARTES_DA_DIVISAO_MAXIMO = 20;

/** "separar": a linha por separar, pelo "⋯"; "dividir": a já separada, no volume aberto (decisão 30). */
export type ModoDaDivisao = "separar" | "dividir";

/** Uma linha do diálogo, um volume. A última fica aberta; as outras fecham. */
export type ParteDaDivisao = {
  quantidade: number;
  /** O que a pessoa está digitando; null fora da digitação. */
  texto: string | null;
  /** O peso digitado, só nos volumes que fecham. */
  peso: string;
};

/** O volume aberto como a tarefa o guarda; sem ele, o seguinte, ainda sem id. */
export type AbertoDaDivisao = {
  id: string | null;
  numero: number;
  /** As unidades gravadas nele (`pick_tasks.volumes[].units`). */
  unidades: number;
  /** As unidades das outras linhas nele. */
  outros: number;
};

export type DivisaoEmVolumes = {
  /** A linha da separação (pick_lines). */
  id: string;
  modo: ModoDaDivisao;
  nome: string;
  posicao: string;
  /** O que se divide: a linha toda, por separar; o que a já separada tem no volume aberto. */
  total: number;
  /**
   * As caixas de onde a linha sai (a sugestão) ou saiu (as gravadas, só
   * quando são o que se divide).
   */
  caixas: CaixaDaLinha[];
  /** A linha como a página a leu: o `separated_at` dela; null na linha por separar. */
  separadaEm: string | null;
  aberto: AbertoDaDivisao;
  /** O maior número entre os volumes da tarefa: os volumes novos vêm depois dele. */
  maior: number;
  /** Todas as linhas do diálogo; a última é o volume que fica aberto. */
  partes: ParteDaDivisao[];
};

/** O que a callable recebe com a divisão (`setPickLineSeparated`, parte 7a). */
export type PedidoDaDivisao = {
  split_volumes: Array<{ number: number; qty: number; weight_kg?: number }>;
  open_volume_id: string | null;
  open_volume_units: number;
  line_separated_at: string | null;
};

const numero = new Intl.NumberFormat("pt-BR");

function unidades(valor: number): string {
  return `${numero.format(valor)} un.`;
}

function soma(valores: readonly number[]): number {
  return valores.reduce((total, valor) => total + valor, 0);
}

function parte(quantidade: number): ParteDaDivisao {
  return { quantidade, texto: null, peso: "" };
}

function copia(partes: readonly ParteDaDivisao[]): ParteDaDivisao[] {
  return partes.map((linha) => ({ ...linha }));
}

/** O que a linha separada tem no volume aberto da tarefa; sem volume aberto, 0. */
export function unidadesNoVolumeAberto(item: Pick<WarehouseTaskItem, "separated_volumes">, volumes: readonly Pick<VolumeDaTarefa, "id" | "status">[]): number {
  const aberto = volumes.find((volume) => volume.status === "open");
  if (!aberto) return 0;
  return soma((item.separated_volumes ?? []).filter((entrada) => entrada.volume_id === aberto.id).map((entrada) => entrada.qty));
}

/**
 * As linhas já separadas que ganham "Dividir em volumes" (decisão 30):
 * enquanto o que elas puseram no volume aberto tem 2 un. ou mais.
 */
export function separadasParaDividir(linhas: readonly Pick<LinhaDaLista, "id" | "item">[], volumes: readonly VolumeDaTarefa[]): Set<string> {
  return new Set(linhas.filter((linha) => estadoDaLinha(linha.item) !== "pendente" && unidadesNoVolumeAberto(linha.item, volumes) >= 2).map((linha) => linha.id));
}

/**
 * As linhas do começo (decisão 27): um volume por fonte da linha, na ordem
 * (caixa por caixa e, por último, o que sai sem caixa); com uma fonte só, ao
 * meio. Passando de 20 fontes, as que sobram vão juntas no último volume.
 */
export function partesDoComeco(total: number, fontes: readonly number[]): ParteDaDivisao[] {
  const validas = fontes.filter((fonte) => Number.isInteger(fonte) && fonte >= 1);
  const porFonte = validas.length >= 2 && soma(validas) === total;
  const juntas =
    validas.length > PARTES_DA_DIVISAO_MAXIMO ? [...validas.slice(0, PARTES_DA_DIVISAO_MAXIMO - 1), soma(validas.slice(PARTES_DA_DIVISAO_MAXIMO - 1))] : validas;
  return (porFonte ? juntas : [Math.ceil(total / 2), Math.floor(total / 2)]).map(parte);
}

/**
 * De onde a linha sai. Na linha por separar, a sugestão do sistema: as
 * caixas e o que as caixas da prateleira não cobrem. Na já separada, as
 * caixas gravadas, quando somam o que se divide; senão (a separada a menos,
 * o resto de "Levar a caixa"), uma fonte só.
 */
function fontesDaLinha(modo: ModoDaDivisao, total: number, caixas: readonly CaixaDaLinha[]): number[] {
  const dasCaixas = caixas.map((caixa) => caixa.qty);
  const nasCaixas = soma(dasCaixas);
  if (modo === "separar") return nasCaixas <= total ? [...dasCaixas, total - nasCaixas].filter((qty) => qty > 0) : [total];
  return nasCaixas === total ? dasCaixas : [total];
}

/** As linhas fecham com o que se divide: de 2 a 20, cada uma com 1 un. ou mais, e a soma igual. */
export function partesFecham(partes: readonly Pick<ParteDaDivisao, "quantidade">[], total: number): boolean {
  return (
    partes.length >= 2 &&
    partes.length <= PARTES_DA_DIVISAO_MAXIMO &&
    partes.every((linha) => Number.isInteger(linha.quantidade) && linha.quantidade >= 1) &&
    soma(partes.map((linha) => linha.quantidade)) === total
  );
}

/**
 * A divisão de uma linha, a partir dos volumes como a tarefa os guarda
 * (`pick_tasks.volumes`, com as unidades gravadas). As linhas do diálogo
 * ficam como estão; a linha, o volume aberto, o que as outras linhas têm
 * nele e os números são os de agora: depois de "Os volumes mudaram", o
 * diálogo mostra o novo estado com as mesmas quantidades. Sem `partes`, as
 * do começo. Null quando não há o que dividir: menos de 2 un., a linha que
 * outra pessoa separou ou desfez, ou linhas que não fecham mais.
 */
export function divisaoDaLinha(entrada: {
  linha: Pick<LinhaDaLista, "id" | "nome" | "codigos" | "quantidade" | "item">;
  modo: ModoDaDivisao;
  volumes: readonly VolumeDaTarefa[];
  /** Na linha por separar, a sugestão do sistema; na já separada, as caixas gravadas. */
  caixas?: readonly CaixaDaLinha[] | null;
  partes?: readonly ParteDaDivisao[] | null;
}): DivisaoEmVolumes | null {
  const { linha, modo, volumes } = entrada;
  if ((estadoDaLinha(linha.item) === "pendente") !== (modo === "separar")) return null;
  const aberto = volumes.find((volume) => volume.status === "open");
  const maior = Math.max(0, ...volumes.map((volume) => volume.number));
  const daLinha = modo === "dividir" ? unidadesNoVolumeAberto(linha.item, volumes) : 0;
  const total = modo === "separar" ? linha.quantidade : daLinha;
  if (!Number.isInteger(total) || total < 2) return null;
  if (entrada.partes && !partesFecham(entrada.partes, total)) return null;
  const dadas = [...(entrada.caixas ?? [])];
  // Na já separada, as caixas gravadas são da linha toda: só ficam quando somam o que se divide, senão desmentiriam o total.
  const caixas = modo === "dividir" && soma(dadas.map((caixa) => caixa.qty)) !== total ? [] : dadas;
  return {
    id: linha.id,
    modo,
    nome: linha.nome || linha.codigos,
    posicao: String(linha.item.location ?? "").trim(),
    total,
    caixas,
    separadaEm: modo === "dividir" ? String(linha.item.separated_at ?? "") || null : null,
    aberto: aberto
      ? { id: aberto.id, numero: aberto.number, unidades: aberto.units, outros: Math.max(0, aberto.units - daLinha) }
      : { id: null, numero: maior + 1, unidades: 0, outros: 0 },
    maior,
    partes: entrada.partes ? copia(entrada.partes) : partesDoComeco(total, fontesDaLinha(modo, total, caixas)),
  };
}

/**
 * Os números que o servidor dá às partes (order-volumes.ts,
 * `porNoVolumeAberto`): a primeira entra no volume aberto, e as outras abrem
 * os seguintes, depois do maior número da tarefa. Sem volume aberto, todas
 * vêm depois do maior.
 */
export function numerosDaDivisao(divisao: Pick<DivisaoEmVolumes, "aberto" | "maior" | "partes">): number[] {
  return divisao.partes.map((_linha, indice) => (divisao.aberto.id ? (indice === 0 ? divisao.aberto.numero : divisao.maior + indice) : divisao.maior + 1 + indice));
}

/** A linha que acompanha a mudança (decisão 28): a última; mudando a última, a de cima. */
function queAcompanha(partes: readonly unknown[], indice: number): number {
  const ultima = partes.length - 1;
  return indice === ultima ? ultima - 1 : ultima;
}

/** Muda a linha no lugar: entre 1 e o que ela e a que acompanha têm juntas, menos 1; a que acompanha leva a diferença. */
function definir(partes: ParteDaDivisao[], indice: number, quantidade: number) {
  const outra = queAcompanha(partes, indice);
  const atual = partes[indice]!;
  const acompanha = partes[outra]!;
  const nova = Math.max(1, Math.min(atual.quantidade + acompanha.quantidade - 1, Math.floor(quantidade)));
  acompanha.quantidade -= nova - atual.quantidade;
  acompanha.texto = null;
  atual.quantidade = nova;
}

function existe(partes: readonly unknown[], indice: number): boolean {
  return partes.length >= 2 && Number.isInteger(indice) && indice >= 0 && indice < partes.length;
}

/** "−" e "+": uma unidade a menos ou a mais; a que acompanha leva a diferença. */
export function passoDaParte(partes: readonly ParteDaDivisao[], indice: number, passo: number): ParteDaDivisao[] {
  const novas = copia(partes);
  if (!existe(novas, indice)) return novas;
  definir(novas, indice, novas[indice]!.quantidade + passo);
  novas[indice]!.texto = null;
  return novas;
}

/**
 * Digitando: o campo guarda os dígitos, e a quantidade muda quando eles dão
 * 1 un. ou mais (no limite da linha). Ao sair do campo, `normalizarParte`.
 */
export function digitarParte(partes: readonly ParteDaDivisao[], indice: number, valor: string): ParteDaDivisao[] {
  const novas = copia(partes);
  if (!existe(novas, indice)) return novas;
  const digitos = String(valor ?? "").replace(/\D/g, "");
  novas[indice]!.texto = digitos;
  novas[queAcompanha(novas, indice)]!.texto = null;
  const quantidade = Number.parseInt(digitos, 10);
  if (quantidade >= 1) definir(novas, indice, quantidade);
  return novas;
}

/** Fora do campo, ele volta a mostrar a quantidade. */
export function normalizarParte(partes: readonly ParteDaDivisao[], indice: number): ParteDaDivisao[] {
  const novas = copia(partes);
  if (existe(novas, indice)) novas[indice]!.texto = null;
  return novas;
}

/** O peso de um volume que fecha. */
export function pesarParte(partes: readonly ParteDaDivisao[], indice: number, peso: string): ParteDaDivisao[] {
  const novas = copia(partes);
  if (existe(novas, indice) && indice < novas.length - 1) novas[indice]!.peso = peso;
  return novas;
}

/** "−" desliga em 1 un. */
export function semMenos(partes: readonly ParteDaDivisao[], indice: number): boolean {
  return !existe(partes, indice) || partes[indice]!.quantidade <= 1;
}

/** "+" desliga quando a linha que acompanha está em 1 un. */
export function semMais(partes: readonly ParteDaDivisao[], indice: number): boolean {
  return !existe(partes, indice) || partes[queAcompanha(partes, indice)]!.quantidade <= 1;
}

/** "Mais um volume": com o último em 2 un. ou mais e menos de 20 volumes. */
export function podeMaisUmVolume(partes: readonly ParteDaDivisao[]): boolean {
  return partes.length >= 2 && partes.length < PARTES_DA_DIVISAO_MAXIMO && partes[partes.length - 1]!.quantidade >= 2;
}

/**
 * "Mais um volume": um volume que fecha, logo antes do último, com a
 * quantidade do de cima, se o último continua com 1 un. ou mais; senão, a
 * metade do último. O último perde o que o novo leva.
 */
export function maisUmVolume(partes: readonly ParteDaDivisao[]): ParteDaDivisao[] {
  const novas = copia(partes);
  if (!podeMaisUmVolume(novas)) return novas;
  const ultima = novas[novas.length - 1]!;
  const acima = novas[novas.length - 2]!.quantidade;
  const quantidade = acima <= ultima.quantidade - 1 ? acima : Math.floor(ultima.quantidade / 2);
  ultima.quantidade -= quantidade;
  ultima.texto = null;
  novas.splice(novas.length - 1, 0, parte(quantidade));
  return novas;
}

/** A lixeira: só nos volumes entre o primeiro e o último. */
export function podeTirarVolume(partes: readonly ParteDaDivisao[], indice: number): boolean {
  return Number.isInteger(indice) && indice > 0 && indice < partes.length - 1;
}

/** "Tirar o volume 17": o que ele tinha vai para o último. */
export function tirarVolume(partes: readonly ParteDaDivisao[], indice: number): ParteDaDivisao[] {
  const novas = copia(partes);
  if (!podeTirarVolume(novas, indice)) return novas;
  const [tirada] = novas.splice(indice, 1);
  const ultima = novas[novas.length - 1]!;
  ultima.quantidade += tirada!.quantidade;
  ultima.texto = null;
  return novas;
}

/** O peso digitado não vale (o vazio vale: o peso é opcional, decisão 15). */
export function pesoInvalido(linha: Pick<ParteDaDivisao, "peso">): boolean {
  return pesoDigitado(linha.peso) === null;
}

/** Confirmar liga com as linhas fechando com o que se divide e sem peso inválido nos volumes que fecham. */
export function podeConfirmarADivisao(divisao: Pick<DivisaoEmVolumes, "partes" | "total">): boolean {
  return partesFecham(divisao.partes, divisao.total) && divisao.partes.slice(0, -1).every((linha) => !pesoInvalido(linha));
}

/** "Polo Masculino Piquet Preto · M · A-07 · 95 un."; sem prateleira, sem o separador sobrando. */
export function subtituloDaDivisao(divisao: Pick<DivisaoEmVolumes, "nome" | "posicao" | "total">): string {
  return [divisao.nome, divisao.posicao || null, unidades(divisao.total)].filter(Boolean).join(" · ");
}

/**
 * O que a linha diz embaixo do volume: o primeiro, com o volume aberto já
 * com itens, "tem 35 un. · fecha com 55 un."; os outros que fecham, "fecha";
 * o último, nada (o nome leva "aberto").
 */
export function textoDaParte(divisao: Pick<DivisaoEmVolumes, "aberto" | "partes">, indice: number): string | null {
  if (indice < 0 || indice >= divisao.partes.length - 1) return null;
  const { outros } = divisao.aberto;
  if (indice === 0 && outros > 0) return `tem ${unidades(outros)} · fecha com ${unidades(outros + divisao.partes[0]!.quantidade)}`;
  return "fecha";
}

/** "Separar em 2 volumes" na linha por separar; "Dividir em 2 volumes" na já separada. */
export function textoDoBotaoDaDivisao(modo: ModoDaDivisao, volumes: number, confirmando = false): string {
  if (confirmando) return modo === "separar" ? "Separando..." : "Dividindo...";
  return `${modo === "separar" ? "Separar" : "Dividir"} em ${numero.format(volumes)} volumes`;
}

/** "Volume 16 fechado", "Volumes 16 e 17 fechados", "Volumes 16, 17 e 18 fechados"; sem volume, null. */
export function textoDosVolumesFechados(fechados: ReadonlyArray<{ number: number }>): string | null {
  const numeros = [...fechados].sort((esquerda, direita) => esquerda.number - direita.number).map((volume) => numero.format(volume.number));
  if (!numeros.length) return null;
  if (numeros.length === 1) return `Volume ${numeros[0]} fechado`;
  return `Volumes ${numeros.slice(0, -1).join(", ")} e ${numeros[numeros.length - 1]} fechados`;
}

/**
 * O pedido da divisão (`split_volumes`, parte 7a): as linhas com o número
 * que o diálogo mostrou e, nos volumes que fecham, o peso válido; o volume
 * aberto como a tarefa o guarda (as unidades gravadas, que na linha já
 * separada incluem as dela); e a linha como a página a leu. O peso vazio
 * não vai: o campo sem valor chegaria como null, e o servidor o recusa.
 */
export function pedidoDaDivisao(divisao: DivisaoEmVolumes): PedidoDaDivisao {
  const numeros = numerosDaDivisao(divisao);
  const ultima = divisao.partes.length - 1;
  return {
    split_volumes: divisao.partes.map((linha, indice) => {
      const peso = indice < ultima ? pesoDigitado(linha.peso) : undefined;
      return { number: numeros[indice]!, qty: linha.quantidade, ...(typeof peso === "number" ? { weight_kg: peso } : {}) };
    }),
    open_volume_id: divisao.aberto.id,
    open_volume_units: divisao.aberto.unidades,
    line_separated_at: divisao.modo === "dividir" ? divisao.separadaEm : null,
  };
}
