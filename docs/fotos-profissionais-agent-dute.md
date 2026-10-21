# Fotos profissionais com Agent Dute

Na contagem de abertura, no recebimento e na ficha de um item em Estoque,
anexe uma foto e escolha **Foto profissional com Agent Dute**. Selecione
**Foto de catálogo** para produtos em geral ou **Roupa em manequim** para
vestuário. Ambos pedem fundo branco e iluminação de estúdio.

A geração recebe a descrição, gênero, grupo, tamanho, cor e marca disponíveis
no cadastro ou formulário. Esses atributos aparecem antes da geração e na
comparação das propostas. Ao usar manequim, o seletor sugere masculino,
feminino, infantil ou neutro pelo gênero e pela descrição. Se não houver
indicação ou se os dados divergirem, é obrigatório escolher explicitamente.
A escolha vale para essa geração e não altera o cadastro do produto.
O backend exige a escolha do manequim e a inclui como instrução explícita
de anatomia; a foto continua sendo a referência dos detalhes visuais da peça.

Na ficha de Estoque, **Gerenciar fotos** permite ampliar todas as fotos,
identificar as geradas pelo Agent Dute, definir a principal e remover uma foto
do produto com confirmação. Remover desvincula a foto do SKU, produto, saldos
e portal na mesma transação, sem alterar quantidades. Se a principal for
removida, a próxima foto passa a ser a principal. É possível remover a última
foto: o produto fica sem foto até que outra seja anexada.

Os arquivos removidos permanecem no Storage. A coleção privada
`catalog_photo_archive` registra URLs, caminhos disponíveis, operador e
principal anterior para recuperação administrativa; não há exclusão física
nem interface de restauração nesta versão. O evento `catalog.photos_updated`
registra a remoção ou a troca da principal. A callable `manageCatalogPhotos`
valida papel de armazém, cliente, vínculo da foto e idempotência.

**Gerar novamente** usa a foto selecionada como ponto de partida, mas o
servidor segue a proveniência do Agent Dute até a foto original antes de gerar.
Isso evita acumular alterações de gerações anteriores. Se a origem estiver
inválida, não acessível ou apontar para outro cliente, a operação é recusada.

É possível selecionar várias fotos do mesmo produto, dentro do limite de oito
fotos por produto, contando os originais. As gerações são sequenciais; se uma
falhar, as propostas anteriores continuam disponíveis para revisão. Compare
cada resultado com o original, descarte propostas incorretas e aprove as demais.
É possível usar a primeira proposta aprovada como foto principal. Na contagem
e no recebimento, as fotos aprovadas entram no rascunho e são vinculadas ao
produto quando o formulário é salvo. Na ficha de estoque, a aprovação salva
imediatamente pelo fluxo auditável de fotos do catálogo.

## Backend e configuração

- Callable `generateCatalogPhoto`, região `southamerica-east1`, timeout de 180 s.
  Frontend: `POST /api/products/generate-photo`, via SDK autenticado de Functions.
- Usa Vertex AI com a conta de serviço da Function, no projeto corrente e
  localização `global`. Modelo padrão `gemini-2.5-flash-image`, configurável
  por `PRODUCT_PHOTO_MODEL` no ambiente da codebase WMS. A conta precisa de
  acesso ao Vertex AI, API habilitada e modelo disponível no projeto.
- Entradas: JPEG, PNG ou WebP até 14 MB. A foto deve estar no bucket do sistema
  em `product-photos/<cliente>/` ou no prefixo histórico
  `customers/<cliente>/product-photos/`. URLs externas e de outro cliente são
  recusadas; o servidor baixa pelo Admin SDK, nunca pela URL do navegador.
- Saída em um objeto novo do Storage, com metadados de origem, modelo, modo,
  cliente e operador. O original não é sobrescrito. A coleção privada
  `product_photo_generations` registra solicitações, resultados e falhas;
  o mesmo UUID do operador retorna o resultado pronto sem gerar novamente.
- Gerar não modifica catálogo ou estoque. Aprovar na ficha usa `addCatalogPhotos`
  e o evento `catalog.photos_added`, com identificação das fotos e mudança da
  principal. A transação recusa exceder o limite em vez de descartar originais.
- Propostas descartadas não são vinculadas ao produto; seus objetos e registros
  de geração permanecem armazenados. Não há limpeza automática nesta versão.

## Validação antes da publicação

Publicar primeiro na homologação pelo fluxo normal do projeto. Testar uma roupa
estampada em manequim e um produto não vestuário em catálogo. Conferir cores,
logos e proporções com a foto original, aprovar e verificar a foto principal no
estoque e no portal. Testar também descarte e indisponibilidade do provedor.
A geração altera pixels e não garante fidelidade de todos os detalhes;
a revisão humana é obrigatória no fluxo.

Conferir também uma camiseta masculina (manequim masculino predefinido),
gênero em conflito com a descrição (escolha obrigatória), dados sem gênero,
remoção de uma foto principal, remoção da última foto e sincronização no portal.

O processamento em lote desta versão reúne fotos de um único produto.
Não há processamento de todo o catálogo em uma única operação.
