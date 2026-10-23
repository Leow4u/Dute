import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { formularioVazio, type FormularioDaDemanda } from "@/lib/operacao/demanda-direta";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { DemandaNovaView } from "./demanda-nova-view";

/** Operação › Nova demanda direta (parte 3.5c, docs/mockups/OpDemandaNova.dc.html). */

const AGORA = new Date("2026-10-23T16:06:00.000Z");
const noop = () => undefined;

const PREENCHIDO: FormularioDaDemanda = {
  ...formularioVazio(AGORA),
  customerCode: "ITAU",
  titulo: "Troca de cadeiras",
  pedidoPorNome: "Renata Campos",
  recebidaHora: "13:05",
  executarHora: "19:00",
  linhas: [
    { chave: "c1", lpuItemId: "lpu_cadeira", item: "Cadeira Flexform", unidade: "UN", quantidade: "40" },
    { chave: "c2", lpuItemId: null, item: "Retirada de entulho", unidade: "VB", quantidade: "1" },
  ],
};

function render(extra: Partial<Parameters<typeof DemandaNovaView>[0]> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/operacao/nova-demanda">
      <DemandaNovaView
        agora={AGORA}
        form={PREENCHIDO}
        onForm={noop}
        clientes={[{ valor: "ITAU", rotulo: "Itaú Unibanco" }]}
        locais={[{ valor: "loc_faria", rotulo: "Faria Lima" }]}
        busca=""
        onBusca={noop}
        resultados={[]}
        onAdicionar={noop}
        onAvulso={noop}
        corrigindo={false}
        onCorrigir={noop}
        problemas={[]}
        ocupado={false}
        erro={null}
        onAbrir={noop}
        {...extra}
      />
    </Router>,
  );
}

describe("Nova demanda direta", () => {
  it("tem o pedido, os locais, os itens e o resumo com o tipo pela hora e o prazo", () => {
    const textos = textosDaTela(render());
    for (const texto of [
      "Nova demanda",
      "Pedido",
      "Cliente",
      "Título",
      "Quem pediu",
      "Telefone",
      "Canal",
      "WhatsApp",
      "Recebida em",
      "Executar até",
      "Tipo",
      "Paraquedas",
      "Corrigir",
      "Locais",
      "Origem",
      "Destino",
      "Andar ou sala",
      "Itens",
      "Item avulso",
      "Cadeira Flexform",
      "Quantidade",
      "Itaú Unibanco",
      "Renata Campos",
      "23/10/2026 13:05",
      "Hoje até 19:00 · faltam 5h54",
      "2",
      "Abrir demanda",
      "Cancelar",
    ]) {
      expect(textos, texto).toContain(texto);
    }
    expect(render()).not.toContain("R$");
  });

  it("sem legenda: só rótulos, dados e ações", () => {
    expect(
      textosForaDaLista(render(), [
        /^(Hoje|Nova demanda|Pedido|Cliente|Título|Quem pediu|Telefone|Canal|Recebida em|Hora|Executar até|Hora limite|Tipo|Corrigir)$/,
        /^(Escolha|Itaú Unibanco|Telefone|WhatsApp|E-mail|Portal|Paraquedas)$/,
        /^(Locais|Origem|Destino|Andar ou sala|Sem local cadastrado|Faria Lima)$/,
        /^(Itens|Buscar no catálogo|Item avulso|Unidade|Quantidade|Cadeira Flexform|UN|Tirar .+)$/,
        /^(Pedido por|Recebida|Prazo|Renata Campos|23\/10\/2026 13:05|Hoje até 19:00 · faltam 5h54|2|Abrir demanda|Cancelar)$/,
      ]),
    ).toEqual([]);
  });

  it("Corrigir abre a escolha do tipo, com o calculado pela hora", () => {
    const textos = textosDaTela(render({ corrigindo: true }));
    expect(textos).toContain("Pela hora: Paraquedas");
    expect(textos).toContain("Emergencial");
    expect(textos).not.toContain("Corrigir");
  });

  it("a busca mostra os itens do catálogo para incluir; sem achar, diz que não achou", () => {
    const com = textosDaTela(render({ busca: "mesa", resultados: [{ id: "lpu_mesa", item: "Mesa de trabalho", servico: "Montagem", unidade: "UN" }] }));
    expect(com).toContain("Mesa de trabalho");
    expect(com).toContain("Montagem · UN");
    expect(com).toContain("Incluir");
    expect(textosDaTela(render({ busca: "xyz", resultados: [] }))).toContain("Nenhum item do catálogo");
  });

  it("depois de tentar abrir, mostra o que falta; o erro da callable também", () => {
    const vazio = formularioVazio(AGORA);
    const textos = textosDaTela(render({ form: vazio, problemas: ["Escolha o cliente.", "Inclua ao menos um item."], erro: "O cadastro VELHO está arquivado." }));
    for (const texto of ["Escolha o cliente.", "Inclua ao menos um item.", "O cadastro VELHO está arquivado.", "Escolha o cliente"]) expect(textos, texto).toContain(texto);
  });

  it("não tem problema de acessibilidade", async () => {
    expect(await violacoesDeAcessibilidade(render({ busca: "mesa", resultados: [{ id: "lpu_mesa", item: "Mesa", servico: null, unidade: null }], corrigindo: true }))).toEqual([]);
  });
});
