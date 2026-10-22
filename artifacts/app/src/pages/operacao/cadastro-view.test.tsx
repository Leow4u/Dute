import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ColaboradorDaLista, VeiculoDaLista } from "@/lib/operacao/cadastro";

import {
  ColaboradoresView,
  VeiculosView,
  fichaDoColaborador,
  fichaVaziaColaborador,
  fichaVaziaVeiculo,
} from "./cadastro-view";

const ANA: ColaboradorDaLista = {
  id: "col_aaaaaaaaaaaaaaaa",
  edicao: 1,
  ativo: true,
  nome: "Ana Souza",
  funcao: "Motorista",
  cpf: "529.982.247-25",
  telefone: "11987654321",
  cnhCategoria: "C",
  cnhValidade: "2028-04-01",
  cnh: "C · 01/04/2028",
};

const VAN: VeiculoDaLista = {
  id: "vei_aaaaaaaaaaaaaaaa",
  edicao: 1,
  ativo: false,
  placa: "ABC-1D23",
  tipo: "VUC",
  modelo: "Daily",
  capacidadeKg: "3500",
  capacidadeM3: "12.5",
  resumo: "Daily · 3500 kg · 12.5 m³",
};

const noop = () => undefined;

function textos(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

describe("tela de colaboradores", () => {
  it("lista nome, função e CPF, e o vazio não tem legenda de preço", () => {
    const html = renderToStaticMarkup(
      <ColaboradoresView
        estado="pronto"
        itens={[ANA]}
        busca=""
        onBusca={noop}
        ficha={null}
        editando={null}
        onFicha={noop}
        onNovo={noop}
        onAbrir={noop}
        onFechar={noop}
        onSalvar={noop}
        onAtivo={noop}
        ocupado={false}
        erro={null}
      />,
    );
    const texto = textos(html);
    expect(texto).toContain("Ana Souza");
    expect(texto).toContain("Motorista");
    expect(texto).toContain("529.982.247-25");
    expect(texto).toContain("Novo colaborador");
    expect(html).not.toContain("R$");
    expect(texto).not.toContain("preço");
  });

  it("a ficha nova tem os campos do plano e um único Salvar", () => {
    const html = renderToStaticMarkup(
      <ColaboradoresView
        estado="pronto"
        itens={[]}
        busca=""
        onBusca={noop}
        ficha={fichaVaziaColaborador()}
        editando={null}
        onFicha={noop}
        onNovo={noop}
        onAbrir={noop}
        onFechar={noop}
        onSalvar={noop}
        onAtivo={noop}
        ocupado={false}
        erro="CPF inválido."
      />,
    );
    const texto = textos(html);
    for (const rotulo of ["Nome", "CPF", "Função", "Telefone", "Categoria da CNH", "Validade da CNH", "Salvar", "Voltar"]) {
      expect(texto, rotulo).toContain(rotulo);
    }
    expect(texto).toContain("Novo colaborador");
    expect(texto).toContain("CPF inválido.");
    expect(texto).not.toContain("Desativar");
  });

  it("quem está aberto pode ser desativado", () => {
    const html = renderToStaticMarkup(
      <ColaboradoresView
        estado="pronto"
        itens={[ANA]}
        busca=""
        onBusca={noop}
        ficha={fichaDoColaborador(ANA)}
        editando={ANA}
        onFicha={noop}
        onNovo={noop}
        onAbrir={noop}
        onFechar={noop}
        onSalvar={noop}
        onAtivo={noop}
        ocupado={false}
        erro={null}
      />,
    );
    expect(textos(html)).toContain("Desativar");
  });
});

describe("tela de veículos", () => {
  it("mostra a placa e, no desativado, Reativar", () => {
    const lista = renderToStaticMarkup(
      <VeiculosView
        estado="pronto"
        itens={[VAN]}
        busca=""
        onBusca={noop}
        ficha={null}
        editando={null}
        onFicha={noop}
        onNovo={noop}
        onAbrir={noop}
        onFechar={noop}
        onSalvar={noop}
        onAtivo={noop}
        ocupado={false}
        erro={null}
      />,
    );
    expect(textos(lista)).toContain("ABC-1D23");
    expect(textos(lista)).toContain("Desativado");
    const ficha = renderToStaticMarkup(
      <VeiculosView
        estado="pronto"
        itens={[VAN]}
        busca=""
        onBusca={noop}
        ficha={fichaVaziaVeiculo()}
        editando={VAN}
        onFicha={noop}
        onNovo={noop}
        onAbrir={noop}
        onFechar={noop}
        onSalvar={noop}
        onAtivo={noop}
        ocupado={false}
        erro={null}
      />,
    );
    expect(textos(ficha)).toContain("Reativar");
    expect(textos(ficha)).toContain("Capacidade (kg)");
    expect(textos(ficha)).toContain("Capacidade (m³)");
  });
});
