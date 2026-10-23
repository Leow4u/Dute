import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ColaboradorDaLista, VeiculoDaLista } from "@/lib/operacao/cadastro";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

import {
  ColaboradoresView,
  VeiculosView,
  alternarPapel,
  fichaDoColaborador,
  fichaDoVeiculo,
  fichaVaziaColaborador,
  fichaVaziaVeiculo,
  type FichaColaborador,
  type FichaVeiculo,
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
  vinculo: "proprio",
  empresa: "",
  papeis: ["motorista"],
  usuarioEmail: "",
  noApp: false,
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
  dono: "proprio",
  empresa: "",
  revisaoEm: "",
};

/** Terceiro, com dois papéis e o login do app ligado. */
const BRUNO: ColaboradorDaLista = {
  ...ANA,
  id: "col_bbbbbbbbbbbbbbbb",
  nome: "Bruno Lima",
  funcao: "Montador",
  cpf: "111.444.777-35",
  cnhCategoria: "",
  cnhValidade: "",
  cnh: null,
  vinculo: "terceiro",
  empresa: "Rota Sul",
  papeis: ["lider", "montador"],
  usuarioEmail: "bruno@rotasul.com.br",
  noApp: true,
};

const CAMINHAO: VeiculoDaLista = {
  ...VAN,
  id: "vei_bbbbbbbbbbbbbbbb",
  ativo: true,
  placa: "XYZ-9A87",
  tipo: "Truck",
  modelo: "Atego",
  resumo: "Atego · 3500 kg · 12.5 m³",
  dono: "terceiro",
  empresa: "Frota Leste",
  revisaoEm: "2026-12-10",
};

const noop = () => undefined;

function colaboradores(itens: ColaboradorDaLista[], ficha: FichaColaborador | null, editando: ColaboradorDaLista | null = null) {
  return renderToStaticMarkup(
    <ColaboradoresView
      estado="pronto"
      itens={itens}
      busca=""
      onBusca={noop}
      ficha={ficha}
      editando={editando}
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
}

function veiculos(itens: VeiculoDaLista[], ficha: FichaVeiculo | null, editando: VeiculoDaLista | null = null) {
  return renderToStaticMarkup(
    <VeiculosView
      estado="pronto"
      itens={itens}
      busca=""
      onBusca={noop}
      ficha={ficha}
      editando={editando}
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
}

/** Os rótulos das caixas de papel marcadas, na ordem da tela. */
function papeisMarcados(html: string): string[] {
  return [...html.matchAll(/<input type="checkbox"[^>]*?(checked="")?[^>]*\/>([^<]+)<\/label>/g)]
    .filter((match) => match[0].includes('checked=""'))
    .map((match) => match[2].trim());
}

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

  it("a ficha tem vínculo, papéis e o e-mail do app; a empresa só aparece para o terceiro", () => {
    const nova = textos(colaboradores([], fichaVaziaColaborador()));
    for (const rotulo of ["Vínculo", "Equipe própria", "Freelancer", "Terceiro", "Papéis", "Líder", "Motorista", "Montador", "Ajudante", "E-mail do app"]) {
      expect(nova, rotulo).toContain(rotulo);
    }
    expect(nova).not.toContain("Empresa");

    const html = colaboradores([BRUNO], fichaDoColaborador(BRUNO), BRUNO);
    expect(textos(html)).toContain("Empresa");
    expect(html).toContain('value="Rota Sul"');
    expect(html).toContain('value="bruno@rotasul.com.br"');
    expect(papeisMarcados(html)).toEqual(["Líder", "Montador"]);
  });

  it("a linha da lista diz o vínculo, os papéis e quem está no app", () => {
    const texto = textos(colaboradores([ANA, BRUNO], null));
    expect(texto).toContain("Montador · Terceiro · Rota Sul · Líder · 111.444.777-35 · no app");
    expect(texto).toContain("Motorista · 529.982.247-25 · C · 01/04/2028");
    expect(texto).not.toContain("Motorista · Motorista");
    expect(texto).not.toContain("Equipe própria");
  });

  it("a ficha não tem problema de acessibilidade", async () => {
    expect(await violacoesDeAcessibilidade(colaboradores([BRUNO], fichaDoColaborador(BRUNO), BRUNO))).toEqual([]);
  });
});

describe("papéis da ficha", () => {
  it("marcar e desmarcar mantém a ordem da lista, sem repetir", () => {
    expect(alternarPapel(["montador"], "lider", true)).toEqual(["lider", "montador"]);
    expect(alternarPapel(["lider", "montador"], "lider", true)).toEqual(["lider", "montador"]);
    expect(alternarPapel(["lider", "montador"], "lider", false)).toEqual(["montador"]);
    expect(alternarPapel([], "ajudante", false)).toEqual([]);
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

  it("a ficha tem dono e próxima revisão; a empresa só aparece no veículo de terceiro", () => {
    const novo = textos(veiculos([], fichaVaziaVeiculo()));
    for (const rotulo of ["Dono", "Próprio", "Terceiro", "Próxima revisão"]) expect(novo, rotulo).toContain(rotulo);
    expect(novo).not.toContain("Empresa");

    const html = veiculos([CAMINHAO], fichaDoVeiculo(CAMINHAO), CAMINHAO);
    expect(textos(html)).toContain("Empresa");
    expect(html).toContain('value="Frota Leste"');
    expect(html).toContain('value="2026-12-10"');
  });

  it("a linha da lista diz o dono terceiro e a revisão", () => {
    const texto = textos(veiculos([CAMINHAO, VAN], null));
    expect(texto).toContain("Truck · Atego · 3500 kg · 12.5 m³ · Terceiro · Frota Leste · revisão 10/12/2026");
    expect(texto).toContain("VUC · Daily · 3500 kg · 12.5 m³");
    expect(texto).not.toContain("Próprio");
  });

  it("a ficha não tem problema de acessibilidade", async () => {
    expect(await violacoesDeAcessibilidade(veiculos([CAMINHAO], fichaDoVeiculo(CAMINHAO), CAMINHAO))).toEqual([]);
  });
});
