# Chaves pessoais de API

Este documento descreve a alteração proposta após o PR #517. Não confirma merge ou publicação desta alteração.

## Criar e gerenciar

Em **Configuração → Sua conta → Chaves de API**, qualquer usuário ativo pode criar uma chave com nome e permissão:

- **Acesso total:** operações já implementadas na API que a conta pode executar atualmente.
- **Somente leitura:** mesmas restrições da conta, sem gravações de negócio.
- **Personalizada:** somente os escopos escolhidos, intersectados com a autorização atual da conta. Um escopo agregado pode atender rotas diferentes; cada rota ainda confere o papel, o cliente e o recurso.

Não se escolhe uma lista de clientes ao criar a chave. A equipe usa sua abrangência habitual; a conta de cliente fica vinculada ao cliente atual do perfil e aos módulos contratados, com o portal ativo. A chave nunca concede um papel diferente ao titular. O campo `customer_code` continua existindo nos registros e filtros da API: ele identifica o cliente do registro, sem cadastrar a Dutelog como cliente.

A validade padrão e máxima é 90 dias. O segredo é exibido uma vez, só fica na memória da tela durante a revelação e não pode ser recuperado depois. A lista mostra identificador mascarado, permissão, datas, último uso e status. Busca/filtro atuam nas páginas carregadas; siga Carregar mais para outras páginas. Criar outra chave e revogar a anterior é o fluxo de rotação.

Somente o próprio usuário lista ou revoga suas chaves pessoais. Isso também vale entre duas contas owner. O token de API não cria, lista nem revoga outras chaves. A gestão exige sessão humana Firebase verificada com revogação.

## API de gestão

Use o endereço `duteApi/api/v1` do ambiente, com ID token Firebase humano.

| Método | Caminho | Resultado |
|---|---|---|
| GET | `/api-keys/capabilities` | Escopos elegíveis, papel, abrangência e código do cliente quando pertinente |
| POST | `/api-keys` | Cria chave própria; retorna `id`, `token`, `expires_at` uma vez |
| GET | `/api-keys?limit=50&cursor=...` | Somente metadados de chaves próprias, incluindo legadas identificadas; `next_cursor` até null |
| DELETE | `/api-keys/{id}` | Revoga somente chave própria; chave de terceiro retorna 404 |

Exemplo de corpo de criação:

```json
{"name":"Meu sistema","permission":"full","expires_in_days":90}
```

Para `custom`, informe `scopes` com pelo menos um valor retornado por capabilities. `full`/`read_only` omitem `scopes` ou enviam lista vazia. `customers`, `delegated_by`, papéis e políticas enviados pelo consumidor são recusados. Contas sem operações disponíveis podem criar uma chave full/read_only; isso não libera endpoints inexistentes nem outras permissões.

O consumidor usa o token recebido em `Authorization: Bearer <CHAVE>`. Gravações continuam exigindo `Idempotency-Key`. Não há aprovação por ação para chaves pessoais. Listagens pessoais da equipe podem omitir `customer_code` para percorrer todos os registros permitidos; para cliente, omitir significa sempre seu código atual. Detalhes também conferem o cliente real do documento; o campo lê só suas OS com UID humano em `equipe_uids`.

## Mudança de acesso e repetição

Cada chamada revalida o perfil ativo em `users`, papel, vínculo de cliente, contrato e portal aplicáveis. Alterações de papel/cliente e `access_disabled` refletem na próxima chamada, inclusive antes de retornar um recibo idempotente. Revogar ou expirar a chave corta o acesso. Não há snapshot que mantenha permissões antigas.

O contrato do cliente segue a interseção segura com as leituras do portal: documento/campo `modules` ausente usa wms+financeiro; lista presente vazia ou sem módulo conhecido concede zero. Há um fallback legado diferente em alguns helpers de domínio; ele não amplia as chaves pessoais. `portal_ativo:false` impede o acesso de cliente.

A auditoria identifica `user_uid` e `integration_id`; eventos de negócio preservam ator `api:<id>` com o papel real da conta pessoal. Não se registram tokens ou corpos completos. `last_used_at` representa uso da credencial quando disponível, não uma garantia de sucesso da ação. Recibos ambíguos continuam fechados para nova execução; confira dados e suporte antes de qualquer nova tentativa com outra chave.

## Coexistência com integrações antigas

Nenhuma chave existente é convertida ou ampliada. Registros sem `kind: personal` mantêm clientes explícitos, escopos originais, delegante owner/admin e `write_policy` anterior. O fluxo `/integrations` continua disponível para gestão administrativa legada e não gerencia chaves pessoais. A lista pessoal também permite ao criador identificar/revogar suas chaves antigas, com rótulo Legada e a política original; não expõe chaves de terceiros.

Para migrar, crie uma chave pessoal, configure e valide o consumidor, depois revogue a antiga. Permissões pessoais são as da conta atual; uma delegação legada não é automaticamente transportada. Não há migração automática ou troca de token escondida.

## Cobertura real

As rotas de negócio do PR #517 são reaproveitadas; esta alteração não oferece toda ação de toda tela. Veja [api-cobertura.md](api-cobertura.md) e [api-personal-adapters.md](api-personal-adapters.md).

- Campo: leitura das próprias OS; execução por API não foi acrescentada. Painel: o quadro da TV ainda não possui rota REST; pode criar chave sem operações disponíveis.
- Cliente: estoque/pedidos usam projeções do portal; faturas usam `client_faturas`. Não acessa catálogo interno, posições, recebimentos internos, pagamentos internos, fila a faturar ou demanda direta da coordenação.
- RH: owner/admin leem; somente rh grava, conforme a conta humana. Dados pessoais e arquivos mantêm escopos separados.
- Financeiro/Comercial: leitura e gravação obedecem às permissões por recurso. Ler preços não libera contatos comerciais ou baixa fiscal/bancária.
- Agent Dute: propriedade permanece por integração; não abre conversas privadas ou registros humanos/de outra chave. Rotinas continuam pausadas e limitadas aos módulos já suportados e permitidos pelo papel/contrato.

Nenhuma chave real, alteração manual de IAM, acesso persistente de terceiro, operação com dados reais, novo merge ou deploy integra esta entrega.
