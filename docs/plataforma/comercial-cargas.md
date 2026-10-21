# Cargas do Comercial

Scripts Node em `functions/comercial/src/cargas/`, com as mesmas funções de
domínio das callables (catálogo, tabela, dinheiro e evento). Desenho em
`fase-6-comercial.md` ("Importação inicial").

Regras de toda carga:

- **Dry-run por padrão.** Sem `--executar`, nada é gravado. Sem `--projeto`, o
  dry-run só confere o arquivo; com `--projeto`, também lê o banco e mostra o
  que gravaria.
- **`--executar` exige `--projeto`**, sem padrão, e só grava onde o Comercial
  está liberado (`domain/liberacao.ts`: hoje só o `dute-homolog`) ou num
  projeto `demo-` com o emulador ligado. A produção entra na parte 17, com o OK
  do Leonardo.
- **Relatório em `tmp/comercial/`** (fora do git), com os preços, para
  conferir. Nunca copie o relatório, a planilha ou o CSV para o repositório.
- **Idempotente pelo sha256 do arquivo.** O mesmo arquivo com os mesmos
  parâmetros não grava de novo; com outros parâmetros, é recusado.
- **Eventos sem preço**, como todo evento do Comercial.
- Nunca abrir `Orçamento cálculo.xlsx` (tem salários), `99_ARQUIVO` nem
  `attached_assets`.

As credenciais são as da máquina (Application Default Credentials). Antes da
primeira carga num projeto: `gcloud auth application-default login`, com uma
conta que grave no Firestore dele.

## Tabela de preço (`tabela.ts`)

```powershell
cd C:\DEV\Dute
npm --prefix functions/comercial ci
npm --prefix functions/comercial run build
node functions/comercial/lib/cargas/tabela.js --arquivo <caminho do CSV> `
  --nome "<nome da tabela>" --variante Comercial --vigente-de AAAA-MM-DD `
  [--vigente-ate AAAA-MM-DD] [--cliente <customer_code> [--contrato <id>]] `
  [--rodape "<texto>"] [--condicoes "<texto>"] [--validade-dias <n>] `
  [--projeto dute-homolog [--executar]] [--por <seu e-mail>]
```

| Parâmetro | O que é |
|---|---|
| `--arquivo` | O CSV (formato abaixo). No relatório e na tabela fica só o nome do arquivo |
| `--nome` | Nome da tabela, como sai no orçamento |
| `--cliente` | `customer_code` de um cadastro em `customers`. Sem ele, é a Tabela Padrão Dutelog |
| `--contrato` | Id do contrato em `contracts`. Exige `--cliente`. Contrato de outro cliente é recusado; contrato que ainda não existe em `contracts` só avisa |
| `--variante` | Texto livre de letras, espaço e hífen: Comercial, Noturna, Fim de semana. Sem algarismo, porque vai no evento |
| `--vigente-de`, `--vigente-ate` | Vigência da tabela, que não precisa ser a do contrato. Sem `--vigente-ate`, fica em aberto |
| `--rodape`, `--condicoes`, `--validade-dias` | Texto do documento. Sem `--validade-dias`, o orçamento sai sem validade, como no Itaú |
| `--projeto`, `--executar` | Ver as regras acima |
| `--por` | E-mail de quem roda, gravado em `importado_por` e no evento |

Saída: `0` quando deu certo, `1` quando há erro no arquivo ou no banco (nada
gravado, relatório com os erros), `2` quando falta ou sobra argumento.

### O que grava

Numa transação só, com o recibo em `comercial_operations`:

- `lpu_items/{id}`: os itens que ainda não existem. O item não tem preço nem
  código do cliente. O id é `lpu_` + digest de categoria, item, serviço e
  unidade, comparados sem acento, sem maiúscula e sem espaço sobrando ("M²" e
  "M2" são a mesma unidade): a Padrão Dutelog e as tabelas dos clientes caem
  nos mesmos itens, e recarregar não duplica. Armazenagem entra com
  `orcavel: false`, porque a cobrança é do WMS.
- `price_tables/{id}`: a tabela, imutável, com `precos { lpu_item_id: { codigo,
  descricao_cliente, preco } }` num documento só, o preço em texto decimal
  exato, `fonte { arquivo, sha256, linhas }`, `importado_por` e
  `importado_em`.
- O encerramento da tabela anterior (`status: "encerrada"`, `vigente_ate`,
  `encerrada_por`), que é a única mudança que uma tabela recebe.
- Os eventos `price_table.imported` e, quando encerra a anterior,
  `price_table.closed`, sem preço.

Leitura: `canReadPrices()` no `firestore.rules` (owner, admin e comercial).
Ninguém grava pelo navegador.

### Vigência

- Duas tabelas do mesmo cliente, contrato e variante nunca valem no mesmo dia.
- A tabela nova que começa depois da ativa a encerra na véspera do seu início,
  na mesma escrita. Ex.: a nova começa em 30/06; a anterior passa a terminar em
  29/06.
