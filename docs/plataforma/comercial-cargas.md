# Cargas do Comercial

Scripts Node em `functions/comercial/src/cargas/`, com as mesmas funções de
domínio e os mesmos schemas das callables (cadastro, catálogo, tabela,
contrato, dinheiro e evento). Desenho em `fase-6-comercial.md` ("Importação
inicial").

Regras de toda carga:

- **Dry-run por padrão.** Sem `--executar`, nada é gravado. Sem `--projeto`, o
  dry-run só confere o arquivo; com `--projeto`, também lê o banco e mostra o
  que gravaria.
- **`--executar` exige `--projeto`**, sem padrão, e é recusado antes de ler
  o arquivo. A carga só grava onde o Comercial está liberado
  (`domain/liberacao.ts`: hoje só o `dute-homolog`) ou num projeto `demo-` com
  o emulador ligado. A produção entra na parte 17, com o OK do Leonardo.
- **O arquivo fica fora do repositório.** O CSV tem preço e o JSON tem dado de
  contrato: nunca commitar o arquivo nem colar o conteúdo dele em serviço
  externo (CLAUDE.md, "Dados sensíveis"). As cargas de contratos e de
  clientes da Omie recusam arquivo dentro do repositório, exceto em `tmp/` e
  `.secrets/`, que o git ignora.
- **Relatório em `tmp/comercial/`**, na raiz do repositório (fora do git), um
  JSON por execução com o que foi (ou seria) feito em cada item; o da tabela
  leva os preços, para conferir. Nunca copie o relatório, a planilha ou o CSV
  para o repositório.
- **Mesmas operações das callables e idempotente.** A carga grava com recibo
  em `comercial_operations` e evento. A de tabela é idempotente pelo sha256 do
  arquivo: o mesmo arquivo com os mesmos parâmetros não grava de novo; com
  outros parâmetros, é recusado. A de contratos compara com o banco: rodar de
  novo o mesmo arquivo não muda nada.
- **Eventos sem preço**, como todo evento do Comercial.
- Nunca abrir `Orçamento cálculo.xlsx` (tem salários), `99_ARQUIVO` nem
  `attached_assets`.

As credenciais são as da máquina (Application Default Credentials). Antes da
primeira carga num projeto: `gcloud auth application-default login`, com uma
conta que grave no Firestore dele.

## Ordem das cargas

0. **Clientes da Omie** (`clientes-omie.js`, parte 13): os cadastros que as
   outras cargas pedem em `customers`, com o estágio pela compra.
1. **Contratos** (`contratos.js`). O cliente precisa estar em `customers`, já
   como cliente. O aditivo de preço fica de fora nesta primeira passada, com o
   problema "tabela não encontrada".
2. **Tabelas** (`tabela.js`): primeiro a Padrão Dutelog
   (`LPU_Dutelog_Padrão.xlsx`, sem `--cliente`, Comercial e Noturna), que cria
   o catálogo; depois as tabelas dos clientes, com `--contrato` apontando para
   o contrato carregado (Itaú v2.0 Comercial e Noturna; a RFQ de 2021,
   encerrada; Safra quando o arquivo chegar). O cliente precisa estar em
   `customers` antes da tabela dele.
3. **Contratos de novo**, com o mesmo arquivo: só registra os aditivos que
   faltavam.

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
| `--contrato` | Id do contrato em `contracts`. Exige `--cliente`. Contrato de outro cliente é recusado. Contrato que ainda não existe em `contracts` só avisa no dry-run e é recusado no `--executar`, porque a tabela é imutável e ficaria apontando para nada |
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
  `orcavel: false`, porque a cobrança é do WMS: vale a palavra armazenagem ou
  armazenamento na categoria, no item ou no serviço (numa LPU de cliente ela
  pode vir só no item, com a categoria "Serviços"). A descrição não conta.
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
  `domain/tabelas.ts`), do contrato do orçamento (ou sem contrato, quando o
  orçamento não tem). Só o cliente sem nenhuma tabela naquela variante, em
  contrato nenhum, usa a Padrão Dutelog da mesma variante. O cliente que tem
  tabela naquela variante, mas nenhuma do contrato do orçamento ou vigente na
  data-base, fica sem tabela (a linha é livre) e nunca cai na Padrão.

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

