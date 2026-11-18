import { nomeComTamanho } from "@workspace/dominio";

import {
  RODADA_DA_RECONTAGEM_GERAL,
  ROTA_DA_RODADA,
  dataCurta,
  unidadesComSinal,
  type AlcanceDaRodada,
  type Momento,
  type RodadaDaContagem,
  type RodadaDaRecontagem,
} from "./recontagem-por-caixa";

/**
 * O registro da rodada da contagem (docs/superpowers/specs/2026-11-18-registro-da-rodada-design.md):
 * o documento de `count_rounds` (functions/wms, domain/count-rounds.ts) como
 * a tela o lê, a rodada aberta do cliente (ou a recontagem geral de 17/11
 * sem documento, que vale como aberta até "Concluir contagem" criar o
 * documento dela), as anteriores e os textos de "Anteriores" e do "Concluir
 * contagem". Funções puras, sem Firestore.
 */

const numero = new Intl.NumberFormat("pt-BR");

function texto(valor: unknown): string {
  return String(valor ?? "").trim();
}

function chave(valor: unknown): string {
  return texto(valor).toUpperCase();
}

function quantidade(valor: unknown): number {
  const lido = Number(valor ?? 0);
  return Number.isFinite(lido) ? lido : 0;
}

/** Os números do fechamento, como o servidor os gravou. */
export type NumerosDaRodada = {
  prateleiras: number;
  prateleirasContadas: number;
  caixas: number;
  caixasConfirmadas: number;
  caixasComDiferenca: number;
  diferenca: number;
};

/** Uma rodada registrada em `count_rounds`: aberta ou concluída. */
export type RodadaRegistrada = RodadaDaRecontagem & {
  cliente: string;
  status: "aberta" | "concluida";
  fim: Momento | null;
  /** Só a concluída tem os números. */
  numeros: NumerosDaRodada | null;
};

/** Quando e quem, do par `*_at` e `*_by` do documento; null sem instante válido. */
function momento(quando: unknown, quem: unknown): Momento | null {
  const instante = texto(quando);
  if (!instante || Number.isNaN(new Date(instante).getTime())) return null;
  const pessoa = quem && typeof quem === "object" ? (quem as Record<string, unknown>) : {};
  return { quando: instante, quem: texto(pessoa.name) || texto(pessoa.email) };
}

/** O alcance gravado: `scope`, `aisle`, `sku_code` e o nome do item (`item`). */
function alcanceDoDocumento(data: Record<string, unknown>): AlcanceDaRodada {
  const scope = texto(data.scope);
  if (scope === "aisle") return { tipo: "rua", rua: chave(data.aisle) };
  if (scope === "item") {
    const sku = chave(data.sku_code);
    const item = data.item && typeof data.item === "object" ? (data.item as Record<string, unknown>) : {};
    const nome = nomeComTamanho({ nome: texto(item.product_name), codigo: texto(item.client_item_code), tamanho: texto(item.size) || null });
    return { tipo: "item", sku, nome: nome || sku };
  }
  return { tipo: "geral" };
}

/** O documento de `count_rounds` como a tela o lê; null sem o cliente ou com status desconhecido. */
export function rodadaRegistrada(id: string, data: Record<string, unknown>): RodadaRegistrada | null {
  const cliente = texto(data.customer_code);
  const status = texto(data.status);
  if (!cliente || (status !== "open" && status !== "closed")) return null;
  const concluida = status === "closed";
  return {
    id,
    cliente,
    titulo: texto(data.title) || id,
    alcance: alcanceDoDocumento(data),
    status: concluida ? "concluida" : "aberta",
    inicio: momento(data.started_at, data.started_by),
    fim: concluida ? momento(data.closed_at, data.closed_by) : null,
    numeros: concluida
      ? {
          prateleiras: quantidade(data.shelves_total),
          prateleirasContadas: quantidade(data.shelves_counted),
          caixas: quantidade(data.boxes_total),
          caixasConfirmadas: quantidade(data.boxes_counted),
          caixasComDiferenca: quantidade(data.boxes_with_difference),
          diferenca: quantidade(data.difference_units),
        }
      : null,
  };
}

/**
 * A rodada aberta do cliente: a registrada aberta de começo mais recente;
 * sem ela, a recontagem geral de 17/11 enquanto não tem documento e tem
 * recontagem gravada com o id fixo (`legadaTemRecontagem`); senão, nenhuma.
 */
