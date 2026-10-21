# Fotos profissionais com Agent Dute

Na contagem de abertura, no recebimento e na ficha de um item em Estoque,
anexe uma foto e escolha **Foto profissional com Agent Dute**. Selecione
**Foto de catálogo** para produtos em geral ou **Roupa em manequim** para
vestuário. Ambos pedem fundo branco e iluminação de estúdio.

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

O processamento em lote desta versão reúne fotos de um único produto.
Não há processamento de todo o catálogo em uma única operação.
