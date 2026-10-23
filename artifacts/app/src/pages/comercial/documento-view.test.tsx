import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { documentoDoOrcamento, fonteDoDocumento } from "@/lib/comercial/documento";

import { OrcamentoDocumento } from "@/components/comercial/orcamento-documento";

import { DocumentoView, type DocumentoViewProps } from "./documento-view";

/**
 * O documento A4 do orçamento (docs/mockups/ComDocumento.dc.html), só a
 * apresentação: o papel que sai na impressão (.print-area), a barra que não
 * sai (.no-print), a marca "Prévia" até o envio e nenhuma legenda.
 */

const DEMANDA = {
  customer_name: "Itaú Unibanco S.A.",
  contrato_id: "itau-2026",
  titulo: "Mudança de 24 estações de trabalho",
  ref_cliente: "CE8977",
  solicitante: { contato_id: "ct_renata", empresa: "Souza & Lopes" },
  origem: { local_id: "loc_ceic", complemento: "8º andar" },
  destino: { local_id: "loc_fl", complemento: "12º andar" },
  execucao: { datas: ["2026-10-29"], a_definir: false },
};

const QUOTE = {
  rotulo: "10045 – RV01",
  rv: 1,
  tipo_rv: "proposta",
  status: "aprovado",
  data_base: "2026-10-14",
  tabela: { id: "pt", nome: "LPU v2.0", variante: "Comercial" },
  linhas: [
    { id: "ln_1", origem: "tabela", codigo: "1.01", item: "Estação de trabalho em L 1,40 m", servico: "Desmontagem", unidade: "UN", quantidade: "24", preco: "38.5", total_cents: 92_400 },
    { id: "ln_2", origem: "tabela", codigo: "5.02", item: "Transporte dedicado VUC até 2,5 t", servico: "Frete", unidade: "VG", quantidade: "3", preco: "690", total_cents: 207_000 },
  ],
  total_cents: 299_400,
  condicoes: "Itens sujeitos a visita técnica.\nFaturamento após autorização do cliente.",
  autor_nome: "Guilherme",
};

const CONTEXTO = {
  numero: "10045",
  agora: new Date("2026-10-21T15:00:00.000Z"),
  contato: { nome: "Renata Albuquerque", empresa: "Souza & Lopes" },
  origem: "CEIC – Torre Olavo Setubal",
  destino: "Faria Lima 3400",
  contrato: { nome: "Contrato Itaú", numeros: ["2021/0187"] },
  autorNome: null,
};

function documento(enviado: boolean) {
  const revisao = enviado ? { ...QUOTE, demanda: DEMANDA, enviado_em: "2026-10-16T13:02:00.000Z" } : null;
  const fonte = fonteDoDocumento({ rv: 1, quote: QUOTE, demanda: DEMANDA, revisao });
  if (fonte.estado !== "pronto") throw new Error("fonte");
  return documentoDoOrcamento(fonte, CONTEXTO);
}

function render(overrides: Partial<DocumentoViewProps> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/comercial/orcamento/documento">
      <DocumentoView
        estado="pronto"
        documento={documento(false)}
        voltar={{ href: "/comercial/orcamento?numero=10045", rotulo: "Orçamento" }}
        onImprimir={() => undefined}
        {...overrides}
      />
    </Router>,
  );
}

/** Textos visíveis, na ordem (a marca d'água é aria-hidden e entra também). */
function texts(html: string) {
  return html
    .replace(/<style>.*?<\/style>/g, "")
    .split(/<[^>]+>/)
    .map((text) => text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/ /g, " ").trim())
    .filter(Boolean);
}

const PAPEL = [
  "Dutelog Soluções Logísticas",
  "Prévia",
  "Proposta",
  "Orçamento 10045 – RV01",
  "Total R$ 2.994,00",
  "Prévia em",
  "21/10/2026",
  "Data-base de preço",
  "14/10/2026",
  "Data de execução",
  "29/10/2026",
  "Cliente",
  "Itaú Unibanco S.A.",
  "Contrato nº",
  "2021/0187",
  "Tabela",
  "LPU v2.0 · Comercial",
  "Para",
  "Renata Albuquerque · Souza & Lopes",
  "Referência do cliente",
  "CE8977",
  "Descrição da atividade",
  "Mudança de 24 estações de trabalho",
  "Origem",
  "CEIC – Torre Olavo Setubal · 8º andar",
  "Destino",
  "Faria Lima 3400 · 12º andar",
  "Código",
  "Item",
  "Serviço",
  "Unid.",
  "Valor unit.",
  "Qtd",
  "Total",
  "1.01",
  "Estação de trabalho em L 1,40 m",
  "Desmontagem",
  "UN",
  "38,50",
  "24",
  "924,00",
  "5.02",
  "Transporte dedicado VUC até 2,5 t",
  "Frete",
  "VG",
  "690,00",
  "3",
  "2.070,00",
  "Total geral",
  "R$ 2.994,00",
  "Condições",
  "Itens sujeitos a visita técnica.",
  "Faturamento após autorização do cliente.",
  "Orçamento elaborado por Guilherme · Comercial",
  "comercial@dutelog.com.br",
  "10045 – RV01",
];

