# API Dute v1 — integração externa

O fluxo normal de **Chaves de API por usuário** está em [api-chaves-pessoais.md](api-chaves-pessoais.md). Abaixo permanece a referência de integrações administradas por owner/admin e das rotas de negócio. A nova família `/api-keys` não amplia nem converte as credenciais legadas.

O contrato mantém a API de Operação e acrescenta 77 rotas de Armazenagem,
Comercial, Financeiro, RH e Agent Dute. A cobertura exata e os limites desta
versão estão em [api-cobertura.md](api-cobertura.md). Uma chave pode acessar
vários módulos, com escopos específicos e clientes autorizados. O app continua
usando suas callables atuais; o consumidor externo usa HTTPS/JSON.

A ampliação está em revisão: este documento descreve o código desta versão,
não comprova que os novos endpoints já foram publicados em algum ambiente.

## Tabelas de preço do contrato (LPU)

`POST <base>/comercial/contratos/<contrato_id>/tabelas` cadastra uma tabela
vinculada ao cliente do contrato. Use o **ID** retornado pela consulta de
contratos; o número comercial (por exemplo, 4900030161) pode ser diferente
do ID. Requer `comercial:contratos:gravar`, Bearer e `Idempotency-Key`,
conforme a política de escrita da chave.

```json
{
  "nome": "LPU Itaú — horário comercial",
  "codigo": "LPU-4900030161",
  "variante": "Comercial",
  "itens": [
    {
      "codigo": "DTL-0001-D",
      "descricao": "Desmontagem de mobiliário",
      "unidade": "UN",
      "preco": "125.5000"
    }
  ]
}
```

`codigo` da tabela e datas `vigente_de`/`vigente_ate` são opcionais.
Sem início, usa-se o início do contrato; sem fim, a vigência fica aberta.
`variante` assume `Comercial`. Os itens exigem código, descrição, unidade
e preço como texto decimal com ponto, sem separador de milhar, não negativo
e com até quatro casas. O limite lógico é 480 itens por tabela; o corpo REST
também precisa caber no limite de 64 KiB da API. Os campos opcionais
`categoria`, `item` e `servico` permitem relacionar o catálogo já existente.
Sem esses campos, descrição e código compõem o nome do item do catálogo,
mantendo distintos os códigos terminados em D/T/M mesmo quando a descrição
é igual.

`GET <base>/comercial/contratos/<contrato_id>/tabelas` lista as tabelas do
contrato, com `comercial:ler`, paginação `limit`/`cursor` e projeção de preços
indexada por `lpu_item_id`. A resposta de criação inclui `tabela_id`.
Os GETs gerais de tabelas continuam disponíveis.

Para orçar, envie nas linhas de `POST <base>/comercial/orcamentos` ou
`PATCH <base>/comercial/orcamentos/<numero>`:

```json
{ "origem": "tabela", "lpu_item_id": "ID_DO_ITEM_RETORNADO_NA_TABELA", "quantidade": "2" }
```

O contrato e a variante do orçamento selecionam a tabela vigente na sua
data-base; código LPU, descrição, unidade e preço são resolvidos pelo backend.
A linha de tabela com preço herdado dispensa `motivo`.
No PATCH de um rascunho com contrato e ainda sem tabela, envie
`atualizar_tabela: true` junto de `expected_edicao` para buscar uma LPU
cadastrada depois da criação do rascunho.

Preços publicados são imutáveis. Uma alteração de preços exige cadastrar
nova vigência, que encerra a anterior pelas regras existentes. PATCH de
preços e DELETE não são expostos para preservar as referências históricas
dos orçamentos e das cobranças. O app oferece edição manual no formulário
**Contratos → Tabelas de preço → Adicionar tabela**; esta versão não importa
arquivos XLSX diretamente.

## Endereços após publicação

| Ambiente | Base |
|---|---|
| Produção | `https://southamerica-east1-dute-prod.cloudfunctions.net/duteApi/api/v1` |
| Homologação | `https://southamerica-east1-dute-homolog.cloudfunctions.net/duteApi/api/v1` |

