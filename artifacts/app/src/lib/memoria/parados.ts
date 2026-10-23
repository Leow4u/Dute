import {
  diaEmSaoPaulo,
  idadeDaCaixa,
  idadeDoItem,
  instanteValido,
  marcarSaidaNaPosicao,
  rotuloDaEtiqueta,
  type EtiquetaDeParado,
  type RegraDeParado,
  type RelogioDoItem,
  type SaidasPorPosicao,
} from "@workspace/dominio";

import type { WarehouseBox } from "../warehouse-boxes";

/**
 * Os dias parado no Estoque (docs/plataforma/fase-5-memoria.md, parte 5.4c):
 * o item do estoque que a rotina do núcleo grava em `ai_stock_age` e a idade
 * dele e das caixas dele hoje, pela regra do modelo do cliente
 * (lib/dominio/src/parados.ts). A tela só lê e mostra.
 */

export type ItemParadoLido = {
  skuCode: string;
  saldo: number;
  relogio: RelogioDoItem;
  saidasPorPosicao: SaidasPorPosicao;
};

export type GiroDoItem = {
  relogio: RelogioDoItem;
  diasParado: number | null;
  etiquetas: EtiquetaDeParado[];
  /** "Parado 90+ dias" e "Sem giro", na ordem das etiquetas. */
  rotulos: string[];
};

export type CaixaParada = {
  code: string;
  posicao: string;
  diasParado: number | null;
  parada: boolean;
};

type Registro = Record<string, unknown>;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function registro(valor: unknown): Registro {
  return valor && typeof valor === "object" ? (valor as Registro) : {};
}

/** O item gravado pela rotina; null sem SKU. */
export function itemParadoLido(dados: Registro): ItemParadoLido | null {
  const skuCode = texto(dados.sku_code);
  if (!skuCode) return null;
  const relogio = registro(dados.relogio);
  const saldo = Number(dados.saldo);
  return {
    skuCode,
    saldo: Number.isFinite(saldo) ? saldo : 0,
    relogio: {
      primeira_entrada: instanteValido(relogio.primeira_entrada),
      ultima_entrada: instanteValido(relogio.ultima_entrada),
      ultima_saida: instanteValido(relogio.ultima_saida),
    },
    saidasPorPosicao: Object.entries(registro(dados.saidas_por_posicao)).reduce<SaidasPorPosicao>(
      (saidas, [posicao, em]) => marcarSaidaNaPosicao(saidas, posicao, em),
      {},
    ),
  };
}

/** O dia de hoje em São Paulo. */
export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  return diaEmSaoPaulo(agora.toISOString()) ?? agora.toISOString().slice(0, 10);
}

/** O giro de cada SKU hoje, pela regra. */
export function giroPorSku(itens: readonly ItemParadoLido[], regra: RegraDeParado, hoje: string): Map<string, GiroDoItem> {
  return new Map(
    itens.map((item) => {
      const idade = idadeDoItem(item.relogio, item.saldo, regra, hoje);
      return [
        item.skuCode,
        {
          relogio: item.relogio,
          diasParado: idade.dias_parado,
          etiquetas: idade.etiquetas,
          rotulos: idade.etiquetas.map((etiqueta) => rotuloDaEtiqueta(etiqueta, regra)),
        },
      ];
    }),
  );
}

/** As caixas guardadas com o SKU, com a idade de cada uma; as paradas primeiro. */
export function caixasDoSku(
  skuCode: string,
  caixas: readonly Pick<WarehouseBox, "code" | "status" | "location_id" | "sku_codes" | "stored_at">[],
  itens: ReadonlyMap<string, ItemParadoLido>,
  regra: RegraDeParado,
  hoje: string,
): CaixaParada[] {
  return caixas
    .filter((caixa) => caixa.status === "stored" && caixa.sku_codes.includes(skuCode))
    .map((caixa) => {
      const idade = idadeDaCaixa(
        { guardada_em: caixa.stored_at, posicao: caixa.location_id, skus: caixa.sku_codes },
        (sku) => itens.get(sku)?.saidasPorPosicao,
        regra,
        hoje,
      );
      return { code: caixa.code, posicao: caixa.location_id, diasParado: idade.dias_parado, parada: idade.etiquetas.length > 0 };
    })
    .sort((a, b) => (b.diasParado ?? -1) - (a.diasParado ?? -1) || a.code.localeCompare(b.code));
}

/** "Hoje", "1 dia", "100 dias". */
export function diasEmTexto(dias: number): string {
  if (dias <= 0) return "Hoje";
  return dias === 1 ? "1 dia" : `${new Intl.NumberFormat("pt-BR").format(dias)} dias`;
}

/** "12/07/2026", no dia de São Paulo; sem data, "—". */
export function dataDoRelogio(instante: string | null): string {
  const dia = diaEmSaoPaulo(instante);
  if (!dia) return "—";
  const [ano, mes, data] = dia.split("-");
  return `${data}/${mes}/${ano}`;
}
