# Zap — painel das conversas de WhatsApp

Painel interno, só para owner e admin, em que a Dutelog acompanha ao vivo as
conversas dos agentes de WhatsApp. A primeira versão só mostra: não responde
pelo painel. O piloto grava a linha do Jamil. As outras linhas já aparecem,
vazias, até o relay delas passar a chamar a ingestão.

Este texto é o contrato do endpoint, o passo a passo de infraestrutura e a
nota de LGPD. **Não mexe no Load Balancer, no certificado nem no DNS.** Isso
só com o OK explícito do Leonardo.

## O que sobe com este código

| Peça | Onde |
|---|---|
| Ingestão `ingestZap` | Cloud Function HTTP, codebase `zap`, `southamerica-east1` |
| Acesso `registrarAcessoZap` | Callable, owner e admin |
| Retenção `runZapRetention` | Todo dia 03:30, America/Sao_Paulo; só na homologação |
| Coleções | `zap_conversations`, `zap_messages`, `zap_access` no Firestore padrão |
| Painel | Cloud Run `dute-zap`, pacote `artifacts/dute-zap` |

A ingestão responde rápido, não chama a Meta e não fica no caminho da entrega
ao agente. O relay entrega primeiro e só então registra aqui, com timeout
curto. Se este POST falhar, a mensagem no WhatsApp já foi para o agente.

O segredo **não está no repositório**. `ZAP_PROJETOS_COM_SEGREDO`
(`functions/zap/src/domain/liberacao.ts`) inclui o `dute-homolog`: a
publicação de lá declara `ZAP_INGEST_SECRET` e a ingestão passa a exigir o
cabeçalho. O `dute-prod` fica de fora até o segredo existir na produção e um
PR o incluir. Incluir um projeto antes de o segredo existir derruba o
`firebase deploy`. Sem o segredo declarado, a ingestão responde `503` com
`sem_segredo`.

## Contrato da ingestão

`POST` no URL da function. Na geração 2 o endereço estável é:

```text
https://southamerica-east1-<projeto>.cloudfunctions.net/ingestZap
```

`<projeto>` é `dute-homolog` ou `dute-prod`. Depois do primeiro deploy, confirme
com:

```powershell
cd C:\DEV\Dute
gcloud functions describe ingestZap --gen2 --region southamerica-east1 --project dute-homolog --format="value(serviceConfig.uri)"
```

Cabeçalho obrigatório, o mesmo valor do segredo `ZAP_INGEST_SECRET`:

```text
X-Dute-Zap-Secret: <segredo>
Content-Type: application/json
```

Corpo até 1 MiB. A identidade da mensagem é o `id` da Meta (`wamid…`).
Mandar de novo o mesmo id não duplica: a resposta vem `200` com `repetidos`.
Status (`sent`, `delivered`, `read`, `played`, `failed`) só anda para a frente;
`failed` não apaga uma leitura. Mídia não é baixada: guardamos o tipo e a
legenda, sem id de mídia nem coordenadas.

### Entrada: o webhook da Meta, como o relay recebe

O corpo é o JSON do webhook, sem embrulho. Mensagens viram direção `in`.
`statuses` atualizam a mensagem que o agente já registrou; se o status chegar
antes, fica um rascunho até o texto.

```bash
curl -sS -X POST "https://southamerica-east1-dute-homolog.cloudfunctions.net/ingestZap" \
  -H "Content-Type: application/json" \
  -H "X-Dute-Zap-Secret: $ZAP_INGEST_SECRET" \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "1447860659935403",
      "changes": [{
        "field": "messages",
        "value": {
          "messaging_product": "whatsapp",
          "metadata": { "phone_number_id": "1415578004977589" },
          "contacts": [{ "profile": { "name": "Maria" }, "wa_id": "5511900000000" }],
          "messages": [{
            "from": "5511900000000",
            "id": "wamid.EXEMPLO_ENTRADA",
            "timestamp": "1732010000",
            "type": "text",
            "text": { "body": "Bom dia" }
          }]
        }
      }]
    }]
  }'
```

Um evento que não é `messages` responde `200` com zero gravações, para o relay
poder encaminhar o corpo inteiro. Mensagem sem id é ignorada (`ignorados`) e o
resto do lote entra.

### Saída: o agente registra depois de enviar

A Meta não ecoa a mensagem enviada. O wrapper do Jamil, depois que a Graph API
devolve o id, manda:

```bash
curl -sS -X POST "https://southamerica-east1-dute-homolog.cloudfunctions.net/ingestZap" \
  -H "Content-Type: application/json" \
  -H "X-Dute-Zap-Secret: $ZAP_INGEST_SECRET" \
  -d '{
    "direction": "out",
    "phone_number_id": "1415578004977589",
    "to": "5511900000000",
    "contact_name": "Maria",
    "message": {
      "id": "wamid.EXEMPLO_SAIDA",
      "timestamp": "1732010001",
      "type": "text",
      "text": "Bom dia, o pedido segue."
    }
  }'
```