O contrato importável fica em `GET <base>/openapi.json`, formato OpenAPI 3.0.3.
Os endereços só ficam disponíveis depois do deploy deste código. Não é preciso
mudar DNS nem publicar o frontend para acessar a API, mas a publicação segue o
lote inteiro de Functions pelo workflow oficial.

## Credenciais

### Pelo app (owner/admin)

Em **Configuração → Integrações**, escolha **Nova integração**. Informe o nome,
selecione os módulos, as permissões e a validade da chave. Para recursos de
cliente, autorize códigos explícitos. É possível autorizar um código futuro
para cadastrar esse cliente pelo Comercial; isso não libera os demais clientes.
Recursos globais de RH/equipe são identificados no formulário e não exigem
cliente fictício. Clique
em **Gerar chave**, copie a credencial e guarde no cofre do integrador antes de
concluir: ela aparece uma única vez e não pode ser recuperada depois.

A lista mostra os metadados das integrações, inclusive expiradas e revogadas.
**Revogar** pede confirmação e corta o acesso imediatamente. Uma chave perdida
deve ser revogada e substituída. As novas chaves do formulário usam
`write_policy: scoped`: a própria chave autoriza as gravações dos escopos
selecionados. Chaves antigas e chamadas de criação que omitem a política
continuam em `approval_required`; não houve ampliação silenciosa de acesso.

### Pela API

Um owner/admin humano usa seu **ID token Firebase** (não o access token do
Google Cloud, nem a chave web Firebase) em `Authorization: Bearer <ID_TOKEN>`.
Esse token pode ser obtido pelo SDK Firebase Authentication da sessão humana
com `getIdToken(user, true)`. Não o entregue ao Grok Bot. Contas removidas,
tokens revogados e pessoas sem papel owner/admin não gerenciam integrações.

`POST <base>/integrations`, `Content-Type: application/json`:

```json
{
  "name": "Grok Bot — Operação",
  "scopes": ["operacao:ler"],
  "customers": ["CODIGO_DO_CLIENTE"],
  "expires_in_days": 30,
  "write_policy": "scoped"
}
```

Resposta 201: `data.id`, `data.token` e `data.expires_at`. O token aparece uma
vez. Só seu hash fica no banco. Guarde no cofre de credenciais do integrador,
nunca no repositório, URL ou conversa. A validade máxima é 90 dias. Não há
credenciais emitidas automaticamente no deploy.

O agente usa `Authorization: Bearer <data.token>`. Nunca precisa de acesso
direto ao Firestore, conta de serviço ou papel administrativo. O responsável
humano atual é verificado em cada chamada; remover seu acesso ou papel
administrativo interrompe a integração. O ator da escrita é `api:<id>` com o
papel operacional mínimo; o agente nunca herda o papel owner/admin.

Para revogar: `DELETE <base>/integrations/<id>`, com token humano owner/admin.
Para rotacionar: criar outra credencial, configurar o consumidor e revogar a
antiga. Homologação e produção não compartilham credenciais.

O corpo de criação aceita de 1 a 25 escopos conhecidos, até 50 códigos de
cliente e política `scoped` ou `approval_required`. Clientes podem ser `[]`
somente quando todos os escopos escolhidos são globais. Omitir `write_policy`
preserva o padrão `approval_required`. Nenhuma rota permite trocar os
escopos/política de uma credencial existente; emita outra e revogue a antiga.

Para listar: `GET <base>/integrations?limit=50&cursor=<id>`, com o mesmo login
humano owner/admin. Retorna `data` com `id`, `name`, `customers`, `scopes`,
`delegated_by`, `expires_at`, `revoked` e `write_policy`, e `next_cursor` (continue até `null`).
O limite é de 1 a 100. Nunca retorna token, hash ou contadores internos.
O CORS da API permite o domínio do app de produção e, na homologação, os dois
endereços do Cloud Run desse ambiente; isso não substitui a autenticação.

| Escopo | Permite |
|---|---|
| `operacao:ler` | Demandas, OS e agenda dos códigos de cliente autorizados |
| `operacao:recursos:ler` | Colaboradores e veículos, recursos compartilhados entre clientes |
| `operacao:demanda:criar` | Criar demanda direta, conforme a política da chave |
| `operacao:os:gravar` | Abrir, planejar e agendar OS, conforme a política da chave |

