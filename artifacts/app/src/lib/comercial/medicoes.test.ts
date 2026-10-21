import { describe, expect, it } from "vitest";

import {
  acoesDaMedicao,
  alertaMedicaoNaoEnviada,
  anexosDaMedicao,
  classificarErroDaMedicao,
  competenciaEscolhida,
  competenciasDoContrato,
  contratosDeMedicao,
  diaDaSemana,
  formDaLinha,
  formNovaLinha,
  itemAvulso,
  itemComPrecoAlterado,
  itemComPrecoDaTabela,
  itemDeTabela,
  marcasDaLinha,
  medicaoDoRegistro,
  payloadAnexar,
  payloadAplicarTarifa,
  payloadAvancar,
  payloadCriar,
  payloadRetirarLinha,
  payloadSalvarLinha,
  periodosDosAditivos,
  prazoDeEnvio,
  problemasDaLinha,
  resumoPorItem,
  rotuloDaCompetencia,
  rotuloDoFrete,
  seloDaMedicao,
  tabelaParaALinha,
  type Medicao,
} from "./medicoes";
import { contratoDoRegistro } from "./contratos";
import { alertaMedicaoNaoEnviada as alertaNoServidor } from "../../../../../functions/comercial/src/domain/medicao";
import { L2, L4, LINHAS_DE_OUTUBRO, TOTAL_DE_OUTUBRO_CENTS, medicaoDoDoc } from "./medicoes-exemplo";

/**
 * Regras puras da tela de Medições (docs/mockups/ComMedicaoMensal.dc.html;
 * parte 16b de docs/plataforma/fase-6-comercial.md): leitura do documento
 * que saveMedicao grava, resumo por item, anexos, competências, prazo,
 * marcas, alerta da virada do mês e as chamadas de saveMedicao e
 * advanceMedicao (functions/comercial, domain/medicoes.ts).
 */

function medicao(sobrescrever: Record<string, unknown> = {}): Medicao {
  const lida = medicaoDoRegistro("safra_2026-10", medicaoDoDoc(sobrescrever));
  if (!lida) throw new Error("medição não foi lida");
  return lida;
}

describe("leitura do documento", () => {
  it("lê a medição de outubro: situação, edição, total e as quatro linhas", () => {
    const lida = medicao();
    expect(lida).toMatchObject({
      id: "safra_2026-10",
      contrato_id: "safra",
      competencia: "2026-10",
      status: "rascunho",
      edicao: 6,
      total_cents: TOTAL_DE_OUTUBRO_CENTS,
    });
    expect(lida.linhas.map((linha) => linha.os)).toEqual(["OS 10031-01", "OS 10034-01", "OS 10038-01", "OS 10043-01"]);
  });

  it("documento sem contrato, com competência ou situação inválida fica de fora", () => {
    expect(medicaoDoRegistro("x", medicaoDoDoc({ contrato_id: "" }))).toBeNull();
    expect(medicaoDoRegistro("x", medicaoDoDoc({ competencia: "2026-13" }))).toBeNull();
    expect(medicaoDoRegistro("x", medicaoDoDoc({ status: "arquivada" }))).toBeNull();
  });

  it("o total é o do servidor, e a linha sem classe (gravada antes dela) lê como item comum", () => {
    const semClasse = { ...L4, itens: [{ ...(L4.itens as Record<string, unknown>[])[0], classe: undefined }] };
    const lida = medicao({ linhas: [semClasse], total_cents: 62000 });
    expect(lida.total_cents).toBe(62000);
    expect(lida.linhas[0].itens[0].classe).toBeNull();
  });
});

