// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "wouter";

import { registroNovo, type NovoRegistro } from "@/lib/campo/fila";
import { comAmbiente, comFotos, comItem, comQuantidade, rascunhoInicial, type RascunhoDaVistoria } from "@/lib/campo/vistoria";
import { fichaDaLeitura, type FichaDaOs } from "@/lib/operacao/ficha-da-os";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { CampoVistoriaView, type CampoVistoriaProps } from "./vistoria-view";

/** Campo › OS de vistoria (parte 3.11b, docs/mockups/Campo2Vistoria.dc.html). */

const noop = () => undefined;
const AGORA = new Date("2026-10-22T18:40:00.000Z");
const ANA = "col_aaaaaaaaaaaaaaaa";

const BRUTO = {
  tipo: "vistoria",
  status: "em_execucao",
  edicao: 4,
  demanda: "10045",
  customer_code: "ITAU",
  cliente_nome: "Itaú Unibanco",
  servicos: ["vistoria"],
  janela: { data: "2026-10-22", inicio: "14:00", fim: "16:00" },
  locais: { origem: { nome: "CEIC", endereco: "Av. Paulista, 1842 · São Paulo/SP", complemento: "12º andar" }, destino: null },
  equipe: [
    { colaborador_id: ANA, nome: "Ana Lima", papel: "lider", vinculo: "proprio", no_app: true, usuario_uid: "uid-ana" },
    { colaborador_id: "col_bbbbbbbbbbbbbbbb", nome: "Bruno Teixeira", papel: "ajudante", vinculo: "proprio", no_app: true, usuario_uid: "uid-bruno" },
  ],
  etapas: [{ etapa: "chegada_origem", instante: "2026-10-22T17:05:00.000Z" }],
  fotos: [{ id: "ft_a000000000000001", caminho: "os/10045-01/fotos/ft_a000000000000001.jpg", legenda: "Recepção", instante: "2026-10-22T17:20:00.000Z" }],
};
const FICHA = fichaDaLeitura("10045-01", BRUTO) as FichaDaOs;

const CATALOGO = [
  { id: "lpu_cadeira", item: "Transporte de cadeira", servico: "Transporte", unidade: "UN" },
  { id: "lpu_estacao", item: "Desmontagem de estação", servico: "Desmontagem", unidade: "UN" },
];

function levantado(): RascunhoDaVistoria {
  let r = comAmbiente(rascunhoInicial(), "Recepção", "amb_1");
  r = comFotos(r, "amb_1", ["ft_a000000000000001"]);
  r = comItem(r, "amb_1", CATALOGO[0]);
  for (let i = 1; i < 8; i += 1) r = comQuantidade(r, "amb_1", "lpu_cadeira", 1);
  return r;
}

function props(extra: Partial<CampoVistoriaProps> = {}): CampoVistoriaProps {
  return {
    ficha: FICHA,
    uid: "uid-ana",
    pendentes: [],
    urls: {},
    catalogo: CATALOGO,
    rascunho: levantado(),
    onMudar: noop,
    erroDasFotos: null,
    agora: () => AGORA,
    novoId: () => "amb_novo",
    onRegistrar: noop,
    onFotos: noop,
    ...extra,
  };
}

function render(extra: Partial<CampoVistoriaProps> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/campo/os">
      <CampoVistoriaView {...props(extra)} />
    </Router>,
  );
}

const PERMITIDOS = [
  "Minhas OS",
  "OS 10045-01",
  "Em execução",
  "Vistoria · Demanda 10045",
  "Itaú Unibanco",
  "Av. Paulista, 1842 · São Paulo/SP · 12º andar",
  "Chegada",
  "14:05",
  "Janela",
  "14:00–16:00",
  "Ambientes",
  "0 de 1 feito",
  "1",
  "Recepção",
  "Em andamento · 1 foto",
  "Novo ambiente",
  "Adicionar",
  "Em andamento",
  "Fotos · 1",
  "14:20",
  "Tirar foto",
  "Itens levantados",
  "Catálogo Dutelog",
  "Transporte de cadeira",
  "un",
  "8",
  "Adicionar item",
  "Concluir ambiente",
  "Medidas",
  "Elevador de serviço",
  "Carga do elevador",
  "Porta",
  "Nova medida",
  "Acesso",
  "Horário de carga",
  "Vaga de carga",
  "Observações",
  "Enviar vistoria ao comercial",
  /^Recepção$/,
];