## Consultar

Enviar `GET <base>/operacao/os?customer_code=CODIGO_DO_CLIENTE&limit=50`.
Também existem `demandas`, `agenda`, `colaboradores` e `veiculos`. O detalhe
usa `os/<numero>` ou `demandas/<numero>`. Cada detalhe confere o cliente real do
documento. Colaboradores e veículos exigem o escopo próprio; as projeções não
incluem CPF, CNH, telefone ou documentos do RH. OS e demandas não retornam
preços, contatos nem URLs de arquivos. O detalhe da demanda inclui `etapa` e os `itens` do escopo vigente, com `id`, `planejado` e `saldo`, para preparar o planejamento sem consultar o banco.

Listagens: `data` e `next_cursor`. Continuar com `cursor=<next_cursor>` até
`null`. `limit` é de 1 a 100. OS e agenda aceitam `status`, `from` e `to`
(`AAAA-MM-DD`, inclusive), sobre `janela.data`. A filtragem ocorre numa página
limitada: uma página pode estar vazia e ainda ter `next_cursor`; ela não indica
fim da listagem. Ordenação por ID do documento, não por data. A agenda ignora
OS sem janela. Não há varredura ilimitada nem consulta que exija índice novo.

## Escrever com autorização pela chave

Para `write_policy: scoped`, envie a chave da integração e uma
`Idempotency-Key` única para cada ação. Não envie `X-Approval-Id`.

```text
Authorization: Bearer <TOKEN_DA_INTEGRACAO>
Content-Type: application/json
Idempotency-Key: parceiro-acao-0001
```

Use POST para criar e PATCH para alterar nas rotas publicadas. Os schemas do
OpenAPI definem os campos reais: `expected_edicao`, `expected_status` ou
`expected_version`, conforme o recurso. Recebimentos e registros do Agent Dute
expõem versão para conferir alterações concorrentes; uma edição vencida dá
409. Nunca altere saldos, status ou customer_code genericamente.

Valores financeiros exigem escopos do Financeiro/Comercial; dados pessoais e
arquivos do RH têm permissões próprias. A identidade auditável é `api:<id>`;
a chave não herda owner/admin. As ferramentas do Agent Dute interno não ganham
as permissões da integração externa.

## Escrever com aprovação por ação (legado/opcional)

Para `write_policy: approval_required`, obtenha uma aprovação humana do método,
caminho, corpo e chave exatos. POST e PATCH dos novos módulos também aceitam
esse fluxo, inclusive recursos globais sem customer_code fictício.

1. O humano owner/admin envia `POST <base>/integrations/<id>/approvals`:

   ```json
   {
     "method": "POST",
     "path": "/api/v1/operacao/os",
     "idempotency_key": "planejamento-10045-1",
     "body": { "demanda": "10045" }
   }
   ```

2. A resposta dá `data.id` e `data.expires_at` (15 minutos).
3. O agente envia `POST <base>/operacao/os` com o mesmo corpo e os headers:

   ```text
   Authorization: Bearer <TOKEN_DA_INTEGRACAO>
   Content-Type: application/json
   Idempotency-Key: planejamento-10045-1
   X-Approval-Id: <ID_DA_APROVACAO>
   ```

`POST /operacao/demandas` abre demanda direta;
`POST /operacao/os` abre uma OS com o saldo;
`POST /operacao/os/planejamento` distribui os itens em até dez OS;
`POST /operacao/os/<numero>/agendamento` agenda com `expected_edicao`.
Consulte os schemas OpenAPI para os campos completos. Não enviar `action`,
`numero` ou `idempotency_key` no corpo: a API os determina pela rota/headers.

Cada ação conserva as validações de estado, saldo, edição, equipe, locais e
frota do app. Idempotência é isolada por integração. Repetir a mesma chamada
com a mesma chave devolve o recibo, podendo incluir `replayed: true`; mudar o
conteúdo com chave já usada no mesmo tipo de ação e escopo de negócio dá conflito. A mesma chave em outra demanda/OS é outro escopo e pode produzir outro efeito. Uma aprovação não serve para outro
agente ou outro corpo, caminho ou chave. Se expirar antes da repetição, uma
pessoa precisa aprovar novamente o mesmo pedido. Nenhuma reaprovação anula
os recibos que impedem duplicação.

