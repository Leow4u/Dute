import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { autorizacaoDoFinanceiro, demandaDoFinanceiro, linhaAFaturar, type LinhaAFaturar } from "@/lib/financeiro/a-faturar";
import { faturaDoFinanceiro, type FaturaDoFinanceiro } from "@/lib/financeiro/faturas";
import { itensDoInicioDoFinanceiro } from "@/lib/financeiro/inicio";
import { ROTA_A_FATURAR, ROTA_A_RECEBER, ROTA_VENCIDOS } from "@/lib/financeiro/navegacao";
import type { InicioDoFinanceiro } from "@/lib/financeiro/use-a-faturar";
import { ProvedorDaConexao, type EstadoDaConexao } from "@/lib/carregando/estado-da-conexao";
import type { NovaTentativa } from "@/lib/operacao/leitura";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosVisiveis } from "@/test/botoes";
import { conexaoEm } from "@/test/conexao";
import { DEZ_E_QUARENTA_E_DOIS } from "@/test/sem-conexao";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { InicioDoFinanceiroView } from "./inicio-view";

/**
 * Início do Financeiro (partes 4.1b e 4.2b): o que espera a pessoa e, ao lado,
 * a fila A faturar e a cobrança em números. Sem legenda. Dados sintéticos.
 */

// Sexta, 23/10/2026, 9h no fuso de quem roda: a saudação é "Bom dia".
const HOJE = new Date(2026, 9, 23, 9, 0);

const AUTORIZACOES = new Map([["aut_itau", autorizacaoDoFinanceiro("aut_itau", { customer_code: "ITAU", status: "registrada", pedido: "4500000009" })]]);

function linha(numero: string, extra: Record<string, unknown>, valor: number | null): LinhaAFaturar {
  const demanda = demandaDoFinanceiro(numero, {
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    etapa: "a_faturar",
    etapa_desde: "2026-10-20T12:00:00.000Z",
    validacao: { rv: 1, autorizacao: "pedido_aceite" },
    autorizacao_ids: ["aut_itau"],
    ...extra,
  })!;
  return linhaAFaturar(demanda, AUTORIZACOES, valor);
}

const LINHAS = [
  linha("10045", {}, 1_234_500),
  linha("10046", { customer_code: "SAFRA", customer_name: "Banco Safra", validacao: { rv: 0, autorizacao: "nenhuma" }, autorizacao_ids: [] }, 250_000),
  linha("10047", { etapa: "aguardando_autorizacao" }, 90_000),
];

function fatura(id: string, extra: Record<string, unknown>): FaturaDoFinanceiro {
  return faturaDoFinanceiro(`fat_${id.padStart(24, "0")}`, {
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    status: "emitida",
    valor_cents: 100_000,
    nf: { numero: id, serie: "1", emitida_em: "2026-09-20" },
    vencimento: "2026-10-20",
    forma: "boleto",
    ...extra,
  })!;
}

const FATURAS = [
  // Vencida em 20/10, enviada e com R$ 400,00 recebidos: saldo de R$ 600,00.
  fatura("1201", { status: "enviada", enviada: { em: "2026-09-21", meio: "email" }, recebido_cents: 40_000 }),
  // A vencer e ainda não enviada.
  fatura("1202", { customer_code: "SAFRA", customer_name: "Banco Safra", valor_cents: 250_000, nf: { numero: "1202", emitida_em: "2026-10-21" }, vencimento: "2026-11-20" }),
  fatura("1203", { status: "paga", recebido_cents: 100_000, paga_em: "2026-10-15" }),
];

