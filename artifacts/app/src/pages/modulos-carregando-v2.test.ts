import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Os outros módulos no carregamento v2 (parte 13g): o Comercial, a Operação,
 * o campo, a TV da sala, o Financeiro e o RH. Nenhuma tela deles gira o
 * Loader2 ou o RefreshCw (`animate-spin`), pulsa (`animate-pulse`, o
 * `Skeleton` antigo) ou escreve "Carregando" solto: a espera é o `Spinner`, o
 * `Esqueleto`, a `CarregandoNaRegiao` (o rótulo no gerúndio aos 300 ms) e o
 * `BotaoDeAcao`. Nenhuma tem região viva solta (`aria-live`, `role="status"`):
 * quem fala é o `Anunciador`, um por tela. A reticência é o caractere único, e
 * o botão que grava não troca o texto sozinho ("{ocupado ? 'Salvando...' :
 * 'Salvar'}"): o gerúndio é a camada do `BotaoDeAcao`, que nunca fica
 * `disabled` (o foco cairia no `body`).
 */

const RAIZ = join(__dirname, "..");
const LUGARES = [
  "pages/comercial",
  "pages/operacao",
  "pages/campo",
  "pages/tv",
  "pages/financeiro",
  "pages/rh",
  "components/comercial",
  "components/operacao",
  "components/campo",
  "components/financeiro",
  "components/relatorios",
  "components/layout/campo-layout.tsx",
  "components/layout/comercial-layout.tsx",
  "components/layout/operacao-layout.tsx",
  "components/layout/financeiro-layout.tsx",
  "components/layout/rh-layout.tsx",
  "components/layout/tv-layout.tsx",
];

function fontes(lugar: string): string[] {
  const caminho = join(RAIZ, lugar);
  if (!statSync(caminho).isDirectory()) return [lugar];
  return (readdirSync(caminho, { recursive: true }) as string[])
    .filter((nome) => /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome))
    .map((nome) => `${lugar}/${nome}`);
}

const ARQUIVOS = LUGARES.flatMap(fontes).map((caminho) => ({ caminho, fonte: readFileSync(join(RAIZ, caminho), "utf8") }));

/** A linha que é só comentário (o JSDoc, o `//` e o `{/* … *\/}`): o texto dela não chega à tela. */
const COMENTARIO = /^\s*(?:\*|\/\/|\/\*|\{\/\*)/;

/** As linhas da fonte que casam com o padrão, como "arquivo:linha: trecho". */
function ocorrencias(padrao: RegExp, { comentarios = true }: { comentarios?: boolean } = {}): string[] {
  return ARQUIVOS.flatMap(({ caminho, fonte }) =>
    fonte
      .split("\n")
      .map((linha, indice) => ({ linha, numero: indice + 1 }))
      .filter(({ linha }) => (comentarios || !COMENTARIO.test(linha)) && padrao.test(linha))
      .map(({ linha, numero }) => `${caminho}:${numero}: ${linha.trim()}`),
  );
}

/**
 * Os rótulos com a reticência dos seis módulos (os gerúndios do BotaoDeAcao e
 * da CarregandoNaRegiao, e os itens que abrem um diálogo), um por um. A
 * espera só pinta o rótulo aos 300 ms, e o HTML estático dos testes das telas
 * não o vê: rótulo novo entra aqui, e a trava falha até alguém o ler e o pôr
 * na lista (seção 7: "os rótulos novos entram na lista de cada tela").
 */
const ROTULOS_COM_RETICENCIA = [
  "Abrindo a demanda…",
  "Abrindo a medição…",
  "Adicionar item…",
  "Agendando…",
  "Anexando à conclusão…",
  "Anexando…",
  "Aplicando a tarifa…",
  "Aprovando e enviando…",
  "Aprovando…",
  "Arquivando…",
  "Atualizando a tabela…",
  "Baixando…",
  "Cancelando a OS…",
  "Cancelando a autorização…",
  "Cancelando a vistoria…",
  "Cancelando o registro…",
  "Carregando ${objeto}…",
  "Carregando a NF…",
  "Carregando a OS…",
  "Carregando a agenda…",
  "Carregando a demanda…",
  "Carregando a ficha…",
  "Carregando a fila…",
  "Carregando a medição…",
  "Carregando a tabela…",
  "Carregando as NFs…",
  "Carregando as OS para revisar…",
  "Carregando as autorizações…",
  "Carregando as demandas…",
  "Carregando as emissões…",
  "Carregando as exportações…",
  "Carregando as pessoas…",
  "Carregando o Hoje…",
  "Carregando o cadastro…",
  "Carregando o orçamento…",
  "Carregando o quadro…",
  "Carregando o relatório…",
  "Carregando os colaboradores…",
  "Carregando os contratos…",
  "Carregando os executados…",
  "Carregando os orçamentos…",
  "Carregando os pagamentos…",
  "Carregando os veículos…",
  "Carregando suas OS…",
  "Concluindo a OS…",
  "Concluindo a revisão…",
  "Criando o contrato…",
  "Criando o orçamento…",
  "Criando o prospect…",
  "Desativando…",
  "Desistindo…",
  "Devolvendo…",
  "Dispensando…",
  "Duplicando…",
  "Emitindo pela Omie…",
  "Enviando ao cliente…",
  "Enviando o arquivo…",
  "Enviando para aprovação…",
  "Escolher…",
  "Estornando…",
  "Gerando a exportação…",
  "Gravando…",
  "Marcando como cliente…",
  "Marcando como enviada…",
  "Novo contato…",
  "Reabrindo a OS…",
  "Reabrindo…",
  "Reativando…",
  "Recusando a solicitação…",
  "Registrando a NF…",
  "Registrando a aprovação…",
  "Registrando a autorização…",
  "Registrando a contestação…",
  "Registrando a perda…",
  "Registrando o aditivo…",
  "Registrando o pagamento…",
  "Registrando…",
  "Retirando a OS…",
  "Retomando…",
  "Salvando a tabela…",
  "Salvando as datas…",
  "Salvando o contato…",
  "Salvando o local…",
  "Salvando o rascunho…",
  "Salvando…",
  "Voltando à montagem…",
];

/** Os rótulos que a `SemLeitura` de Clientes e de Contratos monta ("Carregando ${objeto}…"), um por lista. */
const ROTULOS_DA_SEM_LEITURA = [
  "Carregando as tabelas…",
  "Carregando os aditivos…",
  "Carregando os contatos…",
  "Carregando os contratos…",
  "Carregando os locais…",
];

/** Os rótulos com a reticência na fonte: o texto entre aspas, o do template e o do JSX, fora dos comentários. */
function rotulosComReticencia(): string[] {
  const achados = new Set<string>();
  const padrao = /"([^"]*…)"|`([^`]*…)`|>\s*([^<>{}]*…)\s*<|^\s*([^<>{}"'`=]*…)\s*$/g;
  for (const { fonte } of ARQUIVOS) {
    for (const linha of fonte.split("\n")) {
      if (COMENTARIO.test(linha)) continue;
      for (const achado of linha.matchAll(padrao)) achados.add((achado[1] ?? achado[2] ?? achado[3] ?? achado[4] ?? "").trim());
    }
  }
  return [...achados].sort();
}