describe("resumo por item", () => {
  it("agrupa diárias de ajudante e viagens, com quantidade × preço e o valor de cada item", () => {
    const grupos = resumoPorItem(medicao().linhas);
    expect(grupos.map((grupo) => grupo.titulo)).toEqual(["Diárias de ajudante", "Viagens"]);
    expect(grupos[0].itens).toEqual([
      { rotulo: "Ajudante de Domingo/feriado das 08:00 às 17:00", quantidade: "6", preco: "476,00", total_cents: 285600 },
      { rotulo: "Ajudante de Segunda a Sexta das 09:00 às 18:00", quantidade: "5", preco: "280,00", total_cents: 140000 },
    ]);
    expect(grupos[1].itens).toEqual([
      { rotulo: "3/4", quantidade: "1", preco: "890,00", total_cents: 89000 },
      { rotulo: "Truck até Jundiaí", quantidade: "1", preco: "1.350,00", total_cents: 135000 },
      { rotulo: "VUC", quantidade: "2", preco: "620,00", total_cents: 124000 },
    ]);
  });

  it("a soma dos grupos é o total da medição (a conta fecha com o servidor)", () => {
    const grupos = resumoPorItem(medicao().linhas);
    expect(grupos.reduce((soma, grupo) => soma + grupo.total_cents, 0)).toBe(TOTAL_DE_OUTUBRO_CENTS);
    expect(grupos.map((grupo) => grupo.total_cents)).toEqual([425600, 348000]);
  });

  it("o mesmo item com preço diferente (alterado) não se mistura", () => {
    const alterado = { ...(L4.itens as Record<string, unknown>[])[0], preco: "700.00", origem: "alterado", motivo: "Acordo", total_cents: 70000 };
    const lida = medicao({ linhas: [L4, { ...L4, id: "l5", itens: [alterado] }] });
    const vuc = resumoPorItem(lida.linhas)
      .flatMap((grupo) => grupo.itens)
      .filter((item) => item.rotulo === "VUC");
    expect(vuc.map((item) => [item.quantidade, item.preco])).toEqual([
      ["1", "620,00"],
      ["1", "700,00"],
    ]);
  });

  it("quantidade fracionada soma sem float e item que não é diária nem veículo vai para Outros itens", () => {
    const outro = { ...(L4.itens as Record<string, unknown>[])[0], classe: { diaria: null, veiculo: false, ajudante: false }, descricao: "Embalagem", quantidade: "1.5", preco: "10.00", total_cents: 1500 };
    const outro2 = { ...outro, quantidade: "2.25", total_cents: 2250 };
    const lida = medicao({ linhas: [{ ...L4, itens: [outro] }, { ...L4, id: "l5", itens: [outro2] }] });
    const grupos = resumoPorItem(lida.linhas);
    expect(grupos).toEqual([
      { titulo: "Outros itens", itens: [{ rotulo: "Embalagem", quantidade: "3,75", preco: "10,00", total_cents: 3750 }], total_cents: 3750 },
    ]);
  });

  it("sem linhas, sem grupos", () => {
    expect(resumoPorItem([])).toEqual([]);
  });
});

describe("anexos dos pedidos", () => {
  it("conta quantos de quantos e diz o que falta", () => {
    expect(anexosDaMedicao(medicao().linhas)).toEqual({
      total: 4,
      anexados: 3,
      completo: false,
      itens: [
        { linhaId: "l1", os: "OS 10031-01", nome: "OS 10031-01.pdf", referencia: "OneDrive/Safra/10031.pdf", data: "2026-09-29" },
        { linhaId: "l2", os: "OS 10034-01", nome: "OS 10034-01.pdf", referencia: "OneDrive/Safra/10034.pdf", data: "2026-10-02" },
        { linhaId: "l3", os: "OS 10038-01", nome: "OS 10038-01.pdf", referencia: "OneDrive/Safra/10038.pdf", data: "2026-10-08" },
      ],
      faltando: [{ linhaId: "l4", os: "OS 10043-01" }],
    });
  });

  it("todos anexados: completo; sem linhas: nada a anexar e não é completo", () => {
    const completa = medicao({ linhas: LINHAS_DE_OUTUBRO.map((linha) => ({ ...linha, anexo: { nome: "p.pdf", referencia: "r" } })) });
    expect(anexosDaMedicao(completa.linhas)).toMatchObject({ total: 4, anexados: 4, completo: true, faltando: [] });
    expect(anexosDaMedicao([])).toMatchObject({ total: 0, anexados: 0, completo: false });
  });
});