## Clientes da Omie (`clientes-omie.ts`, parte 13)

Carga do cadastro comercial a partir dos JSON já baixados da Omie, sem tela e
sem chamar a API da Omie.

```powershell
cd C:\DEV\Dute
npm --prefix functions/comercial run build
# 1. Confere os arquivos e gera o CSV de revisão (supõe o cadastro vazio)
node functions/comercial/lib/cargas/clientes-omie.js `
  --clientes tmp\omie\clientes-completo.json `
  --crm tmp\omie\comercial-2026-10-20\crm-contas.json `
  --titulos tmp\omie\comercial-2026-10-20\contas-receber-todas.json
# 2. Compara com o banco, sem gravar; gera o CSV de revisão
node functions/comercial/lib/cargas/clientes-omie.js <os três arquivos> --projeto dute-homolog
# 3. Depois da revisão, com os códigos revisados, ainda sem gravar
node functions/comercial/lib/cargas/clientes-omie.js <os três arquivos> --projeto dute-homolog `
  --codigos tmp\comercial\clientes-omie-revisado.csv
# 4. Grava
node functions/comercial/lib/cargas/clientes-omie.js <os três arquivos> --projeto dute-homolog `
  --codigos tmp\comercial\clientes-omie-revisado.csv --executar
```

| Parâmetro | O que é |
|---|---|
| `--clientes` | `clientes-completo.json`: os clientes e fornecedores da Omie |
| `--crm` | `crm-contas.json`: as contas (empresas) do CRM. Os contatos do CRM (`crm-contatos.json`) não entram |
| `--titulos` | `contas-receber-todas.json`: os títulos do contas a receber, para saber quem comprou |
| `--codigos` | Opcional. O CSV de revisão com a coluna `codigo` preenchida (abaixo) |
| `--projeto`, `--executar` | Ver as regras acima |

Antes do primeiro `--executar` num projeto, as listas de clientes do WMS
(Configurações › Clientes, convite e Posições) precisam ler o cadastro até o
fim (`docs/multicliente-modelos-de-operacao.md`, "Pendências conhecidas"): a
carga traz dezenas de prospects.

### O que entra

- **Pessoa jurídica com a tag Cliente** em `clientes-completo.json` e **as
  contas do CRM**. Fornecedor sem a tag Cliente fica fora.
- **Fora, pela LGPD:** pessoa física (marcada na Omie, ou com um CPF no lugar
  do CNPJ, também no CRM), conta de teste (uma palavra do nome que começa por
  "TESTE", como "Empresa Teste" ou "testesteste") e os contatos. Do que entra,
  a carga lê só o id, o nome, a razão social, o CNPJ, a cidade, a UF, as tags
  e as marcas de pessoa física e de inativo; dos títulos, só o cliente, a
  situação e a data de emissão. E-mail, telefone,
  contato, dados bancários, observações e valores são descartados na leitura
  e nunca chegam ao cadastro, ao relatório nem ao CSV. A pessoa física e a
  conta de teste aparecem no relatório só como contagem.
- **Uma por raiz de CNPJ.** As filiais viram um cadastro só; a raiz (os 8
  primeiros caracteres) é a chave. Nome, razão social, CNPJ, cidade e UF são
  os da matriz (ordem 0001) ou, sem ela, do menor CNPJ do grupo. A conta do
  CRM com CNPJ entra no grupo da mesma raiz. A conta do CRM sem CNPJ entra
  sozinha, sem CNPJ, com o aviso "confira se é empresa". Empresa com a tag
  Cliente (ou conta do CRM) com um documento que não é CNPJ válido fica fora,
  listada no relatório só pelo id da Omie.
- **Cliente ou prospect pela compra.** Quem tem título não cancelado com
  emissão a partir de 01/01/2024, em qualquer CNPJ da raiz (inclusive o de um
  fornecedor), entra como cliente; o resto, como prospect. A conta do CRM sem
  CNPJ é sempre prospect.
- `comercial.omie_ids` guarda `cliente:<codigo_cliente_omie>` de cada CNPJ do
  grupo e `crm:<nCod>` de cada conta do CRM.

### O que a carga faz com cada empresa

O cadastro existente é achado, nesta ordem, pelos ids da Omie que ele já tem
em `comercial.omie_ids`, pela raiz do CNPJ ou pelo código canônico (o código
sugerido ou o revisado, comparado sem acento, maiúscula nem separador, como na
unicidade do cadastro: "BTG-PACTUAL" acha a BTG, "BTG Pactual").

| Situação | Ação |
|---|---|
| Não existe | `criar`, com `origem: "omie"`, o estágio da compra e o código sugerido (ou o revisado) |
| Existe e falta algum id da Omie | `vincular`: só `comercial.omie_ids` muda. Nome, razão social, CNPJ, código e estágio ficam como estão |
| Existe com todos os ids | `sem_mudanca` |
| Outra linha da carga vai para o mesmo cadastro | `juntar` (a linha principal leva a ação) |
| `-` na coluna `codigo` do CSV revisado | `fora` |
| Problema | `a_conferir`: a empresa fica de fora, e a carga termina com código 1 |

O que deixa uma empresa `a_conferir`:

- os ids ou a raiz apontam para mais de um cadastro;
- o código já é de um cadastro com outra raiz de CNPJ;
- o cadastro achado está arquivado;
- duas raízes diferentes da carga com o mesmo código;
- nome sem código sugerido, ou código revisado fora do formato (letras sem
  acento, números e hífen, de 2 a 20 caracteres).

O cadastro existente que é prospect e comprou desde 2024 continua prospect,
com o aviso "marque como cliente na tela". Linhas com o mesmo código vão para
um cadastro só quando no máximo uma delas tem CNPJ (a conta do CRM sem CNPJ
com o nome de um cliente da Omie, por exemplo); para separar, dê outro código
a uma delas no CSV.

### O que grava

Pelas peças das callables do cadastro (`domain/cadastro.ts` e
`domain/customer-identity.ts`): a montagem do prospect (`prospectPayload`), o
código (`codigoDoNovoCadastro`), a unicidade de código e raiz do CNPJ
(`customerIdentityConflict`), o recibo em `comercial_operations` e o evento,
na mesma transação, que confere de novo o estado que o plano leu.

- **Criar:** `customers/{código}` com os campos do prospect do Comercial,
  `origem: "omie"`, `stage` `cliente` ou `prospect`, `comercial`
  (`responsavel_uid: null`, cidade, UF e `omie_ids`) e `created_by:
  carga-clientes-omie`. Nada de sigla, modelo, módulos ou projeções. Evento
  `commercial_customer.created` com o estágio.
- **Vincular:** só `comercial.omie_ids` (e, no cadastro do WMS sem o mapa
  `comercial`, os outros campos dele com `null`), `updated_by` e
  `updated_at`. A transação recusa se os ids gravados mudaram depois da
  leitura ("rode a carga de novo"). Evento `commercial_customer.updated` com
  `campos: ["ids_omie"]`.
- Rodar de novo os mesmos arquivos não muda nada: tudo fica `sem_mudanca`,
  sem recibo nem evento novo.

### Revisão humana: o CSV

Cada execução sem erro de arquivo grava, ao lado do relatório JSON,
`tmp/comercial/clientes-omie-<modo>-<projeto>-<data>.csv` (UTF-8, `;`), uma
linha por empresa que entra:

| Coluna | O que é |
|---|---|
| `chave` | `cnpj-<raiz>`, ou `crm-<nCod>` para a conta do CRM sem CNPJ. Não mude |
| `nome`, `cnpj` | O nome e o CNPJ (da matriz) que vão para o cadastro |
| `filiais`, `omie_ids` | Quantos CNPJs o grupo tem, e os ids da Omie |
| `ultima_compra` | Emissão do título não cancelado mais recente |
| `codigo_sugerido` | O código que a carga usa: o do cadastro existente, o revisado ou o sugerido pelo nome |
| `codigo` | Para preencher na revisão. Vazio fica o sugerido; `-` deixa a empresa de fora |
| `estagio`, `acao` | Cliente ou prospect, e a ação (tabela acima) |
| `avisos` | Problemas e avisos da linha |

1. Rode o dry-run com `--projeto dute-homolog` e abra o CSV no Excel.
2. Confira nome, CNPJ, estágio e ação. Na coluna `codigo`, escreva o código
   que deve ficar (vira o `customer_code` e não muda depois) ou `-` para
   deixar a empresa de fora (por exemplo, uma conta do CRM sem CNPJ que é uma
   pessoa).
3. Salve como **CSV UTF-8 (delimitado por vírgulas)** em `tmp/comercial/` (o
   Excel em português grava com `;`) e passe com `--codigos`. Só as colunas
   `chave` e `codigo` são lidas.
4. Repita o dry-run com `--codigos` até não sobrar `a_conferir`; depois rode
   com `--executar`.

## Contratos e aditivos (`contratos.ts`, parte 8)

```powershell
cd C:\DEV\Dute
npm --prefix functions/comercial run build
# 1. Confere só o arquivo
node functions/comercial/lib/cargas/contratos.js --arquivo C:\caminho\fora\do\repo\contratos.json
# 2. Compara com o banco, sem gravar
node functions/comercial/lib/cargas/contratos.js --arquivo C:\caminho\fora\do\repo\contratos.json --projeto dute-homolog
# 3. Grava
node functions/comercial/lib/cargas/contratos.js --arquivo C:\caminho\fora\do\repo\contratos.json --projeto dute-homolog --executar
```

O que a carga faz com cada contrato:

| No banco | Ação |
|---|---|
| Não existe | `criar` com o id do arquivo |
| Existe e igual | `sem_mudanca` |
| Existe e diferente | `atualizar` só os campos que mudaram, na edição atual |

A vigência gravada é a do arquivo prorrogada pelos aditivos: os do arquivo e
os já registrados no banco, inclusive o que entrou pela tela depois da carga
(rodar de novo não desfaz a prorrogação). Um aditivo de prorrogação (ou de
preço com vigência nova) só muda a vigência quando o fim novo passa do atual;
no contrato por prazo indeterminado, quando começa no início do contrato ou
depois, e aí o contrato passa a ter prazo fixo. Aditivo antigo entra só no
histórico.

Contrato encerrado não é prorrogado por aditivo: a callable `recordAditivo`
registra o aditivo só no histórico (para prorrogar, reabra o contrato antes).
Por isso, na carga, o contrato encerrado já é gravado com a vigência
prorrogada por todos os aditivos (os do arquivo e os registrados), e os
aditivos entram no histórico sem mexer nela.

O que deixa um contrato de fora (os outros seguem, e a carga termina com
código 1):

- cadastro inexistente, prospect ou arquivado (contrato é de cliente);
- contrato do arquivo que já existe para outro cliente.

O que deixa só o aditivo de fora (o contrato e os outros aditivos seguem):

- aditivo já registrado com outro conteúdo (aditivo não se altera);
- aditivo de preço com tabela inexistente ou de outro contrato.

### Campos

- `id`: id interno do documento em `contracts`, por exemplo
  `<customer_code>-2026` (letras, números, hífen e sublinhado). Nunca o número
  do contrato no cliente: o id vai nos eventos, e a carga (como a callable)
  recusa id que contenha um dos `numeros`, inteiro (sem separadores) ou por 5
  ou mais algarismos seguidos dele.
- `contrato`: os campos da callable `saveContract`. Obrigatórios:
  `customer_code` (o código do cadastro), `nome`, `vigente_de`, `vigente_ate`
  (`null` para prazo indeterminado), `renovacao.tipo`, `reajuste.tipo`,
  `regime_padrao`, `autorizacao.tipo`, `pagamento.tipo` e `status`. Preço não
  entra no contrato: as tabelas apontam para ele por `contract_id`.
- `aditivos`: os campos da callable `recordAditivo`. `numero` é a ordem do
  aditivo e vira o id, sem zero à esquerda (`contracts/{id}/aditivos/1`,
  `.../2`); `documento: null` registra o aditivo com a marca "documento não
  localizado".
- Datas em `AAAA-MM-DD`; a data-base do reajuste em `MM-DD`.
- `documentos[].referencia` é texto (por exemplo, o caminho no OneDrive): o
  Storage é fechado ao Comercial no v1.

### Exemplo sintético

Números e nomes inventados, só para mostrar o formato. O teste
`functions/comercial/src/cargas/contratos.test.ts` valida este exemplo.

<!-- exemplo-contratos -->
```json
{
  "contratos": [
    {
      "id": "exemplo-2026",
      "contrato": {
        "customer_code": "EXEMPLO",
        "nome": "Contrato de serviços de mudança",
        "numeros": [
          { "tipo": "contrato", "numero": "0000000000-0" },
          { "tipo": "sistema_cliente", "numero": "SC-0001" }
        ],
        "objeto": "Mudanças, montagem e desmontagem de mobiliário.",
        "vigente_de": "2026-07-01",
        "vigente_ate": "2027-06-30",
        "renovacao": { "tipo": "aditivo", "aviso_dias": 30, "oposicao_ate_dias": null },
        "reajuste": { "tipo": "indice", "indice": "IPCA", "data_base": "07-01" },
        "regimes": [
          { "servico": "Mudança", "regime": "por_demanda" },
          { "servico": "Equipe fixa", "regime": "medicao_mensal" }
        ],
        "regime_padrao": "por_demanda",
        "autorizacao": { "tipo": "pedido_aceite", "prazo_perda_dias": null },
        "pagamento": {
          "tipo": "faixas_do_dia_da_nf",
          "faixas": [
            { "de": 1, "ate": 10, "dia": 30, "mes": "mesmo" },
            { "de": 11, "ate": 20, "dia": 10, "mes": "seguinte" },
            { "de": 21, "ate": 31, "dia": 30, "mes": "seguinte" }
          ],
          "dias": null,
          "texto": null
        },
        "impostos": { "inclusos": true, "texto": "Tributos inclusos no preço." },
        "codigo_servico": "1602",
        "documentos": [
          { "nome": "Contrato assinado", "referencia": "OneDrive/Comercial/Contratos/exemplo/contrato.pdf" }
        ],
        "status": "vigente"
      },
      "aditivos": [
        {
          "numero": 1,
          "assinado_em": null,
          "tipo": "prorrogacao",
          "vigente_de": "2025-07-01",
          "vigente_ate": "2026-06-30",
          "tabela_ids": [],
          "documento": null,
          "observacao": "Documento não localizado."
        },
        {
          "numero": 2,
          "assinado_em": "2026-06-20",
          "tipo": "preco",
          "vigente_de": "2026-07-01",
          "vigente_ate": "2027-06-30",
          "tabela_ids": ["exemplo-2026-comercial", "exemplo-2026-noturna"],
          "documento": { "nome": "Aditivo 2", "referencia": "OneDrive/Comercial/Contratos/exemplo/aditivo-2.pdf" },
          "observacao": ""
        }
      ]
    }
  ]
}
```
