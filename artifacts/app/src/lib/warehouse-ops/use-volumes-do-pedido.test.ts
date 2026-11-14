import { describe, expect, it, vi } from "vitest";

import { leituraDosVolumes, tentarOsQueFaltam } from "./use-volumes-do-pedido";

/**
 * De onde vêm os volumes de um pedido (separação com caixas, parte 4): da
 * tarefa de separação, enquanto ele separa; dos `packages`, depois de
 * concluído. Dados sintéticos.
 */

const PEDIDO = { numero: "PED-0001", clienteCodigo: "BTG Pactual", destino: "Agência Faria Lima", solicitacaoId: "creq_1" };
const TAREFA = {
  volumes: [
    { id: "v1", number: 1, status: "closed", units: 5, weight_kg: 2.3, closed_at: "2026-11-11T12:00:00.000Z" },
    { id: "v2", number: 2, status: "open", units: 4 },
  ],
  comecouEm: "2026-11-10T13:00:00.000Z",
  concluidaEm: null as string | null,
  por: "",
};
const LINHAS = [
  { id: "pli_1", line_number: 1, product_name: "Camiseta Polo G", client_item_code: "A.1.G", sku_code: "BTG-000001", expected_quantity: 5, separated_at: "x", separated_qty: 5, separated_volumes: [{ volume_id: "v1", qty: 5 }] },
  { id: "pli_2", line_number: 2, product_name: "Boné", client_item_code: "B.2", sku_code: "BTG-000002", expected_quantity: 4, separated_at: "x", separated_qty: 4, separated_volumes: [{ volume_id: "v2", qty: 4 }] },
];
const BASE = { id: "ord_1", pedido: PEDIDO, remessa: null, tarefa: TAREFA, linhas: LINHAS, pacotes: null, itensDosPacotes: null, erro: false };

describe("a leitura dos volumes do pedido", () => {
  it("em separação: os volumes fechados da tarefa, sem lacre nem total; o aberto ainda não tem etiqueta", () => {
    const leitura = leituraDosVolumes(BASE);
    expect(leitura.estado).toBe("pronto");
    expect(leitura.pedido).toEqual({
      id: "ord_1",
      numero: "PED-0001",
      clienteCodigo: "BTG Pactual",
      destino: "Agência Faria Lima",
      solicitacaoId: "creq_1",
      lacre: "",
      concluido: false,
      separadoDe: "2026-11-10T13:00:00.000Z",
      separadoAte: null,
      por: "",
    });
    expect(leitura.volumes.map((volume) => [volume.id, volume.numero, volume.unidades, volume.itens])).toEqual([["v1", 1, 5, [{ nome: "Camiseta Polo · G", codigo: "A.1.G", quantidade: 5 }]]]);
  });

  it("concluído: os volumes da remessa, com o lacre, quem concluiu e quando", () => {
    const leitura = leituraDosVolumes({
      ...BASE,
      remessa: { status: "ready_to_dispatch", lacre: "88231" },
      tarefa: { ...TAREFA, concluidaEm: "2026-11-13T20:00:00.000Z", por: "Guilherme Dantas" },
      linhas: null,
      pacotes: [
        { id: "pkg_2", volume_number: 2, packed_units: 4, status: "packed" },
        { id: "pkg_1", volume_number: 1, packed_units: 5, weight_kg: 2.3, status: "packed" },
      ],
      itensDosPacotes: [
        { package_id: "pkg_1", line_number: 1, sku_code: "BTG-000001", client_item_code: "A.1.G", product_name: "Camiseta Polo G", qty_packed: 5 },
        { package_id: "pkg_2", line_number: 2, sku_code: "BTG-000002", client_item_code: "B.2", product_name: "Boné", qty_packed: 4 },
      ],
    });
    expect(leitura.pedido).toMatchObject({ lacre: "88231", concluido: true, separadoAte: "2026-11-13T20:00:00.000Z", por: "Guilherme Dantas" });
    expect(leitura.volumes.map((volume) => [volume.numero, volume.unidades, volume.pesoKg])).toEqual([
      [1, 5, 2.3],
      [2, 4, null],
    ]);
    // A remessa que saiu e a entregue também valem; a cancelada, não.
    for (const status of ["dispatched", "delivered"]) {
      expect(leituraDosVolumes({ ...BASE, remessa: { status, lacre: "1" }, linhas: null, pacotes: [], itensDosPacotes: [] }).pedido?.concluido).toBe(true);
    }
    expect(leituraDosVolumes({ ...BASE, remessa: { status: "cancelled", lacre: "1" } }).pedido).toMatchObject({ concluido: false, lacre: "" });
  });

  it("carregando enquanto falta uma leitura; sem o pedido, não encontrado; com falha, erro", () => {
    expect(leituraDosVolumes({ ...BASE, pedido: undefined }).estado).toBe("carregando");
    expect(leituraDosVolumes({ ...BASE, remessa: undefined }).estado).toBe("carregando");
    expect(leituraDosVolumes({ ...BASE, tarefa: undefined }).estado).toBe("carregando");
    expect(leituraDosVolumes({ ...BASE, linhas: null }).estado).toBe("carregando");
    expect(leituraDosVolumes({ ...BASE, remessa: { status: "ready_to_dispatch", lacre: "1" }, pacotes: [], itensDosPacotes: null }).estado).toBe("carregando");
    expect(leituraDosVolumes({ ...BASE, pedido: null })).toEqual({ estado: "nao_encontrado", pedido: null, volumes: [] });
    expect(leituraDosVolumes({ ...BASE, id: null }).estado).toBe("nao_encontrado");
    expect(leituraDosVolumes({ ...BASE, erro: true }).estado).toBe("erro");
  });

  it("o pedido sem tarefa de separação lida (o legado) sai sem volumes, sem travar", () => {
    const leitura = leituraDosVolumes({ ...BASE, tarefa: null, linhas: [] });
    expect([leitura.estado, leitura.volumes, leitura.pedido?.separadoDe]).toEqual(["pronto", [], null]);
  });
});

describe("a nova tentativa dos volumes do pedido (carregamento v2, junção das partes 10 e 13)", () => {
  it("assina de novo só as leituras ativas que falharam ou não chegaram, e acaba quando todas respondem", async () => {
    let responder: () => void = () => undefined;
    const presa = vi.fn(() => new Promise<void>((pronto) => (responder = pronto)));
    const lida = vi.fn(async () => undefined);
    const semChave = vi.fn(async () => undefined);
    let acabou = false;
    const tentativa = tentarOsQueFaltam([
      { ativa: true, semResposta: true, tentar: presa },
      { ativa: true, semResposta: false, tentar: lida },
      { ativa: false, semResposta: true, tentar: semChave },
    ]).then(() => {
      acabou = true;
    });
    await Promise.resolve();
    expect(presa).toHaveBeenCalledTimes(1);
    expect(lida).not.toHaveBeenCalled();
    // A leitura sem chave nunca responderia: a nova tentativa não a espera.
    expect(semChave).not.toHaveBeenCalled();
    expect(acabou).toBe(false);
    responder();
    await tentativa;
    expect(acabou).toBe(true);
  });
});
