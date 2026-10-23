import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { painelDaTv, quadroLido, type QuadroDaTv } from "@/lib/tv/quadro";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { cartoesPorColuna } from "./tv";
import { TvView, type TvViewProps } from "./tv-view";

/** A TV da sala (parte 3.12b; docs/mockups/TVSala.dc.html). */

const AGORA = new Date("2026-10-23T17:32:00.000Z"); // sexta, 14:32 em São Paulo

const base = { tipo: "servico", servicos: ["transporte"], dia: "2026-10-23", ate: null, etapa: null, etapas: { feitas: 0, previstas: 6 }, concluida_em: null, aceite: null };

const QUADRO = quadroLido({
  hoje: "2026-10-23",
  gerado_em: "2026-10-23T17:31:40.000Z",
  ordens: [
    { ...base, numero: "10056-01", coluna: "agendada", cliente: "Supermercados Boa Vista", rota: "CD Guarulhos → Loja Tatuapé", inicio: "2026-10-23T18:00:00.000Z", equipe: ["João Pereira"], placas: ["DEF4G56"] },
    { ...base, numero: "10058-01", coluna: "agendada", cliente: "Construtora Horizonte", rota: "Campinas → Osasco", inicio: "2026-10-23T20:00:00.000Z", equipe: ["Pedro Nunes"], placas: [] },
    {
      ...base,
      numero: "10051-01",
      coluna: "em_execucao",
      cliente: "Metalúrgica Souza & Filhos",
      rota: "Guarulhos → Av. Paulista",
      inicio: "2026-10-23T12:30:00.000Z",
      ate: "2026-10-23T17:00:00.000Z",
      etapa: { etapa: "saida_origem", instante: "2026-10-23T15:10:00.000Z" },
      etapas: { feitas: 4, previstas: 6 },
      equipe: ["João Pereira", "Bruno Teixeira"],
      placas: ["DEF4G56"],
    },
    {
      ...base,
      numero: "10047-01",
      coluna: "concluida",
      cliente: "Padaria Pão Nosso",
      rota: "São Paulo → Guarulhos",
      inicio: "2026-10-23T11:00:00.000Z",
      concluida_em: "2026-10-23T15:40:00.000Z",
      aceite: "assinatura",
      equipe: ["Rafael Costa"],
      placas: ["MNO3P45"],
    },
  ],
}) as QuadroDaTv;

function render(extra: Partial<TvViewProps> = {}) {
  return renderToStaticMarkup(
    <TvView
      estado="pronto"
      painel={painelDaTv(QUADRO, AGORA)}
      agora={AGORA}
      atualizadoEm={QUADRO.geradoEm}
      semConexao={false}
      porColuna={5}
      basePath=""
      {...extra}
    />,
  );
}

describe("TV da sala", () => {
  it("o relógio, os indicadores, as três colunas e a hora da leitura", () => {
    const textos = textosDaTela(render());
    for (const texto of [
      "Sala de Operações",
      "Sexta-feira, 23 de outubro",
      "14:32",
      "OS hoje",
      "4",
      "Agendadas",
      "Em execução",
      "Concluídas",
      "Atrasadas",
      "Próxima saída",
      "15:00",
      "Supermercados Boa Vista",
      "Agendadas hoje",
      "Concluídas hoje",
      "Atualizado às 14:31",
    ]) {
      expect(textos, texto).toContain(texto);
    }
  });

  it("cada cartão: hora, cliente, serviço e rota, equipe e placa; atrasada, sem veículo e assinada", () => {
    const textos = textosDaTela(render());
    for (const texto of [
      "OS 10056-01",
      "Transporte · CD Guarulhos → Loja Tatuapé",
      "João Pereira",
      "DEF-4G56",
      "Sem veículo",
      "Atrasada 32 min",
      "Metalúrgica Souza & Filhos",
      "Transporte · Guarulhos → Av. Paulista · até 14:00",
      "Saída da origem · 12:10",
      "João Pereira + 1",
      "Assinada",
      "12:40",
      "Rafael Costa",
    ]) {
      expect(textos, texto).toContain(texto);
    }
  });

  it("sem valor e sem ação: nenhum botão, link nem campo", () => {
    // O React pré-carrega o logo com <link rel="preload"> no HTML do servidor; não é link de navegação.
    const html = render().replace(/<link rel="preload" as="image"[^>]*\/>/g, "");
    expect(html).not.toContain("R$");
    expect(html).not.toMatch(/<(a|button|input|select|textarea|form)\b/);
    expect(html).not.toMatch(/\b(?:href|onclick|tabindex)=/i);
  });

  it("sem legenda: só rótulos e dados", () => {
    const fora = textosForaDaLista(render(), [
      /^(Sala de Operações|Sexta-feira, 23 de outubro|14:32)$/,
      /^(OS hoje|Agendadas|Em execução|Concluídas|Atrasadas|Próxima saída)$/,
      /^\d+$/,
      /^(Agendadas hoje|Em execução|Concluídas hoje)$/,
      /^OS \d{5}-\d{2}$/,
      /^\d{2}:\d{2}$/,
      /^(Supermercados Boa Vista|Construtora Horizonte|Metalúrgica Souza & Filhos|Padaria Pão Nosso)$/,
      /^Transporte · (CD Guarulhos → Loja Tatuapé|Campinas → Osasco|Guarulhos → Av\. Paulista · até 14:00|São Paulo → Guarulhos)$/,
      /^(João Pereira|João Pereira \+ 1|Pedro Nunes|Rafael Costa)$/,
      /^(DEF-4G56|MNO-3P45)$/,
      /^(Sem veículo|Atrasada 32 min|Assinada)$/,
      "Saída da origem · 12:10",
      // As iniciais do avatar (aria-hidden).
      /^[A-Z]{1,2}$/,
      "Atualizado às 14:31",
    ]);
    expect(fora).toEqual([]);
  });

  it("coluna cheia mostra quantas OS ficaram de fora; coluna vazia, Nenhuma OS", () => {
    const textos = textosDaTela(render({ porColuna: 1 }));
    expect(textos).toContain("+ 1 OS");
    expect(textos).not.toContain("Construtora Horizonte");
    const vazio = painelDaTv({ ...QUADRO, ordens: [] }, AGORA);
    const html = render({ painel: vazio });
    expect(html.match(/>Nenhuma OS</g)).toHaveLength(3);
    expect(textosDaTela(html)).toContain("Nenhuma");
  });

  it("carregando, erro e sem conexão (segue com o último quadro)", () => {
    expect(textosDaTela(render({ estado: "carregando", painel: null, atualizadoEm: null }))).toContain("Carregando");
    expect(textosDaTela(render({ estado: "erro", painel: null, atualizadoEm: null }))).toContain("Não foi possível carregar o quadro.");
    const semConexao = textosDaTela(render({ semConexao: true }));
    expect(semConexao).toContain("Sem conexão · atualizado às 14:31");
    expect(semConexao).toContain("Metalúrgica Souza & Filhos");
  });

  it("quantos cartões cabem pela altura da tela", () => {
    expect(cartoesPorColuna(1080)).toBe(3);
    expect(cartoesPorColuna(900)).toBe(2);
    expect(cartoesPorColuna(2160)).toBe(8);
    expect(cartoesPorColuna(600)).toBe(2);
  });

  it("não tem problema de acessibilidade", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
  });
});
