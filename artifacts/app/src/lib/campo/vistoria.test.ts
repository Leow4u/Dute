import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { fichaDaLeitura, type FichaDaOs } from "../operacao/ficha-da-os";
import { problemaParaConcluir } from "./concluir";
import { registroNovo, type RegistroNaFila } from "./fila";
import {
  apagarRascunho,
  chegadaDaVistoria,
  comAmbiente,
  comAtual,
  comFeito,
  comFotos,
  comItem,
  comMedida,
  comNovaMedida,
  comQuantidade,
  fazAVistoria,
  feitosEmTexto,
  fotosDoAmbiente,
  guardarRascunho,
  lerRascunho,
  problemaDoNomeDoAmbiente,
  problemasDaVistoria,
  rascunhoInicial,
  rascunhoLido,
  registroDaVistoria,
  semMedida,
  situacaoDoAmbiente,
  vistoriaGuardada,
  type RascunhoDaVistoria,
} from "./vistoria";

/**
 * A vistoria no celular (parte 3.11b): o rascunho por ambiente (fotos e
 * itens do catálogo), as medidas, o que falta para enviar, o envio no
 * formato de sendSurveyToCommercial e o rascunho guardado no aparelho.
 */

const here = dirname(fileURLToPath(import.meta.url));
const VISTORIA_DO_SERVIDOR = readFileSync(resolve(here, "../../../../../functions/operacao/src/domain/vistoria.ts"), "utf8");

const ANA = "col_aaaaaaaaaaaaaaaa";
const BRUNO = "col_bbbbbbbbbbbbbbbb";
const AGORA = new Date("2026-10-22T18:40:00.000Z");

const FICHA = fichaDaLeitura("10045-01", {
  tipo: "vistoria",
  status: "em_execucao",
  edicao: 4,
  demanda: "10045",
  customer_code: "ITAU",
  servicos: ["vistoria"],
  equipe: [
    { colaborador_id: ANA, nome: "Ana Lima", papel: "lider", vinculo: "proprio", no_app: true, usuario_uid: "uid-ana" },
    { colaborador_id: BRUNO, nome: "Bruno Teixeira", papel: "ajudante", vinculo: "proprio", no_app: true, usuario_uid: "uid-bruno" },
  ],
  etapas: [{ etapa: "chegada_origem", instante: "2026-10-22T17:05:00.000Z" }],
  fotos: [{ id: "ft_a000000000000001", caminho: "os/10045-01/fotos/ft_a000000000000001.jpg", legenda: "Recepção", instante: "2026-10-22T17:20:00.000Z" }],
}) as FichaDaOs;

const CADEIRA = { id: "lpu_cadeira", item: "Transporte de cadeira", servico: "Transporte", unidade: "UN" };
const ESTACAO = { id: "lpu_estacao", item: "Desmontagem de estação", servico: "Desmontagem", unidade: "UN" };

function naFila(callable: RegistroNaFila["callable"], dados: Record<string, unknown>, chave: string): RegistroNaFila {
  return registroNovo({ callable, dados, rotulo: "x" }, chave, AGORA);
}

/** Recepção (feita, 1 foto, 8 cadeiras) e Estações (atual, 12 estações e 16 cadeiras). */
function levantado(): RascunhoDaVistoria {
  let r = comAmbiente(rascunhoInicial(), "  Recepção ", "amb_1");
  r = comFotos(r, "amb_1", ["ft_a000000000000001"]);
  r = comItem(r, "amb_1", CADEIRA);
  for (let i = 1; i < 8; i += 1) r = comQuantidade(r, "amb_1", "lpu_cadeira", 1);
  r = comFeito(r, "amb_1", true);
  r = comAmbiente(r, "Estações", "amb_2");
  r = comFotos(r, "amb_2", ["ft_a000000000000002"]);
  r = comItem(r, "amb_2", ESTACAO);
  for (let i = 1; i < 12; i += 1) r = comQuantidade(r, "amb_2", "lpu_estacao", 1);
  r = comItem(r, "amb_2", CADEIRA);
  for (let i = 1; i < 16; i += 1) r = comItem(r, "amb_2", CADEIRA);
  return r;
}

