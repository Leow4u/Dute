import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { documentoDaOs } from "@/lib/operacao/os-documento";
import { fichaDaLeitura, type FichaDaOs } from "@/lib/operacao/ficha-da-os";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { OsImpressaoView } from "./os-impressao-view";

/** A OS impressa, via operacional (parte 3.9d, docs/mockups/OSImpressao.dc.html). */

const noop = () => undefined;
const AGORA = new Date("2026-10-22T13:52:00.000Z"); // 10:52 em São Paulo
const CARLOS = "col_cccccccccccccccc";
const r = (instante: string) => ({ instante, canal: "celular", meio: null, informado_por: CARLOS });

const DADOS = {
  status: "agendada",
  edicao: 4,
  demanda: "10045",
  customer_code: "ITAU",
  cliente_nome: "Itaú Unibanco",
  servicos: ["transporte", "montagem"],
  janela: { data: "2026-10-22", inicio: "07:30", fim: "18:00" },
  locais: {
    origem: { endereco: "Av. Brig. Faria Lima, 3500", complemento: "4º andar", contato: { nome: "Renata Campos", telefone: "11987654321" } },
    destino: { endereco: "Torre B", complemento: "12º andar" },
  },
  instrucoes: "Doca pelo subsolo 2",
  equipe: [
    { colaborador_id: CARLOS, nome: "Carlos Silva", papel: "lider", vinculo: "proprio" },
    { colaborador_id: "col_jjjjjjjjjjjjjjjj", nome: "João Pereira", papel: "motorista", vinculo: "proprio" },
    { colaborador_id: "col_dddddddddddddddd", nome: "Diego Alves", papel: "montador", vinculo: "freelancer" },
    { colaborador_id: "col_vvvvvvvvvvvvvvvv", nome: "Valter Moreira", papel: "motorista", vinculo: "terceiro", empresa: "Rota Sul" },
  ],
  veiculos: [{ veiculo_id: "vei_aaaaaaaaaaaaaaaa", placa: "DEF4G56", tipo: "Baú", modelo: "VW Delivery", dono: "proprio" }],
  itens: [
    { id: "ln_1", codigo: "3.05", item: "Transporte de cadeira Flexform", unidade: "UN", planejado: "150", incluidos: [{ ...r("2026-10-22T12:32:00.000Z"), quantidade: "10" }], executado: "160" },
    { id: "ln_2", codigo: "2.02", item: "Montagem de mesa de trabalho", unidade: "UN", planejado: "60", executado: "58" },
    { id: "ln_3", item: "Caixa de arquivo", unidade: "CX", planejado: "2.5" },
  ],
};

const AGENDADA = fichaDaLeitura("10045-01", DADOS) as FichaDaOs;
const CONCLUIDA = fichaDaLeitura("10045-01", {
  ...DADOS,
  status: "em_revisao",
  etapas: [{ etapa: "fim", ...r("2026-10-22T20:52:00.000Z") }],
  conclusao: {
    ...r("2026-10-22T20:52:00.000Z"),
    aceite: "assinatura",
    responsavel: { nome: "Renata Campos", cargo: "Facilities", documento: "12.345.678-9" },
    assinatura: "os/10045-01/assinatura/as_0123456789abcdef.png",
    diferencas: [{ linha: "ln_2", previsto: "60", executado: "58", motivo: "Quebrada" }],
  },
}) as FichaDaOs;

function render(ficha: FichaDaOs, status: string, url: string | null = null) {
  const documento = documentoDaOs(ficha, { cliente: "Itaú Unibanco S.A.", titulo: "Mudança do 5º andar", status, agora: AGORA });
  return renderToStaticMarkup(
    <Router ssrPath="/operacao/os/impressao">
      <OsImpressaoView estado="pronto" numero="10045-01" documento={documento} urlDaAssinatura={url} onImprimir={noop} />
    </Router>,
  );
}