## Erros e operação

Erros: `{ "error": { "code": "…", "message": "…" }, "request_id": "…" }`.
400 entrada inválida; 401 credencial inválida; 403 sem acesso/aprovação;
404 recurso inexistente; 409 conflito; 412 pré-condição; 429 limite; 5xx falha
temporária/interna. O transporte também pode recusar corpo >64 KiB com 413 e
tipo diferente de application/json com 415. Limite: 60 chamadas/minuto por
integração, compartilhado entre instâncias. Em 429 respeitar Retry-After; em
falha de rede ou 5xx, repetir escrita com a **mesma** chave. Não trocar a chave
porque a resposta se perdeu: a operação pode ter sido concluída.

Nos novos módulos, o recibo da API impede executores concorrentes com a mesma
chave. Repetição concluída retorna 200 com `replayed: true`; conteúdo diferente
retorna 409. Se houver falha após um efeito possivelmente confirmado, o recibo
fica pendente/incerto e a repetição falha fechada com 409: confira os dados e
procure suporte com o request_id. Não crie outra chave para executar às cegas.
Os recibos não expiram automaticamente nesta versão e são preservados pela
zeragem para que um retry antigo não produza outra gravação.

Auditoria em `api_audit`: request ID, integração, status, instante e, nas
escritas, responsável pela autorização e política; nas chaves legadas,
aprovação e aprovador. Clientes e alvos vêm das ações validadas no domínio. O registro de tentativa
precede a alteração. Os eventos e recibos do domínio mantêm suas transações;
o recibo adicional da API reserva a execução antes do domínio e salva o resultado
depois, conservando o estado incerto se houver interrupção. Sem tokens ou corpo completo nos logs. As coleções
`api_integrations`, `api_approvals`, `api_audit` e `api_receipts` são fechadas pelas regras do
Firestore e preservadas pela ferramenta de zeragem.

## Testar e publicar

Na raiz do repositório:

```sh
npm --prefix functions/operacao ci
npm --prefix functions/operacao run test:critical
```

Os scripts e o CI incluem os testes dos seis pacotes. Após merge na main, o
fluxo existente publica na homologação. Conferir com dados de teste leituras,
gravações scoped e o fluxo legado de aprovação. A ampliação proposta nesta
versão deve passar por revisão e homologação antes da autorização específica
para publicar em produção pelo fluxo `publicar_producao`. A publicação confere o contrato exato e a recusa de consulta anônima
com `node tools/check_api_deployed.mjs <projeto>`. Isso prova disponibilidade do
gateway e proteção anônima, não substitui validação autenticada com usuário.
Não criar demandas ou OS reais como smoke de produção.

Para interromper uma integração: revogar sua chave. Para voltar o código:
publicar o commit anterior pelo fluxo oficial, observando que remover uma
Function pode exigir confirmação manual do Firebase. Revogar credenciais
primeiro; rollback do frontend sozinho não desliga esta API.


## Implantação dos novos módulos

O endereço externo continua sendo `duteApi`. O gateway encaminha somente para
nomes fixos de adaptadores do mesmo projeto: `duteArmazenagemApi`,
`duteComercialApi`, `duteFinanceiroApi`, `duteRhApi` e `duteAgenteApi`. Cada
adaptador verifica novamente chave, escopo, validade, responsável e política;
não existe entrada que dispense autenticação. Caminhos de travessia são
recusados antes de encaminhar a credencial.

As codebases têm build independente: `tools/sync_api_shared.mjs` copia o kernel
portátil e os manifests antes do TypeScript, e o deploy inclui o JS compilado.
`gcp-build` vazio evita uma recompilação remota que dependeria do monorepo.
Não publicar somente o frontend/gateway sem os adaptadores correspondentes.
Os módulos preservam suas liberações de ambiente; desligar Operação não
precisa desligar o RH ou Financeiro. A versão ainda não publica NFS-e pela Omie,
não executa operação bancária e não roda rotinas do Agent Dute.

Este trabalho não executou alterações reais de IAM, emissão de credenciais,
merge ou deploy. A entrega é um PR em draft, para revisão antes de publicação.
