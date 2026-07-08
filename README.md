# Dute

Sistema de inventário, armazenagem, movimentações e cobrança para a operação BTG/Dute.

## Estado do projeto

Este repositório é agora a fonte principal de trabalho local/GitHub. A estrutura herdada do Replit foi reduzida para manter apenas o app, a API, os contratos e os dados de referência necessários.

## Como rodar localmente

Pré-requisitos:

1. Node.js compatível com o projeto.
2. PNPM.
3. PostgreSQL acessível via `DATABASE_URL`.
4. Variáveis do Clerk configuradas quando autenticação for usada.

Comandos principais:

```powershell
pnpm install
pnpm run typecheck
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/btg-inventory run dev
```

Por padrão, a API sobe na porta `5000` e o frontend na porta `5173`. É possível sobrescrever com `PORT` e `BASE_PATH` no ambiente.

Para uma visualização estática sem banco, backend ou login real:

```powershell
$env:VITE_DEMO_MODE="true"
pnpm --filter @workspace/btg-inventory run dev
```

Para build de demo publicado em GitHub Pages:

```powershell
$env:VITE_DEMO_MODE="true"
$env:BASE_PATH="/Dute/"
pnpm --filter @workspace/btg-inventory run build
```

## Mapa técnico

- `artifacts/btg-inventory`: frontend React/Vite em PT-BR.
- `artifacts/api-server`: API Express.
- `lib/db`: schema Drizzle/PostgreSQL.
- `lib/api-spec`: contrato OpenAPI.
- `lib/api-client-react`: cliente React gerado por Orval.
- `lib/api-zod`: schemas e tipos gerados para validação.
- `attached_assets`: planilhas e imagens de referência importadas no início do projeto.
- `.agents/memory`: notas técnicas úteis sobre decisões já tomadas.

## Documento-base de negócio

A Dute opera como uma empresa de serviços B2B que integra arquitetura corporativa, construção, logística e tecnologia em um modelo turnkey para transformação de ambientes de trabalho.

Sua proposta central é ser uma one-stop shop para empresas que precisam reconfigurar escritórios, plantas e operações corporativas, assumindo desde o projeto arquitetônico até a obra, mudança física, armazenagem e gestão digital de ativos.

## Proposta de valor

A Dute se posiciona no conceito TurnKey AI-Native, com entrega integrada, funcional e de alto padrão para empresas que buscam transformar seus ambientes corporativos com menos complexidade operacional.

O valor para o cliente está em reduzir a necessidade de coordenar múltiplos fornecedores, centralizando planejamento, execução, logística, tecnologia e governança em um único parceiro responsável pelo resultado fim a fim.

## Segmentos de clientes

O foco da Dute são empresas de médio e grande porte que precisam repensar escritórios, plantas corporativas, operações de mudança, armazenagem e gestão de ativos físicos.

A empresa atua no mercado corporativo, com presença relevante em São Paulo e região metropolitana, atendendo clientes de alto valor agregado em diferentes setores.

## Portfólio de serviços

O portfólio da Dute é organizado em três grandes frentes:

1. Arquitetura corporativa e construção.
2. Logística corporativa, incluindo mudanças e armazenagem.
3. Tecnologia para gestão de ativos e inventário.

Essa combinação permite que a empresa atue tanto na transformação física dos espaços quanto na gestão operacional contínua dos ativos corporativos.

## Arquitetura corporativa e construção

A Dute desenvolve projetos de escritórios, ambientes colaborativos, espaços flexíveis e projetos de workplace, conectando arquitetura, engenharia, planejamento e execução de obra.

Na prática, a atuação segue um modelo de design & build: a empresa participa da concepção, gestão, execução e entrega dos ambientes, assumindo responsabilidade pelo ciclo completo do projeto.

Essa frente também inclui consultoria workplace para adaptar espaços às novas modalidades de trabalho, como modelos híbridos, flexíveis e distribuídos.

## Logística corporativa

Na logística corporativa, a Dute oferece planejamento e execução de mudanças empresariais, relocation de escritórios e plantas, armazenagem de mobiliário e equipamentos, além de controle de ativos corporativos.

Essa operação combina movimentação física, armazenagem, inventário e gestão digital, conectando a execução logística ao controle estratégico dos bens da empresa cliente.

## Tecnologia e gestão de ativos

A camada tecnológica da Dute amplia o serviço físico para uma operação digital de controle e rastreabilidade.

O aplicativo de gestão de ativos e inventário cria uma base operacional para que clientes acompanhem mobiliário, equipamentos, localização, armazenagem e movimentações.

Essa frente aumenta a recorrência e o potencial de relacionamento contínuo com os clientes, abrindo espaço para evolução em direção a uma plataforma SaaS B2B de workplace e asset management.

## Modelo turnkey 4.0

O conceito TurnKey 4.0 representa a responsabilidade completa pela entrega: do projeto à obra, da mudança ao armazenamento, com um único fornecedor coordenando todas as etapas.

Esse modelo reduz risco, simplifica a governança do projeto e gera valor por meio de orquestração, cronograma, previsibilidade, qualidade e mitigação de falhas entre fornecedores.

## Estrutura operacional

A Dute possui uma estrutura multidisciplinar, combinando competências de arquitetura, engenharia, logística, tecnologia e gestão de projetos.

Essa composição permite executar projetos simultâneos com equipes dedicadas a planejamento, obra, operação logística e suporte digital, sustentando o posicionamento de entrega integrada com padrão de qualidade consistente.

## Fontes de receita

As principais fontes de receita vêm de contratos de serviços corporativos, incluindo:

1. Honorários de arquitetura e consultoria workplace.
2. Execução de obras e projetos design & build.
3. Gerenciamento de projetos.
4. Mudanças corporativas e relocation.
5. Armazenagem de bens corporativos.
6. Gestão de ativos e inventário digital.

A camada de gestão de ativos sugere potencial de receita recorrente por licenciamento, assinatura ou modelo SaaS associado à operação física.

## Diferenciais competitivos

Os principais diferenciais da Dute são:

1. Integração entre arquitetura, construção, logística e tecnologia.
2. Modelo turnkey com responsabilidade fim a fim.
3. Capacidade de reduzir a complexidade operacional do cliente.
4. Experiência em workplace e escritórios do futuro.
5. Abordagem humanizada, com imersão no contexto do cliente.
6. Potencial de recorrência por meio da gestão digital de ativos.

## Posicionamento de marca

A Dute se posiciona como uma empresa líder em soluções integradas para ambientes corporativos, indo além de um escritório tradicional de arquitetura ou de uma operação isolada de logística.

A narrativa da marca gira em torno de transformar o jeito de trabalhar, combinando espaço físico, execução operacional, tecnologia e inteligência aplicada ao ambiente corporativo.

## Tese estratégica

Do ponto de vista estratégico, a Dute opera hoje em um modelo intensivo em serviços especializados e execução física, com tecnologia como camada de diferenciação e expansão.

Existe espaço para digitalizar mais etapas do ciclo de vida dos projetos, incluindo briefing, simulação de layouts, gestão de cronogramas, automação de inventário, integrações com ERPs, facilities management e agentes corporativos.

A evolução natural da empresa pode transformar o aplicativo de ativos em uma plataforma recorrente de workplace e asset management, conectada ao modelo TurnKey AI-Native e ao histórico operacional da Dute.
