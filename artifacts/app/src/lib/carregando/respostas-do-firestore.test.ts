import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A regra única das respostas do Firestore (carregamento v2, parte 13j): a
 * resposta só do cache é a falta, a do servidor é a volta, e quem ouve fica
 * sabendo. O `lib/cloud-api.ts` e a escuta ao vivo usam a mesma.
 */

type Modulo = typeof import("./respostas-do-firestore");
let m: Modulo;

beforeEach(async () => {
  vi.resetModules();
  m = await import("./respostas-do-firestore");
});

describe("as respostas do Firestore", () => {
  it("só do cache marca o SDK, com a hora em que ficou; a do servidor tira a marca e a hora", () => {
    expect(m.firestoreSoNoCache()).toBe(false);
    expect(m.firestoreSoNoCacheDesde()).toBeNull();
    m.firestoreRespondeu(false, () => 1_000);
    expect(m.firestoreSoNoCache()).toBe(true);
    expect(m.firestoreSoNoCacheDesde()).toBe(1_000);
    // Outra do cache não muda a hora: o SDK está offline desde a primeira.
    m.firestoreRespondeu(false, () => 5_000);
    expect(m.firestoreSoNoCacheDesde()).toBe(1_000);
    m.firestoreRespondeu(true);
    expect(m.firestoreSoNoCache()).toBe(false);
    expect(m.firestoreSoNoCacheDesde()).toBeNull();
  });

  it("quem ouve fica sabendo a cada resposta do cache e da volta, e não das do servidor com o SDK em dia", () => {
    const ouvinte = vi.fn();
    const deixar = m.ouvirRespostasDoFirestore(ouvinte);
    m.firestoreRespondeu(true);
    expect(ouvinte).not.toHaveBeenCalled();
    m.firestoreRespondeu(false);
    m.firestoreRespondeu(false);
    expect(ouvinte).toHaveBeenCalledTimes(2);
    m.firestoreRespondeu(true);
    expect(ouvinte).toHaveBeenCalledTimes(3);
    deixar();
    m.firestoreRespondeu(false);
    expect(ouvinte).toHaveBeenCalledTimes(3);
  });
});
