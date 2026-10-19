import type { OperationTemplate } from "../types";

/**
 * Mobiliário: peças com patrimônio, foto e estado de conservação (ótimo,
 * bom, ruim, danificado), guardadas em posição de piso. Em construção: o
 * cadastro já aceita o modelo e o portal já esconde o que não faz sentido
 * (Eventos); peças, estado, solicitações e LPU própria vêm nos próximos PRs.
 * Até "Solicitações" existir, o pedido genérico continua como canal.
 */
export const mobiliario: OperationTemplate = {
  key: "mobiliario",
  label: "Mobiliário",
  summary:
    "Por peça, com patrimônio, foto e estado de conservação; solicitações de retirada, devolução, manutenção e descarte; posição de piso.",
  status: "building",
  control: "piece",
  portal: ["assistant", "home", "inventory", "requests", "orders", "invoices", "documents"],
  defines: [
    {
      label: "Portal",
      value: "Agent Dute, Início, Peças, Solicitações, Recebimentos, Faturas e Documentos (sem Eventos)",
    },
    { label: "Controle", value: "Por peça, com número de patrimônio; a visibilidade agrupa por produto" },
    { label: "Cadastro da peça", value: "Tipo, marca, modelo, cor, medidas, patrimônio e estado" },
    { label: "Estado", value: "Ótimo, bom, ruim ou danificado, com foto no recebimento" },
    { label: "Solicitações", value: "Retirada para entrega, devolução, manutenção e descarte (em construção; até lá, Pedidos)" },
    { label: "Cobrança", value: "LPU do contrato: posição, peça, transporte por viagem e manutenção" },
    { label: "Etiqueta", value: "Peça com patrimônio e foto; volume para lotes" },
    { label: "Mapa", value: "Posições de piso com área, na zona do cliente" },
  ],
  file: "lib/operations/templates/mobiliario.ts",
};
