import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { registroNovo } from "@/lib/campo/fila";
import { minhasOs, registroDeEtapa, registroDeInclusao, saudacao } from "@/lib/campo/os-no-campo";
import { fichaDaLeitura, type FichaDaOs } from "@/lib/operacao/ficha-da-os";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { CampoHojeView } from "./hoje-view";
import { CampoOsView } from "./os-view";

/** Campo › Minhas OS e OS em execução (parte 3.8b, docs/mockups/Campo2Hoje.dc.html e Campo2Execucao.dc.html). */

const noop = () => undefined;
const HOJE = "2026-10-20";
const AGORA = new Date("2026-10-20T12:28:00.000Z");
const CARLOS = "col_cccccccccccccccc";

const FICHA = fichaDaLeitura("10211-01", {
  status: "em_execucao",
  edicao: 5,
  demanda: "10211",
  customer_code: "ITAU",
  cliente_nome: "Itaú Unibanco",
  servicos: ["transporte", "montagem"],
  janela: { data: HOJE, inicio: "07:30", fim: "18:00" },
  locais: { origem: { endereco: "Faria Lima 3500", complemento: "4º andar", contato: { nome: "Renata Campos" } }, destino: { endereco: "Torre B", complemento: "12º andar" } },
  equipe: [
    { colaborador_id: CARLOS, nome: "Carlos Silva", papel: "lider", vinculo: "proprio", no_app: true, usuario_uid: "uid-carlos" },
    { colaborador_id: "col_dddddddddddddddd", nome: "Diego Alves", papel: "montador", vinculo: "freelancer" },
  ],
  veiculos: [{ veiculo_id: "vei_a", placa: "DEF4G56", tipo: "Baú", dono: "proprio" }],
  itens: [
    { id: "ln_1", codigo: "3.05", item: "Cadeira Flexform", servico: "Transporte", unidade: "UN", planejado: "150", executado: "150" },
    { id: "ln_2", codigo: "2.02", item: "Mesa de trabalho", servico: "Montagem", unidade: "UN", planejado: "60" },
  ],
  etapas: [
    { etapa: "saida_patio", instante: "2026-10-20T10:05:00.000Z" },
    { etapa: "chegada_origem", instante: "2026-10-20T10:40:00.000Z" },
  ],
  presencas: [{ colaborador_id: CARLOS, entrada: { instante: "2026-10-20T10:30:00.000Z" } }],
}) as FichaDaOs;

function renderHoje() {
  const { dia, ola } = saudacao("Carlos Silva", HOJE);
  return renderToStaticMarkup(
    <Router ssrPath="/campo">
      <CampoHojeView estado="pronto" dia={dia} ola={ola} lista={minhasOs([FICHA], HOJE)} />
    </Router>,
  );
}

function renderOs(extra: Partial<Parameters<typeof CampoOsView>[0]> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/campo/os">
      <CampoOsView
        estado="pronto"
        numero="10211-01"
        ficha={FICHA}
        uid="uid-carlos"
        pendentes={[]}
        urls={{}}
        catalogo={[]}
        erroDasFotos={null}
        agora={() => AGORA}
        onRegistrar={noop}
        onFotos={noop}
        {...extra}
      />
    </Router>,
  );
}

describe("Minhas OS", () => {
  it("o dia, a saudação e a OS de agora com o que importa para sair", () => {
    const html = renderHoje();
    const textos = textosDaTela(html);
    for (const texto of ["Terça, 20 de outubro", "Olá, Carlos", "Agora", "OS 10211-01", "Em execução", "Itaú Unibanco", "Transporte e montagem · Demanda 10211", "Chegada na origem desde 07:40", "Faria Lima 3500 · 4º andar", "Destino Torre B · 12º andar", "Equipe 2", "DEF-4G56", "Continuar OS"]) {
      expect(textos, texto).toContain(texto);
    }
    expect(html).toContain('href="/campo/os?numero=10211-01"');
    expect(html).not.toContain("R$");
  });

  it("sem OS diz isso; não tem problema de acessibilidade", async () => {
    expect(textosDaTela(renderToStaticMarkup(<Router ssrPath="/campo"><CampoHojeView estado="pronto" dia="d" ola="Olá" lista={{ agora: [], depois: [], feito: [] }} /></Router>))).toContain("Nenhuma OS para você");
    expect(await violacoesDeAcessibilidade(renderHoje())).toEqual([]);
  });
});

