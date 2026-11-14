import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { RetornosView } from "@/features/warehouse-ops/order-returns";
import { ProvedorDaConexao, type EstadoDaConexao } from "@/lib/carregando/estado-da-conexao";
import { folhaDaLista } from "@/lib/warehouse-ops/lista-de-separacao";
import { folhaDoRomaneio } from "@/lib/warehouse-ops/romaneio";
import type { VolumeDoPedido } from "@/lib/warehouse-ops/volumes-do-pedido";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { DEZ_E_QUARENTA_E_DOIS, estadosDaFalta, rotulosDaFalta, type LeituraNaFalta } from "@/test/sem-conexao";
import { textosDaTela } from "@/test/textos";

vi.mock("@/lib/firebase", () => ({ firestore: {}, firebaseApp: {}, firebaseAuth: null }));

import { PedidoSeparadoView } from "./pedido-separado-view";
import { PedidosListaView } from "./pedidos-lista-view";
import { PedidosRomaneioView } from "./pedidos-romaneio-view";
import SettingsCustomerNotifications from "./settings-customer-notifications";

/**
 * As telas do WMS com escuta sem conexão (carregamento v2, parte 13l). Até a
 * 13k, elas seguiam a regra nova da leitura (a resposta só do cache é a
 * falta), mas mostravam a falha da seção também sem rede ("Não foi possível
 * carregar o pedido."), e o que estava lido ficava sem dizer de quando era.
 * Agora, como nas telas da 13j: sem nada lido, o aviso da conexão ("Sem
 * conexão." ou "Reconectando…", com "Tentar de novo"); com o que está lido, a
 * faixa com a hora; o erro do servidor, a falha de antes. Dados sintéticos.
 */

const noop = () => undefined;
const tentarComPromessa = () => Promise.resolve();

function volume(numero: number, itens: Array<[string, string, number]>): VolumeDoPedido {
  return {
    id: `pkg_pack_ord_1_${String(numero).padStart(3, "0")}`,
    numero,
    aberto: false,
    unidades: itens.reduce((soma, [, , quantidade]) => soma + quantidade, 0),
    caixa: null,
    pesoKg: null,
    fechadoEm: "2026-11-12T17:40:00.000Z",
    itens: itens.map(([nome, codigo, quantidade]) => ({ nome, codigo, quantidade })),
  };
}

const VOLUMES = [volume(1, [["Polo Masculino Piquet Preto · P", "A.01.0806.005.P", 60]]), volume(2, [["Porta Cartão Couro", "B.0567.005.U", 12]])];

const ROMANEIO = folhaDoRomaneio({
  numero: "PED-0001",
  cliente: "BTG Pactual",
  destino: "Agência Faria Lima",
  paraQuando: "2026-11-16T14:36:00.000Z",
  lacre: "88231",
  separadoDe: "2026-11-10T13:00:00.000Z",
  separadoAte: "2026-11-13T20:00:00.000Z",
  por: "Guilherme Dantas",
  volumes: VOLUMES,
});

const LISTA = folhaDaLista({
  numero: "PED-0001",
  cliente: "BTG Pactual",
  destino: "Agência Faria Lima",
  paraQuando: "2026-11-16T14:36:00.000Z",
  por: "Guilherme Dantas",
  agora: new Date("2026-11-10T17:20:00.000Z"),
  grupos: [],
});

function naConexao(estado: EstadoDaConexao, elemento: React.ReactElement) {
  return renderToStaticMarkup(<ProvedorDaConexao value={conexaoEm(estado)}>{elemento}</ProvedorDaConexao>);
}

describe("Pedidos › Romaneio sem conexão", () => {
  const romaneio = (leitura: LeituraNaFalta, situacao: "erro" | "pronto") => (
    <Router ssrPath="/pedidos/romaneio">
      <PedidosRomaneioView estado={situacao} folha={situacao === "pronto" ? ROMANEIO : null} onImprimir={noop} onTentar={tentarComPromessa} leitura={leitura} />
    </Router>
  );

  it("os estados da falta", async () => {
    expect(await estadosDaFalta(romaneio)).toEqual(rotulosDaFalta({ mensagem: "Não foi possível carregar o pedido.", objeto: "romaneio" }));
  });

  it("o prazo que não chegou sem conexão: o aviso da conexão, e não a frase da falha", async () => {
    const semPrazo = { tentando: false, tentar: noop, falta: "conexao" as const, lidaEm: null };
    const html = naConexao("sem-conexao", romaneio(semPrazo, "pronto"));
    expect(html).toContain("Sem conexão.");
    expect(html).not.toContain("Não foi possível carregar o prazo do pedido.");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    // Com o romaneio lido e sem o servidor, a faixa já diz a falta: o aviso não se repete.
    const lido = naConexao("sem-conexao", romaneio({ ...semPrazo, lidaEm: DEZ_E_QUARENTA_E_DOIS }, "pronto"));
    expect(lido).toContain("Sem conexão · romaneio de 10:42");
    expect(lido).not.toContain("Sem conexão.");
  });
});

