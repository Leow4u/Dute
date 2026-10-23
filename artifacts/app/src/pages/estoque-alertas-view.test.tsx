import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AlertaProposto } from "@/lib/memoria/alertas";
import { telaDoWmsNaV3 } from "@/lib/wms-v3";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { AlertasParadosView, type AlertasParadosViewProps } from "./estoque-alertas-view";

/**
 * Estoque › Alertas (parte 5.4e): o alerta do item parado para a coordenação
 * aprovar. Um alerta por vez, com os itens para escolher; uma ação principal.
 */

const ITAU: AlertaProposto = {
  id: "alerta_0123456789abcdef01234567",
  customerCode: "ITAU",
  regra: { parado_dias: 90, sem_giro_dias: 180 },
  itens: [
    { skuCode: "ITAU-000001", clientItemCode: "POLO-M", productName: "Camisa polo", saldo: 30, ultimaMovimentacao: "2026-04-03T15:00:00.000Z", diasParado: 200 },
    { skuCode: "ITAU-000002", clientItemCode: null, productName: null, saldo: 4, ultimaMovimentacao: "2026-07-12T15:00:00.000Z", diasParado: 100 },
  ],
};
const SAFRA: AlertaProposto = { ...ITAU, id: "alerta_fedcba9876543210fedcba98", customerCode: "SAFRA", itens: ITAU.itens.slice(0, 1) };

const nomes: Record<string, string> = { ITAU: "Itaú Unibanco", SAFRA: "Banco Safra" };

function tela(props: Partial<AlertasParadosViewProps> = {}) {
  return renderToStaticMarkup(
    <div className="v3">
      <AlertasParadosView
        estado="pronto"
        alertas={[ITAU]}
        alerta={ITAU}
        nomeDoCliente={(codigo) => nomes[codigo] ?? codigo}
        marcados={new Set(["ITAU-000001", "ITAU-000002"])}
        ocupado={false}
        erro={null}
        acoes={{ escolher: () => undefined, marcar: () => undefined, marcarTodos: () => undefined, enviar: () => undefined, descartar: () => undefined }}
        {...props}
      />
    </div>,
  );
}

describe("Estoque › Alertas na v3", () => {
  it("a tela está na lista da v3", () => {
    expect(telaDoWmsNaV3("/estoque/alertas")).toBe(true);
  });

  it("o alerta do cliente com os itens, os dias e as duas ações", () => {
    expect(textosDaTela(tela())).toEqual([
      "Alertas de itens parados",
      "Itaú Unibanco",
      "2 itens parados",
      "Parado 90+ dias",
      "Itens do alerta",
      "Item",
      "Saldo",
      "Último movimento",
      "Sem movimento",
      "POLO-M",
      "Camisa polo",
      "30",
      "03/04/2026",
      "200 dias",
      "ITAU-000002",
      "4",
      "12/07/2026",
      "100 dias",
      "Enviar ao cliente",
      "Descartar",
    ]);
  });

  it("uma ação principal; sem item marcado ela espera; enquanto grava, tudo espera", () => {
    const html = tela();
    expect(html.match(/bg-primary text-primary-foreground/g)).toHaveLength(1);
    expect(html).toMatch(/bg-primary text-primary-foreground[^"]*"[^>]*>Enviar ao cliente<\/button>/);
    expect(tela({ marcados: new Set() })).toMatch(/<button[^>]*disabled=""[^>]*>Enviar ao cliente<\/button>/);
    const gravando = tela({ ocupado: true });
    expect(gravando).toContain("Gravando...");
    expect(gravando).toMatch(/<button[^>]*disabled=""[^>]*>Descartar<\/button>/);
  });

  it("com mais de um cliente, a escolha do cliente com a contagem", () => {
    expect(textosDaTela(tela({ alertas: [SAFRA, ITAU] })).slice(0, 4)).toEqual(["Alertas de itens parados", "Banco Safra", "1", "Itaú Unibanco"]);
  });

  it("sem alerta, carregando, com erro e com erro da decisão", () => {
    expect(textosDaTela(tela({ alertas: [], alerta: null }))).toEqual(["Alertas de itens parados", "Nenhum alerta para aprovar."]);
    expect(textosDaTela(tela({ estado: "carregando" }))).toEqual(["Alertas de itens parados", "Carregando alertas..."]);
    expect(textosDaTela(tela({ estado: "erro" }))).toEqual(["Alertas de itens parados", "Não consegui carregar os alertas."]);
    expect(textosDaTela(tela({ erro: "O alerta já foi decidido." })).at(-1)).toBe("O alerta já foi decidido.");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(tela())).toEqual([]);
    expect(await violacoesDeAcessibilidade(tela({ alertas: [SAFRA, ITAU] }))).toEqual([]);
  });
});
