import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WarehouseTask } from "@/lib/warehouse-ops/model";
import { timelineDaCaixa, type CaixaDaChegada } from "@/lib/wms/caixas-do-recebimento";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { destinoVazio } from "./destino-da-caixa";
import { destinoDaCaixaNaGuarda, enderecoDaPrateleira, GuardaDaCaixaConteudo, type GuardaDaCaixaProps } from "./guarda-da-caixa";

/**
 * A guarda da caixa (parte 5f; mockups WmsGuardaCaixa, WmsGuardaCaixaCelular,
 * WmsGuardaCaixaSemPrateleira e WmsGuardaNaoCabe).
 */

const RECEIPT = "inb_avulso_0d0e620b";

const linhas = [
  {
    inbound_item_id: `${RECEIPT}_01`,
    line_number: 1,
    sku_code: "BTG-000086",
    client_item_code: "A.01.0806.004.XG",
    product_name: "POLO MASCULINO PIQUET PRETO XG",
    size: "XG",
    counted_qty: 29,
  },
  {
    inbound_item_id: `${RECEIPT}_02`,
    line_number: 2,
    sku_code: "BTG-000087",
    client_item_code: "A.01.0806.004.GG",
    product_name: "POLO MASCULINO PIQUET PRETO GG",
    size: "GG",
    counted_qty: 12,
  },
];

function caixa(status: string, location_id: string, extra: Partial<CaixaDaChegada> = {}): CaixaDaChegada {
  return {
    code: "CX-000131",
    status,
    location_id,
    lines: linhas,
    unit_count: 41,
    length_m: 0.48,
    width_m: 0.38,
    height_m: 0.3,
    gross_weight_kg: 9.4,
    allow_tilt: false,
    allow_stacking: true,
    conference_revision: 9,
    refused_positions: [],
    ...extra,
  };
}

function guarda(box: CaixaDaChegada, extra: Partial<WarehouseTask> = {}): WarehouseTask {
  return {
    id: "put_box_cx131",
    reference: "put_box_cx131",
    title: "Guardar caixa CX-000131",
    status: "planned",
    box_code: "CX-000131",
    receipt_id: RECEIPT,
    receipt_number: "AVL-0D0E620B",
    invoice_number: "48.230",
    source_location_id: "RECEBIMENTO",
    box_lines: linhas,
    box,
    ...extra,
  };
}

function render(over: Partial<GuardaDaCaixaProps> = {}) {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <GuardaDaCaixaConteudo
      task={guarda(caixa("committing", "B-02"))}
      endereco="Rua B · prateleira 02 · zona BTG Pactual"
      podeOperar
      ocupado={false}
      erro={null}
      destino={destinoVazio()}
      recusando={null}
      onDestino={{ onModo: noop, onEscolher: noop, onConfirmar: noop, onNaoCabe: noop, onTentarDeNovo: noop }}
      onCancelarRecusa={noop}
      onRecusar={noop}
      liberando={false}
      onNaoCabe={noop}
      onCancelarLiberar={noop}
      onLiberar={noop}
      onGuardar={noop}
      {...over}
    />,
  );
}

const CONTEUDO = [
  "Conteúdo",
  "POLO MASCULINO PIQUET PRETO XG",
  "A.01.0806.004.XG · BTG-000086",
  "29 un.",
  "POLO MASCULINO PIQUET PRETO GG",
  "A.01.0806.004.GG · BTG-000087",
  "12 un.",
  "48 × 38 × 30 cm · 9,4 kg",
];

