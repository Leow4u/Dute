// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Router } from "wouter";

import type { NovoRegistro } from "@/lib/campo/fila";
import { fichaDaLeitura, type FichaDaOs } from "@/lib/operacao/ficha-da-os";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { CampoConcluirView } from "./concluir-view";
import { CampoOsView } from "./os-view";

/** Campo › Concluir OS (parte 3.9b, docs/mockups/Campo2Concluir.dc.html). */

const noop = () => undefined;
const AGORA = new Date("2026-10-20T20:50:00.000Z");
const CARLOS = "col_cccccccccccccccc";

const FICHA = fichaDaLeitura("10211-01", {
  status: "em_execucao",
  edicao: 9,
  demanda: "10211",
  customer_code: "ITAU",
  cliente_nome: "Itaú Unibanco",
  janela: { data: "2026-10-20", inicio: "07:30", fim: "18:00" },
  locais: { origem: { endereco: "Faria Lima 3500" }, destino: { endereco: "Torre B", complemento: "12º andar", contato: { nome: "Renata Campos" } } },
  equipe: [
    { colaborador_id: CARLOS, nome: "Carlos Silva", papel: "lider", vinculo: "proprio", no_app: true, usuario_uid: "uid-carlos" },
    { colaborador_id: "col_dddddddddddddddd", nome: "Diego Alves", papel: "montador", vinculo: "proprio", no_app: true, usuario_uid: "uid-diego" },
  ],
  itens: [
    {
      id: "ln_1",
      codigo: "3.05",
      item: "Cadeira Flexform",
      unidade: "UN",
      planejado: "150",
      executado: "160",
      incluidos: [{ quantidade: "10", instante: "2026-10-20T12:32:00.000Z", informado_por: CARLOS, pedido_por: "Renata", motivo: "Pedido no local" }],
    },
    { id: "ln_2", codigo: "2.02", item: "Mesa de trabalho", unidade: "UN", planejado: "60", executado: "58" },
  ],
  etapas: [
    { etapa: "saida_patio", instante: "2026-10-20T10:05:00.000Z" },
    { etapa: "montagem", instante: "2026-10-20T16:00:00.000Z" },
  ],
  fotos: [{ id: "ft_f000000000000001", caminho: "os/10211-01/fotos/ft_f000000000000001.jpg", etapa: "fim", instante: "2026-10-20T20:46:00.000Z" }],
}) as FichaDaOs;

function render(extra: Partial<Parameters<typeof CampoConcluirView>[0]> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/campo/concluir">
      <CampoConcluirView estado="pronto" numero="10211-01" ficha={FICHA} uid="uid-carlos" pendentes={[]} urls={{}} erroDasFotos={null} agora={() => AGORA} onConcluir={noop} onFotos={noop} {...extra} />
    </Router>,
  );
}

// O jsdom não desenha: o quadro de assinatura fica sem contexto, como num navegador sem canvas.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
});

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
});

function montar(onConcluir: (novo: NovoRegistro) => void) {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  act(() => {
    raiz!.render(
      <Router ssrPath="/campo/concluir">
        <CampoConcluirView estado="pronto" numero="10211-01" ficha={FICHA} uid="uid-carlos" pendentes={[]} urls={{}} erroDasFotos={null} agora={() => AGORA} onConcluir={onConcluir} onFotos={noop} />
      </Router>,
    );
  });
  return container;
}

