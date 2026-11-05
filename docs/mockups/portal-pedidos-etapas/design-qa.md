# Etapas dos pedidos do portal — validação visual

Mockup aprovado por Leonardo em 05/11/2026. Implementação em `artifacts/app/src/pages/client/pedidos.tsx`, compartilhada pela lista e pelo detalhe do pedido.

## Referência e resultado

- [Referência aprovada](referencia-aprovada.png)
- [Lista no desktop](lista-desktop.png): primeiro pedido na etapa inicial; segundo com uma etapa concluída e a separação em andamento.
- [Pedido entregue](entregue-desktop.png): quatro checks, sem etapa vigente.
- [Lista no celular](lista-celular.png) e [detalhe no celular](detalhe-celular.png).

A revisão visual confirmou os indicadores aprovados: círculo azul com check branco nas etapas concluídas, círculo azul com halo pulsante na vigente e círculos vazios nas futuras. O halo usa um ciclo de 2 segundos; marcador e texto permanecem estáveis. Cores, tipografia, textos, datas e regras de status existentes do portal foram preservados.

## Verificações

- Typecheck do workspace e build do app passaram.
- 20 testes passaram: `pedidos-etapas.test.tsx`, `orders.test.ts` e `theme-colors.test.ts`. Os nove testes novos cobrem lista, detalhe, estados ativos e terminais, textos e acessibilidade com axe. Os casos ativos falharam antes da alteração e passaram depois.
- Revisão independente do código sem achados acionáveis.
- Chromium: viewport desktop de 1660 × 948, igual à referência; celular de 390 × 844. Inspeção visual sem cortes na régua e sem rolagem horizontal da página.
- CSS calculado confirmou `ping` com duração de `2s` e mudança de transformação do halo. O marcador permaneceu em 20 × 20 px, na mesma posição.
- Com `prefers-reduced-motion: reduce`, a animação calculada foi `none` e o indicador ficou estático.
- Entregue: quatro etapas concluídas, nenhuma `aria-current` e nenhuma animação. Cancelado e recusado: sem régua, como antes.
- Etapas recebem nomes acessíveis com concluída/etapa atual/pendente; somente a vigente recebe `aria-current="step"`. Ícones e halo são decorativos.
- Nenhum erro de console ou de execução nas navegações verificadas.

## Limites da evidência

As capturas e verificações de navegador usam a página real `ClientePedidos`, seus componentes e CSS, com dados simulados no limite de carregamento e uma moldura representativa do portal. Não constituem um teste autenticado em produção. A animação foi verificada no navegador; as capturas PNG mostram apenas um instante dela. Nenhuma regra de negócio, API ou dado de pedido foi alterado.