describe("a vistoria no celular", () => {
  it("o líder: a chegada, os ambientes, o atual com fotos e itens, as medidas, o acesso e o envio; sem legenda", async () => {
    const html = render();
    expect(textosForaDaLista(html, PERMITIDOS)).toEqual([]);
    expect(html).toContain('aria-label="Aumentar Transporte de cadeira"');
    expect(html).not.toContain("Registrar chegada");
    expect(html).not.toMatch(/R\$|preço/i);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("quem não é o líder vê com quem está a vistoria, sem o formulário", () => {
    const html = render({ uid: "uid-bruno" });
    expect(textosForaDaLista(html, [...PERMITIDOS, "Vistoria com Ana Lima"])).toEqual([]);
    expect(html).toContain("Vistoria com Ana Lima");
    expect(html).not.toContain("Enviar vistoria ao comercial");
    expect(html).not.toContain("Novo ambiente");
  });

  it("guardada na fila: a vistoria fica só para ler até chegar", () => {
    const envio = registroNovo({ callable: "sendSurveyToCommercial", dados: { numero: "10045-01" }, rotulo: "Vistoria" }, "k-1", AGORA);
    const html = render({ pendentes: [envio] });
    expect(html).toContain("Vistoria enviada · guardada");
    expect(html).not.toContain("Enviar vistoria ao comercial");
    expect(html).not.toContain("Adicionar item");
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*value=""/);
  });

  it("enviada: a vistoria como foi ao Comercial, sem formulário", async () => {
    const ficha = fichaDaLeitura("10045-01", {
      ...BRUTO,
      status: "revisada",
      vistoria: {
        instante: "2026-10-22T18:40:00.000Z",
        canal: "celular",
        ambientes: [{ nome: "Recepção", itens: [{ lpu_item_id: "lpu_cadeira", item: "Transporte de cadeira", unidade: "UN", quantidade: "8" }], fotos: ["ft_a000000000000001"] }],
        medidas: [{ nome: "Porta", valor: "0,90 m" }],
        acesso: { horario_de_carga: "Depois das 18h", vaga_de_carga: null },
        observacoes: "Elevador de serviço só até as 19h.",
      },
    }) as FichaDaOs;
    const html = render({ ficha, urls: { "os/10045-01/fotos/ft_a000000000000001.jpg": "https://exemplo/foto.jpg" } });
    expect(
      textosForaDaLista(html, [
        "Minhas OS",
        "OS 10045-01",
        "Revisada",
        "Vistoria · Demanda 10045",
        "Itaú Unibanco",
        "Av. Paulista, 1842 · São Paulo/SP · 12º andar",
        "Chegada",
        "14:05",
        "Janela",
        "14:00–16:00",
        "Vistoria enviada",
        "15:40",
        "Recepção",
        "Transporte de cadeira",
        "8 un",
        "Porta",
        "0,90 m",
        "Horário de carga",
        "Depois das 18h",
        "Elevador de serviço só até as 19h.",
      ]),
    ).toEqual([]);
    expect(html).toContain('alt="Recepção · 14:20"');
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
});

function montar(extra: Partial<CampoVistoriaProps>, inicial: RascunhoDaVistoria = levantado()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  function ComEstado() {
    const [rascunho, setRascunho] = useState(inicial);
    return <CampoVistoriaView {...props(extra)} rascunho={rascunho} onMudar={(muda) => setRascunho(muda)} />;
  }
  act(() => {
    raiz!.render(
      <Router ssrPath="/campo/os">
        <ComEstado />
      </Router>,
    );
  });
  return container;
}

function botao(tela: HTMLElement, texto: string): HTMLButtonElement {
  const achado = [...tela.querySelectorAll("button")].find((elemento) => elemento.textContent?.trim() === texto || elemento.getAttribute("aria-label") === texto);
  if (!achado) throw new Error(`Botão ${texto} não encontrado`);
  return achado;
}

function digitar(campo: HTMLInputElement, valor: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("levantar e enviar", () => {
  it("o ambiente novo vira o atual; + soma; o envio vai pela fila no formato de sendSurveyToCommercial", () => {
    const enviados: NovoRegistro[] = [];
    const tela = montar({ onRegistrar: (novo) => enviados.push(novo) });
    const nome = [...tela.querySelectorAll("label")].find((rotulo) => rotulo.textContent === "Novo ambiente")!;
    digitar(document.getElementById(nome.htmlFor) as HTMLInputElement, "Estações");
    act(() => botao(tela, "Adicionar").click());
    expect(tela.querySelector('section[aria-label="Ambiente atual"] h2')?.textContent).toBe("Estações");
    const recepcao = [...tela.querySelectorAll<HTMLButtonElement>('section[aria-label="Ambientes"] button[aria-pressed]')].find((elemento) => elemento.textContent?.includes("Recepção"))!;
    act(() => recepcao.click());
    expect(recepcao.getAttribute("aria-pressed")).toBe("true");
    act(() => botao(tela, "Aumentar Transporte de cadeira").click());
    expect(tela.textContent).toContain("9");
    act(() => botao(tela, "Enviar vistoria ao comercial").click());
    expect(enviados).toHaveLength(1);
    expect(enviados[0].callable).toBe("sendSurveyToCommercial");
    expect(enviados[0].dados).toMatchObject({
      numero: "10045-01",
      instante: "2026-10-22T18:40:00.000Z",
      ambientes: [
        { nome: "Recepção", itens: [{ lpu_item_id: "lpu_cadeira", quantidade: "9" }], fotos: ["ft_a000000000000001"] },
        { nome: "Estações", itens: [], fotos: [] },
      ],
    });
  });

  it("sem a chegada, o envio mostra o que falta; registrar a chegada vai pela fila", () => {
    const enviados: NovoRegistro[] = [];
    const agendada = fichaDaLeitura("10045-01", { ...BRUTO, status: "agendada", etapas: [] }) as FichaDaOs;
    const tela = montar({ ficha: agendada, onRegistrar: (novo) => enviados.push(novo) });
    act(() => botao(tela, "Enviar vistoria ao comercial").click());
    expect(tela.querySelector('[role="alert"]')?.textContent).toBe("Registre a chegada antes de enviar a vistoria.");
    expect(enviados).toEqual([]);
    act(() => botao(tela, "Registrar chegada").click());
    expect(enviados.map((novo) => [novo.callable, novo.dados.etapa])).toEqual([["registerStep", "chegada_origem"]]);
  });
});