- A tabela antiga carregada depois (a RFQ de 2021 do Itaú, por exemplo) entra
  encerrada, desde que termine antes da ativa começar. Use `--vigente-ate` com
  a véspera do início da tabela seguinte.
- Qualquer outra sobreposição para a carga, inclusive com tabela já
  encerrada. A correção de uma tabela no mesmo período (versão substituída)
  entra com os contratos (parte 8); até lá, a carga recusa.
- O orçamento usa a tabela cuja vigência contém a data-base (a data do
  orçamento), mesmo que ela já esteja encerrada (`tabelaVigente` em
  `domain/tabelas.ts`). O cliente sem tabela naquela variante usa a Padrão
  Dutelog da mesma variante; o cliente que tem tabela, mas nenhuma vigente na
  data-base, não cai na Padrão.

### O CSV

- UTF-8, separador `;`, uma linha por preço, com este cabeçalho (acento e
  maiúscula no cabeçalho não importam):

  ```
  codigo;categoria;item;servico;descricao;unidade;preco
  ```

- `codigo`: o código do cliente (DTL-0007-D), impresso no orçamento.
- `categoria`: a categoria da tabela.
- `item`: o objeto (mesa, cadeira, divisória).
- `servico`: o que se faz com ele (Transporte, Montagem, Desmontagem,
  Prestação de Serviço, Fornecimento).
- `descricao`: a descrição como está na tabela do cliente.
- `unidade`: UN, M², ML, VG, KM, DIA, M³/MÊS...
- `preco`: número com **ponto** decimal, até 4 casas, sem `R$` e sem separador
  de milhar: `45.50`, `3.89`, `12.345`. As casas ficam como vieram (o
  orçamento imprime o unitário com elas).

O que para a carga, com a linha no relatório:

- preço com vírgula, `R$`, milhar, expoente, mais de 4 casas (inclusive o
  número de ponto flutuante do Excel, como `3.8900000000000001`) ou negativo;
- campo vazio, linha com mais ou menos de 7 colunas, aspas sem fechar;
- arquivo que não é UTF-8, cabeçalho diferente ou separador vírgula;
- a mesma chave (categoria, item, serviço e unidade) duas vezes com preço ou
  código diferente. Repetida igual, entra uma vez, com aviso.

Código repetido em itens diferentes não é erro: vira itens distintos (o
DTL-0126 aparece três vezes na LPU do Itaú). O relatório lista cada código
repetido e como foi separado. Preço zero só avisa.

### Como gerar o CSV a partir das planilhas

1. Trabalhe numa cópia da planilha, fora do repositório. Na LPU do Itaú, é a
   cópia operacional da v2.0, não o original.
2. **O PDF assinado prevalece sobre o Excel** (decisão de 08/10/2026). Confira
   código, descrição e preço linha a linha contra o texto do PDF antes de
   gerar o CSV; o que divergir, corrija na cópia pelo PDF. Na LPU do Itaú já se
   sabe que os preços de DTL-0007-D e DTL-0007-T estão trocados no Excel, e que
   o rodapé do PDF fala em 238 linhas, mas são 215 por aba.
3. Uma aba por variante vira um CSV e uma carga. A LPU do Itaú tem duas abas,
   Comercial e Noturna, com 215 linhas cada: dois arquivos, dois comandos,
   `--variante Comercial` e `--variante Noturna`, com a mesma vigência.
4. Numa aba nova, monte as 7 colunas na ordem do cabeçalho, uma linha por
   preço, sem linha de total, subtítulo ou linha em branco no meio.
5. Na coluna `preco`, use o texto com ponto:
   `=SUBSTITUIR(TEXTO(<célula do preço>;"0,00##");",";".")`. Depois copie a
   coluna e cole como valores. Assim o preço sai com 2 a 4 casas e sem o
   ponto flutuante do Excel.
6. Salve a aba como **CSV UTF-8 (delimitado por vírgulas)**. No Excel em
   português, o separador sai `;`. Salve fora do repositório.
7. Rode o dry-run sem `--projeto` e confira o relatório em `tmp/comercial/`:
   itens por categoria, a soma dos preços (compare com a soma da coluna na
   planilha), os códigos repetidos e os itens não orçáveis. O CSV de
   conferência, ao lado do relatório, tem uma linha por item.
8. Rode o dry-run com `--projeto dute-homolog`: ele confere o cliente, o
   contrato e a vigência (o que entra ativo e o que encerra).
9. Rode com `--projeto dute-homolog --executar --por <seu e-mail>`.

Ordem das cargas: primeiro a Padrão Dutelog (`LPU_Dutelog_Padrão.xlsx`, sem
`--cliente`, Comercial e Noturna), que cria o catálogo; depois as tabelas dos
clientes (Itaú v2.0 Comercial e Noturna; a RFQ de 2021, encerrada; Safra
quando o arquivo chegar). O cliente precisa estar em `customers` antes da
tabela dele.
