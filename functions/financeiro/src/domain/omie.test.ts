import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ErroDaOmie, OMIE_API, chamarOmie, classificarResposta, corpoDaChamada, semChaves, type TransporteDaOmie } from "./omie.js";

/**
 * O cliente da API da Omie (parte 7.4a): o corpo da chamada, a falha de cada
 * resposta e as chaves que nunca saem na mensagem. As mensagens de erro são
 * as das páginas de ajuda da Omie e a da chave inválida, vista numa chamada
 * de teste em 24/10/2026.
 */

const CHAVES = { app_key: "1234567890", app_secret: "segredo-abc" };

describe("a resposta da Omie", () => {
  it("o 200 sem faultstring é sucesso", () => {
    assert.equal(classificarResposta(200, { nCodOS: 10 }), null);
  });

  it("cada falha cai no tipo certo, com a espera", () => {
    const casos: Array<[number, unknown, string, number]> = [
      [403, { faultstring: "A chave de acesso não está preenchida ou não é válida.", faultcode: "SOAP-ENV:Server" }, "chave", 0],
      [429, { faultstring: "Too Many Requests" }, "limite", 60_000],
      [425, { faultstring: "Consumo indevido: método bloqueado por 30 minutos." }, "limite", 30 * 60_000],
      [500, { faultstring: "ERROR: Consumo redundante detectado, aguarde 60 segundos." }, "limite", 60_000],
      [500, { faultstring: "ERROR: Ordem de Serviço já cadastrada para o código de integração [nfe_x]!" }, "duplicado", 0],
      [500, { faultstring: "PROTO_BYEBYE" }, "instavel", 2 * 60_000],
      [502, null, "instavel", 2 * 60_000],
      [500, { faultstring: "ERROR: Tag [nCodCli] não informada." }, "recusa", 2 * 60_000],
      [200, { faultstring: "ERROR: Cliente não cadastrado." }, "recusa", 2 * 60_000],
      [500, { faultstring: "ERROR: Cliente bloqueado para faturamento." }, "recusa", 2 * 60_000],
    ];
    for (const [status, corpo, tipo, espera] of casos) {
      const falha = classificarResposta(status, corpo);
      assert.ok(falha, JSON.stringify(corpo));
      assert.deepEqual([falha.tipo, falha.esperar_ms], [tipo, espera], JSON.stringify(corpo));
    }
  });
});

describe("a chamada", () => {
  it("o corpo leva o call, as chaves e o param numa lista", () => {
    assert.deepEqual(JSON.parse(corpoDaChamada(CHAVES, "StatusOS", { cCodIntOS: "nfe_1" })), {
      call: "StatusOS",
      app_key: CHAVES.app_key,
      app_secret: CHAVES.app_secret,
      param: [{ cCodIntOS: "nfe_1" }],
    });
  });

  it("chama o endereço do serviço e devolve o corpo", async () => {
    const chamadas: string[] = [];
    const transporte: TransporteDaOmie = async (url) => {
      chamadas.push(url);
      return { status: 200, corpo: { nCodOS: 77 } };
    };
    assert.deepEqual(await chamarOmie(transporte, CHAVES, "servicos/os", "StatusOS", {}), { nCodOS: 77 });
    assert.deepEqual(chamadas, [`${OMIE_API}/servicos/os/`]);
  });

  it("a falha e a rede caída viram ErroDaOmie, sem as chaves na mensagem", async () => {
    const recusa: TransporteDaOmie = async () => ({ status: 500, corpo: { faultstring: `ERROR: app_secret segredo-abc inválido para a app_key 1234567890` } });
    await assert.rejects(chamarOmie(recusa, CHAVES, "servicos/os", "StatusOS", {}), (error: unknown) => {
      assert.ok(error instanceof ErroDaOmie);
      assert.equal(error.falha.tipo, "chave");
      assert.doesNotMatch(error.message, /segredo-abc|1234567890/);
      return true;
    });
    const caida: TransporteDaOmie = async () => {
      throw new Error("connect ECONNREFUSED com app_key=1234567890");
    };
    await assert.rejects(chamarOmie(caida, CHAVES, "servicos/os", "StatusOS", {}), (error: unknown) => {
      assert.ok(error instanceof ErroDaOmie);
      assert.equal(error.falha.tipo, "instavel");
      assert.doesNotMatch(error.message, /1234567890/);
      return true;
    });
  });

  it("semChaves troca cada chave por asteriscos", () => {
    assert.equal(semChaves("a 1234567890 b segredo-abc", CHAVES), "a *** b ***");
  });
});
