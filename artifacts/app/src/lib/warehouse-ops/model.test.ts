import { describe, expect, it } from "vitest";

import {
  canAdvanceTask,
  canRegisterException,
  getErrorMessage,
  getPackingCheckRows,
  getTaskTitle,
  normalizeQueues,
  somenteConsulta,
  type WarehouseTask,
} from "./model";

describe("mensagem de erro das Functions", () => {
  it("mostra só a mensagem quando o corpo do erro vem em JSON", () => {
    const body = JSON.stringify({
      message: "Não foi possível conferir a qualidade da foto agora. A proposta não foi salva; tente novamente.",
      code: "unavailable",
    });
    expect(getErrorMessage(new Error(body))).toBe(
      "Não foi possível conferir a qualidade da foto agora. A proposta não foi salva; tente novamente.",
    );
  });

  it("mantém o texto quando o erro não é JSON", () => {
    expect(getErrorMessage(new Error("HTTP 500"))).toBe("HTTP 500");
    expect(getErrorMessage("falhou")).toBe("Erro inesperado");
  });
});

/** A guarda de linha como a fila entrega: o produto vem na linha da tarefa. */
function guardaDeLinha(nome: string | undefined, codigo: string, extra: Partial<WarehouseTask> = {}): WarehouseTask {
  const titulo = `Guardar ${nome ?? "BTG-000123"}`;
  return {
    id: "putaway:put_1",
    reference: "put_1",
    title: titulo,
    status: "planned",
    items: [{ id: "put_1:putaway", sku: "BTG-000123", sku_code: "BTG-000123", client_item_code: codigo, name: nome ?? titulo, product_name: nome ?? titulo, quantity: 6 }],
    ...extra,
  };
}

describe("o título da tarefa (padrão do nome, 06/11/2026)", () => {
  it("a guarda de linha leva o nome com o tamanho depois do ponto, antes e depois da limpeza dos nomes", () => {
    expect(getTaskTitle(guardaDeLinha("Polo masculino piquet preto - XG", "A.01.0806.005.XG"))).toBe("Guardar Polo masculino piquet preto · XG");
    expect(getTaskTitle(guardaDeLinha("Polo Masculino Piquet Preto", "A.01.0806.005.XG"))).toBe("Guardar Polo Masculino Piquet Preto · XG");
    expect(getTaskTitle(guardaDeLinha("CALÇA SOCIAL MASCULINA PRETA 42", "A.01.0712.001.42", { source: "wms_area_putaway" }))).toBe(
      "Guardar CALÇA SOCIAL MASCULINA PRETA · 42",
    );
  });

  it("sem tamanho no código vale o campo Tamanho; tamanho único e produto sem tamanho ficam só com o nome", () => {
    const comCampo = guardaDeLinha("Camiseta dry fit M", "CAM-01");
    comCampo.items![0]!.size = "M";
    expect(getTaskTitle(comCampo)).toBe("Guardar Camiseta dry fit · M");
    expect(getTaskTitle(guardaDeLinha("Boné BTG U", "A.05.0101.001.U"))).toBe("Guardar Boné BTG");
    expect(getTaskTitle(guardaDeLinha("Caneca BTG 300 ml", "A.09.0001.002"))).toBe("Guardar Caneca BTG 300 ml");
  });

  it("a guarda que o servidor já gravou com o tamanho fica como está, mesmo com o tamanho só no campo", () => {
    const nova = guardaDeLinha("Camiseta dry fit", "CAM-01", { title: "Guardar Camiseta dry fit · M" });
    expect(getTaskTitle(nova)).toBe("Guardar Camiseta dry fit · M");
  });

  it("a guarda da caixa, a guarda sem nome do produto e as outras tarefas ficam com o título gravado", () => {
    const caixa: WarehouseTask = {
      id: "putaway:put_box_cx131",
      title: "Guardar caixa CX-000131",
      box_code: "CX-000131",
      items: [{ id: "put_box_cx131:putaway", name: "Guardar caixa CX-000131", product_name: "Guardar caixa CX-000131" }],
    };
    expect(getTaskTitle(caixa)).toBe("Guardar caixa CX-000131");
    // A fila repete o título na linha quando a guarda não tem o nome do produto.
    expect(getTaskTitle(guardaDeLinha(undefined, "A.01.0806.005.XG"))).toBe("Guardar BTG-000123");
    const chegada: WarehouseTask = {
      id: "receiving:inb_avulso_1",
      title: "AVL-0D0E620B",
      items: [{ id: "l1", product_name: "Polo masculino piquet preto - XG", client_item_code: "A.01.0806.005.XG" }],
    };
    expect(getTaskTitle(chegada)).toBe("AVL-0D0E620B");
    expect(getTaskTitle({ id: "putaway:put_2", reference: "put_2", items: [{ product_name: "Polo preto XG", client_item_code: "A.01.0806.005.XG" }] })).toBe("put_2");
    expect(getTaskTitle({ id: "put_3" })).toBe("Tarefa put_3");
  });
});

describe("as linhas da conferência física", () => {
  it("o nome com o tamanho depois do ponto e o código do cliente antes do SKU", () => {
    const rows = getPackingCheckRows({
      id: "packing:pack_1",
      status: "planned",
      items: [
        { id: "l1", name: "Polo masculino piquet preto - XG", client_item_code: "A.01.0806.005.XG", sku: "BTG-000126", quantity: 15 },
        { id: "l2", product_name: "Calça Social Masculino Preta", client_item_code: "A.01.0712.001.42", sku_code: "BTG-000084", quantity: 6 },
        { id: "l3", product_name: "Boné BTG", client_item_code: "A.05.0101.001.U", sku: "BTG-000300", quantity: 2 },
        { id: "l4", sku: "BTG-000200", quantity: 1 },
        { id: "l5", quantity: 1 },
      ],
    });
    expect(rows.map((row) => [row.title, row.code])).toEqual([
      ["Polo masculino piquet preto · XG", "A.01.0806.005.XG"],
      ["Calça Social Masculino Preta · 42", "A.01.0712.001.42"],
      ["Boné BTG", "A.05.0101.001.U"],
      ["BTG-000200", "BTG-000200"],
      ["Linha 5", undefined],
    ]);
  });
});

describe("a tarefa só para consulta", () => {
  it("quem não opera o armazém não avança nem registra exceção; a tarefa segue a mesma", () => {
    const queue = normalizeQueues({ receiving: { key: "receiving", name: "Recebimento", tasks: [{ id: "inb_1", status: "checking", can_advance: true }] } }).find(
      (entry) => entry.key === "receiving",
    )!;
    const entrada = { task: queue.tasks[0]!, queue };
    expect(canAdvanceTask(entrada.task)).toBe(true);
    expect(canRegisterException(entrada.task)).toBe(true);
    const consulta = somenteConsulta(entrada);
    expect(canAdvanceTask(consulta.task)).toBe(false);
    expect(canRegisterException(consulta.task)).toBe(false);
    expect({ ...consulta.task, can_advance: true, can_register_exception: undefined }).toMatchObject({ id: "inb_1", status: "checking" });
    expect(entrada.task.can_advance).toBe(true);
  });
});