describe("a guarda da caixa", () => {
  it("com destino: a prateleira reservada, o endereço, o conteúdo, concluir a guarda e não cabe aqui", async () => {
    const html = render();
    expect(
      textosForaDaLista(html, [
        "Guarda",
        "planejada",
        "Guardar caixa CX-000131",
        "AVL-0D0E620B · NF 48.230 · origem RECEBIMENTO",
        "Destino",
        "B-02",
        "Rua B · prateleira 02 · zona BTG Pactual",
        ...CONTEUDO,
        "Concluir guarda em B-02",
        "Não cabe aqui",
      ]),
    ).toEqual([]);
    expect(html).not.toContain("sem prateleira");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("sem prateleira: o selo, o guardar em da bancada e concluir a guarda desligado até o destino (decisão 14)", async () => {
    const html = render({ task: guarda(caixa("reviewed", "")) });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Concluir guarda<\/button>/);
    expect(html).not.toContain("Não cabe aqui");
    expect(
      textosForaDaLista(html, [
        "Guarda",
        "planejada",
        "sem prateleira",
        "Guardar caixa CX-000131",
        "AVL-0D0E620B · NF 48.230 · origem RECEBIMENTO",
        "Guardar em",
        "Sugestão do sistema",
        "Escolher prateleira",
        ...CONTEUDO,
        "Concluir guarda",
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("a recusa do servidor fica na própria guarda (decisão 24)", async () => {
    const erro =
      "No RECEBIMENTO há 10 de POLO MASCULINO PIQUET PRETO GG (BTG-000087) livres, e a caixa CX-000131 tem 12: a coordenação acerta o saldo do RECEBIMENTO antes da guarda.";
    const html = render({ erro });
    expect(html).toContain(erro);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("guardada, ou para quem só consulta: onde a caixa ficou, sem as ações", () => {
    const guardada = render({ task: guarda(caixa("stored", "B-02"), { status: "completed", can_advance: false }), podeOperar: false });
    expect(guardada).toContain("B-02");
    expect(guardada).not.toContain("sem prateleira");
    expect(guardada).not.toContain("Concluir guarda");
    expect(guardada).not.toContain("Não cabe aqui");
    const consulta = render({ task: guarda(caixa("reviewed", "")), podeOperar: false });
    expect(consulta).not.toContain("Guardar em");
    expect(consulta).not.toContain("Concluir guarda");
  });
});

/** A etiqueta na guarda (recebimento com caixas, parte 6; mockups WmsEtiquetaRecebimentoGuarda, WmsEtiquetaRecebimentoGuardada e WmsEtiquetaRecebimentoCelular). */
describe("a etiqueta na guarda", () => {
  it("com destino, Imprimir etiqueta ao lado de Não cabe aqui; sem prateleira, nada", async () => {
    const html = render({ onEtiqueta: () => undefined });
    expect(
      textosForaDaLista(html, [
        "Guarda",
        "planejada",
        "Guardar caixa CX-000131",
        "AVL-0D0E620B · NF 48.230 · origem RECEBIMENTO",
        "Destino",
        "B-02",
        "Rua B · prateleira 02 · zona BTG Pactual",
        ...CONTEUDO,
        "Concluir guarda em B-02",
        "Não cabe aqui",
        "Imprimir etiqueta",
      ]),
    ).toEqual([]);
    expect(html).toContain("Imprimir etiqueta");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    expect(render({ task: guarda(caixa("reviewed", "")), onEtiqueta: () => undefined })).not.toContain("Imprimir etiqueta");
  });

  it("guardada: Guardada em e só Imprimir etiqueta; quem só consulta a guarda aberta não imprime", async () => {
    const guardada = render({
      task: guarda(caixa("stored", "B-02"), { status: "completed", can_advance: false }),
      podeOperar: false,
      onEtiqueta: () => undefined,
    });
    expect(guardada).toContain("Guardada em");
    expect(guardada).not.toContain("Destino");
    expect(guardada).not.toContain("Concluir guarda");
    expect(
      textosForaDaLista(guardada, [
        "Guarda",
        /^concluída$/i,
        "Guardar caixa CX-000131",
        "AVL-0D0E620B · NF 48.230 · origem RECEBIMENTO",
        "Guardada em",
        "B-02",
        "Rua B · prateleira 02 · zona BTG Pactual",
        ...CONTEUDO,
        "Imprimir etiqueta",
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(guardada)).toEqual([]);
    const consulta = render({ task: guarda(caixa("committing", "B-02")), podeOperar: false, onEtiqueta: () => undefined });
    expect(consulta).not.toContain("Imprimir etiqueta");
  });

  it("a etiqueta impressa com outra prateleira avisa; a timeline conta a caixa, da etapa mais recente à primeira", async () => {
    const comHistorico = caixa("committing", "B-05", {
      closed_at: "2026-11-06T17:28:00.000Z",
      destination_confirmed_at: "2026-11-06T17:41:00.000Z",
      label_printed_at: "2026-11-06T17:32:00.000Z",
      label_printed_location: "B-02",
      label_print_count: 1,
      refusals: [{ position: "B-02", reason: "Frente ocupada por caixa sem registro", refused_at: "2026-11-06T17:40:00.000Z", phase: "putaway" }],
    });
    expect(timelineDaCaixa(comHistorico).map((etapa) => etapa.titulo)).toEqual([
      "Destino confirmado · B-05",
      "Prateleira B-02 liberada · não coube",
      "Etiqueta impressa · B-02",
      "Caixa fechada · 48 × 38 × 30 cm · 9,4 kg",
    ]);
    const html = render({ task: guarda(comHistorico), endereco: "Rua B · prateleira 05 · zona BTG Pactual", onEtiqueta: () => undefined });
    expect(html).toContain("Etiqueta impressa com B-02 · 14:32");
    expect(
      textosForaDaLista(html, [
        "Guarda",
        "planejada",
        "Guardar caixa CX-000131",
        "AVL-0D0E620B · NF 48.230 · origem RECEBIMENTO",
        "Destino",
        "B-05",
        "Rua B · prateleira 05 · zona BTG Pactual",
        "Etiqueta impressa com B-02 · 14:32",
        ...CONTEUDO,
        "Concluir guarda em B-05",
        "Não cabe aqui",
        "Imprimir etiqueta",
        "Timeline",
        /^[1-4]$/,
        "Destino confirmado · B-05",
        "06/11/2026, 14:41",
        "Prateleira B-02 liberada · não coube",
        "06/11/2026, 14:40 · Frente ocupada por caixa sem registro",
        "Etiqueta impressa · B-02",
        "06/11/2026, 14:32",
        "Caixa fechada · 48 × 38 × 30 cm · 9,4 kg",
        "06/11/2026, 14:28",
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    // Guardada: a guarda é a última etapa, a segunda impressão é reimpressão, e a etiqueta da prateleira atual não avisa.
    const guardada = caixa("stored", "B-02", {
      stored_at: "2026-11-06T18:02:00.000Z",
      label_printed_at: "2026-11-06T17:32:00.000Z",
      label_printed_location: "B-02",
      label_print_count: 2,
    });
    expect(timelineDaCaixa(guardada).map((etapa) => etapa.titulo)).toEqual(["Guardada em B-02", "Etiqueta reimpressa · B-02"]);
    expect(render({ task: guarda(guardada, { status: "completed" }), podeOperar: false })).not.toContain("Etiqueta impressa com");
    expect(timelineDaCaixa(caixa("counting", ""))).toEqual([]);
  });
});

describe("o que a guarda lê", () => {
  it("o destino é o da caixa reservada ou guardada; sem a caixa, o da tarefa sem a origem", () => {
    expect(destinoDaCaixaNaGuarda(guarda(caixa("committing", "B-02")))).toBe("B-02");
    expect(destinoDaCaixaNaGuarda(guarda(caixa("stored", "B-02")))).toBe("B-02");
    expect(destinoDaCaixaNaGuarda(guarda(caixa("reviewed", "")))).toBe("");
    expect(destinoDaCaixaNaGuarda(guarda(caixa("reviewed", ""), { box: null, location: "RECEBIMENTO" }))).toBe("");
    expect(destinoDaCaixaNaGuarda(guarda(caixa("reviewed", ""), { box: null, location: "B-02" }))).toBe("B-02");
  });

  it("o endereço da prateleira pelo cadastro", () => {
    expect(enderecoDaPrateleira({ aisle: "B", shelf: 2, customer_code: "BTG Pactual" })).toBe("Rua B · prateleira 02 · zona BTG Pactual");
    expect(enderecoDaPrateleira(null)).toBeNull();
  });
});