describe("competências do contrato", () => {
  const rascunhoDeAgosto = medicao({ id: "safra_2026-08", competencia: "2026-08", status: "enviada", enviada_em: "2026-09-01T13:00:00.000Z", total_cents: 1694000 });
  const setembro = medicao({ id: "safra_2026-09", competencia: "2026-09", status: "aprovada", aprovada_em: "2026-10-05T13:00:00.000Z", total_cents: 1521000 });
  const outubro = medicao();

  it("existentes em ordem, com situação e resumo (Enviada 01/09 · R$ 16.940,00)", () => {
    const chips = competenciasDoContrato([outubro, rascunhoDeAgosto, setembro], "2026-10-21");
    expect(chips.map((chip) => [chip.competencia, chip.rotulo, chip.situacao])).toEqual([
      ["2026-08", "Agosto/2026", "enviada"],
      ["2026-09", "Setembro/2026", "aprovada"],
      ["2026-10", "Outubro/2026", "rascunho"],
    ]);
    expect(chips[0].resumo.replace(/ /g, " ")).toBe("Enviada 01/09 · R$ 16.940,00");
    expect(chips[1].resumo.replace(/ /g, " ")).toBe("Aprovada 05/10 · R$ 15.210,00");
    expect(chips[2].resumo.replace(/ /g, " ")).toBe("Rascunho · R$ 7.736,00");
  });

  it("o mês de hoje e o anterior, sem medição, aparecem como não abertos; mês futuro nunca", () => {
    const chips = competenciasDoContrato([rascunhoDeAgosto], "2026-10-21");
    expect(chips.map((chip) => [chip.competencia, chip.situacao])).toEqual([
      ["2026-08", "enviada"],
      ["2026-09", "nao_aberta"],
      ["2026-10", "nao_aberta"],
    ]);
    expect(chips.at(-1)!.resumo).toBe("Prazo de envio 01/11");
  });

  it("a escolhida é a da URL, se existe; senão a última aberta; sem nenhuma, a de hoje", () => {
    const chips = competenciasDoContrato([rascunhoDeAgosto, setembro, outubro], "2026-10-21");
    expect(competenciaEscolhida(chips, "2026-09", "2026-10-21")).toBe("2026-09");
    expect(competenciaEscolhida(chips, "2025-01", "2026-10-21")).toBe("2026-10");
    expect(competenciaEscolhida(chips, null, "2026-10-21")).toBe("2026-10");
    expect(competenciaEscolhida([], null, "2026-10-21")).toBe("2026-10");
    // Aberta por link do Início: o mês que passou, mesmo sem medição.
    const sem = competenciasDoContrato([], "2026-10-21");
    expect(competenciaEscolhida(sem, "2026-09", "2026-10-21")).toBe("2026-09");
  });

  it("rótulo da competência", () => {
    expect(rotuloDaCompetencia("2026-03")).toBe("Março/2026");
  });
});

describe("prazo de envio", () => {
  it("é a virada do mês: em N dias, hoje ou em atraso", () => {
    expect(prazoDeEnvio("2026-10", "2026-10-20")).toEqual({ data: "2026-11-01", rotulo: "01/11/2026", quando: "em 12 dias", atrasado: false });
    expect(prazoDeEnvio("2026-10", "2026-10-31")).toMatchObject({ quando: "amanhã" });
    expect(prazoDeEnvio("2026-10", "2026-11-01")).toMatchObject({ quando: "hoje", atrasado: false });
    expect(prazoDeEnvio("2026-09", "2026-10-04")).toEqual({ data: "2026-10-01", rotulo: "01/10/2026", quando: "há 3 dias", atrasado: true });
    expect(prazoDeEnvio("2026-12", "2026-12-20").data).toBe("2027-01-01");
  });
});

describe("selo e dia da semana", () => {
  it("rótulo e tom de cada situação", () => {
    expect(seloDaMedicao("rascunho")).toEqual({ rotulo: "Rascunho", tom: "neutro" });
    expect(seloDaMedicao("enviada")).toEqual({ rotulo: "Aguardando aprovação", tom: "info" });
    expect(seloDaMedicao("aprovada")).toEqual({ rotulo: "Aprovada", tom: "ok" });
    expect(seloDaMedicao("contestada")).toEqual({ rotulo: "Contestada", tom: "critico" });
    expect(seloDaMedicao("nao_aberta")).toEqual({ rotulo: "Não aberta", tom: "neutro" });
  });

  it("frete: data e dia da semana (01/10 · qui)", () => {
    expect(diaDaSemana("2026-10-01")).toBe("qui");
    expect(diaDaSemana("2026-10-03")).toBe("sáb");
    expect(diaDaSemana("2026-10-18")).toBe("dom");
    expect(rotuloDoFrete(medicao().linhas[0])).toBe("01/10 · qui");
  });
});

