import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { andamentoInicial, inclusaoVazia, type FormularioDeAndamento } from "@/lib/operacao/andamento";
import { fichaDaLeitura, type FichaDaOs } from "@/lib/operacao/ficha-da-os";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { AndamentoView } from "./andamento-view";

/** "Registrar andamento" na ficha da OS (parte 3.7e, docs/mockups/OpOS.dc.html). */

const noop = () => undefined;
const AGORA = new Date("2026-10-22T17:20:00.000Z");

const FICHA = fichaDaLeitura("10045-01", {
  status: "em_execucao",
  edicao: 9,
  demanda: "10045",
  customer_code: "ITAU",
  janela: { data: "2026-10-22", inicio: "07:30", fim: "18:00" },
  equipe: [
    { colaborador_id: "col_cccccccccccccccc", nome: "Carlos Silva", papel: "lider", vinculo: "proprio" },
    { colaborador_id: "col_jjjjjjjjjjjjjjjj", nome: "João Pereira", papel: "motorista", vinculo: "proprio" },
  ],
  itens: [
    { id: "ln_1", item: "Cadeira Flexform", unidade: "UN", planejado: "150", executado: "96", incluidos: [{ quantidade: "10", instante: "2026-10-22T12:32:00.000Z" }] },
    { id: "ln_2", item: "Mesa de trabalho", unidade: "UN", planejado: "60" },
  ],
  etapas: [{ etapa: "saida_patio", instante: "2026-10-22T10:05:00.000Z" }],
}) as FichaDaOs;

const INICIAL = andamentoInicial(FICHA, AGORA);

function render(form: FormularioDeAndamento, extra: Partial<Parameters<typeof AndamentoView>[0]> = {}) {
  return renderToStaticMarkup(
    <AndamentoView
      ficha={FICHA}
      form={form}
      onForm={noop}
      problemas={[]}
      erro={null}
      ocupado={false}
      fotos={[]}
      onFotos={noop}
      onTirarFoto={noop}
      anexos={{ fotosDoFinal: [], assinatura: null, onFotosDoFinal: noop, onTirarFotoDoFinal: noop, onAssinatura: noop }}
      onCancelar={noop}
      onRegistrar={noop}
      {...extra}
    />,
  );
}

