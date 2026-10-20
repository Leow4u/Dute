# Inventário de abertura: conferência e correções

O inventário de abertura é a carga inicial de cada cliente. Durante essa etapa, separe os produtos das caixas de origem e monte as **caixas de destino** conforme a organização física desejada, por exemplo mesmo modelo/cor com tamanhos diferentes. Cada tamanho continua com seu próprio código.

## Conferir antes de guardar

1. Em **Contagem → Inventário de abertura**, inicie uma **Nova caixa de destino**. O sistema gera um CX estável; ainda não exige medidas nem prateleira.
2. Identifique e conte cada produto. Confira a caixa de destino a cada lançamento. Os itens salvos ficam em conferência, sem criar catálogo, SKU, saldo ou posição ocupada.
3. Edite ou remova rascunhos até o resumo corresponder ao conteúdo físico.
4. Use **Revisar e fechar caixa**. O fechamento é persistido; para editar novamente, use **Reabrir conferência**.
5. Meça a caixa fechada e peça a posição. Se a embalagem puder virar, marque **Pode virar esta caixa de lado**. Para empilhar, marque separadamente **Pode empilhar esta caixa sobre outra que suporte seu peso**. Confira frente, profundidade e altura efetivas exibidas na sugestão.
6. Confirme a guarda na posição física e imprima a etiqueta. Só nessa etapa os produtos novos ganham SKU e as contagens entram no estoque.
7. Inicie a próxima caixa. O inventário só pode ser concluído quando todas as caixas estiverem guardadas ou as caixas vazias tiverem sido removidas.

Rascunhos ficam salvos no servidor e podem ser retomados ao abrir a caixa na lista da sessão. O progresso de lançamentos/unidades publicados é separado do conteúdo ainda em conferência.

Se uma guarda for interrompida, abra a caixa e use **Retomar guarda**. Cada linha tem uma chave persistente de processamento; as linhas já publicadas não são somadas novamente. Uma linha que falhou na validação pode ser corrigida sem alterar as que já publicaram. Só é possível voltar integralmente à conferência enquanto nenhuma linha foi publicada ou estiver em processamento.

Caixas armazenadas podem ser reabertas explicitamente para ajustes durante a sessão. Erro apenas no vínculo de uma linha deve usar **Corrigir caixa**, abaixo.

## Posição e orientação

As seis orientações da caixa são consideradas quando o operador permite apoiar de lado. Sem essa permissão, a altura original é preservada. A confirmação revalida espaço e peso no servidor e grava a orientação efetiva, sem alterar as medidas originais.

O cálculo considera uma fileira na profundidade. Com a permissão de empilhar,
o motor também testa os topos livres de caixas já guardadas na mesma
prateleira. A base da nova caixa precisa caber inteira sobre uma única caixa;
a soma das alturas e o peso total precisam respeitar a prateleira. A pessoa
confere se a embalagem indicada suporta o peso: o cadastro ainda não mede
resistência da embalagem. A sugestão mostra o código do apoio e a altura da
base; a confirmação revalida esse mesmo apoio, sem substituí-lo.

O sistema prefere a base da prateleira quando há frente livre. Caixas em
guarda (`committing`) reservam o apoio, mas só oferecem um novo topo após
concluir a guarda. Não é possível remover uma caixa que serve de apoio a
outra. O mapa desconta da frente apenas as caixas da base e informa
capacidade de referência **na base**, sem estimar empilhamento automaticamente. A recusa de uma sugestão vale para a caixa atual e fica auditada; não bloqueia a prateleira para as demais caixas.

No fluxo novo, a sugestão usa os SKUs conhecidos das linhas conferidas. A preferência continua por SKU exato e proximidade; não deduz família/modelo a partir do nome nem do sufixo do código. A organização por modelo/cor é feita na separação física. Para produtos totalmente novos, ainda sem SKU e posição anterior, vale a primeira prateleira compatível da zona do cliente.

## Corrigir lançamentos já publicados

Use **Corrigir caixa** em **Contagem → Inventário de abertura → Linhas conferidas** quando os produtos estão em caixas físicas diferentes, mas foram lançados na mesma caixa por engano.

1. Confira as etiquetas das caixas físicas.
2. Se o destino ainda não existe no sistema, use **Cadastrar caixa já armazenada** na mesma sessão, com suas medidas e posição física.
3. Filtre os lançamentos pela caixa incorreta.
4. Na linha, escolha **Corrigir caixa**, selecione a caixa física de destino e informe o motivo.
5. Confira origem, destino e quantidade e confirme.
6. Repita para as demais linhas e confira o conteúdo das caixas.

A operação move a linha inteira. SKU, cadastro, fotos, custo e quantidade global são preservados. Se as caixas estiverem em prateleiras diferentes, os saldos por posição são realocados na mesma transação, com movimentos compensados que não entram na cobrança. Toda correção registra ator e motivo. Repetir a mesma requisição não repete a movimentação.

Nesta primeira entrega, o destino precisa ser uma caixa guardada do mesmo cliente e sessão e não pode ter outro lançamento do mesmo SKU. Tamanhos com SKUs diferentes podem compartilhar a caixa. Dividir parte de uma linha ou fundir contagens do mesmo SKU exige outra operação; não use estorno para simular uma simples troca de caixa.

A ação **Remover para corrigir** continua destinada ao estorno de uma contagem errada: pode remover um cadastro criado na abertura quando não resta estoque. Para erro apenas na caixa, use **Corrigir caixa**.

Cada novo lançamento exige conferir explicitamente a etiqueta da caixa selecionada. A confirmação é limpa ao salvar ou trocar de caixa.

## Validação

- Integração Firestore: mesma posição, posições diferentes, idempotência, isolamento de cliente/sessão, destino inválido e preservação de saldo/catálogo.
- Frontend: roteamento da callable e seleção dos destinos compatíveis.
- Nenhuma correção de dados reais é executada pelo deploy; a equipe escolhe as caixas físicas na interface.

## Estado técnico

- `counting`: caixa de destino e rascunhos persistidos em `opening_inventory_draft_lines`; sem saldo.
- `reviewed`: conteúdo conferido e fechado, aguardando posição.
- `committing`: capacidade reservada; cada linha publica estoque e checkpoint na mesma transação. Pode retomar após interrupção.
- `stored`: guarda concluída, com `opening_closed: true`. Reabertura é explícita e auditada.
- Revisão otimista impede sobrescrever uma edição de outra tela.
- Criação de caixa e encerramento da sessão são coordenados transacionalmente; caixas pendentes impedem a conclusão.
- Capacidade considera caixas guardadas e reservas em andamento; a revisão da prateleira serializa guardas concorrentes.
