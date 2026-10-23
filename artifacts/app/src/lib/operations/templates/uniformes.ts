import { REGRAS_DE_PARADO, regraEmTexto } from "@workspace/dominio";

import type { OperationTemplate } from "../types";

/**
 * Uniformes e materiais: o modelo da operação BTG, em produção desde
 * 30/07/2026. Tudo o que o sistema faz hoje é este modelo.
 */
export const uniformes: OperationTemplate = {
  key: "uniformes",
  label: "Uniformes e materiais",
  summary:
    "Quantidade por SKU, pedidos e eventos que se repetem, cobrança por posição ocupada e caixa como unidade de manuseio.",
  status: "ready",
  control: "quantity",
  portal: ["assistant", "home", "inventory", "events", "requests", "orders", "services", "invoices", "documents"],
  defines: [
    {
      label: "Portal",
      value: "Agent Dute, Início, Estoque, Eventos, Envios para a Dutelog, Pedidos, Faturas e Documentos",
    },
    { label: "Controle", value: "Por quantidade em cada SKU" },
    { label: "Cadastro do item", value: "Código do cliente, produto, gênero, grupo, tamanho e cor" },
    { label: "Pedidos", value: "Retirada por quantidade; o que se repete vira evento e volta como pedido" },
    { label: "Cobrança", value: "LPU: posição ocupada, movimentação e serviços da tabela de preços" },
    { label: "Etiqueta", value: "Caixa (CX-000001) e posição, impressas em Estoque › Etiquetas" },
    { label: "Mapa", value: "Prateleiras por zona; a caixa é a unidade de manuseio" },
    { label: "Dias parado", value: regraEmTexto(REGRAS_DE_PARADO.uniformes) },
  ],
  file: "lib/operations/templates/uniformes.ts",
};