Áudio, imagem, vídeo, documento e figurinha usam `type` (`audio`, `image`,
`video`, `document`, `sticker`) e, se houver, o texto da legenda em `text`.
Não mande URL nem id de mídia.

A entrada avulsa, se o relay preferir não repassar o webhook cru, é a mesma
forma com `"direction": "in"` e `from` no lugar de `to`.

### Respostas

| HTTP | `erro` | Quando |
|---|---|---|
| 200 | — | Gravou, repetiu ou não havia mensagem. Corpo: `gravados`, `atualizados`, `repetidos`, `ignorados` |
| 400 | `corpo_invalido` ou `lote_grande` | Não é webhook nem registro; ou mais de 50 itens |
| 401 | `segredo_recusado` | Cabeçalho ausente ou diferente |
| 405 | `metodo` | Não é POST |
| 413 | `corpo_grande` | Passa de 1 MiB |
| 415 | `content_type` | Não é `application/json` |
| 503 | `sem_segredo` | O projeto ainda não declara o segredo. Não grava |
| 503 | `indisponivel` | Falha ao gravar. Pode repetir o mesmo corpo |

Exemplo de sucesso: `{"ok":true,"gravados":1,"atualizados":0,"repetidos":0,"ignorados":0}`.

O log da function leva contagem e id, não o texto.

### Linhas

| `phone_number_id` | Agente | Número |
|---|---|---|
| `1027983403741650` | Clara, Comercial | 11 96607-6831 |
| `1138046412727833` | Rafael, Orçamentista | 11 93623-6252 |
| `1338744619330876` | Sueli, RH | 11 95504-9459 |
| `1372203299320671` | Sueli, RH Colaboradores | 11 95507-4950 |
| `1345453701990219` | João, Operacional | 11 95504-9551 |
| `1415578004977589` | Jamil, Compras, piloto | 11 95507-5266 |

Um id fora da lista ainda é guardado, como linha desconhecida. A conversa é
`{phone_number_id}_{wa_id}`.

## Modelo

Leitura no navegador só para owner e admin (`isPrivileged`). Escrita só pelo
servidor. O papel é o de `users/{uid}`, o mesmo documento que o app lê.

- `zap_conversations`: uma por linha e contato, com a última prévia e o horário.
- `zap_messages`: uma por id da Meta. Direção, tipo, texto, horário, status, agente.
- `zap_access`: quem entrou no painel (`entered`) ou abriu uma conversa (`opened`).
  Guarda uid, papel, ação, o id da conversa e o horário. Não guarda o texto.

A zeragem do WMS não apaga estas coleções (`docs/novo-go-live-zeragem-total.md`).

## Ligar o piloto do Jamil

Nesta ordem. O segredo é criado por quem tem Owner; o valor não entra no git.
Não rode de novo o `secrets:set` da homologação: o segredo já está na versão 1,
e o comando criaria outra versão.

1. Feito no PR #632, na `main`. A homologação publicou a function (ainda sem
   segredo, ingestão em 503) e o Cloud Run `dute-zap`. O job conferiu
   `https://dute-zap-u2iwz5xjyq-rj.a.run.app`. O deploy também imprimiu
   `https://dute-zap-368642218894.southamerica-east1.run.app`.
2. No Firebase Auth do `dute-homolog`, em Authentication → Settings →
   Authorized domains, incluir os dois hosts `run.app` acima. Sem isso o
   login diz que o endereço não está autorizado.
3. O `ZAP_INGEST_SECRET` está no Secret Manager do `dute-homolog`, versão 1.
   A conta `github-actions-functions@dute-homolog` precisa de
   `roles/secretmanager.admin` só nesse segredo
   (`docs/deploy-functions-manual.md`, "Function com segredo"). Quem confirma
   o papel é a publicação das functions deste PR: o `firebase deploy` confere
   a versão, dá `secretAccessor` à conta de runtime e falha se a conta do CI
   não administra o segredo. A produção não declara o segredo, então o job
   dela não prova esse acesso.

```powershell
cd C:\DEV\Dute
$p = "dute-homolog"
firebase functions:secrets:set ZAP_INGEST_SECRET --project $p
gcloud secrets add-iam-policy-binding ZAP_INGEST_SECRET --project $p --member="serviceAccount:github-actions-functions@$p.iam.gserviceaccount.com" --role=roles/secretmanager.admin --condition=None
```

4. Este PR põe `"dute-homolog"` em `ZAP_PROJETOS_COM_SEGREDO`. O teste trava a
   lista: homologação declara `ZAP_INGEST_SECRET`; produção e `dute-btg` não.
