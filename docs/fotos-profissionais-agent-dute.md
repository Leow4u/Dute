# Fotos profissionais com Agent Dute

Na contagem de abertura, no recebimento e na ficha de um item em Estoque,
anexe uma foto e escolha **Foto profissional com Agent Dute**. Selecione
**Foto de catálogo** para produtos em geral e **Manequim de vitrine** ou
**Roupa sem manequim** para vestuário. As opções pedem fundo branco e iluminação de estúdio.

## Apresentação da roupa e conferência visual

**Foto de catálogo** preserva a apresentação do original, inclusive se estiver
dobrado. É a opção mais fiel quando a foto não mostra a peça inteira aberta.
**Manequim de vitrine** limita peças superiores (tricôs, camisetas, camisas etc.)
a um busto sem cabeça, mãos ou pernas, que termina dentro da barra da roupa.
Peças inferiores usam suporte coberto pela própria peça; vestidos e macacões
usam suporte invisível. Não deve haver anatomia íntima ou volumes anatômicos.
**Roupa sem manequim** mostra somente a peça, com suporte invisível.

O prompt exige fidelidade de logo, bordado, zíper, gola, punhos e textura, e
orienta a não inventar o formato escondido de uma roupa dobrada. Se necessário,
o resultado mantém a apresentação original em vez de reconstruir a peça aberta.

Antes de armazenar e retornar uma proposta ao navegador, o backend compara
original e proposta em uma chamada visual separada, usando
`PRODUCT_PHOTO_REVIEW_MODEL` (padrão `gemini-2.5-flash`). A conferência avalia
apresentação comercial, fidelidade da peça, marcas e enquadramento. Todos os
critérios precisam passar. Reprovação, resposta incompleta ou indisponibilidade
da conferência impedem salvar e exibir a proposta; o original permanece intacto.
Não há nova geração automática que gere custos adicionais sem uma nova ação.

A conferência acrescenta uma chamada de IA por proposta e admite até 14 MB
somando original e resultado, para respeitar o limite da requisição. O prazo
da geração é de 120 s e o da conferência de 45 s, dentro do timeout da callable.
Uma versão nova da apresentação entra no hash de idempotência para não reutilizar
propostas antigas sem conferência. O resultado aprovado e o modelo de revisão
ficam registrados no pedido de geração. Essa conferência também é probabilística:
a revisão humana continua necessária antes de aprovar a publicação da foto.

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
