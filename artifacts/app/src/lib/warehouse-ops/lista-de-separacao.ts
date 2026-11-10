import { nomeComTamanho, nomeSemTamanho, ordemDoTamanho, tamanhoDoCodigo } from "@workspace/dominio";

import type { WarehouseTaskItem } from "./model";

/**
 * A lista de separação do pedido (docs/plataforma/separacao-com-caixas.md,
 * parte 1; docs/mockups/WmsSepararLista.dc.html): as linhas por prateleira, na
 * ordem de caminhada do cadastro de Posições, e a caixa onde cada item está.
 * Só leitura: nada aqui baixa saldo nem conteúdo de caixa.
 */

export type PosicaoDaLista = { code: string; sequence?: number | null };

/** O que a lista lê da caixa: onde está, de quem é e quais SKUs entraram nela. */
export type CaixaDaLista = {
  code: string;
  customer_code: string;
  status: string;
  location_id: string;
  sku_codes: string[];
  stored_at: string | null;
};

export type LinhaDaLista = {
  id: string;
  nome: string;
  codigos: string;
  quantidade: number;
  /** As caixas guardadas na prateleira que têm o item, a mais antiga primeiro. */
  caixas: string[];
  item: WarehouseTaskItem;
};

export type GrupoDaLista = {
  /** A prateleira; "" na linha sem endereço. */
  posicao: string;
  itens: number;
  unidades: number;
  linhas: LinhaDaLista[];
};

const numero = new Intl.NumberFormat("pt-BR");

function texto(valor: unknown): string {
  return String(valor ?? "").trim();
}

function chave(valor: unknown): string {
  return texto(valor).toUpperCase();
}

/** "A.01.0806.005.GG · BTG-000125": o código do cliente e o SKU, o que existir, sem repetir. */
export function codigosDoItem(item: WarehouseTaskItem): string {
  const codigos = [item.client_item_code, item.sku_code ?? item.sku].map(texto).filter(Boolean);
  return [...new Set(codigos)].join(" · ");
}

export function quantidadeDoItem(item: WarehouseTaskItem): number {
  return Number(item.expected_quantity ?? item.quantity ?? 0) || 0;
}

/** "5 itens · 450 un.": o que o cabeçalho da prateleira diz. */
export function resumoDoGrupo(grupo: Pick<GrupoDaLista, "itens" | "unidades">): string {
  return `${numero.format(grupo.itens)} ${grupo.itens === 1 ? "item" : "itens"} · ${numero.format(grupo.unidades)} un.`;
}

/**
 * As caixas guardadas na prateleira da linha que receberam o SKU dela, do
 * cliente do pedido, a mais antiga primeiro (a data da guarda; no empate, o
 * código). É o conteúdo de entrada: a separação ainda não baixa a caixa.
 */
export function caixasDoItem(item: WarehouseTaskItem, caixas: readonly CaixaDaLista[], cliente?: string | null): string[] {
  const posicao = chave(item.location);
  const sku = chave(item.sku_code ?? item.sku);
  if (!posicao || !sku) return [];
  const dono = chave(cliente);
  return caixas
    .filter(
      (caixa) =>
        caixa.status === "stored" &&
        chave(caixa.location_id) === posicao &&
        (!dono || chave(caixa.customer_code) === dono) &&
        caixa.sku_codes.some((codigo) => chave(codigo) === sku),
    )
    .sort((esquerda, direita) => porGuarda(esquerda.stored_at, direita.stored_at) || esquerda.code.localeCompare(direita.code, "pt-BR", { numeric: true }))
    .map((caixa) => caixa.code);
}

/** A data da guarda é um instante ISO: compara como texto; a caixa sem data fica depois. */
function porGuarda(esquerda: string | null, direita: string | null): number {
  const antes = esquerda || "￿";
  const depois = direita || "￿";
  return antes < depois ? -1 : antes > depois ? 1 : 0;
}

/**
 * As linhas do pedido por prateleira. As prateleiras vêm na ordem de
 * caminhada (`sequence` do cadastro); a que não está no cadastro vem depois,
 * em ordem alfabética, e a linha sem endereço fica no fim. Dentro da
 * prateleira: a caixa, depois o produto com os tamanhos em ordem e, no
 * empate, a linha do pedido (pelo número, para a 100 não vir depois da 10).
 */
export function gruposDaSeparacao(
  itens: readonly WarehouseTaskItem[],
  posicoes: readonly PosicaoDaLista[] = [],
  opcoes: { caixas?: readonly CaixaDaLista[]; cliente?: string | null } = {},
): GrupoDaLista[] {
  const sequencias = new Map(posicoes.flatMap((posicao) => (posicao.sequence == null ? [] : [[chave(posicao.code), Number(posicao.sequence)] as const])));
  const grupos = new Map<string, Array<LinhaDaLista & { ordem: number; familia: string; tamanho: number }>>();
  itens.forEach((item, indice) => {
    const posicao = texto(item.location);
    const codigo = item.client_item_code;
    const nome = item.name ?? item.product_name;
    const linha = {
      id: texto(item.id) || `linha-${indice}`,
      nome: nomeComTamanho({ nome, codigo, tamanho: item.size }),
      codigos: codigosDoItem(item),
      quantidade: quantidadeDoItem(item),
      caixas: opcoes.caixas ? caixasDoItem(item, opcoes.caixas, opcoes.cliente) : [],
      item,
      ordem: Number(item.line_number) || indice + 1,
      familia: nomeSemTamanho({ nome, codigo, tamanho: item.size }),
      tamanho: ordemDoTamanho(texto(item.size) || tamanhoDoCodigo(codigo)),
    };
    grupos.set(posicao, [...(grupos.get(posicao) ?? []), linha]);
  });

  const camada = (posicao: string) => (!posicao ? 2 : sequencias.has(chave(posicao)) ? 0 : 1);
  return [...grupos.entries()]
    .sort(([esquerda], [direita]) => {
      const porCamada = camada(esquerda) - camada(direita);
      if (porCamada) return porCamada;
      const porSequencia = (sequencias.get(chave(esquerda)) ?? 0) - (sequencias.get(chave(direita)) ?? 0);
      return porSequencia || esquerda.localeCompare(direita, "pt-BR", { numeric: true });
    })
    .map(([posicao, linhas]) => ({
      posicao,
      itens: linhas.length,
      unidades: linhas.reduce((soma, linha) => soma + linha.quantidade, 0),
      linhas: [...linhas]
        .sort(
          (esquerda, direita) =>
            (esquerda.caixas[0] ?? "￿").localeCompare(direita.caixas[0] ?? "￿", "pt-BR", { numeric: true }) ||
            esquerda.familia.localeCompare(direita.familia, "pt-BR", { numeric: true }) ||
            esquerda.tamanho - direita.tamanho ||
            esquerda.ordem - direita.ordem,
        )
        .map(({ ordem: _ordem, familia: _familia, tamanho: _tamanho, ...linha }) => linha),
    }));
}
