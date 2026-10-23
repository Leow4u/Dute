import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import type { LinhaDoSaldo } from "@/lib/operacao/demandas";
import { fichaDaLeitura, servicosEmTexto, type FichaDaOs } from "@/lib/operacao/ficha-da-os";
import { linhasParaRevisar, paraRevisar, revisaoInicial, type FormularioDaRevisao } from "@/lib/operacao/revisao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { ReabrirView } from "./reabrir-view";
import { RevisaoView } from "./revisao-view";

/** Operação › Revisão (parte 3.10b, docs/mockups/OpRevisao.dc.html). */

const noop = () => undefined;
const CARLOS = "col_cccccccccccccccc";
const r = (instante: string) => ({ instante, canal: "celular", meio: null, informado_por: CARLOS });

const FICHA = fichaDaLeitura("10045-01", {
  status: "em_revisao",
  edicao: 12,
  demanda: "10045",
  customer_code: "ITAU",
  cliente_nome: "Itaú Unibanco",
  servicos: ["transporte", "montagem"],
  janela: { data: "2026-10-20", inicio: "07:30", fim: "18:00" },
  equipe: [{ colaborador_id: CARLOS, nome: "Carlos Silva", papel: "lider", vinculo: "proprio" }],
  itens: [
    { id: "ln_1", codigo: "3.05", item: "Cadeira", unidade: "UN", planejado: "150", executado: "160", incluidos: [{ ...r("2026-10-20T12:32:00.000Z"), quantidade: "10", pedido_por: "Renata Campos" }] },
    { id: "ln_2", codigo: "2.02", item: "Mesa", unidade: "UN", planejado: "60", executado: "58" },
  ],
  etapas: [
    { etapa: "saida_patio", ...r("2026-10-20T10:05:00.000Z") },
    { etapa: "fim", ...r("2026-10-20T20:20:00.000Z") },
  ],
  fotos: [{ id: "ft_0000000000000001", caminho: "c1", etapa: "fim", ...r("2026-10-20T20:21:00.000Z") }],
  conclusao: {
    ...r("2026-10-20T20:52:00.000Z"),
    aceite: "assinatura",
    responsavel: { nome: "Renata Campos", cargo: "Facilities" },
    assinatura: "os/10045-01/assinatura/as_0123456789abcdef.png",
    diferencas: [{ linha: "ln_2", previsto: "60", executado: "58", motivo: "2 mesas com pé quebrado" }],
  },
}) as FichaDaOs;

const SALDO: LinhaDoSaldo[] = [
  { id: "ln_1", item: "Cadeira", unidade: "UN", escopo: "300", nasOs: "300", osNumeros: [], saldo: "0" },
  { id: "ln_2", item: "Mesa", unidade: "UN", escopo: "120", nasOs: "120", osNumeros: [], saldo: "0" },
];
const LINHAS = linhasParaRevisar(FICHA, SALDO, false);
const CARTOES = paraRevisar([FICHA], { ITAU: "Itaú Unibanco" }, servicosEmTexto);

function render(form: FormularioDaRevisao = revisaoInicial(LINHAS), extra: Partial<Parameters<typeof RevisaoView>[0]> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/operacao/revisao">
      <RevisaoView
        estado="pronto"
        cartoes={CARTOES}
        selecionada="10045-01"
        os={{ ficha: FICHA, cliente: "Itaú Unibanco", linhas: LINHAS, direta: false, urls: { "os/10045-01/assinatura/as_0123456789abcdef.png": "https://example.test/a.png" }, hoje: "2026-10-20" }}
        form={form}
        onForm={noop}
        problemas={[]}
        erro={null}
        ocupado={false}
        onConcluir={noop}
        {...extra}
      />
    </Router>,
  );
}

const DECIDIDO: FormularioDaRevisao = {
  linhas: {
    ln_1: { escolha: "corrigir", quantidade: "155", motivoDaCorrecao: "Contagem em dobro", resto: "aditivo", motivo: "" },
    ln_2: { escolha: "proxima_os", quantidade: "58", motivoDaCorrecao: "", resto: "", motivo: "" },
  },
  nota: "",
};

