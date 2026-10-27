# API Dute v1 — integração externa

Este incremento entrega a estrutura da API e o módulo Operação. Armazenagem,
Comercial, Financeiro e RH ainda não têm endpoints REST neste contrato. O app
continua usando suas callables atuais. Não é necessário criar outro agente nem
usar MCP para integrar: o consumidor precisa enviar HTTPS/JSON com headers.

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
selecione os clientes, as permissões da Operação e a validade da chave. Clique
em **Gerar chave**, copie a credencial e guarde no cofre do integrador antes de
concluir: ela aparece uma única vez e não pode ser recuperada depois.

A lista mostra os metadados das integrações, inclusive expiradas e revogadas.
**Revogar** pede confirmação e corta o acesso imediatamente. Uma chave perdida
deve ser revogada e substituída. As escritas da integração continuam exigindo
aprovação humana por ação, conforme o contrato abaixo.

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
  "expires_in_days": 30
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

Para listar: `GET <base>/integrations?limit=50&cursor=<id>`, com o mesmo login
humano owner/admin. Retorna `data` com `id`, `name`, `customers`, `scopes`,
`delegated_by`, `expires_at` e `revoked`, e `next_cursor` (continue até `null`).
O limite é de 1 a 100. Nunca retorna token, hash ou contadores internos.
O CORS da API permite o domínio do app de produção e, na homologação, os dois
endereços do Cloud Run desse ambiente; isso não substitui a autenticação.

| Escopo | Permite |
|---|---|
| `operacao:ler` | Demandas, OS e agenda dos códigos de cliente autorizados |
| `operacao:recursos:ler` | Colaboradores e veículos, recursos compartilhados entre clientes |
| `operacao:demanda:criar` | Criar demanda direta, com aprovação humana |
| `operacao:os:gravar` | Abrir, planejar e agendar OS, com aprovação humana |

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

## Escrever

A regra do produto continua: o agente pode preparar, mas o impacto real exige
aprovação humana. A aprovação precisa indicar o método, caminho, corpo e chave
exatos; não é uma autorização genérica de escrita.

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

Auditoria em `api_audit`: request ID, integração, status, instante e, nas
escritas aprovadas, cliente, aprovação e aprovador. O registro de tentativa
precede a alteração; os eventos de negócio e os recibos continuam na mesma
transação da alteração. Sem tokens ou corpo completo nos logs. As coleções
`api_integrations`, `api_approvals` e `api_audit` são fechadas pelas regras do
Firestore e preservadas pela ferramenta de zeragem.

## Testar e publicar

Na raiz do repositório:

```sh
npm --prefix functions/operacao ci
npm --prefix functions/operacao run test:critical
```

O CI já inclui os testes novos nas suites da Operação. Após merge na main, o
fluxo existente publica na homologação. Conferir a criação de uma credencial
de teste, consultas e uma ação humana aprovada com dados de teste. Só depois
disparar CI na main com `publicar_producao` (autorizado pelo usuário nesta
tarefa). A publicação confere o contrato exato e a recusa de consulta anônima
com `node tools/check_api_deployed.mjs <projeto>`. Isso prova disponibilidade do
gateway e proteção anônima, não substitui validação autenticada com usuário.
Não criar demandas ou OS reais como smoke de produção.

Para interromper uma integração: revogar sua chave. Para voltar o código:
publicar o commit anterior pelo fluxo oficial, observando que remover uma
Function pode exigir confirmação manual do Firebase. Revogar credenciais
primeiro; rollback do frontend sozinho não desliga esta API.
