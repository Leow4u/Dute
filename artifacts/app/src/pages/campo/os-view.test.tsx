// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "wouter";

import { registroNovo, type RegistroNaFila } from "@/lib/campo/fila";
import { fichaDaLeitura, type FichaDaOs } from "@/lib/operacao/ficha-da-os";

import { CampoOsView } from "./os-view";

/**
 * O toque duplo no celular: registrado o toque, o botão já vira a próxima
 * ação, e o segundo toque do mesmo botão logo depois não registra a próxima.
 */

const CARLOS = "col_cccccccccccccccc";
const DIEGO = "col_dddddddddddddddd";
const FICHA = fichaDaLeitura("10211-01", {
  status: "em_execucao",
  edicao: 5,
  demanda: "10211",
  customer_code: "ITAU",
  cliente_nome: "Itaú Unibanco",
  servicos: ["transporte"],
  janela: { data: "2026-10-20", inicio: "07:30", fim: "18:00" },
  locais: { origem: { endereco: "Faria Lima 3500" }, destino: { endereco: "Torre B" } },
  equipe: [
    { colaborador_id: CARLOS, nome: "Carlos Silva", papel: "lider", vinculo: "proprio", no_app: true, usuario_uid: "uid-carlos" },
    { colaborador_id: DIEGO, nome: "Diego Alves", papel: "montador", vinculo: "freelancer" },
  ],
  itens: [],
  etapas: [
    { etapa: "saida_patio", instante: "2026-10-20T10:05:00.000Z" },
    { etapa: "chegada_origem", instante: "2026-10-20T10:40:00.000Z" },
  ],
  presencas: [{ colaborador_id: CARLOS, entrada: { instante: "2026-10-20T10:30:00.000Z" } }],
}) as FichaDaOs;

let instante = new Date("2026-10-20T12:28:00.000Z");
let registrados: RegistroNaFila[] = [];
let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

function NoCelular() {
  const [pendentes, setPendentes] = useState<RegistroNaFila[]>([]);
  registrados = pendentes;
  return (
    <Router ssrPath="/campo/os">
      <CampoOsView
        estado="pronto"
        numero="10211-01"
        ficha={FICHA}
        uid="uid-carlos"
        pendentes={pendentes}
        urls={{}}
        catalogo={[]}
        erroDasFotos={null}
        agora={() => instante}
        onRegistrar={(novo) => setPendentes((atual) => [...atual, registroNovo(novo, `k-${atual.length}`, instante)])}
        onFotos={() => undefined}
      />
    </Router>
  );
}

async function abrir() {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => raiz!.render(<NoCelular />));
}

function botao(texto: string | RegExp): HTMLButtonElement {
  const achado = [...container!.querySelectorAll("button")].find((elemento) =>
    typeof texto === "string" ? elemento.textContent === texto : texto.test(elemento.textContent ?? ""),
  );
  if (!achado) throw new Error(`Sem o botão ${texto}`);
  return achado;
}

async function tocar(elemento: HTMLButtonElement) {
  await act(async () => elemento.click());
}

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  registrados = [];
  instante = new Date("2026-10-20T12:28:00.000Z");
});

describe("o toque duplo no celular", () => {
  it("a etapa: o segundo toque logo depois não registra a seguinte; um segundo depois, sim", async () => {
    await abrir();
    await tocar(botao("Registrar carregamento"));
    // O botão já virou a próxima etapa.
    await tocar(botao("Registrar saída da origem"));
    expect(registrados.map((registro) => registro.dados.etapa)).toEqual(["carregamento"]);

    instante = new Date(instante.getTime() + 2_000);
    await tocar(botao("Registrar saída da origem"));
    expect(registrados.map((registro) => registro.dados.etapa)).toEqual(["carregamento", "saida_origem"]);
  });

  it("a presença: a entrada tocada duas vezes não marca a saída", async () => {
    await abrir();
    await tocar(botao("Entrada de Diego Alves"));
    await tocar(botao("Saída de Diego Alves"));
    expect(registrados.map((registro) => [registro.dados.colaborador_id, registro.dados.tipo])).toEqual([[DIEGO, "entrada"]]);
  });
});
