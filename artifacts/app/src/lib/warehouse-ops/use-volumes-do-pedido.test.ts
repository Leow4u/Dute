import { describe, expect, it, vi } from "vitest";

import { nameAndSize, volumeLabels } from "../warehouse-labels";
import { folhaDoRomaneio } from "./romaneio";
import { itemDaLinhaDeSeparacao } from "./separacao";
import { tamanhosDoCatalogo } from "./tamanho-do-catalogo";
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
const BASE = { id: "ord_1", pedido: PEDIDO, remessa: null, tarefa: TAREFA, linhas: LINHAS, pacotes: null, itensDosPacotes: null, tamanhos: tamanhosDoCatalogo([]), erro: false };

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
    // O cadastro dos SKUs, de onde vem o Tamanho: a etiqueta e o romaneio esperam por ele.
    expect(leituraDosVolumes({ ...BASE, tamanhos: undefined }).estado).toBe("carregando");
    expect(leituraDosVolumes({ ...BASE, pedido: null })).toEqual({ estado: "nao_encontrado", pedido: null, volumes: [] });
    expect(leituraDosVolumes({ ...BASE, id: null }).estado).toBe("nao_encontrado");
    expect(leituraDosVolumes({ ...BASE, erro: true }).estado).toBe("erro");
  });

  it("o pedido sem tarefa de separação lida (o legado) sai sem volumes, sem travar", () => {
    const leitura = leituraDosVolumes({ ...BASE, tarefa: null, linhas: [] });
    expect([leitura.estado, leitura.volumes, leitura.pedido?.separadoDe]).toEqual(["pronto", [], null]);
  });
});

/**
 * O tamanho que mora só no campo Tamanho do SKU, e não no fim do código do
 * cliente: a capacidade do copo (lib/dominio/src/nome-do-produto.casos.json).
 * Nem a linha da separação nem o item do volume o gravam; ele vem do cadastro
 * do SKU, como /api/skus o devolve. Os documentos estão no formato que o
 * servidor grava (functions/wms: operations.ts e pick-progress.ts).
 */