describe("Registrar andamento", () => {
  it("etapa: as etapas que ainda se registram, data, hora, quem informou e o meio", () => {
    const html = render(INICIAL);
    const textos = textosDaTela(html);
    for (const texto of ["Registrar andamento", "escritório", "Etapa", "Itens", "Ocorrência", "Chegada na origem", "Fim", "Data", "Hora", "Informado por", "Carlos Silva · Líder", "Meio", "Telefone", "WhatsApp", "Cancelar", "Registrar"]) {
      expect(textos, texto).toContain(texto);
    }
    expect(textos).not.toContain("Saída do pátio");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Etapa</);
  });

  it("itens: o feito de cada linha com o previsto e o que passou do planejado", () => {
    const html = render({ ...INICIAL, tipo: "itens", inclusao: { ...inclusaoVazia(FICHA), linha: "avulso" } });
    const textos = textosDaTela(html);
    for (const texto of ["Cadeira Flexform", "de 160", "Mesa de trabalho", "de 60", "Além do planejado", "Item", "Item avulso", "Nome do item", "Unidade", "Quantidade", "Quem pediu no local", "Motivo", "Tirar"]) {
      expect(textos, texto).toContain(texto);
    }
    expect(textosDaTela(render({ ...INICIAL, tipo: "itens" }))).toContain("Incluir além do planejado");
  });

  it("ocorrência: a descrição, quem informou e as fotos escolhidas", () => {
    const textos = textosDaTela(render({ ...INICIAL, tipo: "ocorrencia" }, { fotos: ["IMG_0931.jpg"] }));
    for (const texto of ["Descrição", "Informado por", "Fotos", "IMG_0931.jpg", "Anexar"]) expect(textos, texto).toContain(texto);
  });

  it("conclusão: a hora do fim, o motivo dos itens a menos, as fotos do final e a via assinada", () => {
    const conclusao = { ...INICIAL, tipo: "conclusao" as const, nome: "Renata Campos" };
    const anexos = { fotosDoFinal: ["IMG_0950.jpg"], assinatura: "via-assinada.jpg", onFotosDoFinal: noop, onTirarFotoDoFinal: noop, onAssinatura: noop };
    const html = render(conclusao, { anexos });
    const textos = textosDaTela(html);
    for (const texto of [
      "Conclusão",
      "Data do fim",
      "Hora do fim",
      "Informado por",
      "Meio",
      "Motivo dos itens a menos",
      "Cadeira Flexform · 96 de 160",
      "Mesa de trabalho · 0 de 60",
      "Fotos do final",
      "IMG_0950.jpg",
      "Aceite",
      "Via assinada no papel",
      "Sem aceite no local",
      "Responsável do cliente",
      "Cargo",
      "Via assinada",
      "via-assinada.jpg",
      "Concluir OS",
    ]) {
      expect(textos, texto).toContain(texto);
    }
    const sem = textosDaTela(render({ ...conclusao, aceite: "sem_aceite" }, { anexos }));
    expect(sem).toContain("Quem recebeu");
    expect(sem).not.toContain("CPF ou RG");
    expect(sem).not.toContain("via-assinada.jpg");
  });

  it("o que impede e o erro da callable aparecem como alerta", () => {
    const textos = textosDaTela(render(INICIAL, { problemas: ["Escolha a etapa."], erro: "A OS foi atualizada." }));
    expect(textos).toContain("Escolha a etapa.");
    expect(textos).toContain("A OS foi atualizada.");
  });

  it("sem legenda: só rótulos, dados e ações", () => {
    expect(
      textosForaDaLista(render({ ...INICIAL, tipo: "itens", inclusao: inclusaoVazia(FICHA) }), [
        /^(Registrar andamento|escritório|Etapa|Itens|Ocorrência|Conclusão)$/,
        /^(Cadeira Flexform|Mesa de trabalho|de \d+)$/,
        /^(Além do planejado|Item|Item avulso|Quantidade|Quem pediu no local|Motivo|Tirar)$/,
        /^(Informado por|Ninguém da equipe|Carlos Silva · Líder|João Pereira · Motorista|Meio|Sem meio|Telefone|WhatsApp|Presencial)$/,
        /^(Cancelar|Registrar)$/,
      ]),
    ).toEqual([]);
  });

  it("conclusão sem legenda: só rótulos, dados e ações", () => {
    expect(
      textosForaDaLista(render({ ...INICIAL, tipo: "conclusao" }), [
        /^(Registrar andamento|escritório|Etapa|Itens|Ocorrência|Conclusão)$/,
        /^(Data do fim|Hora do fim|Motivo dos itens a menos|Cadeira Flexform · 96 de 160|Mesa de trabalho · 0 de 60|Fotos do final|Anexar)$/,
        /^(Aceite|Via assinada no papel|Sem aceite no local|Responsável do cliente|Cargo|Via assinada)$/,
        /^(Informado por|Ninguém da equipe|Carlos Silva · Líder|João Pereira · Motorista|Meio|Sem meio|Telefone|WhatsApp|Presencial)$/,
        /^(Cancelar|Concluir OS)$/,
      ]),
    ).toEqual([]);
  });

  it("não tem problema de acessibilidade", async () => {
    for (const form of [INICIAL, { ...INICIAL, tipo: "itens" as const, inclusao: inclusaoVazia(FICHA) }, { ...INICIAL, tipo: "ocorrencia" as const }, { ...INICIAL, tipo: "conclusao" as const }]) {
      expect(await violacoesDeAcessibilidade(render(form, { fotos: ["IMG_0931.jpg"], problemas: ["Descreva a ocorrência."] }))).toEqual([]);
    }
  });
});

describe("Registrar andamento na vistoria (parte 3.11d)", () => {
  it("só a etapa e a ocorrência; das etapas, só ir e chegar", () => {
    const vistoria = { ...FICHA, tipo: "vistoria" as const, itens: [], etapas: [] };
    const html = render(andamentoInicial(vistoria, AGORA), { ficha: vistoria });
    const textos = textosDaTela(html);
    expect(textos).toEqual(expect.arrayContaining(["Etapa", "Ocorrência", "Saída do pátio", "Chegada na origem"]));
    for (const ausente of ["Itens", "Conclusão", "Carregamento", "Montagem", "Fim"]) expect(textos, ausente).not.toContain(ausente);
  });
});
