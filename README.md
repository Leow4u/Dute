# Dute

Sistema de inventário, armazenagem, movimentações e cobrança para a operação BTG/Dute.

## Estado do projeto

O projeto agora usa somente o frontend React/Vite criado inicialmente. Backend, banco e autenticação legados foram substituídos por serviços Google Cloud/Firebase:

- Firebase Hosting para publicar o app.
- Firebase Authentication com login por e-mail/senha e cadastro apenas por convite.
- Cloud Firestore em `southamerica-east1` para dados operacionais.
- Firestore Security Rules para controle de acesso.

## Como rodar localmente

Pré-requisitos:

1. Node.js compatível com o projeto.
2. PNPM.
3. `.env.local` com as variáveis `VITE_FIREBASE_*`.

O `vite.config.ts` do app BTG lê esse arquivo na raiz do repositório, mesmo com o frontend dentro de `artifacts/btg-inventory`.

Comandos principais:

```powershell
pnpm install
pnpm run typecheck
pnpm --filter @workspace/btg-inventory run dev
```

Para uma visualização estática sem login real:

```powershell
$env:VITE_DEMO_MODE="true"
pnpm --filter @workspace/btg-inventory run dev
```

Para gerar o build de produção:

```powershell
pnpm --filter @workspace/btg-inventory run build
```

## Deploy

O projeto Firebase padrão é `dute-f7480`, e o Hosting site configurado é `dute-f7480`.

```powershell
npx firebase-tools deploy --only hosting,firestore --project dute-f7480
```

O domínio planejado é `app.dutelog.com.br`; a conexão final do domínio exige criar o domínio no Firebase Hosting e apontar os registros DNS na Hostinger.

## Acesso por convite

O login é fechado. Usuários não criam conta publicamente.

1. Um usuário interno acessa `Usuários & Acessos`.
2. Cria um convite com nome, e-mail e perfil (`interno` ou `cliente`).
3. O sistema copia um link `/sign-up?invite=...`.
4. O convidado cria senha usando esse link.

As regras do Firestore só permitem criar perfil quando existe convite pendente para o e-mail autenticado.

## Mapa técnico

- `artifacts/btg-inventory`: frontend React/Vite em PT-BR.
- `artifacts/btg-inventory/src/lib/firebase.ts`: inicialização Firebase.
- `artifacts/btg-inventory/src/lib/auth.tsx`: autenticação e perfil do usuário.
- `artifacts/btg-inventory/src/lib/cloud-api.ts`: ponte Firestore para as chamadas que as telas já usam.
- `lib/api-client-react`: hooks e tipos usados pelas telas existentes.
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