function digitar(campo: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const prototipo = campo instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototipo, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function botao(raizDaTela: HTMLElement, texto: string): HTMLButtonElement {
  const achado = [...raizDaTela.querySelectorAll("button")].find((elemento) => elemento.textContent?.trim() === texto);
  if (!achado) throw new Error(`Botão ${texto} não encontrado`);
  return achado;
}

describe("Concluir OS no celular", () => {
  it("os itens com o feito, a diferença e o motivo, as fotos do final, o responsável e a assinatura", () => {
    const textos = textosDaTela(render());
    for (const texto of [
      "OS 10211-01",
      "Concluir OS 10211-01",
      "Itaú Unibanco · Demanda 10211",
      "Destino",
      "Torre B · 12º andar",
      "Montagem",
      "13:00",
      "Itens executados",
      "Corrigir",
      "Cadeira Flexform",
      "3.05 · un",
      "160",
      "de 160",
      "+10 incluídas em campo · Carlos Silva · 09:32",
      "Mesa de trabalho",
      "58",
      "de 60",
      "−2",
      "Motivo da diferença",
      "Fotos do final · 1",
      "1 na OS",
      "17:46",
      "Tirar foto",
      "Responsável do cliente",
      "Sem responsável no local",
      "Nome",
      "Cargo",
      "CPF ou RG",
      "Aceite dos itens executados",
      "Limpar",
      "Assinar aqui",
      "Concluir com assinatura",
    ]) {
      expect(textos, texto).toContain(texto);
    }
    expect(render()).toContain('value="Renata Campos"');
    expect(render()).not.toContain("R$");
  });

  it("sem legenda: só rótulos, dados e ações", () => {
    expect(
      textosForaDaLista(render(), [
        /^(OS 10211-01|Concluir OS 10211-01|Itaú Unibanco · Demanda 10211|Destino|Torre B · 12º andar|Montagem|13:00)$/,
        /^(Itens executados|Corrigir|Cadeira Flexform|Mesa de trabalho|\d\.\d{2} · un|\d+|de \d+|−2|completo|\+10 incluídas em campo · Carlos Silva · 09:32|Motivo da diferença)$/,
        /^(Fotos do final · 1|1 na OS|17:46|Tirar foto)$/,
        /^(Responsável do cliente|Sem responsável no local|Nome|Cargo|CPF ou RG|Aceite dos itens executados|Limpar|Assinar aqui|Concluir com assinatura)$/,
      ]),
    ).toEqual([]);
  });

  it("não tem problema de acessibilidade", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
  });

  it("quem não é o líder não conclui; a OS concluída mostra a conclusão", () => {
    expect(textosDaTela(render({ uid: "uid-diego" }))).toContain("Só o líder conclui a OS.");
    const concluida = textosDaTela(render({ ficha: { ...FICHA, status: "em_revisao" } }));
    expect(concluida).toContain("OS 10211-01 concluída");
    expect(concluida).toContain("Minhas OS");
    expect(textosDaTela(render({ estado: "carregando", ficha: null }))).toContain("Carregando");
  });

  it("sem o motivo nada vai; sem responsável no local, vai a conclusão com o nome de quem recebeu", () => {
    const enviados: NovoRegistro[] = [];
    const tela = montar((novo) => enviados.push(novo));
    act(() => botao(tela, "Concluir com assinatura").click());
    expect(enviados).toEqual([]);
    expect(tela.querySelector('[role="alert"]')?.textContent).toContain("Informe o motivo da diferença em Mesa de trabalho.");
    expect(tela.querySelector('[role="alert"]')?.textContent).toContain("Colha a assinatura do responsável.");

    act(() => (tela.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    digitar(tela.querySelector("textarea")!, "2 mesas com pé quebrado");
    digitar([...tela.querySelectorAll("input")].find((campo) => campo.value === "Renata Campos")!, "Sr. Almeida (portaria)");
    act(() => botao(tela, "Concluir sem aceite no local").click());

    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toEqual({
      callable: "completeServiceOrder",
      dados: {
        numero: "10211-01",
        instante: "2026-10-20T20:50:00.000Z",
        aceite: "sem_aceite",
        responsavel: { nome: "Sr. Almeida (portaria)" },
        diferencas: [{ linha: "ln_2", motivo: "2 mesas com pé quebrado" }],
      },
      rotulo: "Conclusão",
    });
    // Confirma ali mesmo: a fila guarda antes de a pessoa sair da tela.
    expect(tela.textContent).toContain("OS 10211-01 concluída");
  });
});

describe("a OS no celular leva à conclusão", () => {
  function renderOs(uid: string) {
    return renderToStaticMarkup(
      <Router ssrPath="/campo/os">
        <CampoOsView estado="pronto" numero="10211-01" ficha={FICHA} uid={uid} pendentes={[]} urls={{}} catalogo={[]} erroDasFotos={null} agora={() => AGORA} onRegistrar={noop} onFotos={noop} />
      </Router>,
    );
  }

  it("o líder vê Concluir OS; o montador, não", () => {
    expect(renderOs("uid-carlos")).toContain('href="/campo/concluir?numero=10211-01"');
    expect(textosDaTela(renderOs("uid-carlos"))).toContain("Concluir OS");
    expect(textosDaTela(renderOs("uid-diego"))).not.toContain("Concluir OS");
  });
});