describe("marcas da linha", () => {
  it("dia que não bate: diz o dia da execução e a tarifa que foi usada", () => {
    const lida = medicao().linhas;
    expect(marcasDaLinha(lida[1])).toEqual([
      { marca: "dia_nao_bate_tarifa", texto: "Sábado na tarifa de dia útil", tom: "critico" },
    ]);
  });

  it("rota fora da tabela e sem pedido anexo", () => {
    const lida = medicao().linhas;
    expect(marcasDaLinha(lida[2])).toEqual([{ marca: "rota_fora_da_tabela", texto: "Rota fora da tabela", tom: "atencao" }]);
    expect(marcasDaLinha(lida[3])).toEqual([{ marca: "sem_pedido_anexo", texto: "Sem pedido anexo", tom: "atencao" }]);
    expect(marcasDaLinha(lida[0])).toEqual([]);
  });

  it("o botão Aplicar vem do trocar_por que o servidor deu", () => {
    const linha = medicao().linhas[1];
    expect(linha.itens.map((item) => item.trocar_por)).toEqual([null, "ajud-sab"]);
  });
});

describe("ações por situação", () => {
  it("rascunho: enviar é a principal (com linhas); sem linhas, desabilitada", () => {
    expect(acoesDaMedicao("rascunho", 4)).toEqual({ principal: "enviar", secundarias: ["exportar"], editavel: true, podeEnviar: true });
    expect(acoesDaMedicao("rascunho", 0)).toMatchObject({ principal: "enviar", podeEnviar: false });
  });

  it("enviada: registrar aprovação (principal) e contestação; não se edita", () => {
    expect(acoesDaMedicao("enviada", 4)).toEqual({ principal: "aprovar", secundarias: ["contestar", "exportar"], editavel: false, podeEnviar: false });
  });

  it("contestada: reabrir; aprovada: só exportar", () => {
    expect(acoesDaMedicao("contestada", 4)).toEqual({ principal: "reabrir", secundarias: ["exportar"], editavel: false, podeEnviar: false });
    expect(acoesDaMedicao("aprovada", 4)).toEqual({ principal: null, secundarias: ["exportar"], editavel: false, podeEnviar: false });
  });
});

describe("chamadas das callables", () => {
  const lida = medicao();

  it("abrir a medição do mês: contrato e competência, com a chave", () => {
    expect(payloadCriar("safra", "2026-10", "chave-1")).toEqual({
      action: "create",
      request_id: "chave-1",
      contrato_id: "safra",
      competencia: "2026-10",
    });
  });

  it("enviar, aprovar, contestar e reabrir levam a situação e a edição que a tela viu", () => {
    expect(payloadAvancar(lida, "send", "c2")).toEqual({
      action: "send",
      request_id: "c2",
      medicao_id: "safra_2026-10",
      expected_status: "rascunho",
      expected_edicao: 6,
    });
    const enviada = medicao({ status: "enviada" });
    expect(payloadAvancar(enviada, "approve", "c3", { link: " https://mail/aprovou ", em: "2026-10-22T09:00-03:00" })).toEqual({
      action: "approve",
      request_id: "c3",
      medicao_id: "safra_2026-10",
      expected_status: "enviada",
      expected_edicao: 6,
      link: "https://mail/aprovou",
      em: "2026-10-22T09:00-03:00",
    });
    expect(payloadAvancar(enviada, "approve", "c3b", {})).toEqual({
      action: "approve",
      request_id: "c3b",
      medicao_id: "safra_2026-10",
      expected_status: "enviada",
      expected_edicao: 6,
    });
    expect(payloadAvancar(enviada, "contest", "c4", { nota: " Valor do sábado " })).toMatchObject({ action: "contest", nota: "Valor do sábado" });
    expect(payloadAvancar(medicao({ status: "contestada" }), "reopen", "c5")).toMatchObject({ action: "reopen", expected_status: "contestada" });
  });

  it("retirar a linha leva a edição vista", () => {
    expect(payloadRetirarLinha(lida, "l4", "c6")).toEqual({
      action: "remove_line",
      request_id: "c6",
      medicao_id: "safra_2026-10",
      expected_edicao: 6,
      linha_id: "l4",
    });
  });

  it("aplicar a tarifa: a mesma linha com o item trocado pelo da tabela, só a quantidade", () => {
    const linha = lida.linhas[1];
    const payload = payloadAplicarTarifa(lida, linha, "ajud-util", "c7") as { linha: { itens: Record<string, unknown>[] } };
    expect(payload).toMatchObject({ action: "upsert_line", request_id: "c7", medicao_id: "safra_2026-10", expected_edicao: 6 });
    expect(payload.linha.itens).toEqual([
      { lpu_item_id: "tres-quartos", quantidade: "1", origem: "tabela" },
      { lpu_item_id: "ajud-sab", quantidade: "3", origem: "tabela" },
    ]);
    expect(payload.linha).toMatchObject({ id: "l2", os: "OS 10034-01", dia_tipo: "sabado", janela: "diurna" });
  });

  it("anexar: a mesma linha, com o anexo (nome e referência)", () => {
    const linha = lida.linhas[3];
    const payload = payloadAnexar(lida, linha, { nome: " OS 10043-01.pdf ", referencia: " OneDrive/Safra/10043.pdf " }, "c8") as {
      linha: Record<string, unknown>;
    };
    expect(payload.linha.anexo).toEqual({ nome: "OS 10043-01.pdf", referencia: "OneDrive/Safra/10043.pdf" });
    expect(payload.linha).toMatchObject({ id: "l4", os: "OS 10043-01", itens: [{ lpu_item_id: "vuc", quantidade: "1", origem: "tabela" }, { lpu_item_id: "ajud-dom", quantidade: "2", origem: "tabela" }] });
  });
});