/** Os textos da OS em execução: rótulos, dados e ações (a trava contra legenda). */
const TEXTOS_DA_OS = [
  /^(Minhas OS|OS 10211-01|Em execução|Itaú Unibanco · Demanda 10211|Saída do pátio 07:05|2h 23min|Janela|07:30–18:00)$/,
  /^(Etapas|Saída do pátio|Chegada na origem|Carregamento|Saída da origem|Chegada no destino|Montagem|Fim|\d|\d{2}:\d{2}|Registrar carregamento|Outra etapa)$/,
  /^(3\.05 · Transporte|2\.02 · Montagem|Cadeira Flexform|Mesa de trabalho|\d+|de \d+ un|Além do planejado · Incluir|Incluir item executado)$/,
  /^(Equipe no local · 2|Carlos Silva|Diego Alves|Líder · desde 07:30|Freelancer · Montador|Entrada|Saída|de .+|[A-Z]{2})$/,
  /^(Fotos · 0|Tirar foto|Registrar ocorrência|Concluir OS)$/,
];

describe("OS em execução no celular", () => {
  it("tem as etapas com a próxima em destaque, os itens com + e −, a equipe, as fotos e a ocorrência", () => {
    const html = renderOs();
    const textos = textosDaTela(html);
    for (const texto of [
      "Minhas OS",
      "OS 10211-01",
      "Em execução",
      "Itaú Unibanco · Demanda 10211",
      "Saída do pátio 07:05",
      "2h 23min",
      "Janela",
      "07:30–18:00",
      "Etapas",
      "Chegada na origem",
      "07:40",
      "Registrar carregamento",
      "Outra etapa",
      "Itens · 2",
      "3.05 · Transporte",
      "Cadeira Flexform",
      "150",
      "de 150 un",
      "Além do planejado · Incluir",
      "Incluir item executado",
      "Equipe no local · 2",
      "Líder · desde 07:30",
      "Freelancer · Montador",
      "Entrada",
      "Saída",
      "Fotos · 0",
      "Tirar foto",
      "Registrar ocorrência",
    ]) {
      expect(textos, texto).toContain(texto);
    }
    expect(html).toContain('aria-label="Mais um: Mesa de trabalho"');
    expect(html).not.toContain("R$");
  });

  it("a etapa guardada na fila aparece como guardada e a próxima anda", () => {
    const guardada = registroNovo(registroDeEtapa(FICHA, "carregamento", AGORA), "k1", AGORA);
    const textos = textosDaTela(renderOs({ pendentes: [guardada] }));
    expect(textos).toContain("09:28 · guardada");
    expect(textos).toContain("Registrar saída da origem");
  });

  it("a inclusão guardada de um item que a OS não tem: linha nova com o relógio, a quantidade e a hora, sem + e − (pergunta 65)", async () => {
    const pendentes = [
      registroNovo(registroDeInclusao(FICHA, { tipo: "catalogo", lpuItemId: "lpu_divisoria", nome: "Divisória" }, "4", "Renata Campos", "Sala 412", AGORA), "k1", AGORA),
      registroNovo(registroDeInclusao(FICHA, { tipo: "avulso", nome: "Suporte de monitor", unidade: "un" }, "2", "Renata Campos", "Sala 412", AGORA), "k2", AGORA),
    ];
    const html = renderOs({ pendentes, catalogo: [{ id: "lpu_divisoria", item: "Divisória", servico: "Montagem", unidade: "UN" }] });
    const textos = textosDaTela(html);
    for (const texto of ["Itens · 4", "Montagem", "Divisória", "4 un", "Item avulso", "Suporte de monitor", "2 un", "guardada 09:28"]) {
      expect(textos, texto).toContain(texto);
    }
    expect(html).not.toContain("Mais um: Divisória");
    expect(html).not.toContain("Menos um: Suporte de monitor");
    expect(textosForaDaLista(html, [...TEXTOS_DA_OS, /^(Itens · 4|Divisória|Suporte de monitor|Item avulso|\d+ un|guardada \d{2}:\d{2})$/])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("concluída não recebe registro; carregando e não encontrada", () => {
    const textos = textosDaTela(renderOs({ ficha: { ...FICHA, status: "em_revisao" } }));
    expect(textos).toContain("OS concluída");
    expect(textos).not.toContain("Tirar foto");
    expect(textosDaTela(renderOs({ estado: "carregando", ficha: null }))).toContain("Carregando");
    expect(textosDaTela(renderOs({ estado: "nao_encontrada", ficha: null }))).toContain("OS 10211-01 não encontrada");
  });

  it("sem legenda: só rótulos, dados e ações", () => {
    expect(textosForaDaLista(renderOs(), [...TEXTOS_DA_OS, /^Itens · 2$/])).toEqual([]);
  });

  it("não tem problema de acessibilidade", async () => {
    expect(await violacoesDeAcessibilidade(renderOs())).toEqual([]);
  });
});
