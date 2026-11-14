import { describe, expect, it, vi } from "vitest";

const tarefa = vi.hoisted(() => ({
  eventos: [] as Array<{ bytesTransferred: number; totalBytes: number }>,
  falha: null as unknown,
  cancelada: false,
}));

vi.mock("firebase/storage", () => ({
  uploadBytesResumable: () => ({
    on: (_evento: string, progresso: (instantaneo: { bytesTransferred: number; totalBytes: number }) => void, erro: (falha: unknown) => void, fim: () => void) => {
      for (const instantaneo of tarefa.eventos) progresso(instantaneo);
      if (tarefa.falha) erro(tarefa.falha);
      else fim();
    },
    cancel: () => {
      tarefa.cancelada = true;
      return true;
    },
  }),
}));

import { EnvioCancelado, FOTOS_POR_VEZ, LADO_MAIOR_DA_FOTO, compactarFoto, decisaoDaFoto, enviarComProgresso, medidasReduzidas, type DependenciasDaFoto } from "./envio-de-fotos";

/**
 * As fotos do celular (carregamento v2, parte 11; decisão 4 do celular, de
 * 06/11/2026): compactadas a 2000 px no lado maior, como o anexo do Agent
 * Dute, e enviadas pelo uploadBytesResumable, que conta os bytes.
 */

function foto(tipo: string, tamanho: number, nome = "IMG_0001.jpg"): File {
  return new File([new Uint8Array(tamanho)], nome, { type: tipo, lastModified: 1_700_000_000_000 });
}

function navegadorFalso(medidas: { largura: number; altura: number }, tamanhoDaPronta = 400_000) {
  const desenhadas: Array<{ largura: number; altura: number }> = [];
  const dependencias: DependenciasDaFoto = {
    medir: async () => medidas,
    desenhar: async (arquivo, alvo) => {
      desenhadas.push(alvo);
      return new File([new Uint8Array(tamanhoDaPronta)], arquivo.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    },
  };
  return { dependencias, desenhadas };
}

describe("a compactação a 2000 px", () => {
  it("o lado maior é o mesmo do anexo do Agent Dute, e são 4 fotos por vez no catálogo", () => {
    expect(LADO_MAIOR_DA_FOTO).toBe(2000);
    expect(FOTOS_POR_VEZ).toBe(4);
  });

  it("a foto do celular deitada (4000 × 3000) vira 2000 × 1500, em JPEG", async () => {
    const { dependencias, desenhadas } = navegadorFalso({ largura: 4000, altura: 3000 });
    const pronta = await compactarFoto(foto("image/jpeg", 3_400_000), { dependencias });
    expect(desenhadas).toEqual([{ largura: 2000, altura: 1500 }]);
    expect(pronta.type).toBe("image/jpeg");
    expect(pronta.name).toBe("IMG_0001.jpg");
    expect(pronta.size).toBe(400_000);
  });

  it("a foto em pé (3024 × 4032) fica com 2000 px na altura", async () => {
    const { dependencias, desenhadas } = navegadorFalso({ largura: 3024, altura: 4032 });
    await compactarFoto(foto("image/jpeg", 2_900_000), { dependencias });
    expect(desenhadas).toEqual([{ largura: 1500, altura: 2000 }]);
    expect(medidasReduzidas({ largura: 2001, altura: 10 })).toEqual({ largura: 2000, altura: 10 });
  });

  it("a PNG grande também vira JPEG de 2000 px no catálogo, com o nome em .jpg", async () => {
    const { dependencias, desenhadas } = navegadorFalso({ largura: 5000, altura: 2500 });
    const pronta = await compactarFoto(foto("image/png", 6_000_000, "etiqueta.png"), { dependencias });
    expect(desenhadas).toEqual([{ largura: 2000, altura: 1000 }]);
    expect(pronta.name).toBe("etiqueta.jpg");
  });

  it("a foto pequena e leve sobe como veio; a pequena e pesada é recomprimida no mesmo tamanho", async () => {
    const leve = navegadorFalso({ largura: 1600, altura: 1200 });
    const pequena = foto("image/jpeg", 300_000);
    expect(await compactarFoto(pequena, { dependencias: leve.dependencias })).toBe(pequena);
    expect(leve.desenhadas).toEqual([]);
    const pesada = navegadorFalso({ largura: 1600, altura: 1200 }, 900_000);
    const pronta = await compactarFoto(foto("image/jpeg", 2_500_000), { dependencias: pesada.dependencias });
    expect(pesada.desenhadas).toEqual([{ largura: 1600, altura: 1200 }]);
    expect(pronta.size).toBe(900_000);
  });

  it("com manterTipo (o nome da OS e do anexo já leva a extensão), só a JPEG muda", async () => {
    expect(decisaoDaFoto({ type: "image/png", size: 6_000_000 }, { largura: 4000, altura: 3000 }, { manterTipo: true })).toBe("manter");
    expect(decisaoDaFoto({ type: "image/webp", size: 6_000_000 }, { largura: 4000, altura: 3000 }, { manterTipo: true })).toBe("manter");
    expect(decisaoDaFoto({ type: "image/jpeg", size: 3_000_000 }, { largura: 4000, altura: 3000 }, { manterTipo: true })).toBe("reduzir");
    const { dependencias, desenhadas } = navegadorFalso({ largura: 4000, altura: 3000 });
    const png = foto("image/png", 6_000_000, "ft_a1.png");
    expect(await compactarFoto(png, { manterTipo: true, dependencias })).toBe(png);
    expect(desenhadas).toEqual([]);
  });

  it("o que não é foto e a foto que o navegador não abre sobem como vieram", async () => {
    const pdf = foto("application/pdf", 5_000_000, "nota.pdf");
    expect(await compactarFoto(pdf, { dependencias: navegadorFalso({ largura: 4000, altura: 3000 }).dependencias })).toBe(pdf);
    const avisos = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const heic = foto("image/jpeg", 4_000_000);
    const quebrado: DependenciasDaFoto = {
      medir: async () => {
        throw new Error("decode");
      },
      desenhar: async () => heic,
    };
    expect(await compactarFoto(heic, { dependencias: quebrado })).toBe(heic);
    avisos.mockRestore();
  });
});

describe("o envio que conta os bytes", () => {
  it("passa a fração de cada evento e termina em 1", async () => {
    tarefa.eventos = [
      { bytesTransferred: 100, totalBytes: 400 },
      { bytesTransferred: 300, totalBytes: 400 },
    ];
    tarefa.falha = null;
    const fracoes: number[] = [];
    await enviarComProgresso({} as never, new Blob(["x"]), { contentType: "image/jpeg" }, (fracao) => fracoes.push(fracao));
    expect(fracoes).toEqual([0.25, 0.75, 1]);
  });

  it("o sinal cancela a tarefa e o envio rejeita como cancelado", async () => {
    tarefa.eventos = [];
    tarefa.falha = null;
    tarefa.cancelada = false;
    const parar = new AbortController();
    parar.abort();
    await expect(enviarComProgresso({} as never, new Blob(["x"]), undefined, undefined, parar.signal)).rejects.toBeInstanceOf(EnvioCancelado);
  });
});