describe("o tamanho do campo Tamanho nos volumes do pedido", () => {
  const CADASTRO = [
    { id: "BTG-000206", cod_btg: "BTG-000206", sku_code: "BTG-000206", sku_code_key: "BTG-000206", cod_cliente: "B.0572.003.U.B", customer_code: "BTG", produto: "Copo Beercup em Inox", tamanho: "475ML", status: "active" },
    { id: "BTG-000125", cod_btg: "BTG-000125", sku_code: "BTG-000125", sku_code_key: "BTG-000125", cod_cliente: "A.01.0806.005.GG", customer_code: "BTG", produto: "Polo Masculino Piquet Preto", tamanho: "GG", status: "active" },
  ];
  const ORDEM = { number: "PED-0001", customer: "BTG Pactual", destination: "Agência Faria Lima" };

  /** A linha da separação como o Firestore a guarda, lida pelo mesmo mapeamento da tela. */
  function linhaGravada(numero: number, sku: string, codigo: string, nome: string, quantidade: number, volume: string) {
    const id = `pli_ord_1_${String(numero).padStart(2, "0")}`;
    return itemDaLinhaDeSeparacao(id, {
      id,
      customer_code: "BTG",
      pick_task_id: "pick_ord_1",
      order_id: "ord_1",
      order_number: "PED-0001",
      line_number: numero,
      sku_code: sku,
      client_item_code: codigo,
      product_name: nome,
      location_id: "B-03",
      client_line_number: numero,
      qty_to_pick: quantidade,
      qty_picked: 0,
      status: "open",
      separated_qty: quantidade,
      separated_at: "2026-11-12T13:10:00.000Z",
      separated_by: { uid: "u_1", name: "Guilherme Dantas" },
      separated_volumes: [{ volume_id: volume, qty: quantidade }],
    });
  }

  /** O item do volume como a conclusão o grava (`package_items`): também sem o tamanho. */
  function itemGravado(volume: number, linha: number, sku: string, codigo: string, nome: string, quantidade: number) {
    const pacote = `pkg_pack_ord_1_${String(volume).padStart(3, "0")}`;
    return {
      id: `pki_${pacote}_${String(linha).padStart(2, "0")}`,
      package_id: pacote,
      shipment_id: "ship_ord_1",
      status: "packed",
      customer_code: "BTG",
      order_id: "ord_1",
      order_number: "PED-0001",
      line_number: linha,
      sku_code: sku,
      client_item_code: codigo,
      product_name: nome,
      location_id: "B-03",
      qty_packed: quantidade,
    };
  }

  const TAREFA_DO_COPO = {
    ...TAREFA,
    volumes: [
      { id: "v1", number: 1, status: "closed", units: 4, weight_kg: 1.8, closed_at: "2026-11-12T13:20:00.000Z" },
      { id: "v2", number: 2, status: "closed", units: 20, closed_at: "2026-11-12T13:40:00.000Z" },
    ],
  };
  const LINHAS_DO_COPO = [
    linhaGravada(1, "BTG-000206", "B.0572.003.U.B", "Copo Beercup em Inox", 4, "v1"),
    linhaGravada(2, "BTG-000125", "A.01.0806.005.GG", "Polo Masculino Piquet Preto", 20, "v2"),
  ];

  it("em separação: o copo sai com 475ML no volume e na etiqueta, com o tamanho à parte para a folha A4", () => {
    const leitura = leituraDosVolumes({ ...BASE, tarefa: TAREFA_DO_COPO, linhas: LINHAS_DO_COPO, tamanhos: tamanhosDoCatalogo(CADASTRO) });
    expect(leitura.estado).toBe("pronto");
    expect(leitura.volumes.map((volume) => volume.itens.map((item) => [item.quantidade, item.nome, item.codigo]))).toEqual([
      [[4, "Copo Beercup em Inox · 475ML", "B.0572.003.U.B"]],
      // O tamanho que está no fim do código continua o do código, sem repetir.
      [[20, "Polo Masculino Piquet Preto · GG", "A.01.0806.005.GG"]],
    ]);
    const [copo] = volumeLabels(leitura.volumes[0]!, { ...ORDEM, total: null });
    expect(copo!.lines).toEqual([{ code: "B.0572.003.U.B", sku: "", name: "Copo Beercup em Inox · 475ML", qty: 4, size: "475ML" }]);
    expect(nameAndSize(copo!.lines[0]!)).toEqual({ name: "Copo Beercup em Inox", size: "475ML" });
    const [polo] = volumeLabels(leitura.volumes[1]!, { ...ORDEM, total: null });
    expect(polo!.lines.map((linha) => [linha.name, linha.size])).toEqual([["Polo Masculino Piquet Preto · GG", "GG"]]);
  });

  it("concluído: os itens dos volumes também saem com 475ML, na etiqueta e no romaneio", () => {
    const leitura = leituraDosVolumes({
      ...BASE,
      remessa: { status: "ready_to_dispatch", lacre: "88231" },
      tarefa: { ...TAREFA_DO_COPO, concluidaEm: "2026-11-12T15:00:00.000Z", por: "Guilherme Dantas" },
      linhas: null,
      pacotes: [
        { id: "pkg_pack_ord_1_001", order_id: "ord_1", status: "packed", volume_number: 1, packed_units: 4, weight_kg: 1.8, closed_at: "2026-11-12T13:20:00.000Z" },
        { id: "pkg_pack_ord_1_002", order_id: "ord_1", status: "packed", volume_number: 2, packed_units: 20, closed_at: "2026-11-12T13:40:00.000Z" },
      ],
      itensDosPacotes: [
        itemGravado(1, 1, "BTG-000206", "B.0572.003.U.B", "Copo Beercup em Inox", 4),
        itemGravado(2, 2, "BTG-000125", "A.01.0806.005.GG", "Polo Masculino Piquet Preto", 20),
      ],
      tamanhos: tamanhosDoCatalogo(CADASTRO),
    });
    expect(leitura.pedido?.concluido).toBe(true);
    const [copo] = volumeLabels(leitura.volumes[0]!, { ...ORDEM, total: leitura.volumes.length });
    expect([copo!.total, copo!.lines]).toEqual([2, [{ code: "B.0572.003.U.B", sku: "", name: "Copo Beercup em Inox · 475ML", qty: 4, size: "475ML" }]]);
    expect(nameAndSize(copo!.lines[0]!)).toEqual({ name: "Copo Beercup em Inox", size: "475ML" });
    const folha = folhaDoRomaneio({ numero: "PED-0001", lacre: "88231", volumes: leitura.volumes });
    expect(folha.volumes.map((volume) => volume.itens.map((item) => item.nome))).toEqual([["Copo Beercup em Inox · 475ML"], ["Polo Masculino Piquet Preto · GG"]]);
  });

  it("o SKU fora do cadastro lido sai como antes, só com o nome", () => {
    const leitura = leituraDosVolumes({ ...BASE, tarefa: TAREFA_DO_COPO, linhas: LINHAS_DO_COPO, tamanhos: tamanhosDoCatalogo(CADASTRO.slice(1)) });
    const [copo] = volumeLabels(leitura.volumes[0]!, { ...ORDEM, total: null });
    expect(copo!.lines).toEqual([{ code: "B.0572.003.U.B", sku: "", name: "Copo Beercup em Inox", qty: 4 }]);
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