describe("documento A4 do orçamento", () => {
  it("sem legenda: a barra (voltar, título, imprimir) e o papel só têm rótulos e dados", () => {
    expect(texts(render())).toEqual(["Orçamento", "Orçamento 10045 – RV01", "Imprimir / Salvar PDF", "Prévia", ...PAPEL]);
  });

  it("até o envio, a marca Prévia (no cabeçalho e atravessada no papel)", () => {
    const html = render();
    expect(html.match(/>Prévia</g)).toHaveLength(2);
    expect(html).toMatch(/aria-hidden="true"[^>]*><span[^>]*>Prévia<\/span>/);
  });

  it("enviado: a cópia congelada, sem a marca, com a emissão do envio", () => {
    const html = render({ documento: documento(true) });
    expect(html).not.toContain("Prévia");
    const lista = texts(html);
    expect(lista.slice(lista.indexOf("Emissão"), lista.indexOf("Emissão") + 2)).toEqual(["Emissão", "16/10/2026"]);
  });

  it("só o papel sai na impressão (.print-area); a barra, não (.no-print); A4 em pé", () => {
    const html = render();
    expect(html).toMatch(/<div class="no-print [^"]*">/);
    expect(html).toMatch(/<article aria-label="Orçamento 10045 – RV01" class="print-area /);
    expect(html).toContain("@page { size: A4; }");
    // Uma ação: imprimir.
    expect(html.match(/bg-primary text-primary-foreground/g)).toHaveLength(1);
  });

  it("no celular o papel não se espreme: fica na largura do A4 e a caixa em volta rola para o lado", () => {
    const html = render();
    const papel = html.match(/<article aria-label="Orçamento 10045 – RV01" class="([^"]*)"/)?.[1] ?? "";
    expect(papel.split(" ")).toEqual(expect.arrayContaining(["w-[794px]", "max-w-none", "shrink-0"]));
    expect(papel.split(" ")).not.toContain("w-full");
    expect(html).toMatch(/<div class="[^"]*overflow-x-auto[^"]*"><article/);
  });

  it("aberto da aprovação, volta a ela", () => {
    const lista = texts(render({ voltar: { href: "/comercial/aprovar?numero=10045", rotulo: "Para aprovar" } }));
    expect(lista[0]).toBe("Para aprovar");
    expect(render({ voltar: { href: "/comercial/aprovar?numero=10045", rotulo: "Para aprovar" } })).toContain(
      'href="/comercial/aprovar?numero=10045"',
    );
  });

  it("com a razão social e o CNPJ (parte 6.20), o cabeçalho os mostra com a cidade; sem eles, só o nome", () => {
    const comEmissor = texts(
      renderToStaticMarkup(
        <OrcamentoDocumento
          documento={documento(true)}
          emissor={{ razaoSocial: "Empresa Exemplo Ltda.", cnpj: "11222333000181", cidade: "São Paulo/SP" }}
        />,
      ),
    );
    expect(comEmissor.slice(0, 2)).toEqual(["Empresa Exemplo Ltda.", "CNPJ 11.222.333/0001-81 · São Paulo/SP"]);
    const semEmissor = texts(renderToStaticMarkup(<OrcamentoDocumento documento={documento(true)} emissor={{ razaoSocial: "", cnpj: "", cidade: "" }} />));
    expect(semEmissor[0]).toBe("Dutelog Soluções Logísticas");
    expect(semEmissor.some((texto) => texto.startsWith("CNPJ"))).toBe(false);
  });

  it("carregando, não encontrado e erro, sem o papel nem a impressão", () => {
    for (const [estado, mensagem] of [
      ["carregando", "Carregando..."],
      ["nao_encontrado", "Orçamento não encontrado"],
      ["erro", "Não foi possível carregar o orçamento."],
    ] as const) {
      const html = render({ estado, documento: null });
      expect(texts(html), estado).toEqual(["Orçamento", "Imprimir / Salvar PDF", mensagem]);
      expect(html).not.toContain("print-area");
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Imprimir/);
    }
  });
});
