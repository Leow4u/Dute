import { describe, expect, it } from "vitest";

import { fichaDaLeitura } from "../operacao/ficha-da-os";
import { comprovanteDaOs, hrefDoComprovante, temComprovante } from "./comprovante";
import { osDoPortal } from "./servicos";

/**
 * O comprovante da OS concluída no portal (parte 4.3d): o que foi feito, quem
 * recebeu, a assinatura e as fotos do final. Nada interno, nenhum valor; a
 * vistoria e a OS ainda aberta não têm comprovante. Dados sintéticos.
 */

const CONCLUSAO = {
  instante: "2026-10-22T19:30:00.000Z",
  canal: "celular",
  aceite: "assinatura",
  responsavel: { nome: "Renata Campos", cargo: "Facilities", documento: "12.345.678-9" },
  assinatura: "os/10045-01/assinatura/as_0123456789abcdef.png",
  diferencas: [{ linha: "ln_2", previsto: "60", executado: "58", motivo: "2 mesas com pé quebrado" }],
  arquivos_do_final: ["ft_f000000000000001.jpg", "ft_f000000000000002.jpg", "../fora.jpg"],
};

function ficha(extra: Record<string, unknown> = {}) {
  const lida = fichaDaLeitura("10045-01", {
    demanda: "10045",
    customer_code: "ITAU",
    cliente_nome: "Itaú Unibanco",
    status: "em_revisao",
    edicao: 9,
    servicos: ["transporte", "montagem"],
    janela: { data: "2026-10-22", inicio: "07:30", fim: "18:00" },
    locais: { origem: { nome: "Galpão 3", endereco: "Rua das Indústrias, 450" }, destino: { endereco: "Av. Faria Lima, 3500", complemento: "5º andar" } },
    equipe: [
      { colaborador_id: "c1", nome: "Ana Lima", papel: "lider" },
      { colaborador_id: "c2", nome: "João Pereira", papel: "motorista" },
      { colaborador_id: "c3", nome: "Diego Alves", papel: "montador" },
    ],
    veiculos: [{ veiculo_id: "v1", placa: "DEF4G56", tipo: "caminhao" }],
    itens: [
      { id: "ln_1", item: "Cadeira", unidade: "UN", planejado: "150", executado: "160" },
      { id: "ln_2", item: "Mesa de trabalho", unidade: "UN", planejado: "60", executado: "58" },
      { id: "ln_3", item: "Gaveteiro", unidade: "UN", planejado: "10", executado: null },
    ],
    fotos: [
      { id: "ft_0000000000000001", caminho: "os/10045-01/fotos/ft_0000000000000001.jpg", etapa: "carregamento", instante: "2026-10-22T12:00:00.000Z", canal: "celular" },
      { id: "ft_f000000000000001", caminho: "os/10045-01/fotos/ft_f000000000000001.jpg", etapa: "fim", instante: "2026-10-22T19:25:00.000Z", canal: "celular" },
    ],
    ocorrencias: [{ id: "o1", instante: "2026-10-22T13:00:00.000Z", canal: "celular", descricao: "Elevador de carga parado" }],
    revisao: { instante: "2026-10-23T12:00:00.000Z", nota: "Conferido" },
    conclusao: CONCLUSAO,
    ...extra,
  });
  if (!lida) throw new Error("ficha inválida");
  return lida;
}

describe("o comprovante da OS no portal", () => {
  it("a concluída: o serviço, a janela, os locais, o motorista, o feito, quem assinou e as fotos do final", () => {
    const comprovante = comprovanteDaOs(ficha(), "Itaú Unibanco");
    expect(comprovante).toEqual({
      numero: "10045-01",
      demanda: "10045",
      servicos: "Transporte e montagem",
      cliente: "Itaú Unibanco",
      janela: "22/10/2026 · 07:30–18:00",
      concluidaEm: "22/10/2026 às 16:30",
      origem: "Galpão 3 · Rua das Indústrias, 450",
      destino: "Av. Faria Lima, 3500 · 5º andar",
      motorista: "João Pereira · DEF-4G56",
      itens: [
        { id: "ln_1", item: "Cadeira", unidade: "un", feito: "160" },
        { id: "ln_2", item: "Mesa de trabalho", unidade: "un", feito: "58" },
        { id: "ln_3", item: "Gaveteiro", unidade: "un", feito: "0" },
      ],
      aceite: { nome: "Renata Campos", detalhe: "Facilities · doc. 12.345.678-9", assinatura: "os/10045-01/assinatura/as_0123456789abcdef.png" },
      // Só as do final, e só nome de arquivo válido.
      fotos: ["os/10045-01/fotos/ft_f000000000000001.jpg", "os/10045-01/fotos/ft_f000000000000002.jpg"],
    });
    // Nada interno: a revisão, as ocorrências, o previsto, a equipe além do motorista, a foto do carregamento.
    expect(JSON.stringify(comprovante)).not.toMatch(/Conferido|Elevador|Ana Lima|Diego|ft_0000000000000001|"150"|"60"|quebrado|R\$|valor|preco/);
  });

  it("sem aceite no local: quem recebeu e nenhuma assinatura", () => {
    const comprovante = comprovanteDaOs(ficha({ status: "revisada", conclusao: { ...CONCLUSAO, aceite: "sem_aceite", responsavel: { nome: "Portaria" }, assinatura: null } }), "");
    expect(comprovante?.aceite).toEqual({ nome: "Portaria", detalhe: "Sem aceite no local", assinatura: null });
    // Sem o nome do cadastro, o da demanda copiado na OS.
    expect(comprovante?.cliente).toBe("Itaú Unibanco");
  });

  it("a OS concluída antes da parte 4.3c sai sem as fotos; a aberta, a cancelada e a vistoria não têm comprovante", () => {
    const { arquivos_do_final: _fora, ...semLista } = CONCLUSAO;
    expect(comprovanteDaOs(ficha({ conclusao: semLista }), "Itaú")?.fotos).toEqual([]);
    for (const status of ["aberta", "agendada", "em_execucao", "cancelada"]) {
      expect(comprovanteDaOs(ficha({ status }), "Itaú"), status).toBeNull();
      expect(osDoPortal(ficha({ status }), "2026-10-23").comprovante, status).toBe(false);
    }
    expect(temComprovante(ficha({ tipo: "vistoria", status: "revisada" }))).toBe(false);
    expect(temComprovante(ficha({ conclusao: null }))).toBe(false);
    expect(osDoPortal(ficha(), "2026-10-23").comprovante).toBe(true);
    expect(hrefDoComprovante("10045-01")).toBe("/portal/servicos/comprovante?os=10045-01");
  });
});