5. O relay, depois de rotear pelo `phone_number_id`, faz o POST do webhook em
   paralelo, com timeout de uns 2 segundos, e não deixa este POST atrasar o
   `200` para a Meta. O wrapper do Jamil faz o POST de saída com o id que a
   Graph API devolveu. Os dois usam o mesmo cabeçalho. Repetir é seguro.
6. Entrar num dos hosts do passo 1 com um owner ou admin. A linha do Jamil
   está marcada como piloto.

Produção é o mesmo roteiro no `dute-prod`, no disparo manual do CI
(`publicar_producao`), e só com o OK do Leonardo. O job de produção também
sobe o `dute-zap`. O domínio `zap.dutelog.com.br` continua de fora até o
passo de infraestrutura abaixo.

## Infraestrutura do subdomínio

**Não aplicar sem o OK explícito do Leonardo.** Homologação não tem Load
Balancer: o painel fica no `run.app`. Produção usa o balanceador que já existe
(`docs/plataforma/fase-1-corte.md`):

- IP `dute-app-ip`, `34.54.243.247`
- mapa `dute-app-url-map` (`dutelog.com.br` e `www` vão para o site; o resto, para o app)
- proxy `dute-app-https-proxy`, mapa de certificados `dute-cert-map`
- certificados atuais: `dute-app-cert` (`app.dutelog.com.br`) e `dutelog-site-cert`

Os CNAMEs `_acme-challenge_drmxqhwlpiaruyad*` na Hostinger não podem sair: a
renovação dos certificados atuais depende deles.

Ordem, para `zap.dutelog.com.br` não cair no app enquanto o mapa manda "o
resto" para o `dute-app`:

1. Certificado novo no Certificate Manager, só para `zap.dutelog.com.br`, com
   autorização DNS. O CNAME de desafio que o Google mostrar é **outro**
   registro; cria na Hostinger e espera ficar ativo. Não apague os que já
   existem.
2. Entrada desse certificado no `dute-cert-map`.
3. NEG serverless do Cloud Run `dute-zap` em `southamerica-east1`, e um
   backend service apontando para ele.
4. Regra de host no `dute-app-url-map`: `zap.dutelog.com.br` vai para esse
   backend. Não altere o default (o app) nem os hosts do site.
5. Por último, o registro DNS na Hostinger: **A** de nome `zap`, valor
   `34.54.243.247`. Não mude o apex, o `app` nem o `www`.
6. Authorized domain `zap.dutelog.com.br` no Firebase Auth do `dute-prod`.

Enquanto o passo 5 não existir, o painel de produção é o `run.app` do
`dute-zap`, com esse host autorizado no login.

## LGPD

Referência: `docs/plataforma/lgpd.md`, em especial "A operação primeiro"
(26/10/2026). A operação é pequena e interna; retenção não pode travá-la.

O que esta conversa guarda: telefone do contato, nome que o WhatsApp manda,
texto ou legenda, tipo da mídia (sem o arquivo), horário, id da Meta e qual
agente. Quem lê é owner ou admin, pela regra do Firestore. O navegador não
escreve.

O registro de acesso (`zap_access`) anota a abertura do painel e de cada
conversa: uid, papel, ação e horário. Não copia a mensagem. A tela chama
`registrarAcessoZap` uma vez ao entrar e uma vez ao abrir.

Retenção, em `functions/zap/src/domain/retencao.ts`:

- prazo `ZAP_RETENCAO_DIAS`, hoje **180**, num lugar só;
- rotina `runZapRetention`, 03:30 de São Paulo, até 4 000 documentos por
  coleção por dia;
- lista `RETENCAO_AMBIENTES_LIBERADOS`, hoje só `dute-homolog`.

A produção não apaga. Ligar lá é um PR que inclui `dute-prod` nessa lista,
quando o Leonardo pedir, no mesmo espírito das rotinas que já existem. O log
da rodada é a contagem, sem telefone e sem texto.

Não usamos a coleção `events` do WMS: o volume e o conteúdo são desta conversa,
e o registro é a própria mensagem mais o acesso.

## Deploy

O CI roda o unitário do Zap no job de checagens e a integração (emulador, com
o índice das consultas do painel) no job de integração, junto das outras
codebases. O `publicar.yml` instala a pasta no deploy de functions, que já
publica todas as codebases.

O Cloud Run `dute-zap` sobe num job à parte. Na homologação ele só roda quando
o commit mexe em `artifacts/dute-zap/` ou no `Dockerfile.zap`, para não somar
minutos em todo push. Na produção, o disparo manual sobe o painel junto. O app
`dute-app` e o site não mudam de serviço, de imagem nem de domínio.