export function rodadaAberta(registradas: readonly RodadaRegistrada[], cliente: string | null | undefined, legadaTemRecontagem: boolean): RodadaDaRecontagem | null {
  const dono = texto(cliente);
  if (!dono) return null;
  const doCliente = registradas.filter((rodada) => rodada.cliente === dono);
  const abertas = doCliente.filter((rodada) => rodada.status === "aberta").sort((esquerda, direita) => (direita.inicio?.quando ?? "").localeCompare(esquerda.inicio?.quando ?? ""));
  if (abertas[0]) return abertas[0];
  if (legadaTemRecontagem && !doCliente.some((rodada) => rodada.id === RODADA_DA_RECONTAGEM_GERAL.id)) return RODADA_DA_RECONTAGEM_GERAL;
  return null;
}

/** As rodadas concluídas do cliente, a de fim mais recente primeiro. */
export function anterioresDaContagem(registradas: readonly RodadaRegistrada[], cliente: string | null | undefined): RodadaRegistrada[] {
  const dono = texto(cliente);
  return registradas
    .filter((rodada) => Boolean(dono) && rodada.cliente === dono && rodada.status === "concluida")
    .sort((esquerda, direita) => (direita.fim?.quando ?? "").localeCompare(esquerda.fim?.quando ?? "") || esquerda.id.localeCompare(direita.id));
}

/** "17/11 a 21/11 · Guilherme Dantas"; no mesmo dia, "21/11 · Guilherme Dantas"; sem fim, "". */
export function periodoDaRodada(rodada: Pick<RodadaRegistrada, "inicio" | "fim">): string {
  if (!rodada.fim) return "";
  const comeco = rodada.inicio ? dataCurta(rodada.inicio.quando) : "";
  const termino = dataCurta(rodada.fim.quando);
  const datas = comeco && comeco !== termino ? `${comeco} a ${termino}` : termino;
  return [datas, rodada.fim.quem].filter(Boolean).join(" · ");
}

function plural(qty: number, singular: string, varios: string): string {
  return `${numero.format(qty)} ${qty === 1 ? singular : varios}`;
}

/**
 * "5 prateleiras · 6 caixas · 1 com diferença · −3 un."; com prateleira por
 * contar, "4 de 5 prateleiras · 5 de 6 caixas · …"; sem caixa com diferença,
 * "sem diferença". A mesma frase do servidor (count-rounds.ts).
 */
export function numerosDaRodadaConcluida(numeros: NumerosDaRodada): string {
  const contadas = (feitas: number, total: number, singular: string, varios: string) => (feitas === total ? plural(total, singular, varios) : `${numero.format(feitas)} de ${plural(total, singular, varios)}`);
  const diferenca = numeros.caixasComDiferenca ? `${numero.format(numeros.caixasComDiferenca)} com diferença · ${unidadesComSinal(numeros.diferenca)}` : "sem diferença";
  return [contadas(numeros.prateleirasContadas, numeros.prateleiras, "prateleira", "prateleiras"), contadas(numeros.caixasConfirmadas, numeros.caixas, "caixa", "caixas"), diferenca].join(" · ");
}

/** "3 prateleiras por contar ficam fora." no "Concluir contagem"; null com tudo contado. */
export function avisoDasPorContar(rodada: Pick<RodadaDaContagem, "prateleiras" | "prateleirasContadas">): string | null {
  const faltam = rodada.prateleiras - rodada.prateleirasContadas;
  if (faltam <= 0) return null;
  return faltam === 1 ? "1 prateleira por contar fica fora." : `${numero.format(faltam)} prateleiras por contar ficam fora.`;
}

/** O endereço da Contagem por caixa de uma rodada (o "Ver" das anteriores). */
export function hrefDaRodada(id: string): string {
  return `${ROTA_DA_RODADA}?rodada=${encodeURIComponent(id)}`;
}

/** A rodada da busca (`?rodada=cr_1`); sem ela, null. */
export function rodadaDaBusca(busca: string): string | null {
  return texto(new URLSearchParams(busca).get("rodada")) || null;
}

/** O que a pessoa escolhe em "Iniciar contagem". */
export type EscolhaDoAlcance = { tipo: "geral" } | { tipo: "rua"; rua: string } | { tipo: "item"; sku: string };

/** A entrada de `startCountRound` (functions/wms, count-rounds.ts), sem campo vazio. */
export type EntradaDoInicio = { customer_code: string; scope: "general" } | { customer_code: string; scope: "aisle"; aisle: string } | { customer_code: string; scope: "item"; sku_code: string };

export function entradaDoInicio(cliente: string, escolha: EscolhaDoAlcance): EntradaDoInicio {
  if (escolha.tipo === "rua") return { customer_code: cliente, scope: "aisle", aisle: chave(escolha.rua) };
  if (escolha.tipo === "item") return { customer_code: cliente, scope: "item", sku_code: chave(escolha.sku) };
  return { customer_code: cliente, scope: "general" };
}
