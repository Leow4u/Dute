# Armazenagem como único módulo disponível

Escopo aprovado na conversa: manter a Armazenagem multicliente, sua operação,
seu faturamento e as configurações necessárias. Ocultar Operação, Comercial,
Financeiro e RH separados, inclusive nos links diretos, preservando código,
dados e permissões existentes. Entrar diretamente na Armazenagem.

A mudança vale para `dute-prod`. Homologação mantém os módulos para evolução
e futura retomada. Reutilizar as liberações existentes e acrescentar um modo
de Armazenagem exclusiva; apagar os módulos perderia trabalho e esconder só
os cards deixaria as telas acessíveis.

O papel financeiro continua no faturamento da Armazenagem, sem ganhar acesso
ao estoque. Papéis exclusivos dos módulos pausados não recebem novos acessos.
O portal conserva estoque, pedidos e faturas, sem Serviços da Operação.

Dependência identificada: `payBillingInvoice` hoje exige o Financeiro em
produção. Permitir novamente a baixa no WMS para competências sem NF vinculada.
Competências já vinculadas a uma NF conservam a trava de integridade existente;
a interface informa essa condição sem oferecer baixa incompatível ou link oculto.

Preços vinculados (`lpu_item_id`) continuam vindo das mesmas tabelas, com suas
vigências e histórico. Em Faturamento › Contratos e tabelas, owner/admin mantêm
essas tabelas para o cliente ativo usando a tela existente. Não se amplia a
permissão de financeiro/comercial e não se altera o cálculo da cobrança.

Não há migração, exclusão de dados ou desligamento de serviços de backend.
A publicação deve levar a função de pagamento antes do frontend. Reativação:
retirar `dute-prod` das duas listas de Armazenagem exclusiva e republicar ambos.
