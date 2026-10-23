import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { fichaDaLeitura, type FichaDaOs } from "@/lib/operacao/ficha-da-os";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { OsView } from "./os-view";

/** Operação › OS (parte 3.7d, docs/mockups/OpOS.dc.html). */

const HOJE = "2026-10-22";
const CARLOS = "col_cccccccccccccccc";
const JOAO = "col_jjjjjjjjjjjjjjjj";

const registro = (instante: string, informado_por: string | null = null, extra: Record<string, unknown> = {}) => ({ instante, canal: "celular", meio: null, informado_por, ...extra });

const FICHA = fichaDaLeitura("10045-01", {
  status: "em_execucao",
  edicao: 9,
  demanda: "10045",
  customer_code: "ITAU",
  servicos: ["transporte", "montagem"],
  janela: { data: HOJE, inicio: "07:30", fim: "18:00" },
  locais: {
    origem: { nome: "Faria Lima", endereco: "Av. Brig. Faria Lima, 3500", complemento: "4º andar", contato: { nome: "Renata Campos", telefone: "11987654321" } },
    destino: { nome: "Centro Empresarial", endereco: "Av. Eng. Armando de Arruda Pereira, 2937", complemento: "Torre B", contato: null },
  },
  instrucoes: "Doca pelo subsolo 2",
  equipe: [
    { colaborador_id: CARLOS, nome: "Carlos Silva", papel: "lider", vinculo: "proprio", no_app: true },
    { colaborador_id: JOAO, nome: "João Pereira", papel: "motorista", vinculo: "proprio", no_app: true },
    { colaborador_id: "col_vvvvvvvvvvvvvvvv", nome: "Valter Moreira", papel: "motorista", vinculo: "terceiro", empresa: "Rota Sul" },
  ],
  veiculos: [{ veiculo_id: "vei_aaaaaaaaaaaaaaaa", placa: "DEF4G56", tipo: "Baú", modelo: "VW Delivery", dono: "proprio" }],
  itens: [
    {
      id: "ln_1",
      codigo: "3.05",
      item: "Transporte de cadeira Flexform",
      unidade: "UN",
      planejado: "150",
      executado: "128",
      executado_em: "2026-10-22T17:20:00.000Z",
      incluidos: [registro("2026-10-22T12:32:00.000Z", CARLOS, { quantidade: "10", pedido_por: "Renata Campos", motivo: "Sala 412" })],
    },
    { id: "ln_2", item: "Montagem de mesa de trabalho", unidade: "UN", planejado: "60", executado: "22", executado_em: "2026-10-22T16:00:00.000Z" },
  ],
  etapas: [
    { etapa: "saida_patio", ...registro("2026-10-22T10:05:00.000Z", JOAO) },
    { etapa: "chegada_destino", ...registro("2026-10-22T14:05:00.000Z", JOAO, { canal: "escritorio", meio: "telefone" }) },
    { etapa: "montagem", ...registro("2026-10-22T14:20:00.000Z", CARLOS) },
  ],
  ocorrencias: [{ id: "oc_01", descricao: "Elevador de carga parado", ...registro("2026-10-22T11:30:00.000Z", CARLOS) }],
  fotos: [{ id: "ft_0000000000000001", caminho: "os/10045-01/fotos/ft_0000000000000001.jpg", legenda: "Carga", ...registro("2026-10-22T10:52:00.000Z") }],
}) as FichaDaOs;

/** A mesma OS concluída com assinatura (parte 3.9c). */
const CONCLUIDA = fichaDaLeitura("10045-01", {
  status: "em_revisao",
  edicao: 12,
  demanda: "10045",
  customer_code: "ITAU",
  janela: { data: HOJE, inicio: "07:30", fim: "18:00" },
  equipe: [{ colaborador_id: CARLOS, nome: "Carlos Silva", papel: "lider", vinculo: "proprio", no_app: true }],
  itens: [{ id: "ln_2", item: "Montagem de mesa de trabalho", unidade: "UN", planejado: "60", executado: "58" }],
  etapas: [
    { etapa: "montagem", ...registro("2026-10-22T14:20:00.000Z", CARLOS) },
    { etapa: "fim", ...registro("2026-10-22T20:52:00.000Z", CARLOS) },
  ],
  conclusao: {
    ...registro("2026-10-22T20:52:00.000Z", CARLOS),
    aceite: "assinatura",
    responsavel: { nome: "Renata Campos", cargo: "Facilities", documento: "12.345.678-9" },
    assinatura: "os/10045-01/assinatura/as_0123456789abcdef.png",
    diferencas: [{ linha: "ln_2", previsto: "60", executado: "58", motivo: "2 mesas com pé quebrado" }],
  },
}) as FichaDaOs;