describe("OS impressa", () => {
  it("o cabeçalho, o cliente, a equipe e a frota, os locais, os itens e as assinaturas em branco", () => {
    const html = render(AGENDADA, "Agendada");
    const textos = textosDaTela(html);
    for (const texto of [
      "OS 10045-01",
      "Imprimir OS 10045-01",
      "Imprimir",
      "Ordem de serviço",
      "Nº 10045-01",
      "Transporte e montagem",
      "Emitida em 22/10/2026 às 10:52 · Agendada",
      "Itaú Unibanco S.A.",
      "10045",
      "Mudança do 5º andar",
      "22/10/2026 · 07:30–18:00",
      "Carlos Silva (líder), João Pereira (motorista), Diego Alves (montador · freelancer), Valter Moreira (motorista · terceiro Rota Sul)",
      "DEF-4G56 · VW Delivery · Baú",
      "Av. Brig. Faria Lima, 3500 · 4º andar",
      "Renata Campos · 11987654321",
      "Torre B · 12º andar",
      "Transporte de cadeira Flexform",
      "160",
      "2,5",
      "cx",
      "Doca pelo subsolo 2",
      "Líder Dutelog",
      "Carlos Silva · data ____/____/______",
      "João Pereira · CNH ______________",
      "Cliente / recebedor",
      "Nome ______________ · Doc. ______________ · ___:___",
      "OS 10045-01 · via operacional",
    ]) {
      expect(textos, texto).toContain(texto);
    }
    // A via de campo vai com o feito em branco.
    expect(textos).not.toContain("58");
  });

  it("sem valor nenhum", () => {
    for (const html of [render(AGENDADA, "Agendada"), render(CONCLUIDA, "Em revisão", "https://example.test/a.png")]) {
      expect(html).not.toMatch(/R\$|valor|preço|total/i);
    }
  });

  it("concluída: o feito e o aceite com a assinatura", () => {
    const html = render(CONCLUIDA, "Em revisão", "https://example.test/assinatura.png");
    const textos = textosDaTela(html);
    expect(textos).toContain("58");
    // O documento que a OS antiga gravou não aparece (decisão 3 da LGPD).
    expect(textos).toContain("Renata Campos · Facilities · 17:52");
    expect(textos.join(" ")).not.toContain("12.345.678-9");
    expect(html).toContain('src="https://example.test/assinatura.png"');
    expect(html).toContain('alt="Assinatura de Renata Campos"');
  });

  it("sem legenda: só rótulos, dados e ações", () => {
    expect(
      textosForaDaLista(render(AGENDADA, "Agendada"), [
        /^(OS 10045-01|Imprimir OS 10045-01|Imprimir|Ordem de serviço|Nº 10045-01|Transporte e montagem|Emitida em .+)$/,
        /^(Dutelog Soluções Logísticas|Cliente|Itaú Unibanco S\.A\.|Demanda|10045|Pedido|Mudança do 5º andar)$/,
        /^(Agendamento e equipe|Data e janela|22\/10\/2026 · 07:30–18:00|Equipe|Veículos|.+ \(líder\), .+|DEF-4G56 · VW Delivery · Baú)$/,
        /^(Origem|Destino|Endereço|Contato no local|Av\. .+|Torre B · 12º andar|Renata Campos · 11987654321|—)$/,
        /^(Itens|Código|Item|Unid\.|Previsto|Feito|3\.05|2\.02|Transporte de cadeira Flexform|Montagem de mesa de trabalho|Caixa de arquivo|un|cx|\d+(,\d+)?)$/,
        /^(Instruções|Doca pelo subsolo 2)$/,
        /^(Líder Dutelog|Motorista|Cliente \/ recebedor|.+ · data .+|.+ · CNH .+|Nome .+)$/,
        /^(app\.dutelog\.com\.br|OS 10045-01 · via operacional)$/,
      ]),
    ).toEqual([]);
  });

  it("carregando e não encontrada não imprimem", () => {
    const html = renderToStaticMarkup(
      <Router ssrPath="/operacao/os/impressao">
        <OsImpressaoView estado="nao_encontrada" numero="10045-09" documento={null} urlDaAssinatura={null} onImprimir={noop} />
      </Router>,
    );
    expect(textosDaTela(html)).toContain("OS 10045-09 não encontrada");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Imprimir/);
  });

  it("não tem problema de acessibilidade", async () => {
    expect(await violacoesDeAcessibilidade(render(AGENDADA, "Agendada"))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render(CONCLUIDA, "Em revisão", "https://example.test/a.png"))).toEqual([]);
  });
});