describe("o rascunho da vistoria", () => {
  it("nasce com as medidas que toda vistoria pergunta", () => {
    expect(rascunhoInicial().medidas.map((medida) => [medida.nome, medida.sugerida])).toEqual([
      ["Elevador de serviço", true],
      ["Carga do elevador", true],
      ["Porta", true],
    ]);
  });

  it("ambientes: o novo é o atual; nome único sem olhar acento e caixa; concluir passa ao próximo a fazer", () => {
    const r = levantado();
    expect(r.ambientes.map((ambiente) => [ambiente.nome, ambiente.feito])).toEqual([
      ["Recepção", true],
      ["Estações", false],
    ]);
    expect(r.atual).toBe("amb_2");
    expect(problemaDoNomeDoAmbiente(r, " recepcao ")).toBe("O ambiente recepcao já está na vistoria.");
    expect(problemaDoNomeDoAmbiente(r, "  ")).toBe("Informe o nome do ambiente.");
    expect(problemaDoNomeDoAmbiente(r, "x".repeat(61))).toBe("Use até 60 caracteres no nome do ambiente.");
    expect(problemaDoNomeDoAmbiente(r, "Arquivo")).toBeNull();
    const comArquivo = comAmbiente(r, "Arquivo", "amb_3");
    expect(comFeito(comArquivo, "amb_2", true).atual).toBe("amb_3");
    expect(comFeito(comArquivo, "amb_1", false).atual).toBe("amb_1");
    expect(comAtual(r, "amb_9")).toBe(r);
    expect([situacaoDoAmbiente(comArquivo.ambientes[0], "amb_3"), situacaoDoAmbiente(comArquivo.ambientes[1], "amb_3"), situacaoDoAmbiente(comArquivo.ambientes[2], "amb_2")]).toEqual([
      "Feito",
      "Em andamento",
      "A fazer",
    ]);
    expect(feitosEmTexto(comArquivo)).toBe("1 de 3 feitos");
    expect(feitosEmTexto(rascunhoInicial())).toBeNull();
  });

  it("itens: entram com 1, somam no mesmo item e saem ao chegar a zero; fotos sem repetir", () => {
    const r = levantado();
    expect(r.ambientes[1].itens.map((item) => [item.item, item.quantidade])).toEqual([
      ["Desmontagem de estação", 12],
      ["Transporte de cadeira", 16],
    ]);
    let menos = r;
    for (let i = 0; i < 16; i += 1) menos = comQuantidade(menos, "amb_2", "lpu_cadeira", -1);
    expect(menos.ambientes[1].itens.map((item) => item.lpuItemId)).toEqual(["lpu_estacao"]);
    expect(comFotos(r, "amb_2", ["ft_a000000000000002", "ft_a000000000000003"]).ambientes[1].fotos).toEqual(["ft_a000000000000002", "ft_a000000000000003"]);
  });

  it("medidas: a sugerida não muda de nome nem sai; a nova sim", () => {
    let r = comMedida(rascunhoInicial(), "md_sugerida_3", "nome", "Janela");
    r = comMedida(r, "md_sugerida_3", "valor", "0,90 m");
    expect(r.medidas[2]).toMatchObject({ nome: "Porta", valor: "0,90 m" });
    r = comNovaMedida(r, "md_1");
    r = comMedida(r, "md_1", "nome", "Pé-direito");
    expect(semMedida(semMedida(r, "md_1"), "md_sugerida_1").medidas.map((medida) => medida.nome)).toEqual(["Elevador de serviço", "Carga do elevador", "Porta"]);
  });
});

