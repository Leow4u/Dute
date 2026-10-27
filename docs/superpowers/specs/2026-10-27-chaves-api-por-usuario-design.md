# Chaves pessoais de API

## Aprovação e intenção

Desenho confirmado pelo usuário no chat em 27/10/2026: “Isso, é exatamente isso!” após a descrição de chaves pessoais como extensão da conta, criação por nome/permissão, lista com identificação mascarada/último uso/revogação, sem escolher clientes manualmente. Esta aprovação autoriza implementar e entregar um PR revisável; não autoriza novo merge/deploy nem emitir credenciais reais.

## Comportamento

- Qualquer usuário com perfil ativo cria, lista e revoga suas próprias chaves em Configuração → Chaves de API, seção Sua conta. Login humano necessário para gestão; uma API key não gerencia outras chaves.
- Criar abre um diálogo com nome e permissão: `full` (Acesso total), `read_only` (Somente leitura), `custom` (Personalizada, escopos disponíveis à conta). Validade padrão de 90 dias; preserva limite atual 1–90. Segredo exibido/copiadо uma única vez. Lista mostra nome, prefixo público mascarado, permissão, último uso, criação, validade e status; busca/filtro e revogação.
- Acesso total é limitado às rotas implementadas e às permissões atuais do usuário; não cria funções ainda ausentes da API. Remoção, bloqueio, mudança de papel, vínculo com cliente e módulos/portal contratados são revalidados a cada chamada. Somente leitura não grava. Personalizada é interseção dos escopos selecionados com o acesso atual da conta.
- Não há seleção obrigatória de clientes: equipe usa sua abrangência normal; cliente fica preso ao código da conta e aos módulos contratados, com portal ativo. Filtros `customer_code` continuam possíveis nas chamadas; quando omitidos, listar todos os registros permitidos de forma paginada. Cliente nunca consulta o documento interno quando a tela usa uma projeção do portal.
- Uma chave pessoal não recebe um papel diferente que libere ações que seu titular não pode fazer. Restrições por rota e por registro valem além do escopo: ex. operador não decide pedido, campo não lê OS alheia, owner/admin não ganham gravação RH se o app a reserva ao papel rh.
- Auditoria registra chave e titular, sem token/corpo completo. Eventos conservam ator `api:<id>` e guardam vínculo auditável com o usuário. Idempotência, recibos incertos, concorrência e validações de domínio preservados.
- Chaves existentes conservam exatamente seu modelo, clientes e política; nenhuma migração amplia acesso. O fluxo anterior `/integrations` continua compatível para integrações legadas. A tela deve permitir ao criador identificar/revogar suas chaves antigas, distinguindo a política original.

## Arquitetura e escolhas de implementação

Uma nova família `/api/v1/api-keys` oferece gestão pessoal. `GET /api-keys/capabilities` retorna escopos/perfil/abrangência permitidos, `GET/POST /api-keys`, `DELETE /api-keys/{id}`. Mesmo gateway e mesmas operações de negócio; nenhum banco genérico ou nova credencial de infraestrutura.

Novo registro em `api_integrations`: `kind: personal`, `permission: full|read_only|custom`, `delegated_by` identifica titular, `scopes` para escolha custom, `customers: []`, `write_policy: scoped`, hash/validade/revogação preservados, `created_at` e `last_used_at_ms`. Registros sem `kind` são legados. O tipo novo é discriminado e validado; configurações desconhecidas falham fechadas.

Um principal portátil compartilhado resolve usuário/papel/cliente/contrato e política de ações. Os seis pacotes recebem cópia no build atual. O handler aplica a interseção antes de executar; adaptadores preservam guardas de tenant na mesma transação do domínio. As leituras usam projeções e filtros que a conta humana pode usar. Onde o domínio contém restrição que o escopo agregado não expressa, a rota também confere. Operações não suportadas para um perfil são documentadas e recusadas; não se inventa autorização por analogia.

Alternativas consideradas: manter apenas integrações administradas pelo owner não atende o fluxo confirmado; criar uma segunda API completa duplicaria regras e contratos. A escolha é acrescentar credencial pessoal e reutilizar o gateway/serviços existentes, preservando o modelo legado.

## Limites

Sem exclusão irrestrita, concessão de permissões, emissão fiscal, operação bancária, execução automática de rotinas ou novos privilégios. Sem chave real, IAM, acesso a dados reais, merge ou deploy nesta implementação. O artefato de entrega é novo PR draft.

## Evidências esperadas

Testes dos 11 papéis, titular/terceiro, troca de papel/cliente/contrato/bloqueio, full/read_only/custom, chave legada, corpo malicioso, concorrência e repetição. Casos específicos de RH/Financeiro e projeções do cliente. UI testada em desktop/celular com mocks e sem token persistido. Checks completos dos seis pacotes, frontend, ferramentas, índices, OpenAPI e empacotamento; revisão independente antes do PR.