describe("os outros módulos no carregamento v2", () => {
  it("lê as telas dos seis módulos", () => {
    // A trava que não acha arquivo nenhum passaria sem olhar nada.
    expect(ARQUIVOS.length).toBeGreaterThan(80);
    for (const modulo of ["pages/comercial/", "pages/operacao/", "pages/campo/", "pages/tv/", "pages/financeiro/", "pages/rh/"]) {
      expect(ARQUIVOS.some(({ caminho }) => caminho.startsWith(modulo)), modulo).toBe(true);
    }
  });

  it("nada gira nem pulsa fora das peças: sem animate-spin, animate-pulse, Loader2 nem o Skeleton antigo", () => {
    expect(ocorrencias(/animate-spin|animate-pulse|\bLoader2\b/)).toEqual([]);
    expect(ocorrencias(/["']@\/components\/ui\/skeleton["']/)).toEqual([]);
  });

  it("nenhuma região viva solta: quem fala é o Anunciador", () => {
    // Nem aria-live nem os papéis que já são regiões vivas (status, log; o alert é a falha e fica de fora).
    expect(ocorrencias(/aria-live|role=["'{](?:status|log|marquee|timer)\b/)).toEqual([]);
    // O papel que escolhe entre dois ({erro ? "alert" : "status"}) também é região viva.
    expect(ocorrencias(/role=\{[^}]*["'](?:status|log|marquee|timer)["']/)).toEqual([]);
  });

  it("nenhum \"Carregando\" solto: a espera é a CarregandoNaRegiao, com o que se lê no gerúndio", () => {
    expect(ocorrencias(/>\s*Carregando(?:…|\.\.\.)?\s*</, { comentarios: false })).toEqual([]);
    expect(ocorrencias(/["'`]Carregando(?:…|\.\.\.)?["'`]/, { comentarios: false })).toEqual([]);
  });

  it("cada rótulo com a reticência está na lista: o que só aparece aos 300 ms também passa pela trava de textos", () => {
    expect(rotulosComReticencia()).toEqual([...ROTULOS_COM_RETICENCIA].sort());
  });

  it("os rótulos que a SemLeitura monta com o objeto também estão na lista", () => {
    const montados = ARQUIVOS.flatMap(({ fonte }) => [...fonte.matchAll(/<SemLeitura\b[^>]*\bobjeto="([^"]+)"/g)].map((achado) => `Carregando ${achado[1]}…`));
    expect([...new Set(montados)].sort()).toEqual([...ROTULOS_DA_SEM_LEITURA].sort());
  });

  it("a reticência é o caractere único, nunca três pontos", () => {
    // Uma letra seguida de "..." e do fim do texto: o espalhamento ({...x}, [...x]) não entra.
    expect(ocorrencias(/\p{L}\.\.\.(?=["'`<\s])/u, { comentarios: false })).toEqual([]);
  });

  it("o botão que grava não troca o próprio texto: o gerúndio é a camada do BotaoDeAcao", () => {
    // "{ocupado ? 'Salvando…' : 'Salvar'}" no filho de um Button; o `andamento=` do BotaoDeAcao é a forma certa.
    expect(ocorrencias(/(?<!andamento=)\{\s*[\w.!]+\s*\?\s*"[^"]*(?:ando|endo|indo)(?:…|\.\.\.)"\s*:/)).toEqual([]);
  });
});
