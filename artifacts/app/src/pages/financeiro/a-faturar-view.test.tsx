import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import {
  autorizacaoDoFinanceiro,
  competenciaDoFinanceiro,
  demandaDoFinanceiro,
  formInicial,
  linhaAFaturar,
  linhaDaArmazenagem,
  type LinhaAFaturar,
} from "@/lib/financeiro/a-faturar";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { AFaturarView, type AFaturarViewProps } from "./a-faturar-view";

/**
 * Financeiro › A faturar (parte 4.1b): as prontas por cliente, o painel de
 * registrar a NF e as que esperam. Só rótulos, dados e ações; uma ação
 * principal, "Registrar NF", e a identidade v3. Dados sintéticos.
 */

const AGORA = new Date("2026-10-23T15:00:00.000Z");
const HOJE = "2026-10-23";

const AUTORIZACOES = new Map([
  ["aut_itau", autorizacaoDoFinanceiro("aut_itau", { customer_code: "ITAU", status: "registrada", pedido: "4500000009", aceite: "ACE-1", demandas: [{ numero: "10045", rv: 2 }] })],
]);

function linha(numero: string, extra: Record<string, unknown>, valor: number | null): LinhaAFaturar {
  const demanda = demandaDoFinanceiro(numero, {
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    titulo: `Serviço ${numero}`,
    etapa: "a_faturar",
    etapa_desde: "2026-10-20T12:00:00.000Z",
    validacao: { rv: 2, autorizacao: "pedido_aceite" },
    autorizacao_ids: ["aut_itau"],
    ...extra,
  })!;
  return linhaAFaturar(demanda, AUTORIZACOES, valor);
}

const LINHAS: LinhaAFaturar[] = [
  linha("10045", { titulo: "Desmontagem e transporte de mobiliário" }, 1_234_500),
  linha("10046", { validacao: { rv: 0, autorizacao: "pedido_aceite" }, etapa_desde: "2026-10-01T12:00:00.000Z" }, 250_000),
  linha("10060", { customer_code: "SAFRA", customer_name: "Banco Safra", validacao: { rv: 0, autorizacao: "nenhuma" }, autorizacao_ids: [], titulo: null }, 50_000),
  linha("10047", { etapa: "aguardando_autorizacao", titulo: "Transporte de arquivo deslizante" }, 90_000),
  linha("10050", { customer_code: "SAFRA", customer_name: "Banco Safra", medicao_pendente: true, validacao: { autorizacao: "medicao_aprovada", medicao_id: "ctr_safra_2026-10" }, autorizacao_ids: [], titulo: "Medição de outubro" }, null),
];

const noop = () => undefined;

function props(extra: Partial<AFaturarViewProps> = {}): AFaturarViewProps {
  return {
    estado: "pronto",
    linhas: LINHAS,
    busca: "",
    painel: { aberto: true, marcadas: ["10045"], form: { ...formInicial(HOJE, null), numero: "1234", vencimento: "2026-11-20" }, resultado: null, erro: null },
    hoje: HOJE,
    agora: AGORA,
    ocupado: false,
    acoes: { buscar: noop, abrirPainel: noop, fecharPainel: noop, marcar: noop, editar: noop, registrar: noop },
    ...extra,
  };
}

function render(extra: Partial<AFaturarViewProps> = {}): string {
  return renderToStaticMarkup(
    <Router ssrPath="/financeiro/a-faturar">
      <AFaturarView {...props(extra)} />
    </Router>,
  );
}

const PRONTAS = [
  "Prontas para faturar",
  "3",
  "R$ 15.345,00",
  "Banco Safra",
  "1",
  "R$ 500,00",
  "10060",
  "RV 0 · Sem exigência de autorização",
  "3 dias",
  "Itaú Unibanco",
  "2",
  "R$ 14.845,00",
  "10046",
  "Serviço 10046",
  "RV 0 · Pedido 4500000009 · aceite ACE-1",
  "R$ 2.500,00",
  "22 dias",
  "10045 – RV02",
  "Desmontagem e transporte de mobiliário",
  "RV 2 · Pedido 4500000009 · aceite ACE-1",
  "R$ 12.345,00",
];