describe("a vistoria na OS", () => {
  it("a chegada gravada ou guardada; o envio guardado na fila", () => {
    expect(chegadaDaVistoria(FICHA, [])).toBe("2026-10-22T17:05:00.000Z");
    const semChegada = { ...FICHA, etapas: [] };
    expect(chegadaDaVistoria(semChegada, [])).toBeNull();
    const chegou = naFila("registerStep", { numero: "10045-01", etapa: "chegada_origem", instante: "2026-10-22T17:06:00.000Z" }, "k-1");
    expect(chegadaDaVistoria(semChegada, [chegou])).toBe("2026-10-22T17:06:00.000Z");
    expect(vistoriaGuardada(FICHA, [chegou])).toBeNull();
    const envio = naFila("sendSurveyToCommercial", { numero: "10045-01" }, "k-2");
    expect(vistoriaGuardada(FICHA, [chegou, envio])?.chave).toBe("k-2");
  });

  it("quem faz: o líder, ou qualquer um da equipe sem líder; quem não está na OS, ninguém", () => {
    expect([fazAVistoria(FICHA, "uid-ana"), fazAVistoria(FICHA, "uid-bruno"), fazAVistoria(FICHA, "uid-x"), fazAVistoria(FICHA, null)]).toEqual([true, false, false, false]);
    const semLider = { ...FICHA, equipe: FICHA.equipe.map((pessoa) => ({ ...pessoa, papel: null })) };
    expect(fazAVistoria(semLider, "uid-bruno")).toBe(true);
  });

  it("as fotos do ambiente: a gravada na OS e a que ainda está na fila", () => {
    const r = levantado();
    const guardada = naFila("attachPhoto", { numero: "10045-01", arquivo: "ft_a000000000000002.jpg", instante: "2026-10-22T17:30:00.000Z" }, "k-3");
    expect(fotosDoAmbiente(r.ambientes[0], FICHA, []).map((foto) => [foto.id, foto.foto?.legenda ?? null, foto.guardada])).toEqual([["ft_a000000000000001", "Recepção", null]]);
    expect(fotosDoAmbiente(r.ambientes[1], FICHA, [guardada]).map((foto) => [foto.id, foto.foto, foto.guardada?.chave])).toEqual([["ft_a000000000000002", null, "k-3"]]);
  });

  it("o serviço não se conclui pela tela de conclusão", () => {
    expect(problemaParaConcluir(FICHA, [], "uid-ana")).toBe("A vistoria vai ao Comercial pela tela da OS.");
  });
});

