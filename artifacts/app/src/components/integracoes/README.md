# Chaves pessoais de API

Em Configurações → Sua conta → Chaves de API, qualquer perfil ativo pode criar uma chave com nome e permissão. Acesso total e Somente leitura acompanham o acesso atual da conta; Personalizada permite escolher somente os escopos devolvidos por `/api-keys/capabilities`. Não há seleção de cliente: a abrangência é a da conta. A API revalida papel, contrato e acesso a cada chamada.

A validade padrão e máxima é 90 dias (mínimo 1). Copie o segredo ao criar: ele aparece somente no diálogo atual e é descartado ao fechar. Não é armazenado em cache de consultas, mutations, localStorage ou sessionStorage. Se não houver recibo de criação, confira a lista e revogue a chave antes de criar outra.

A lista mostra prefixo mascarado, permissão, datas, último uso e status. Busca e filtro aplicam-se às páginas já carregadas; use Carregar mais para consultar as demais. Revogar exige confirmação e interrompe o acesso imediatamente. Chaves legadas aparecem identificadas com sua política original; a interface não converte nem amplia seu acesso.
