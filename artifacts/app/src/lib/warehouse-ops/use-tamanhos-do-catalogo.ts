import { useMemo } from "react";

import { useCatalogoDeSkus } from "@/lib/use-item-photos";

import { tamanhosDoCatalogo, type TamanhosDoCatalogo } from "./tamanho-do-catalogo";

/** O cadastro que não pôde ser lido: os volumes saem sem o tamanho dele, como antes, em vez de ficar carregando. */
const SEM_TAMANHOS: TamanhosDoCatalogo = new Map();

/**
 * O Tamanho dos SKUs, do mesmo cadastro (e do mesmo cache) que as fotos dos
 * itens leem na fila de Pedidos e na bancada: quem vem de lá não lê de novo.
 * Undefined enquanto a primeira leitura não volta; se ela falha, vazio.
 */
export function useTamanhosDoCatalogo(ligado = true): TamanhosDoCatalogo | undefined {
  const catalogo = useCatalogoDeSkus(ligado);
  const skus = catalogo.data?.items;
  const falhou = catalogo.isError;
  return useMemo(() => (skus ? tamanhosDoCatalogo(skus) : falhou ? SEM_TAMANHOS : undefined), [skus, falhou]);
}
