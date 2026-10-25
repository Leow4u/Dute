import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { registroNovo, type RegistroNaFila } from "./fila";
import { armazemNaMemoria, armazemNoAparelho } from "./fila-guardada";

/**
 * A fila guardada no aparelho (parte 3.8c): o registro feito sem sinal
 * sobrevive a fechar o app, com o instante original e a foto dentro, e cada
 * pessoa só vê o dela.
 */

const TOQUE = new Date("2026-10-20T12:28:00.000Z");

function etapa(chave: string, etapaDaOs: string, instante: string): RegistroNaFila {
  return registroNovo({ callable: "registerStep", dados: { numero: "10211-01", etapa: etapaDaOs, instante }, rotulo: etapaDaOs }, chave, TOQUE);
}

describe("fila guardada no aparelho", () => {
  it("guarda e devolve na ordem, com a chave e o instante do toque", async () => {
    const fabrica = new IDBFactory();
    const fila = [etapa("k-1", "saida_origem", "2026-10-20T13:20:00.000Z"), etapa("k-2", "chegada_destino", "2026-10-20T14:05:00.000Z")];
    await armazemNoAparelho(fabrica).guardar("uid-carlos", fila, []);
    // O app fechou e abriu de novo: outra conexão ao mesmo banco.
    const reaberta = await armazemNoAparelho(fabrica).carregar("uid-carlos");
    expect(reaberta.map((registro) => [registro.chave, registro.dados.instante, registro.dados.idempotency_key])).toEqual([
      ["k-1", "2026-10-20T13:20:00.000Z", "k-1"],
      ["k-2", "2026-10-20T14:05:00.000Z", "k-2"],
    ]);
    expect(reaberta[0]).toEqual(fila[0]);
  });

  it("guardar grava a fila e tira só o que saiu dela: o que já chegou sai", async () => {
    const fabrica = new IDBFactory();
    const armazem = armazemNoAparelho(fabrica);
    const [um, dois] = [etapa("k-1", "saida_origem", "2026-10-20T13:20:00.000Z"), etapa("k-2", "chegada_destino", "2026-10-20T14:05:00.000Z")];
    await armazem.guardar("uid-carlos", [um, dois], []);
    await armazem.guardar("uid-carlos", [dois], ["k-1"]);
    expect((await armazem.carregar("uid-carlos")).map((registro) => registro.chave)).toEqual(["k-2"]);
    await armazem.guardar("uid-carlos", [], ["k-2"]);
    expect(await armazem.carregar("uid-carlos")).toEqual([]);
  });

  it("o que a fila da tela não conhece fica: a fila que não carregou e a outra aba não apagam", async () => {
    const fabrica = new IDBFactory();
    const guardado = registroNovo({ callable: "registerStep", dados: { numero: "10211-01", etapa: "saida_origem" }, rotulo: "Saída" }, "k-antes", new Date("2026-10-20T12:00:00.000Z"));
    await armazemNoAparelho(fabrica).guardar("uid-carlos", [guardado], []);
    // Outra aba (ou a tela cuja leitura falhou) grava só o que ela tem.
    const novo = registroNovo({ callable: "registerStep", dados: { numero: "10211-01", etapa: "chegada_destino" }, rotulo: "Chegada" }, "k-depois", new Date("2026-10-20T12:30:00.000Z"));
    await armazemNoAparelho(fabrica).guardar("uid-carlos", [novo], []);
    // Os dois ficam, na ordem dos toques.
    expect((await armazemNoAparelho(fabrica).carregar("uid-carlos")).map((registro) => registro.chave)).toEqual(["k-antes", "k-depois"]);
    // Na memória, o mesmo.
    const memoria = armazemNaMemoria();
    await memoria.guardar("uid-carlos", [guardado], []);
    await memoria.guardar("uid-carlos", [novo], []);
    expect((await memoria.carregar("uid-carlos")).map((registro) => registro.chave)).toEqual(["k-antes", "k-depois"]);
  });

  it("cada pessoa só vê o dela", async () => {
    const fabrica = new IDBFactory();
    const armazem = armazemNoAparelho(fabrica);
    await armazem.guardar("uid-carlos", [etapa("k-c", "saida_origem", "2026-10-20T13:20:00.000Z")], []);
    await armazem.guardar("uid-ana", [etapa("k-a", "carregamento", "2026-10-20T11:00:00.000Z")], []);
    expect((await armazem.carregar("uid-carlos")).map((registro) => registro.chave)).toEqual(["k-c"]);
    expect((await armazem.carregar("uid-ana")).map((registro) => registro.chave)).toEqual(["k-a"]);
    expect(await armazem.carregar("uid-outro")).toEqual([]);
  });

  it("a foto vai junto, inteira", async () => {
    const fabrica = new IDBFactory();
    const arquivo = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" });
    const foto = registroNovo(
      { callable: "attachPhoto", dados: { numero: "10211-01", arquivo: "ft_0123456789abcdef.jpg", instante: "2026-10-20T12:20:00.000Z" }, foto: { caminho: "os/10211-01/fotos/ft_0123456789abcdef.jpg", arquivo, contentType: "image/jpeg" }, rotulo: "Foto" },
      "k-f",
      TOQUE,
    );
    await armazemNoAparelho(fabrica).guardar("uid-carlos", [foto], []);
    const [lida] = await armazemNoAparelho(fabrica).carregar("uid-carlos");
    expect(lida.foto?.caminho).toBe("os/10211-01/fotos/ft_0123456789abcdef.jpg");
    expect(lida.foto?.arquivo.size).toBe(4);
  });

  it("sem IndexedDB, fica na memória", async () => {
    const armazem = armazemNoAparelho(null, null);
    await armazem.guardar("uid-carlos", [etapa("k-1", "saida_origem", "2026-10-20T13:20:00.000Z")], []);
    expect((await armazem.carregar("uid-carlos")).map((registro) => registro.chave)).toEqual(["k-1"]);
    expect(await armazemNaMemoria().carregar("uid-carlos")).toEqual([]);
  });

  it("as falhas ficam por pessoa, sobrevivem a fechar o app e saem quando dispensadas", async () => {
    const local = new Map<string, string>();
    const armazenamento = {
      getItem: (chave: string) => local.get(chave) ?? null,
      setItem: (chave: string, valor: string) => void local.set(chave, valor),
      removeItem: (chave: string) => void local.delete(chave),
    };
    const fabrica = new IDBFactory();
    const recusa = { chave: "k-c", rotulo: "Conclusão", mensagem: "A OS já foi concluída." };
    await armazemNoAparelho(fabrica, armazenamento).guardarFalhas("uid-carlos", [recusa]);
    // O app fechou e abriu de novo.
    expect(await armazemNoAparelho(fabrica, armazenamento).carregarFalhas("uid-carlos")).toEqual([recusa]);
    expect(await armazemNoAparelho(fabrica, armazenamento).carregarFalhas("uid-ana")).toEqual([]);

    await armazemNoAparelho(fabrica, armazenamento).guardarFalhas("uid-carlos", []);
    expect(local.size).toBe(0);

    // O que não é falha não volta.
    local.set("dute.campo.falhas.uid-carlos", JSON.stringify([recusa, { chave: 1 }, "texto"]));
    expect(await armazemNoAparelho(fabrica, armazenamento).carregarFalhas("uid-carlos")).toEqual([recusa]);
  });
});