describe("formulário da linha", () => {
  const lida = medicao();

  it("linha nova: vazia, na competência", () => {
    const form = formNovaLinha("2026-10", "chave");
    expect(form).toMatchObject({ id: null, os: "", executadaEm: "", janela: "diurna", diaTipo: "" });
    expect(form.itens).toEqual([]);
    expect(problemasDaLinha(form, "2026-10", "2026-10-21")).toEqual(expect.arrayContaining(["Informe a OS.", "Informe ao menos um item."]));
  });

  it("linha gravada volta ao formulário com os itens, e o salvar leva só o que o servidor aceita", () => {
    const form = formDaLinha(lida.linhas[2], "chave");
    expect(form).toMatchObject({ id: "l3", os: "OS 10038-01", diaTipo: "domingo_feriado" });
    expect(form.itens.map((item) => [item.origem, item.lpuItemId, item.quantidade, item.preco, item.descricao])).toEqual([
      ["avulso", null, "1", "1350.00", "Truck até Jundiaí"],
      ["tabela", "ajud-dom", "4", "", ""],
    ]);
    expect(problemasDaLinha(form, "2026-10", "2026-10-21")).toEqual([]);
    const payload = payloadSalvarLinha(lida, form, "c9") as { linha: Record<string, unknown> };
    expect(payload).toMatchObject({ action: "upsert_line", expected_edicao: 6, medicao_id: "safra_2026-10", request_id: "c9" });
    expect(payload.linha).toMatchObject({
      id: "l3",
      os: "OS 10038-01",
      solicitada_em: "2026-10-08",
      executada_em: "2026-10-12",
      dia_tipo: "domingo_feriado",
      janela: "diurna",
      anexo: { nome: "OS 10038-01.pdf", referencia: "OneDrive/Safra/10038.pdf" },
    });
    expect(payload.linha.itens).toEqual([
      { lpu_item_id: null, quantidade: "1", origem: "avulso", preco: "1350.00", motivo: "Rota fora da LPU", descricao: "Truck até Jundiaí" },
      { lpu_item_id: "ajud-dom", quantidade: "4", origem: "tabela" },
    ]);
  });

  it("confere o que o servidor também confere: execução no mês e até hoje, solicitação antes, motivo e preço dos avulsos", () => {
    const base = formDaLinha(lida.linhas[0], "chave");
    expect(problemasDaLinha({ ...base, executadaEm: "2026-09-30" }, "2026-10", "2026-10-21")[0]).toMatch(/outro mês/);
    expect(problemasDaLinha({ ...base, executadaEm: "2026-10-25" }, "2026-10", "2026-10-21")[0]).toMatch(/depois de hoje/);
    expect(problemasDaLinha({ ...base, solicitadaEm: "2026-10-05" }, "2026-10", "2026-10-21")[0]).toMatch(/solicitação vem antes/);
    const avulso = { ...base, itens: [{ ...base.itens[0], origem: "avulso" as const, lpuItemId: null, preco: "", motivo: "", descricao: "" }] };
    expect(problemasDaLinha(avulso, "2026-10", "2026-10-21")).toEqual(
      expect.arrayContaining(["Item 1: informe a descrição.", "Item 1: informe o preço.", "Item 1: informe o motivo."]),
    );
    const quantidade = { ...base, itens: [{ ...base.itens[0], quantidade: "abc" }] };
    expect(problemasDaLinha(quantidade, "2026-10", "2026-10-21")).toContain("Item 1: quantidade inválida.");
  });
});