describe("enviar a vistoria", () => {
  it("o que falta: a chegada, um ambiente, uma foto, um item e o nome de cada medida", () => {
    expect(problemasDaVistoria(rascunhoInicial(), { chegou: false })).toEqual([
      "Registre a chegada antes de enviar a vistoria.",
      "Levante ao menos um ambiente.",
      "Tire ao menos uma foto da vistoria.",
      "Levante ao menos um item do catálogo.",
    ]);
    expect(problemasDaVistoria(levantado(), { chegou: true })).toEqual([]);
    let r = comNovaMedida(levantado(), "md_1");
    r = comMedida(r, "md_1", "valor", "3,20 m");
    r = comNovaMedida(r, "md_2");
    r = comMedida(comMedida(r, "md_2", "nome", "porta"), "md_2", "valor", "0,80 m");
    r = comMedida(r, "md_sugerida_3", "valor", "0,90 m");
    expect(problemasDaVistoria(r, { chegou: true })).toEqual(["Dê nome a cada medida.", "A medida porta aparece duas vezes."]);
  });

  it("o registro: sendSurveyToCommercial, com o instante do toque e só a medida com valor", () => {
    let r = comMedida(levantado(), "md_sugerida_3", "valor", " 0,90  m ");
    r = { ...r, horarioDeCarga: " Depois das 18h ", vagaDeCarga: "", observacoes: "  Elevador até 19h.  " };
    expect(registroDaVistoria(FICHA, r, AGORA)).toEqual({
      callable: "sendSurveyToCommercial",
      dados: {
        numero: "10045-01",
        instante: "2026-10-22T18:40:00.000Z",
        ambientes: [
          { nome: "Recepção", itens: [{ lpu_item_id: "lpu_cadeira", quantidade: "8" }], fotos: ["ft_a000000000000001"] },
          {
            nome: "Estações",
            itens: [
              { lpu_item_id: "lpu_estacao", quantidade: "12" },
              { lpu_item_id: "lpu_cadeira", quantidade: "16" },
            ],
            fotos: ["ft_a000000000000002"],
          },
        ],
        medidas: [{ nome: "Porta", valor: "0,90 m" }],
        acesso: { horario_de_carga: "Depois das 18h", vaga_de_carga: null },
        observacoes: "Elevador até 19h.",
      },
      rotulo: "Vistoria",
    });
  });

  it("os campos do registro são os que o servidor aceita (o schema é .strict())", () => {
    const bloco = (inicio: string, fim: string) => VISTORIA_DO_SERVIDOR.slice(VISTORIA_DO_SERVIDOR.indexOf(inicio), VISTORIA_DO_SERVIDOR.indexOf(fim, VISTORIA_DO_SERVIDOR.indexOf(inicio)));
    // Chave com valor ("nome: ...") ou abreviada ("numero,").
    const chaves = (texto: string, recuo: number) => Array.from(texto.matchAll(new RegExp(`^ {${recuo}}(\\w+)(?::|,$)`, "gm")), ([, chave]) => chave);
    const envio = chaves(bloco("const EnviarVistoria = z", "export type PedidoDeVistoria"), 4);
    const ambiente = chaves(bloco("const AmbientePedido = z", "const MedidaPedida"), 4);
    const item = chaves(bloco("const ItemPedido = z", "const AmbientePedido"), 4);
    const { dados } = registroDaVistoria(FICHA, levantado(), AGORA);
    expect(Object.keys(dados).every((chave) => envio.includes(chave))).toBe(true);
    expect(envio).toEqual(["idempotency_key", "numero", "instante", "ambientes", "medidas", "acesso", "observacoes", "informado_por", "meio"]);
    const [primeiro] = dados.ambientes as Array<Record<string, unknown>>;
    expect(Object.keys(primeiro).every((chave) => ambiente.includes(chave))).toBe(true);
    expect(Object.keys((primeiro.itens as Array<Record<string, unknown>>)[0]).every((chave) => item.includes(chave))).toBe(true);
    expect(VISTORIA_DO_SERVIDOR).toMatch(/horario_de_carga: opcional\(/);
    expect(VISTORIA_DO_SERVIDOR).toMatch(/vaga_de_carga: opcional\(/);
  });
});

describe("o rascunho no aparelho", () => {
  function armazenamento() {
    const dados = new Map<string, string>();
    return {
      dados,
      getItem: (chave: string) => dados.get(chave) ?? null,
      setItem: (chave: string, valor: string) => void dados.set(chave, valor),
      removeItem: (chave: string) => void dados.delete(chave),
    };
  }

  it("guarda por OS, lê de volta e apaga", () => {
    const aparelho = armazenamento();
    guardarRascunho("10045-01", levantado(), aparelho);
    expect([...aparelho.dados.keys()]).toEqual(["dute:campo:vistoria:10045-01"]);
    expect(lerRascunho("10045-01", aparelho)).toEqual(levantado());
    expect(lerRascunho("10045-02", aparelho)).toBeNull();
    apagarRascunho("10045-01", aparelho);
    expect(lerRascunho("10045-01", aparelho)).toBeNull();
  });

  it("o que não se lê fica de fora; o armazenamento bloqueado não quebra a tela", () => {
    const aparelho = armazenamento();
    aparelho.setItem("dute:campo:vistoria:10045-01", "{não é json");
    expect(lerRascunho("10045-01", aparelho)).toBeNull();
    const lido = rascunhoLido({
      ambientes: [
        { id: "amb_1", nome: "Sala", fotos: ["ft_a000000000000001", "../outra.jpg"], itens: [{ lpuItemId: "lpu_cadeira", item: "Cadeira", quantidade: 2.5 }, { lpuItemId: "lpu_mesa", item: "Mesa", quantidade: 3 }] },
        { nome: "Sem id" },
      ],
      atual: "amb_9",
      medidas: [],
    });
    expect(lido?.ambientes).toEqual([{ id: "amb_1", nome: "Sala", feito: false, fotos: ["ft_a000000000000001"], itens: [{ lpuItemId: "lpu_mesa", item: "Mesa", unidade: null, quantidade: 3 }] }]);
    expect([lido?.atual, lido?.medidas.length]).toEqual([null, 3]);
    const bloqueado = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("cheio");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    };
    expect(lerRascunho("10045-01", bloqueado)).toBeNull();
    expect(() => guardarRascunho("10045-01", levantado(), bloqueado)).not.toThrow();
    expect(() => apagarRascunho("10045-01", bloqueado)).not.toThrow();
  });
});