describe("Pedidos › Lista de separação sem conexão", () => {
  const lista = (leitura: LeituraNaFalta, situacao: "erro" | "pronto") => (
    <Router ssrPath="/pedidos/lista">
      <PedidosListaView estado={situacao} folha={situacao === "pronto" ? LISTA : null} onImprimir={noop} onTentar={tentarComPromessa} leitura={leitura} />
    </Router>
  );

  it("os estados da falta", async () => {
    expect(await estadosDaFalta(lista)).toEqual(rotulosDaFalta({ mensagem: "Não foi possível carregar o pedido." }));
  });
});

describe("Pedidos › o pedido separado sem conexão", () => {
  it("os estados da falta dos volumes", async () => {
    expect(
      await estadosDaFalta((leitura, situacao) => (
        <Router ssrPath="/pedidos/separar">
          <PedidoSeparadoView
            numero="PED-0001"
            resumo="BTG Pactual · 2 itens · 72 un."
            estado={situacao}
            volumes={situacao === "pronto" ? VOLUMES : []}
            etiquetasDosVolumesHref={null}
            romaneioHref={null}
            onTentar={tentarComPromessa}
            leitura={leitura}
          />
        </Router>
      )),
    ).toEqual(rotulosDaFalta({ mensagem: "Não foi possível carregar os volumes.", objeto: "pedido" }));
  });
});

describe("Devoluções › os retornos da Operação sem conexão", () => {
  const RETORNO = { orderId: "ord_1", numero: "PED-0001", customerCode: "BTG", chegouEm: "2026-11-13T12:00:00.000Z" } as never;
  const acoes = { abrir: noop, fechar: noop, mudarLinha: noop, mudarNotas: noop, receber: noop };

  it("sem nada lido: o aviso da conexão, e não a falha; o servidor, a falha", async () => {
    const semConexao = naConexao("sem-conexao", <RetornosView retornos={[]} aberto={null} acoes={acoes} falha={{ tentar: tentarComPromessa, falta: "conexao" }} />);
    expect(semConexao).toContain("Sem conexão.");
    expect(semConexao).not.toContain("Não consegui carregar os retornos da Operação.");
    expect(textosDaTela(semConexao)).toEqual(["Retornos da Operação", "Sem conexão.", "Tentar de novo"]);
    expect(await violacoesDeAcessibilidade(semConexao)).toEqual([]);
    const doServidor = naConexao("conectado", <RetornosView retornos={[]} aberto={null} acoes={acoes} falha={{ tentar: tentarComPromessa, falta: "servidor" }} />);
    expect(doServidor).toContain("Não consegui carregar os retornos da Operação.");
  });

  it("lidos: ficam, com a hora", () => {
    const html = naConexao(
      "sem-conexao",
      <RetornosView retornos={[RETORNO]} aberto={null} acoes={acoes} leitura={{ tentando: false, tentar: noop, falta: "conexao", lidaEm: DEZ_E_QUARENTA_E_DOIS }} />,
    );
    expect(html).toContain("Sem conexão · lista de 10:42");
    expect(html).toContain("PED-0001");
  });
});

describe("Configurações › Clientes › Avisos por e-mail sem conexão", () => {
  const avisos = (leitura: { itens: never[] | null; erro: boolean; falta: "conexao" | "servidor" | null; lidaEm: number | null }) => (
    <SettingsCustomerNotifications customer={{ code: "ITAU", name: "Itaú Unibanco" }} contatos={{ leitura: { ...leitura, tentando: false, tentar: tentarComPromessa }, lista: [], reler: noop }} />
  );

  it("sem nada lido: o aviso da conexão no lugar dos contatos; o servidor, a falha de antes", async () => {
    const html = naConexao("sem-conexao", avisos({ itens: null, erro: true, falta: "conexao", lidaEm: null }));
    expect(textosDaTela(html)).toEqual(["Avisos por e-mail", "Novo contato", "Sem conexão.", "Tentar de novo"]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    expect(naConexao("reconectando", avisos({ itens: null, erro: true, falta: "conexao", lidaEm: null }))).toContain("Reconectando…");
    const doServidor = naConexao("conectado", avisos({ itens: null, erro: true, falta: "servidor", lidaEm: null }));
    expect(doServidor).toContain("Não foi possível carregar os contatos.");
    expect(doServidor).not.toMatch(/Sem conexão|Reconectando/);
  });

  it("lidos: ficam, com a hora", async () => {
    const html = naConexao("sem-conexao", avisos({ itens: [], erro: false, falta: "conexao", lidaEm: DEZ_E_QUARENTA_E_DOIS }));
    expect(html).toContain("Sem conexão · lista de 10:42");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});