describe("itens do formulário", () => {
  const doCatalogo = { lpuItemId: "vuc", codigo: "T-01", item: "Viagem", categoria: "Transporte", servico: "", unidade: "viagem", descricao: "VUC", preco: "620.00" };

  it("item da tabela entra com quantidade 1, sem preço; o avulso entra vazio", () => {
    expect(itemDeTabela(doCatalogo, "k1")).toEqual({ chave: "k1", origem: "tabela", lpuItemId: "vuc", rotulo: "VUC", quantidade: "1", preco: "", motivo: "", descricao: "" });
    expect(itemAvulso("k2")).toMatchObject({ origem: "avulso", lpuItemId: null, quantidade: "1", preco: "", motivo: "", descricao: "" });
  });

  it("alterar o preço parte do preço da tabela e pede o motivo; voltar à tabela limpa os dois", () => {
    const alterado = itemComPrecoAlterado(itemDeTabela(doCatalogo, "k1"), "620.00");
    expect(alterado).toMatchObject({ origem: "alterado", preco: "620,00", motivo: "", lpuItemId: "vuc" });
    expect(itemComPrecoDaTabela({ ...alterado, preco: "700,00", motivo: "Acordo" })).toMatchObject({ origem: "tabela", preco: "", motivo: "" });
    const payload = payloadSalvarLinha(medicao(), { ...formNovaLinha("2026-10", "k"), os: "OS 1", itens: [{ ...alterado, preco: "700,5", motivo: " Acordo " }] }, "c") as { linha: { itens: unknown[] } };
    expect(payload.linha.itens).toEqual([{ lpu_item_id: "vuc", quantidade: "1", origem: "alterado", preco: "700.5", motivo: "Acordo" }]);
  });
});

describe("tabela para escolher os itens da linha", () => {
  const tabelas = [
    { id: "v1", nome: "v1", variante: "Comercial", vigente_de: "2025-05-12", vigente_ate: "2026-06-30", status: "encerrada", precos: {} },
    { id: "v2", nome: "v2", variante: "Comercial", vigente_de: "2026-07-01", vigente_ate: null, status: "ativa", precos: {} },
    { id: "n2", nome: "n2", variante: "Noturna", vigente_de: "2026-07-01", vigente_ate: null, status: "ativa", precos: {} },
  ];

  it("vale a vigente na data da solicitação, na variante da medição; noturna usa a Noturna se existe", () => {
    expect(tabelaParaALinha(tabelas, "2026-06-15", "diurna", "Comercial")?.id).toBe("v1");
    expect(tabelaParaALinha(tabelas, "2026-10-02", "diurna", "Comercial")?.id).toBe("v2");
    expect(tabelaParaALinha(tabelas, "2026-10-02", "noturna", "Comercial")?.id).toBe("n2");
    expect(tabelaParaALinha(tabelas.slice(0, 2), "2026-10-02", "noturna", "Comercial")?.id).toBe("v2");
    expect(tabelaParaALinha(tabelas, "2024-01-01", "diurna", "Comercial")).toBeNull();
  });
});

