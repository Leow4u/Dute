// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Router } from "wouter";

import { comAmbiente, comFotos, guardarRascunho, lerRascunho, rascunhoInicial } from "@/lib/campo/vistoria";
import { fichaDaLeitura, type FichaDaOs } from "@/lib/operacao/ficha-da-os";

import { VistoriaNoCampo } from "./vistoria";

/**
 * A OS de vistoria no celular, com a tela aberta: a foto que o servidor
 * recusou sai do rascunho da tela, que senão a gravaria de volta no aparelho
 * e travaria o envio.
 */

const FICHA = fichaDaLeitura("10045-01", {
  tipo: "vistoria",
  status: "em_execucao",
  edicao: 4,
  demanda: "10045",
  customer_code: "ITAU",
  cliente_nome: "Itaú Unibanco",
  servicos: ["vistoria"],
  janela: { data: "2026-10-22", inicio: "14:00", fim: "16:00" },
  locais: { origem: { nome: "CEIC", endereco: "Av. Paulista, 1842 · São Paulo/SP" }, destino: null },
  equipe: [{ colaborador_id: "col_aaaaaaaaaaaaaaaa", nome: "Ana Lima", papel: "lider", vinculo: "proprio", no_app: true, usuario_uid: "uid-ana" }],
  etapas: [{ etapa: "chegada_origem", instante: "2026-10-22T17:05:00.000Z" }],
  fotos: [],
}) as FichaDaOs;

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function abrir(fotosRecusadas: readonly string[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <Router ssrPath="/campo/os">
        <VistoriaNoCampo ficha={FICHA} uid="uid-ana" pendentes={[]} fotosRecusadas={fotosRecusadas} urls={{}} catalogo={[]} enviar={() => undefined} />
      </Router>,
    );
  });
}

beforeEach(() => window.localStorage.clear());

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
});

describe("a vistoria aberta e a foto recusada", () => {
  it("a tela tira a foto recusada do rascunho dela e grava sem ela", async () => {
    guardarRascunho("10045-01", comFotos(comAmbiente(rascunhoInicial(), "Recepção", "amb_1"), "amb_1", ["ft_a000000000000001", "ft_a000000000000002"]));
    await abrir(["ft_a000000000000002"]);
    expect(lerRascunho("10045-01")?.ambientes[0].fotos).toEqual(["ft_a000000000000001"]);
  });

  it("sem foto recusada, o rascunho fica como está", async () => {
    guardarRascunho("10045-01", comFotos(comAmbiente(rascunhoInicial(), "Recepção", "amb_1"), "amb_1", ["ft_a000000000000001"]));
    await abrir([]);
    expect(lerRascunho("10045-01")?.ambientes[0].fotos).toEqual(["ft_a000000000000001"]);
  });
});
