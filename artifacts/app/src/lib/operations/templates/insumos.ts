import { REGRAS_DE_PARADO, regraEmTexto } from "@workspace/dominio";

import type { OperationTemplate } from "../types";

/**
 * Insumos internos: o estoque da própria Dutelog (plástico bolha, caixas,
 * fita, ferramentas) no mesmo galpão e no mesmo mapa. Sem portal e sem
 * fatura: ninguém de fora entra. Em construção: entrada, baixa por uso e
 * mínimo de estoque vêm depois do cadastro.
 */
export const insumos: OperationTemplate = {
  key: "insumos",
  label: "Insumos internos",
  summary: "Consumo da própria Dutelog: entrada, baixa por uso e mínimo de estoque. Sem portal, sem fatura.",
  status: "building",
  control: "quantity",
  portal: null,
  defines: [
    { label: "Portal", value: "Não tem: só a equipe Dutelog vê" },
    { label: "Controle", value: "Por quantidade, com mínimo de estoque" },
    { label: "Movimento", value: "Entrada por compra e baixa por uso na operação" },
    { label: "Cobrança", value: "Nenhuma" },
    { label: "Mapa", value: "Mesma zona por cliente, nas prateleiras reservadas à Dutelog" },
    { label: "Dias parado", value: regraEmTexto(REGRAS_DE_PARADO.insumos) },
  ],
  file: "lib/operations/templates/insumos.ts",
};