describe("erro da callable", () => {
  it("medição que mudou ou sumiu recarrega; as outras recusas só mostram a mensagem", () => {
    const mudou = Object.assign(new Error("A medição safra_2026-10 mudou: está em rascunho, na edição 7. Abra de novo."), { codigo: "failed-precondition" });
    expect(classificarErroDaMedicao(mudou)).toEqual({ mensagem: mudou.message, recarregar: true });
    const edicao = Object.assign(new Error("A medição safra_2026-10 mudou desde que foi aberta (edição 7, não 6). Abra de novo para não perder a mudança."), { codigo: "failed-precondition" });
    expect(classificarErroDaMedicao(edicao).recarregar).toBe(true);
    const situacao = Object.assign(new Error("A medição está enviada ao cliente: só dá para enviar ao cliente com ela em rascunho."), { codigo: "failed-precondition" });
    expect(classificarErroDaMedicao(situacao).recarregar).toBe(true);
    const sumiu = Object.assign(new Error("Medição safra_2026-10 não encontrada."), { codigo: "not-found" });
    expect(classificarErroDaMedicao(sumiu).recarregar).toBe(true);
    const recusa = Object.assign(new Error("OS 10031-01: data inválida."), { codigo: "invalid-argument" });
    expect(classificarErroDaMedicao(recusa)).toEqual({ mensagem: "OS 10031-01: data inválida.", recarregar: false });
    const preco = Object.assign(new Error("O preço de 2 linhas mudou desde a última gravação (tabela do contrato carregada depois). Grave a medição de novo e confira antes de enviar."), { codigo: "failed-precondition" });
    expect(classificarErroDaMedicao(preco).recarregar).toBe(false);
  });
});

describe("contratos por medição mensal", () => {
  const base = {
    customer_code: "BANCO-SAFRA",
    nome: "LPU de transporte",
    vigente_de: "2025-05-12",
    vigente_ate: null,
    regime_padrao: "medicao_mensal",
    regimes: [],
  };
  const SAFRA = contratoDoRegistro("safra", base)!;
  const ITAU = contratoDoRegistro("itau", { ...base, customer_code: "ITAU", nome: "Mudanças", regime_padrao: "por_demanda" })!;
  const MISTO = contratoDoRegistro("misto", { ...base, customer_code: "MISTO", nome: "Misto", regime_padrao: "por_demanda", regimes: [{ servico: "Equipe fixa", regime: "medicao_mensal" }] })!;
  const ENCERRADO = contratoDoRegistro("velho", { ...base, customer_code: "VELHO", status: "encerrado" })!;

  it("só os que cobram por medição mensal (no padrão ou num serviço), vigentes primeiro", () => {
    expect(contratosDeMedicao([ITAU, ENCERRADO, MISTO, SAFRA]).map((contrato) => contrato.id)).toEqual(["misto", "safra", "velho"]);
  });
});

