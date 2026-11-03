import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SuggestionResult } from "@/lib/warehouse-boxes";
import type { WarehousePosition } from "@/lib/warehouse-positions";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import {
  DestinoDaCaixa,
  RecusaDaPrateleiraConteudo,
  candidatoDoDestino,
  destinoVazio,
  semPrateleiraLivre,
  seloDaCaixaFechada,
  sugestaoDoConfirmar,
  type DestinoDaCaixaEstado,
} from "./destino-da-caixa";

/**
 * O destino da caixa fechada na bancada (recebimento com caixas, parte 5c;
 * mockups WmsRecebimentoFecharCaixa e WmsRecebimentoSemPrateleira).
 */

const sugestao: SuggestionResult = {
  ok: true,
  customer_code: "BTG Pactual",
  zone_positions: 43,
  position: {
    code: "B-02",
    reason: "Já tem BTG-000087 nesta prateleira e ainda cabe.",
    tier: 1,
    leftover_m: 0.82,
    sequence: 14,
    placement: { front_m: 0.48, depth_m: 0.38, height_m: 0.3, orientation: "length_width_height" },
  },
  alternatives: [
    {
      code: "B-03",
      reason: "A mais próxima de B-02, que já tem o mesmo produto.",
      tier: 2,
      leftover_m: 1.32,
      sequence: 15,
      placement: { front_m: 0.48, depth_m: 0.38, height_m: 0.3 },
    },
    {
      code: "B-01",
      reason: "A mais próxima de B-02, que já tem o mesmo produto.",
      tier: 2,
      leftover_m: 1.4,
      sequence: 13,
      placement: { front_m: 0.48, depth_m: 0.38, height_m: 0.3 },
    },
  ],
  rejected: null,
  checked: 43,
};

const semEspaco: SuggestionResult = {
  ok: true,
  position: null,
  alternatives: [],
  rejected:
    "Nenhuma prateleira da zona de BTG Pactual tem espaço para uma caixa de 48 × 38 × 30 cm. Coordenação precisa ampliar a zona ou liberar espaço.",
  checked: 43,
};

function estado(over: Partial<DestinoDaCaixaEstado> = {}): DestinoDaCaixaEstado {
  return { ...destinoVazio(), ...over };
}

function render(over: Partial<DestinoDaCaixaEstado> = {}, ocupado = false) {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <DestinoDaCaixa
      estado={estado(over)}
      ocupado={ocupado}
      onModo={noop}
      onEscolher={noop}
      onConfirmar={noop}
      onNaoCabe={noop}
      onTentarDeNovo={noop}
    />,
  );
}

const CABECALHO = ["Guardar em", "Sugestão do sistema", "Escolher prateleira"];

const prateleira = (code: string): WarehousePosition =>
  ({ code, customer_code: "BTG Pactual", status: "active", sequence: 3 }) as WarehousePosition;