function render(inicio: Partial<InicioDoFinanceiro> = {}, nome = "Carla Mendes", conexao: EstadoDaConexao = "conectado") {
  const completo: InicioDoFinanceiro = {
    itens: itensDoInicioDoFinanceiro(LINHAS, FATURAS, new Date("2026-10-23T12:00:00.000Z")),
    linhas: LINHAS,
    faturas: FATURAS,
    carregando: false,
    falhas: [],
    ...inicio,
  };
  return renderToStaticMarkup(
    <ProvedorDaConexao value={conexaoEm(conexao)}>
      <Router ssrPath="/financeiro">
        <InicioDoFinanceiroView nome={nome} hoje={HOJE} inicio={completo} />
      </Router>
    </ProvedorDaConexao>,
  );
}

describe("Início do Financeiro", () => {
  it("data, saudação, quantas coisas esperam, o que precisa de você e os números, o mais urgente primeiro", () => {
    expect(textosVisiveis(render())).toEqual([
      "Sexta-feira, 23 de outubro",
      "Bom dia, Carla",
      "4 coisas",
      "precisam de você no Financeiro.",
      "Precisa de você",
      "1 NF vencida",
      "Itaú Unibanco · R$ 600,00",
      "Cobrar",
      "2 demandas a faturar",
      "Itaú Unibanco · Banco Safra · R$ 14.845,00",
      "Faturar",
      "1 NF para enviar ao cliente",
      "Banco Safra",
      "Enviar",
      "1 demanda aguardando autorização",
      "Itaú Unibanco",
      "Ver",
      "A faturar",
      "R$ 14.845,00",
      "Prontas para faturar",
      "2",
      "Aguardando autorização",
      "1",
      "Sem valor para faturar",
      "0",
      "Abrir a fila",
      "A receber",
      "R$ 3.100,00",
      "A vencer",
      "Vencidas",
      "Para enviar",
      "Abrir A receber",
    ]);
  });

  it("só rótulos, dados e ações: nenhum texto fora da lista", () => {
    const permitidos = [
      "Sexta-feira, 23 de outubro",
      "Bom dia, Carla",
      /^\d+ coisas?$/,
      /^precisam? de você no Financeiro\.$/,
      "Precisa de você",
      /^\d+ demandas? a faturar$/,
      /^\d+ demandas? aguardando autorização$/,
      /^\d+ NFs? vencidas?$/,
      /^\d+ NFs? para enviar ao cliente$/,
      "Banco Safra",
      "Cobrar",
      "Enviar",
      "A receber",
      "A vencer",
      "Vencidas",
      "Para enviar",
      "Abrir A receber",
      /^[^·]+( · [^·]+)* · R\$ [\d.]+,\d{2}$/,
      "Itaú Unibanco",
      "Faturar",
      "Ver",
      "A faturar",
      /^R\$ [\d.]+,\d{2}$/,
      "Prontas para faturar",
      "Aguardando autorização",
      "Sem valor para faturar",
      "Abrir a fila",
      /^\d+$/,
    ];
    expect(textosForaDaLista(render(), permitidos)).toEqual([]);
  });

  it("a primeira ação, a da NF vencida, é a principal; as outras, secundárias, cada uma na tela dela", () => {
    const html = render();
    const classe = (rotulo: string) => html.match(new RegExp(`<a [^>]*class="([^"]*)"[^>]*>${rotulo}</a>`))?.[1] ?? "";
    expect(classe("Cobrar")).toContain("bg-primary");
    for (const rotulo of ["Faturar", "Enviar", "Ver", "Abrir a fila", "Abrir A receber"]) expect(classe(rotulo), rotulo).not.toContain("bg-primary");
    for (const rota of [ROTA_VENCIDOS, ROTA_A_FATURAR, ROTA_A_RECEBER]) expect(html).toContain(`href="${rota}"`);
  });

  it("carregando não diz que não há nada; erro diz o que não carregou", () => {
    // Lendo, a lateral já tem a forma final: os rótulos e os blocos no lugar dos números, nunca o zero (parte 13g).
    const lendo = render({ itens: [], linhas: undefined, faturas: undefined, carregando: true });
    expect(textosVisiveis(lendo)).toEqual([
      "Sexta-feira, 23 de outubro",
      "Bom dia, Carla",
      "Precisa de você",
      "A faturar",
      "Prontas para faturar",
      "Aguardando autorização",
      "Sem valor para faturar",
      "Abrir a fila",
      "A receber",
      "A vencer",
      "Vencidas",
      "Para enviar",
      "Abrir A receber",
    ]);
    expect(lendo).toContain('data-forma="contagem"');
    expect(lendo).not.toContain("animate-pulse");
    expect(textosVisiveis(lendo)).not.toContain("0");
    const erro = render({ itens: [], linhas: undefined, faturas: undefined, falhas: ["autorizações"] });
    expect(erro).toMatch(/<p role="alert"[^>]*>Não foi possível carregar: autorizações\.<\/p>/);
    expect(textosVisiveis(erro)).not.toContain("Prontas para faturar");
  });

  it("nada parado: a frase diz, e os números continuam", () => {
    const textos = textosVisiveis(render({ itens: [], linhas: [], faturas: [] }));
    expect(textos).toContain("Nada parado no Financeiro.");
    expect(textos).not.toContain("Precisa de você");
    expect(textos).toContain("Prontas para faturar");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ itens: [], linhas: undefined, faturas: undefined, carregando: true }))).toEqual([]);
  });
});