describe("alerta da virada do mês", () => {
  const SAFRA = {
    id: "safra",
    customer_code: "BANCO-SAFRA",
    status: "vigente",
    regime_padrao: "medicao_mensal",
    regimes: [],
    vigente_de: "2025-05-12",
    vigente_ate: null,
  };
  const rascunhoDeSetembro = { id: "safra_2026-09", contrato_id: "safra", customer_code: "BANCO-SAFRA", competencia: "2026-09", status: "rascunho" };

  it("antes da virada do mês, nada: o mês corrente em rascunho e o anterior já aprovado", () => {
    const outubro = { ...rascunhoDeSetembro, id: "safra_2026-10", competencia: "2026-10" };
    const setembro = { ...rascunhoDeSetembro, status: "aprovada" };
    expect(alertaMedicaoNaoEnviada("2026-10-31", [outubro, setembro], [SAFRA])).toEqual([]);
  });

  it("no primeiro dia do mês seguinte, a medição do mês que passou em rascunho alerta (atraso 0) e depois conta os dias", () => {
    expect(alertaMedicaoNaoEnviada("2026-10-01", [rascunhoDeSetembro], [SAFRA])).toEqual([
      {
        medicao_id: "safra_2026-09",
        contrato_id: "safra",
        customer_code: "BANCO-SAFRA",
        competencia: "2026-09",
        situacao: "rascunho",
        envio_ate: "2026-10-01",
        dias_de_atraso: 0,
      },
    ]);
    expect(alertaMedicaoNaoEnviada("2026-10-04", [rascunhoDeSetembro], [SAFRA])[0].dias_de_atraso).toBe(3);
  });

  it("enviada, aprovada ou contestada não alerta", () => {
    for (const status of ["enviada", "aprovada", "contestada"]) {
      expect(alertaMedicaoNaoEnviada("2026-10-04", [{ ...rascunhoDeSetembro, status }], [SAFRA]), status).toEqual([]);
    }
  });

  it("contrato por medição mensal sem a medição do mês que passou: não aberta", () => {
    expect(alertaMedicaoNaoEnviada("2026-10-02", [], [SAFRA])).toEqual([
      {
        medicao_id: "safra_2026-09",
        contrato_id: "safra",
        customer_code: "BANCO-SAFRA",
        competencia: "2026-09",
        situacao: "nao_aberta",
        envio_ate: "2026-10-01",
        dias_de_atraso: 1,
      },
    ]);
  });

  it("contrato de outro regime, encerrado ou fora da vigência não alerta", () => {
    expect(alertaMedicaoNaoEnviada("2026-10-02", [], [{ ...SAFRA, regime_padrao: "por_demanda" }])).toEqual([]);
    expect(alertaMedicaoNaoEnviada("2026-10-02", [], [{ ...SAFRA, status: "encerrado" }])).toEqual([]);
    expect(alertaMedicaoNaoEnviada("2026-10-02", [], [{ ...SAFRA, vigente_de: "2026-10-01" }])).toEqual([]);
  });

  it("a prorrogação reescreve a vigência: o mês do período anterior ainda alerta", () => {
    const prorrogado = {
      ...SAFRA,
      vigente_de: "2026-10-01",
      vigente_ate: "2027-09-30",
      vigencias_anteriores: periodosDosAditivos([{ vigencia_anterior: { de: "2025-10-01", ate: "2026-09-30" } }]),
    };
    expect(alertaMedicaoNaoEnviada("2026-10-02", [], [prorrogado])).toHaveLength(1);
  });

  it("medição de mês bem anterior em rascunho alerta com o atraso dela; o contrato sem medição só alerta o mês que passou", () => {
    const velha = { ...rascunhoDeSetembro, id: "safra_2026-07", competencia: "2026-07" };
    const alertas = alertaMedicaoNaoEnviada("2026-10-04", [velha], [SAFRA]);
    expect(alertas.map((alerta) => [alerta.competencia, alerta.situacao, alerta.dias_de_atraso])).toEqual([
      ["2026-07", "rascunho", 64],
      ["2026-09", "nao_aberta", 3],
    ]);
  });
});

describe("alerta: o app e o servidor alertam o mesmo", () => {
  const contrato = {
    id: "safra",
    customer_code: "BANCO-SAFRA",
    status: "vigente",
    regime_padrao: "medicao_mensal",
    regimes: [],
    vigente_de: "2025-05-12",
    vigente_ate: null,
  };
  const medicoes = [
    { id: "safra_2026-07", contrato_id: "safra", customer_code: "BANCO-SAFRA", competencia: "2026-07", status: "rascunho" },
    { id: "safra_2026-08", contrato_id: "safra", customer_code: "BANCO-SAFRA", competencia: "2026-08", status: "enviada" },
    { id: "itau_2026-09", contrato_id: "itau", customer_code: "ITAU", competencia: "2026-09", status: "rascunho" },
  ];
  const cenarios: Array<[string, typeof medicoes, Array<typeof contrato & Record<string, unknown>>]> = [
    ["2026-09-30", medicoes, [contrato]],
    ["2026-10-01", medicoes, [contrato]],
    ["2026-10-04", [], [contrato]],
    ["2026-10-04", medicoes, [contrato, { ...contrato, id: "outro", regime_padrao: "por_demanda", regimes: [{ regime: "medicao_mensal" }] }]],
    ["2026-01-02", [], [{ ...contrato, vigente_de: "2026-01-01" }]],
    ["2026-02-01", medicoes, [{ ...contrato, status: "encerrado" }]],
    ["2026-10-02", [], [{ ...contrato, vigente_de: "2026-10-01", vigente_ate: "2027-09-30", vigencias_anteriores: periodosDosAditivos([{ vigencia_anterior: { de: "2025-10-01", ate: "2026-09-30" } }]) }]],
  ];

  it.each(cenarios.map((cenario, indice) => [indice, ...cenario] as const))("cenário %i (%s)", (_indice, hoje, lidas, contratos) => {
    const servidor = alertaNoServidor(new Date(`${hoje}T15:00:00Z`), lidas, contratos);
    expect(alertaMedicaoNaoEnviada(hoje, lidas, contratos)).toEqual(servidor);
  });
});
