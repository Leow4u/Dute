# Runbook Fase 5 - Expansao com governanca

Este runbook orienta a entrada de novos clientes sem misturar estoque,
usuarios, faturas ou eventos com o contrato BTG Pactual.

## Objetivo

- Manter BTG Pactual como cliente inicial e fonte real atual.
- Cadastrar novos clientes em `customers`.
- Vincular usuarios de portal em `customer_accounts`.
- Garantir que toda alteracao critica passe por Cloud Functions, com evento e
  idempotencia.
- Evitar escrita direta em colecoes governadas pelo navegador.

## Onde operar

| Acao | Tela | Perfil |
| --- | --- | --- |
| Criar ou pausar cliente | Administracao > Clientes | owner/admin |
| Vincular usuario a cliente | Administracao > Clientes | owner/admin |
| Enviar convite de acesso | Administracao > Usuarios e acessos | owner/admin |
| Alterar perfil interno | Administracao > Usuarios e acessos | owner/admin |
| Consultar estoque do cliente | Portal do cliente ou Estoque interno | cliente/operacao |
| Alterar estoque | WMS ou movimentacao operacional | operacao WMS |

## Checklist de novo cliente

1. Criar cliente em `Administracao > Clientes`.
2. Confirmar codigo unico do cliente. Esse codigo sera usado para filtrar portal,
   estoque, pedidos, faturas e eventos.
3. Definir status do portal: ativo, pausado ou bloqueado.
4. Definir modo de cobranca: LPU contratual, sob medida ou sem cobranca.
5. Vincular usuarios do cliente em `customer_accounts`.
6. Criar convite em `Usuarios e acessos` com perfil `cliente`.
7. Validar que o usuario cliente enxerga apenas dados do proprio
   `customer_code`.
8. Registrar documentos comerciais/contratuais no modulo de conhecimento do
   Agent Dute.

## Smoke test obrigatorio

- Acessar Configuração > Cliente BTG (`/configuracoes/cliente`) como admin.
- Criar um cliente de teste interno ou editar um cliente existente.
- Confirmar evento `customers.create` ou `customers.update`.
- Criar vinculo de usuario e confirmar evento `customer_accounts.create`.
- Acessar portal como usuario cliente e confirmar isolamento por cliente.
- Confirmar que Firestore Rules continuam bloqueando escrita direta em
  `customers` e `customer_accounts`.

## Regras de seguranca

- Nunca reaproveitar o mesmo codigo para clientes diferentes.
- Nunca cadastrar produto/SKU sem `customer_code` correto.
- Nunca fazer importacao direta de estoque para novo cliente sem reconciliacao.
- Nunca expor local de galpao, divergencia operacional ou custo interno no
  portal do cliente sem regra explicita.

## Rollback

Se um cliente ou vinculo for criado errado:

1. Arquivar o registro pela tela de Clientes.
2. Registrar evento operacional explicando a correcao.
3. Validar se houve convite criado e revogar em Usuarios e acessos.
4. Nao deletar fisicamente registros com historico operacional.
