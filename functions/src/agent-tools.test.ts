import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { agentToolsForRole } from "./domain/agent-dute.js";

const PORTAL = ["resumo_estoque", "buscar_itens", "listar_pedidos", "ver_pedido", "movimentacoes", "faturas", "documentos"];

describe("consultas do Agent Dute por papel", () => {
  it("cliente só tem o que o portal mostra", () => {
    assert.deepEqual(agentToolsForRole("cliente"), PORTAL);
  });

  it("WMS tem o chão do armazém, sem faturas nem prévia", () => {
    const tools = agentToolsForRole("wms");
    for (const name of ["recebimentos", "tarefas_armazem", "enderecos"]) assert.ok(tools.includes(name as never), name);
    for (const name of ["faturas", "previa_faturamento", "fila_solicitacoes", "eventos"]) {
      assert.equal(tools.includes(name as never), false, name);
    }
  });

  it("financeiro tem o portal e a prévia, sem a operação", () => {
    assert.deepEqual(agentToolsForRole("financeiro"), [...PORTAL, "previa_faturamento"]);
  });

  it("coordenação tem a operação; prévia só para quem lê faturamento", () => {
    for (const role of ["owner", "admin", "suporte", "interno"]) {
      const tools = agentToolsForRole(role);
      for (const name of ["fila_solicitacoes", "recebimentos", "tarefas_armazem", "enderecos", "eventos"]) {
        assert.ok(tools.includes(name as never), `${role}: ${name}`);
      }
      assert.equal(tools.includes("previa_faturamento"), role !== "interno", role);
    }
  });

  it("papel desconhecido não consulta nada", () => {
    assert.deepEqual(agentToolsForRole("visitante"), []);
  });
});