// Os textos repetidos (o cliente, a demanda marcada e o valor dela) já apareceram na fila.
const PAINEL = [
  "Registrar NF",
  "Cliente",
  "Número da NF",
  "Série",
  "Emissão",
  "Vencimento",
  "Forma de pagamento",
  "Boleto",
  "Pix",
  "Transferência",
  "Cartão",
  "Dinheiro",
  "Observação",
  "Na NF",
  "Total da NF",
  "Cancelar",
];

const ESPERANDO = [
  "Esperando",
  "10050",
  "Medição de outubro",
  "Banco Safra · Medição 10/2026 · Sem autorização registrada",
  "—",
  "Medição pendente",
  "10047 – RV02",
  "Transporte de arquivo deslizante",
  "Itaú Unibanco · RV 2 · Pedido 4500000009 · aceite ACE-1",
  "R$ 900,00",
  "Aguardando autorização",
];

const PRINCIPAL = /<button[^>]*class="[^"]*bg-primary text-primary-foreground[^"]*"[^>]*>[\s\S]*?<\/button>/g;

function secao(html: string, rotulo: string): string {
  const rotuloEm = html.indexOf(`aria-label="${rotulo}"`);
  expect(rotuloEm, rotulo).toBeGreaterThan(-1);
  // Do começo da tag da seção até o fim dela.
  return html.slice(html.lastIndexOf("<", rotuloEm), html.indexOf("</section>", rotuloEm));
}

const FECHADO = { aberto: false, marcadas: [], form: formInicial(HOJE, null), resultado: null, erro: null };

describe("A faturar", () => {
  it("sem legenda: a fila, o painel e as que esperam só têm rótulos, dados e ações", () => {
    expect(textosDaTela(render())).toEqual(["A faturar", ...PRONTAS, ...PAINEL, ...ESPERANDO]);
    const permitidos = [
      "A faturar",
      "Prontas para faturar",
      "Esperando",
      "Cliente",
      ...PAINEL,
      /^\d+$/,
      /^R\$ [\d.]+,\d{2}$/,
      "—",
      /^\d+( – RV\d{2})?$/,
      /^(Serviço \d+|Desmontagem e transporte de mobiliário|Transporte de arquivo deslizante|Medição de outubro)$/,
      /^(Itaú Unibanco|Banco Safra)$/,
      /^((Itaú Unibanco|Banco Safra) · )?(RV \d+|Medição \d{2}\/\d{4}) · (Pedido \d+ · aceite [\w-]+|Sem exigência de autorização|Sem autorização registrada)$/,
      /^\d+ dias?$/,
      "Medição pendente",
      "Aguardando autorização",
    ];
    expect(textosForaDaLista(render(), permitidos)).toEqual([]);
  });

  it("identidade v3 e uma ação principal só: Registrar NF", () => {
    const html = render();
    expect(html).toMatch(/^<div class="v3 /);
    const principais = html.match(PRINCIPAL) ?? [];
    expect(principais).toHaveLength(1);
    expect(textosDaTela(principais[0] ?? "")).toEqual(["Registrar NF"]);
  });

  it("com uma demanda do Itaú marcada, só as prontas do Itaú têm caixa; a do Safra espera outra NF", () => {
    const prontas = secao(render(), "Prontas para faturar");
    expect([...prontas.matchAll(/aria-label="Incluir ([^"]+)"/g)].map(([, rotulo]) => rotulo)).toEqual(["10046", "10045 – RV02"]);
    const caixa = (rotulo: string) => prontas.match(new RegExp(`<button[^>]*aria-label="Incluir ${rotulo}"[^>]*>`))?.[0] ?? "";
    expect(caixa("10045 – RV02")).toContain('aria-checked="true"');
    expect(caixa("10046")).toContain('aria-checked="false"');
    const painel = secao(render(), "Registrar NF");
    expect(painel).toContain('aria-label="Tirar 10045 – RV02"');
    expect(textosDaTela(painel)).toContain("R$ 12.345,00");
    // A que espera nunca tem caixa.
    expect(secao(render(), "Esperando")).not.toContain("Incluir");
  });

  it("a emissão não passa de hoje; o vencimento não vem antes da emissão; o erro do servidor aparece no painel", () => {
    const html = render({ painel: { aberto: true, marcadas: ["10045"], form: { ...formInicial(HOJE, null), numero: "1234", vencimento: "2026-11-20" }, resultado: null, erro: "A NF 1234 da série 1 já está registrada." } });
    expect(html).toMatch(/id="nf-emissao"[^>]*max="2026-10-23"|max="2026-10-23"[^>]*id="nf-emissao"/);
    expect(html).toMatch(/id="nf-vencimento"[^>]*min="2026-10-23"|min="2026-10-23"[^>]*id="nf-vencimento"/);
    expect(html).toMatch(/<p role="alert"[^>]*>A NF 1234 da série 1 já está registrada\.<\/p>/);
  });

  it("painel fechado: sem caixas, sem ação principal, e Registrar NF no cabeçalho; a confirmação aparece", () => {
    const html = render({ painel: { ...FECHADO, resultado: "NF 1234 registrada: 1 demanda faturada · R$ 12.345,00" } });
    expect(html).not.toContain("Incluir");
    expect(html.match(PRINCIPAL) ?? []).toHaveLength(0);
    const textos = textosDaTela(html);
    expect(textos.slice(0, 3)).toEqual(["A faturar", "Registrar NF", "NF 1234 registrada: 1 demanda faturada · R$ 12.345,00"]);
    expect(html).toMatch(/<div role="status"[^>]*>[\s\S]*NF 1234 registrada/);
  });

  it("carregando, erro e fila vazia dizem o que é, sem botão de registrar", () => {
    expect(textosDaTela(render({ estado: "carregando", linhas: [], painel: FECHADO }))).toEqual(["A faturar", "Prontas para faturar", "0", "Carregando..."]);
    expect(textosDaTela(render({ estado: "erro", linhas: [], painel: FECHADO }))).toEqual(["A faturar", "Prontas para faturar", "0", "Não foi possível carregar a fila."]);
    expect(textosDaTela(render({ linhas: [], painel: FECHADO }))).toEqual(["A faturar", "Prontas para faturar", "0", "Nada a faturar"]);
  });

  it("a busca filtra as prontas e as que esperam", () => {
    const textos = textosDaTela(render({ busca: "safra", painel: FECHADO }));
    expect(textos).toContain("10060");
    expect(textos).toContain("10050");
    expect(textos).not.toContain("10046");
    expect(textos).not.toContain("10047 – RV02");
    expect(textosDaTela(render({ busca: "nada assim", painel: FECHADO }))).toContain("Nada encontrado");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe, com o painel aberto e fechado", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ painel: FECHADO }))).toEqual([]);
  });

  it("a armazenagem emitida no WMS fica no grupo do cliente, entra na NF e passa no axe (parte 7.2b)", async () => {
    const armazenagem = linhaDaArmazenagem(
      competenciaDoFinanceiro("ITAU__2026-09", { customer_code: "ITAU", competencia: "2026-09", status: "emitido", emitido_em: "2026-10-02T12:00:00.000Z", invoice_snapshot: { total_cents: 750_800 } })!,
    );
    const html = render({ linhas: [...LINHAS, armazenagem], painel: { ...props().painel, marcadas: ["10045", "ITAU__2026-09"] } });
    const prontas = textosDaTela(secao(html, "Prontas para faturar"));
    expect(prontas.slice(0, 3)).toEqual(["Prontas para faturar", "4", "R$ 22.853,00"]);
    expect(prontas).toEqual(expect.arrayContaining(["Itaú Unibanco", "3", "R$ 22.353,00", "Armazenagem 09/2026", "Fatura do WMS · Emitida na Armazenagem", "R$ 7.508,00", "21 dias"]));
    const painel = textosDaTela(secao(html, "Registrar NF"));
    expect(painel).toEqual(expect.arrayContaining(["Na NF", "2", "Armazenagem 09/2026", "R$ 7.508,00", "R$ 19.853,00"]));
    expect(html).toContain('aria-label="Tirar Armazenagem 09/2026"');
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});
