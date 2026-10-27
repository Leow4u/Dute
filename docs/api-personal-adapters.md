# Cobertura dos adaptadores de chaves pessoais

Referência de autorização: `firestore.rules`, callables e serviços humanos citados na matriz de `.superpowers/sdd/2026-10-27-chaves-api-por-usuario/permissions-audit.md` (27/10/2026). A API expõe somente as rotas existentes. `full`, `read_only` e `custom` continuam limitados pelo papel e contrato atuais; o escopo agregado não autoriza toda ação de um módulo.

Nesta tabela, “coordenação” significa owner/admin/interno; “comercial” e “financeiro” significam os respectivos papéis, além de owner/admin onde indicado. O perfil painel não possui rota destes cinco adaptadores; campo só possui as rotas específicas da Operação, fora deste documento.

| Adaptador | Leitura pessoal | Gravação pessoal |
|---|---|---|
| WMS | Coordenação/wms/suporte: catálogo, posições, estoque, pedidos e recebimentos. Financeiro: estoque e movimentos. Cliente com wms: estoque e pedidos próprios. Movimentos: coordenação/wms/financeiro/suporte. | Pedidos: coordenação/wms/financeiro/suporte e cliente com wms. Decisão de pedido: coordenação. Recebimentos e movimentos: coordenação/wms. |
| Comercial | Clientes/contatos: owner/admin/comercial. Locais: owner/admin/interno/comercial. Demandas: owner/admin/interno/comercial/financeiro. Contratos, aditivos, tabelas, orçamentos, revisões e medições: owner/admin/comercial/financeiro. | Owner/admin/comercial, apenas as operações existentes de cadastro, contrato vigente, orçamento em rascunho e medição. |
| Financeiro | Faturas/pagamentos: owner/admin/comercial/financeiro. Cliente com financeiro: somente faturas próprias do portal. A faturar demandas/medições: owner/admin/comercial/financeiro. Armazenagem: owner/admin/financeiro/suporte. | Owner/admin/financeiro: registrar NF externa, documentar cobrança e registrar pagamento. |
| RH | Owner/admin/rh, com os escopos separados para dados pessoais e abertura auditada de arquivo. | Somente rh. Owner/admin não recebem papel rh. |
| Agente | Playbooks: owner/admin/interno/suporte. Rotinas: owner/admin/interno/wms/suporte e cliente com módulo contratado wms/operacao; cada registro também confere o papel e o contrato do cliente atual. | Playbooks: owner/admin/interno/suporte. Rotinas: mesmos leitores habilitados, somente wms/operacao, pausadas e com escopos do módulo. |

Clientes não recebem catálogo, posições, recebimentos ou movimentos internos do WMS, pagamentos ou filas internas do Financeiro. Comercial/financeiro não recebem rotinas desta API: seus módulos humanos são comercial/financeiro, enquanto este adaptador só aceita wms/operacao.

## Projeções e identidade

WMS usa `client_inventory` para estoque do cliente e do papel financeiro; pedidos do cliente usam `client_request_status`, inclusive no detalhe. As whitelists de resposta já documentadas são mantidas, sem campos adicionais. Financeiro usa `client_faturas` para cliente e uma whitelist própria: campos escalares do portal, números de demanda como strings e NF limitada a numero/serie/emitida_em. A união dos campos opcionais internos e do portal está em `functions/financeiro/src/api/routes.json`; periodo_ids, medicao_ids e registrada_em não fazem parte da resposta do cliente.

A equipe pode omitir o filtro de cliente em listas paginadas; o cliente usa sempre seu vínculo atual. Rotinas continuam pertencendo a `api:<id>`: não se abrem conversas, registros humanos ou registros de outras chaves. Mudanças no contrato removem rotinas da lista e impedem detalhe/gravação; uma página filtrada pode estar vazia e ainda possuir next_cursor. `modules: []` concede zero módulos; apenas ausência do campo/documento aplica wms+financeiro. Portal desativado corta o cliente.

Eventos de domínio conservam `uid: api:<id>` e o papel real nas chamadas pessoais; o handler audita também o UID humano. Integrações sem kind preservam as coleções, os filtros obrigatórios e os papéis sintéticos anteriores. As guardas de tenant e de relações dentro das transações, CAS e recibos de idempotência permanecem em uso. Antes de devolver um recibo pessoal, o kernel confere o cliente do corpo e o hook das rotinas revalida contrato e propriedade atual; a versão antiga do PATCH não invalida um replay autorizado.

## Limites da validação desta tarefa

Os testes unitários dos cinco adaptadores exercitam a matriz de onze papéis nas leituras representativas; decisões de pedido e gravações de RH possuem negações específicas. Os testes integrados usam o handler e serviços reais em projetos demo locais, cobrindo projeção, mudança de papel, bloqueio, vínculo/contrato do cliente, autoria real e replay; Core inclui perda de contrato em leitura/gravação de rotina. Não certificam IAM, produção nem execução agendada de rotinas, que a API mantém pausadas. Gestão de chaves, casos completos de permission/custom e Operação pertencem ao kernel compartilhado e à tarefa de gestão.
