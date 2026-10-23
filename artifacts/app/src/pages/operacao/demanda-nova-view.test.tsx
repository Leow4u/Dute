import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { formularioVazio, type FormularioDaDemanda } from "@/lib/operacao/demanda-direta";
import { hrefDaDemanda } from "@/lib/operacao/navegacao";
import { formularioDaSolicitacao, solicitacaoDaOperacao } from "@/lib/operacao/solicitacoes";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { DemandaNovaView, type PainelDaSolicitacao } from "./demanda-nova-view";

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

describe("atender a solicitação do portal (parte 4.4c)", () => {
  const solicitacao = solicitacaoDaOperacao("sol_0123456789abcdef", {
    status: "recebida",
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    tipo_servico: "transporte",
    data: "2026-10-24",
    horario: "08:00",
    desejada_em: "2026-10-24T11:00:00.000Z",
    recebida_em: "2026-10-23T12:30:00.000Z",
    origem: "Rua das Indústrias, 450",
    destino: "Av. Paulista, 1000",
    descricao: "Levar 12 paletes.\nCuidado com o vidro.",
    anexos: [{ caminho: "portal/ITAU/solicitacoes/an_0123456789abcdef.pdf", nome: "NF 4498.pdf", tipo: "application/pdf" }],
    contato: { nome: "Roberto Souza", email: "roberto@itau.example" },
  })!;
  const RECUSA = { aberta: false, motivo: "", problema: null, ocupado: false, erro: null };
  function painel(extra: Partial<PainelDaSolicitacao> = {}): PainelDaSolicitacao {
    return {
      solicitacao,
      urls: { "portal/ITAU/solicitacoes/an_0123456789abcdef.pdf": "https://storage.example/nf.pdf" },
      resolvida: null,
      recusa: RECUSA,
      onRecusar: noop,
      onMotivo: noop,
      onConfirmarRecusa: noop,
      onVoltar: noop,
      ...extra,
    };
  }
  const form = formularioDaSolicitacao(solicitacao, AGORA);
  const PRINCIPAL = /<button[^>]*class="[^"]*bg-primary text-primary-foreground[^"]*"[^>]*>[\s\S]*?<\/button>/g;

  it("o formulário vem preenchido, o canal é o portal, recebida em e o cliente não mudam; ao lado, a solicitação com os anexos", () => {
    const html = render({ form, solicitacao: painel() });
    const secao = html.slice(html.indexOf('<section aria-label="Solicitação do portal"'));
    expect(textosDaTela(secao.slice(0, secao.indexOf("</section>")))).toEqual([
      "Solicitação do portal",
      "Cliente",
      "Itaú Unibanco",
      "Contato",
      "Roberto Souza · roberto@itau.example",
      "Pedido",
      "Transporte / frete · Sáb 24/10 08:00",
      "Origem",
      "Rua das Indústrias, 450",
      "Destino",
      "Av. Paulista, 1000",
      "O que será feito",
      "Levar 12 paletes. Cuidado com o vidro.",
      "Anexos",
      "NF 4498.pdf",
      "Recusar",
    ]);
    expect(html).toContain('href="https://storage.example/nf.pdf"');
    expect(html).toMatch(/<input[^>]*id="demanda-recebida-data"[^>]*disabled=""|<input[^>]*disabled=""[^>]*id="demanda-recebida-data"/);
    expect(html).toMatch(/<select[^>]*id="demanda-cliente"[^>]*disabled=""|<select[^>]*disabled=""[^>]*id="demanda-cliente"/);
    expect(html).not.toContain('aria-label="Canal"');
    expect(textosDaTela(html)).toContain("Portal");
    expect((html.match(PRINCIPAL) ?? []).map((botao) => textosDaTela(botao).join(" "))).toEqual(["Abrir demanda"]);
  });

  it("recusar pede o motivo, que o cliente lê; o problema e o erro dizem o que é", () => {
    const html = render({ form, solicitacao: painel({ recusa: { aberta: true, motivo: "não", problema: "Diga ao cliente o motivo.", ocupado: false, erro: "A solicitação foi recusada." } }) });
    const textos = textosDaTela(html);
    for (const texto of ["Motivo", "Diga ao cliente o motivo.", "A solicitação foi recusada.", "Recusar solicitação", "Voltar"]) expect(textos, texto).toContain(texto);
    expect(html).toMatch(/<textarea[^>]*aria-invalid="true"[^>]*aria-describedby="recusa-motivo-problema"/);
    expect((html.match(PRINCIPAL) ?? []).map((botao) => textosDaTela(botao).join(" "))).toEqual(["Abrir demanda"]);
  });

  it("a solicitação já atendida leva à demanda e não se recusa mais", () => {
    const html = render({ solicitacao: painel({ resolvida: "Já virou a demanda 10050", solicitacao: { ...solicitacao, status: "aceita", demanda: "10050" } }) });
    expect(html).toMatch(new RegExp(`<p role="status"[^>]*><a[^>]*href="${hrefDaDemanda("10050").replace(/[?]/g, "\\?")}"[^>]*>Já virou a demanda 10050</a></p>`));
    expect(textosDaTela(html)).not.toContain("Recusar");
    // Sem a solicitação ativa, o canal volta a ser escolhido.
    expect(html).toContain('aria-label="Canal"');
  });

  it("não tem problema de acessibilidade", async () => {
    expect(await violacoesDeAcessibilidade(render({ form, solicitacao: painel() }))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ form, solicitacao: painel({ recusa: { ...RECUSA, aberta: true, problema: "Diga ao cliente o motivo." } }) }))).toEqual([]);
  });
});