describe("o destino da caixa fechada", () => {
  it("a sugestão do motor: a prateleira, de onde ela saiu, como a caixa fica, as alternativas, confirmar e não cabe", async () => {
    const html = render({ sugestao });
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Sugestão do sistema<\/button>/);
    expect(
      textosForaDaLista(html, [
        ...CABECALHO,
        "B-02",
        "Já tem BTG-000087 nesta prateleira e ainda cabe.",
        "Frente 48 × profundidade 38 × altura 30 cm",
        "mesmo produto",
        "alternativas B-03 · B-01",
        "Confirmar destino em B-02",
        "Não cabe aqui",
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("sem prateleira livre na zona: a frase do servidor e nenhum destino para confirmar (decisão 14)", async () => {
    const html = render({ sugestao: semEspaco });
    expect(html).not.toContain("Confirmar destino");
    expect(html).not.toContain("Não cabe aqui");
    expect(textosForaDaLista(html, [...CABECALHO, "Sem prateleira", semEspaco.rejected!])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("escolher a prateleira: a lista da zona e a prévia do encaixe, sem o não cabe", async () => {
    const vazia = render({ modo: "escolha", prateleiras: [prateleira("A-03")] });
    expect(vazia).toContain("Prateleira cadastrada");
    expect(vazia).not.toContain("Confirmar destino");
    const html = render({
      modo: "escolha",
      prateleiras: [prateleira("A-03")],
      escolhida: "A-03",
      previa: { ...sugestao.alternatives[0]!, code: "A-03", reason: "Prateleira selecionada manualmente.", tier: 3 },
    });
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Escolher prateleira<\/button>/);
    expect(html).not.toContain("Não cabe aqui");
    expect(
      textosForaDaLista(html, [
        ...CABECALHO,
        "Prateleira cadastrada",
        "A-03",
        "Prateleira selecionada manualmente.",
        "Frente 48 × profundidade 38 × altura 30 cm",
        "Confirmar destino em A-03",
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("a prateleira escolhida que não serve mostra a frase do servidor", async () => {
    const erro = "A caixa não cabe nesta prateleira ou ela foi excluída da escolha. Selecione outra.";
    const html = render({ modo: "escolha", prateleiras: [prateleira("A-03")], escolhida: "A-03", erroPrevia: erro });
    expect(html).not.toContain("Confirmar destino");
    expect(textosForaDaLista(html, [...CABECALHO, "Prateleira cadastrada", "A-03", "Prateleira não serve", erro])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("consultando, e a consulta que falhou com o tentar de novo", async () => {
    expect(textosForaDaLista(render({ carregandoSugestao: true }), [...CABECALHO, "Consultando a sugestão…"])).toEqual([]);
    const html = render({ erroSugestao: "Atualize a tela: a chegada mudou." });
    expect(
      textosForaDaLista(html, [...CABECALHO, "Não foi possível consultar a sugestão", "Atualize a tela: a chegada mudou.", "Tentar de novo"]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("ocupado, confirmar e não cabe ficam desligados", () => {
    const html = render({ sugestao }, true);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirmar destino em B-02<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Não cabe aqui<\/button>/);
  });
});

describe("não cabe aqui, na bancada", () => {
  const noop = () => undefined;
  const corpo = (motivoInicial = "") =>
    renderToStaticMarkup(
      <RecusaDaPrateleiraConteudo
        prateleira="B-02"
        caixa="CX-000132"
        detalhe="48 × 38 × 30 cm · 6,1 kg · GG 18 · 18 un."
        enviando={false}
        onCancelar={noop}
        onRecusar={noop}
        motivoInicial={motivoInicial}
      />,
    );

  it("a caixa, o motivo e recusar a prateleira, só com o motivo", async () => {
    const vazio = corpo();
    expect(vazio).toMatch(/<button[^>]*disabled=""[^>]*>Recusar B-02<\/button>/);
    const preenchido = corpo("Outra caixa ocupando a frente da prateleira");
    expect(preenchido).not.toMatch(/<button[^>]*disabled=""[^>]*>Recusar B-02<\/button>/);
    expect(
      textosForaDaLista(preenchido, ["Caixa CX-000132", "48 × 38 × 30 cm · 6,1 kg · GG 18 · 18 un.", "Motivo", "Cancelar", "Recusar B-02"]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(preenchido)).toEqual([]);
  });
});

describe("as regras do destino", () => {
  it("a prateleira à vista é a sugerida, ou a escolhida já conferida", () => {
    expect(candidatoDoDestino(estado({ sugestao }))?.code).toBe("B-02");
    expect(candidatoDoDestino(estado({ modo: "escolha", sugestao }))).toBeNull();
    expect(candidatoDoDestino(estado({ modo: "escolha", previa: sugestao.alternatives[1]! }))?.code).toBe("B-01");
  });

  it("o selo da caixa fechada diz sem prateleira só quando o motor não achou nenhuma", () => {
    expect(seloDaCaixaFechada(estado())).toBe("fechada · sem destino");
    expect(seloDaCaixaFechada(estado({ sugestao }))).toBe("fechada · sem destino");
    expect(seloDaCaixaFechada(estado({ sugestao: semEspaco }))).toBe("fechada · sem prateleira");
    expect(semPrateleiraLivre(estado({ sugestao: semEspaco }))).toBe(true);
  });

  it("o confirmar leva a sugestão do motor, mesmo quando a pessoa escolheu outra", () => {
    expect(sugestaoDoConfirmar(sugestao)).toEqual({
      position: "B-02",
      reason: "Já tem BTG-000087 nesta prateleira e ainda cabe.",
      alternatives: ["B-03", "B-01"],
      tier: 1,
    });
    expect(sugestaoDoConfirmar(semEspaco)).toBeUndefined();
    expect(sugestaoDoConfirmar(null)).toBeUndefined();
  });
});