/**
 * O Início do Financeiro sem conexão (revisão da parte 13l). A leitura das
 * faturas, das emissões e das baixas passou a levar a falta na 13l, mas o
 * Início não a lia: sem rede, ele dizia "Não foi possível carregar:
 * faturas." como se o servidor tivesse recusado, enquanto o Início da
 * Operação já dizia "Sem conexão.". Agora ele escolhe como o da Operação: sem
 * nada lido, o aviso da conexão no lugar do "Precisa de você"; com tudo lido,
 * o que estava fica, com a hora; o erro do servidor segue no aviso das fontes.
 * Dados sintéticos.
 */
describe("Início do Financeiro sem conexão (revisão da parte 13l)", () => {
  const noop = () => undefined;
  const semConexao = (lidaEm: number | null = null): NovaTentativa => ({ tentando: false, tentar: noop, falta: "conexao", lidaEm, falhou: lidaEm === null });
  const SEM_NADA = { itens: [], linhas: undefined, faturas: undefined, falhas: ["faturas"] };

  it("sem nada lido: o aviso da conexão no lugar do que precisa de você, e não a falha das faturas", async () => {
    for (const estado of ["sem-conexao", "reconectando"] as const) {
      const html = render({ ...SEM_NADA, releitura: semConexao() }, "Carla Mendes", estado);
      const textos = textosDaTela(html);
      expect(textos).toContain(estado === "sem-conexao" ? "Sem conexão." : "Reconectando…");
      expect(textos).toContain("Tentar de novo");
      expect(html).not.toContain("Não foi possível carregar");
      expect(textosForaDaLista(html, [/^Sexta-feira/, /^Bom dia/, "Sem conexão.", "Reconectando…", "Tentar de novo"])).toEqual([]);
      expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    }
  });

  it("lido: o que estava fica, com a hora da lista", async () => {
    const html = render({ releitura: semConexao(DEZ_E_QUARENTA_E_DOIS) }, "Carla Mendes", "sem-conexao");
    expect(textosDaTela(html)).toContain("Sem conexão · lista de 10:42");
    expect(textosVisiveis(html)).toContain("Prontas para faturar");
    expect(html).not.toContain("Não foi possível carregar");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("o erro do servidor segue no aviso das fontes", () => {
    const html = render({ ...SEM_NADA, releitura: { tentando: false, tentar: noop, falta: "servidor", lidaEm: null, falhou: true } });
    expect(html).toContain("Não foi possível carregar: faturas.");
    expect(html).not.toMatch(/Sem conexão|Reconectando/);
  });
});