describe("Revisão", () => {
  it("a lista para revisar e a OS da vez com as conferências, os itens e as divergências", () => {
    const html = render();
    const textos = textosDaTela(html);
    for (const texto of [
      "Revisão",
      "Para revisar",
      "OS 10045-01",
      "2 divergências",
      "Itaú Unibanco · Demanda 10045",
      "Assinada 17:52 por Renata Campos",
      "Em revisão",
      "Demanda 10045",
      "líder Carlos Silva",
      "Concluída em campo 17:20 · assinada 17:52 por Renata Campos (Facilities)",
      "Ver OS",
      "Imprimir",
      "Fotos · 1",
      "Assinatura",
      "Renata Campos · 17:52",
      "Equipe e horários",
      "10h15",
      "contra 10h30 planejadas · 1 pessoa",
      "Itens com divergência",
      "+10 Cadeira · −2 Mesa",
      "Itens · executado e saldo",
      "Escopo da demanda 10045",
      "Orçado na demanda",
      "Saldo na demanda",
      "Divergências",
      "+10 Cadeira · acima do orçado (310 de 300)",
      "+10 incluídas em campo · Carlos Silva · às 09:32 · pedido por Renata Campos",
      "Pedir aditivo ao Comercial",
      "Absorver sem cobrar",
      "Corrigir quantidade",
      "−2 Mesa",
      "Na conclusão: 2 mesas com pé quebrado",
      "Passar para a próxima OS",
      "Encerrar sem executar",
      "Nota da revisão",
      "Concluir revisão",
    ]) {
      expect(textos, texto).toContain(texto);
    }
    expect(html).toContain('href="/operacao/os?numero=10045-01"');
    expect(html).toContain('src="https://example.test/a.png"');
    expect(html).not.toContain("R$");
  });

  it("corrigida a quantidade, o que resta se decide; com aditivo, o botão diz", () => {
    const textos = textosDaTela(render(DECIDIDO));
    for (const texto of ["Quantidade executada", "Motivo da correção", "O que resta · +5", "Concluir revisão e pedir aditivo"]) expect(textos, texto).toContain(texto);
  });

  it("sem legenda: só rótulos, dados e ações", () => {
    expect(
      textosForaDaLista(render(DECIDIDO), [
        /^(Revisão|Para revisar|1|OS 10045-01|2 divergências|Itaú Unibanco · Demanda 10045|Transporte e montagem|Assinada 17:52 por Renata Campos)$/,
        /^(Em revisão|Demanda 10045|·|Itaú Unibanco|hoje 07:30–18:00|líder Carlos Silva|Concluída em campo .+|Ver OS|Imprimir)$/,
        /^(Fotos · 1|Assinatura|Renata Campos · 17:52|Equipe e horários|10h15|contra 10h30 planejadas · 1 pessoa|Itens com divergência|2|\+10 Cadeira · −2 Mesa)$/,
        /^(Itens · executado e saldo|Escopo da demanda 10045|Item|Un|Planejado|Executado|Diferença|Orçado na demanda|Saldo na demanda)$/,
        /^(3\.05|2\.02|Cadeira|Mesa|un|\d+|[+−]\d+|—)$/,
        /^(Divergências|\+10 Cadeira · acima do orçado \(310 de 300\)|\+10 incluídas em campo .+|−2 Mesa|Na conclusão: .+)$/,
        /^(Pedir aditivo ao Comercial|Absorver sem cobrar|Corrigir quantidade|Passar para a próxima OS|Encerrar sem executar)$/,
        /^(Quantidade executada|Motivo da correção|O que resta · \+5|Nota da revisão|Concluir revisão e pedir aditivo)$/,
      ]),
    ).toEqual([]);
  });

  it("sem OS para revisar diz isso; os problemas aparecem como alerta", () => {
    expect(textosDaTela(renderToStaticMarkup(<Router ssrPath="/operacao/revisao"><RevisaoView estado="pronto" cartoes={[]} selecionada={null} os={null} form={null} onForm={noop} problemas={[]} erro={null} ocupado={false} onConcluir={noop} /></Router>))).toContain("Nenhuma OS para revisar");
    expect(textosDaTela(render(revisaoInicial(LINHAS), { problemas: ["Cadeira: decida a divergência (+10)."] }))).toContain("Cadeira: decida a divergência (+10).");
  });

  it("não tem problema de acessibilidade", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
    expect(await violacoesDeAcessibilidade(render(DECIDIDO, { problemas: ["x"], erro: "y" }))).toEqual([]);
  });
});

describe("Reabrir a OS", () => {
  it("o motivo e a confirmação, sem problema de acessibilidade", async () => {
    const html = renderToStaticMarkup(<ReabrirView motivo="" onMotivo={noop} problema="Informe o motivo da reabertura." erro={null} ocupado={false} onCancelar={noop} onReabrir={noop} />);
    expect(textosDaTela(html)).toEqual(["Reabrir OS", "Motivo", "Informe o motivo da reabertura.", "Cancelar"]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});