function render(extra: Partial<Parameters<typeof OsView>[0]> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/operacao/os">
      <OsView
        estado="pronto"
        numero="10045-01"
        ficha={FICHA}
        cabecalho={{ cliente: "Itaú Unibanco", titulo: "Mudança do 5º andar", tipo: "planejada" }}
        hoje={HOJE}
        urls={{ "os/10045-01/fotos/ft_0000000000000001.jpg": "https://example.test/foto.jpg" }}
        {...extra}
      />
    </Router>,
  );
}

describe("OS", () => {
  it("tem o cabeçalho, os passos, os locais, as etapas, os itens, as fotos, a equipe e o histórico", () => {
    const html = render();
    const textos = textosDaTela(html);
    for (const texto of [
      "Hoje",
      "OS 10045-01",
      "Em execução",
      "Planejada",
      "Demanda 10045",
      "Itaú Unibanco",
      "Mudança do 5º andar",
      "Transporte e montagem",
      "hoje 07:30–18:00",
      "Agendar",
      "Executar",
      "Líder · Carlos Silva",
      "Montagem desde 11:20",
      "Concluir",
      "Revisar",
      "Locais",
      "Abrir no Maps",
      "Origem",
      "Destino · chegada 11:05",
      "Contato do cliente",
      "Renata Campos · 11987654321",
      "Instruções",
      "Doca pelo subsolo 2",
      "Etapas",
      "Janela 07:30–18:00",
      "07:05",
      "Saída do pátio",
      "desde 11:20",
      "até 18:00",
      "Itens",
      "Escopo e saldo da demanda 10045",
      "Feito às 14:20",
      "Transporte de cadeira Flexform",
      "150 + 10",
      "128 de 160",
      "+10 além do planejado",
      "Fotos · 1",
      "Carga",
      "Equipe · 3",
      "Carlos Silva",
      "Líder · no app",
      "Terceiro · Motorista · Rota Sul",
      "Veículos · 1",
      "DEF-4G56",
      "VW Delivery · Baú",
      "Histórico",
      "Início da montagem",
      "Elevador de carga parado",
    ]) {
      expect(textos, texto).toContain(texto);
    }
    expect(html).toContain('src="https://example.test/foto.jpg"');
    expect(html).toContain('href="/operacao/demanda?numero=10045"');
    expect(html).not.toContain("R$");
    // Em execução, a equipe não se altera pelo agendamento.
    expect(textos).not.toContain("Alterar");
  });

  it("agendada, Alterar leva ao painel de escalar do Hoje", () => {
    const html = render({ ficha: { ...FICHA, status: "agendada", etapas: [] } });
    expect(html).toMatch(/<a href="\/operacao\/hoje\?os=10045-01"[^>]*>Alterar<\/a>/);
  });

  it("cancelada mostra o motivo no lugar dos passos", () => {
    const textos = textosDaTela(render({ ficha: { ...FICHA, status: "cancelada", cancelamento: "Cliente desistiu" } }));
    expect(textos).toContain("Cancelada · Cliente desistiu");
    expect(textos).not.toContain("Revisar");
  });

  it("sem legenda: só rótulos, dados e ações", () => {
    expect(
      textosForaDaLista(render(), [
        /^(Hoje|OS 10045-01|Em execução|Planejada|Demanda 10045|·|Itaú Unibanco|Mudança do 5º andar|Transporte e montagem|hoje 07:30–18:00)$/,
        /^(Agendar|Executar|Concluir|Revisar|Coordenação|Líder e cliente|Líder · Carlos Silva|· feito|2|3|4)$/,
        /^(3 pessoas · DEF-4G56|Montagem desde 11:20|Fotos e assinatura no local · até 18:00|Itens, fotos e divergências)$/,
        /^(Locais|Abrir no Maps|Origem · saída 10:20|Origem|Destino · chegada 11:05|Av\. .+|Faria Lima|Centro Empresarial|Contato do cliente|Renata Campos · 11987654321|Instruções|Doca pelo subsolo 2)$/,
        /^(Etapas|Janela 07:30–18:00|\d{2}:\d{2}|desde 11:20|até 18:00|—)$/,
        /^(Saída do pátio|Chegada na origem|Carregamento|Saída da origem|Chegada no destino|Montagem|Fim)$/,
        /^(João Pereira · celular|Carlos Silva · celular|escritório · informado por João Pereira · telefone)$/,
        /^(Itens|Escopo e saldo da demanda 10045|Item|Un|Planejado|Feito às 14:20|3\.05|Transporte de cadeira Flexform|Montagem de mesa de trabalho|un)$/,
        /^(Planejado|150 \+ 10|160|60|\d+ de \d+|\+10 além do planejado|\+10 em campo · Carlos Silva · 09:32 · pedido por Renata Campos · Sala 412)$/,
        /^(Fotos · 1|Carga)$/,
        /^(Equipe · 3|Carlos Silva|João Pereira|Valter Moreira|Líder · no app|Motorista · no app|Terceiro · Motorista · Rota Sul|[A-Z]{2})$/,
        /^(Veículos · 1|DEF-4G56|VW Delivery · Baú)$/,
        /^(Histórico|Início da montagem|Chegada no destino|Saída do pátio|\+10 Transporte de cadeira Flexform além do planejado|Elevador de carga parado)$/,
        /^(.+ · \d{2}:\d{2})$/,
      ]),
    ).toEqual([]);
  });

  it("concluída: o aceite, quem assinou, a assinatura e o motivo de cada item a menos", () => {
    const html = render({ ficha: CONCLUIDA, urls: { "os/10045-01/assinatura/as_0123456789abcdef.png": "https://example.test/assinatura.png" } });
    const textos = textosDaTela(html);
    for (const texto of [
      "Em revisão",
      "Conclusão",
      "Assinada 17:52 por Renata Campos",
      "Facilities · doc. 12.345.678-9",
      "Carlos Silva · celular",
      "Montagem de mesa de trabalho · 58 de 60",
      "2 mesas com pé quebrado",
      "OS concluída · assinada por Renata Campos",
    ]) {
      expect(textos, texto).toContain(texto);
    }
    expect(html).toContain('src="https://example.test/assinatura.png"');
    expect(html).not.toContain("R$");
  });

  it("concluída sem aceite no local: quem recebeu, sem assinatura", () => {
    const sem = { ...CONCLUIDA, conclusao: { ...CONCLUIDA.conclusao!, aceite: "sem_aceite" as const, assinatura: null, responsavel: { nome: "Sr. Almeida", cargo: null, documento: null } } };
    const textos = textosDaTela(render({ ficha: sem }));
    expect(textos).toContain("Sem aceite no local · 17:52 · recebido por Sr. Almeida");
    expect(textos).toContain("OS concluída sem aceite no local");
    expect(textos).not.toContain("Assinatura");
  });

  it("revisada: a decisão de cada divergência e a nota", () => {
    const revisada = fichaDaLeitura("10045-01", {
      status: "revisada",
      edicao: 13,
      demanda: "10045",
      customer_code: "ITAU",
      itens: [{ id: "ln_2", item: "Montagem de mesa de trabalho", unidade: "UN", planejado: "60", executado: "58" }],
      revisao: {
        instante: "2026-10-22T21:10:00.000Z",
        nota: "Elevador lento",
        linhas: [
          { linha: "ln_2", item: "Montagem de mesa de trabalho", diferenca: "-2", corrigido: null, decisao: "proxima_os", motivo: null },
          { linha: "ln_1", item: "Cadeira", diferenca: "10", corrigido: "155", decisao: "absorver", motivo: "Cortesia do contrato" },
        ],
      },
    }) as FichaDaOs;
    const textos = textosDaTela(render({ ficha: revisada }));
    for (const texto of ["Revisão", "Revisada 18:10", "−2 Montagem de mesa de trabalho · próxima OS", "+10 Cadeira · corrigido para 155 · absorvido sem cobrar", "Cortesia do contrato", "Elevador lento", "OS revisada"]) {
      expect(textos, texto).toContain(texto);
    }
  });

  it("carregando, erro e não encontrada", () => {
    expect(textosDaTela(render({ estado: "carregando", ficha: null }))).toContain("Carregando");
    expect(textosDaTela(render({ estado: "erro", ficha: null }))).toContain("Não foi possível carregar a OS.");
    expect(textosDaTela(render({ estado: "nao_encontrada", ficha: null }))).toContain("OS 10045-01 não encontrada");
  });

  it("não tem problema de acessibilidade", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ ficha: CONCLUIDA, urls: { "os/10045-01/assinatura/as_0123456789abcdef.png": "https://example.test/a.png" } }))).toEqual([]);
  });
});
