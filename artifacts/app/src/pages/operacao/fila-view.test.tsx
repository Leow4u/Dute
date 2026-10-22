import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AgendaEmEdicao, DemandaParaAbrir, OsDaFila, QuadroDoDia } from "@/lib/operacao/fila";

import { FilaView, type PessoaDaEquipe, type VeiculoDaAgenda } from "./fila-view";

const ABERTA: OsDaFila = {
  numero: "10045-01",
  demanda: "10045",
  customer_code: "ITAU",
  status: "aberta",
  edicao: 1,
  itens: [{ item: "Estação", quantidade: "2" }],
  agenda: null,
};

const HOJE: OsDaFila = {
  numero: "10045-02",
  demanda: "10045",
  customer_code: "ITAU",
  status: "agendada",
  edicao: 2,
  itens: [{ item: "Transporte", quantidade: "1" }],
  agenda: { data: "2026-10-22", hora: "15:00", equipe: ["col_aaaaaaaaaaaaaaaa", "col_bbbbbbbbbbbbbbbb"], veiculo_id: "vei_aaaaaaaaaaaaaaaa" },
};

const DEMANDA: DemandaParaAbrir = {
  numero: "10046",
  customer_code: "ITAU",
  titulo: "Montagem do 12º andar",
  os_numeros: [],
};

const ANA: PessoaDaEquipe = { id: "col_aaaaaaaaaaaaaaaa", nome: "Ana Souza", funcao: "Motorista", ativo: true };
const VAN: VeiculoDaAgenda = { id: "vei_aaaaaaaaaaaaaaaa", placa: "ABC-1D23", tipo: "VUC", ativo: true };

const QUADRO: QuadroDoDia = { paraAgendar: [ABERTA], agendadasHoje: [HOJE], outrosDias: [] };
const AGENDA: AgendaEmEdicao = { data: "2026-10-22", hora: "", equipe: [], veiculoId: "", motivo: "" };

const noop = () => undefined;

function textos(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function render(parcial: Partial<Parameters<typeof FilaView>[0]> = {}) {
  return renderToStaticMarkup(
    <FilaView
      estado="pronto"
      hoje="2026-10-22"
      demandas={[DEMANDA]}
      quadro={QUADRO}
      nomesClientes={{ ITAU: "Itaú" }}
      nomesPessoas={{ col_aaaaaaaaaaaaaaaa: "Ana Souza" }}
      placas={{ vei_aaaaaaaaaaaaaaaa: "ABC1D23" }}
      pessoas={[ANA]}
      veiculos={[VAN]}
      os={null}
      agenda={null}
      onAgenda={noop}
      onAbrirDemanda={noop}
      onAbrirOs={noop}
      onVoltar={noop}
      onSalvar={noop}
      onCancelar={noop}
      ocupado={false}
      erro={null}
      {...parcial}
    />,
  );
}

describe("fila do dia", () => {
  it("mostra a demanda para abrir e as três colunas, sem preço", () => {
    const html = render();
    const texto = textos(html);
    expect(texto).toContain("Hoje");
    expect(texto).toContain("22/10/2026");
    expect(texto).toContain("Para abrir");
    expect(texto).toContain("10046");
    expect(texto).toContain("Montagem do 12º andar");
    expect(texto).toContain("Abrir OS");
    expect(texto).toContain("Para agendar");
    expect(texto).toContain("Agendadas hoje");
    expect(texto).toContain("Outros dias");
    expect(texto).toContain("10045-01");
    expect(texto).toContain("10045-02");
    expect(texto).toContain("Itaú");
    expect(texto).toContain("Estação · 2");
    expect(texto).toContain("Ana Souza +1");
    expect(texto).toContain("ABC-1D23");
    expect(texto).toContain("Nenhuma OS em outro dia");
    expect(html).not.toContain("R$");
    expect(texto).not.toMatch(/preço/i);
    expect(html).not.toContain("Em execução");
    expect(html).not.toContain("Concluídas");
  });

  it("abrir a OS mostra data, equipe, veículo e o cancelamento", () => {
    const html = render({ os: ABERTA, agenda: AGENDA });
    const texto = textos(html);
    expect(texto).toContain("10045-01");
    expect(html).toContain('id="os-data"');
    expect(html).toContain("Ana Souza");
    expect(html).toContain("ABC-1D23");
    expect(texto).toContain("Salvar");
    expect(texto).toContain("Cancelar OS");
    expect(html).not.toContain("Para agendar");
    expect(html).not.toContain("R$");
  });

  it("a fila que não carregou não finge lista vazia", () => {
    const texto = textos(render({ estado: "erro", demandas: [], quadro: { paraAgendar: [], agendadasHoje: [], outrosDias: [] } }));
    expect(texto).toContain("Não foi possível carregar a fila.");
    expect(texto).not.toContain("Nenhuma OS aberta");
  });
});
