# Terminal Assistant

Agente de terminal que responde perguntas em linguagem natural sobre logs de acesso armazenados em SQLite. Você pergunta em português, a IA gera a SQL, a aplicação valida e pede sua confirmação, executa a consulta e a IA transforma o resultado em uma resposta textual.

```txt
> Qual empresa possui mais acessos?
Gerando SQL...

SQL sugerida:
SELECT company, COUNT(*) AS total FROM access_logs GROUP BY company ORDER BY total DESC LIMIT 1

Explicação:
Agrupa os acessos por empresa, conta quantos cada uma tem e retorna a primeira.

Executar esta consulta? (s/N) s
1 linha(s) retornada(s). Gerando resposta...

A empresa com mais acessos é a Kris Group, com 610 acessos.
```

O projeto também serve como estudo de fundamentos do Node.js: streams, backpressure, `readline`, `node:sqlite`, `parseArgs`, `--env-file` e o test runner nativo, tudo sem dependências além do SDK de IA e do faker.

## Sumário

- [Requisitos](#requisitos)
- [Início rápido](#início-rápido)
- [Configuração](#configuração)
- [Scripts](#scripts)
- [Como funciona](#como-funciona)
- [Segurança da SQL](#segurança-da-sql)
- [Desempenho](#desempenho)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Testes](#testes)
- [Solução de problemas](#solução-de-problemas)

## Requisitos

- **Node.js 24 LTS** (testado na 24.21). O mínimo é a 22.13, primeira versão com `node:sqlite` sem flag; o AI SDK 7 exige Node 22 ou superior.
- Uma chave de API de um provider de IA:
  - **Google Gemini** (padrão, tem cota gratuita): crie em <https://aistudio.google.com/apikey>.
  - **OpenAI** (exige créditos pré-pagos): crie em <https://platform.openai.com/api-keys>.
- Cerca de **2,5 GB livres** em disco para o arquivo de log (1 GB) e o banco com índices (1,3 GB).

## Início rápido

```bash
git clone https://github.com/FelipePinheiroRegina/terminal-assistant.git
cd terminal-assistant
npm install

# 1. configure a chave de API
cp .env.example .env.local
# edite .env.local e preencha GOOGLE_GENERATIVE_AI_API_KEY

# 2. gere ~1 GB de logs falsos (access_log.log)
npm run generate

# 3. carregue os logs no SQLite (database.db)
npm run seed

# 4. inicie o agente
npm start
```

Para testar rápido sem esperar 1 GB, gere um arquivo menor:

```bash
npm run generate -- --size 50
```

## Configuração

As variáveis ficam em `.env.local`, carregado pelo próprio Node com `--env-file-if-exists` (sem `dotenv`). Esse arquivo está no `.gitignore` e **nunca deve ser versionado**. Use o `.env.example` como modelo.

| Variável | Padrão | Descrição |
|---|---|---|
| `AI_PROVIDER` | `google` | Provider de IA: `google` ou `openai`. |
| `AI_MODEL` | `gemini-3.5-flash-lite` (google) / `gpt-5.4-mini` (openai) | Modelo usado nas duas chamadas à IA. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | | Chave do Gemini, obrigatória quando `AI_PROVIDER=google`. |
| `OPENAI_API_KEY` | | Chave da OpenAI, obrigatória quando `AI_PROVIDER=openai`. |
| `DATABASE_PATH` | `database.db` | Caminho do banco SQLite usado pelo agente. |

## Scripts

### `npm run generate`

Gera um arquivo NDJSON (um objeto JSON por linha) com logs de acesso falsos usando o [faker](https://github.com/faker-js/faker). Para quando o arquivo atinge o tamanho pedido.

| Opção | Atalho | Padrão | Descrição |
|---|---|---|---|
| `--size` | `-s` | `1024` | Tamanho alvo em MB. |
| `--output` | `-o` | `access_log.log` | Arquivo de saída. |

Formato de cada linha:

```json
{"ip":"41.152.162.67","username":"Rylan_Harris69","first_name":"Rylan","last_name":"Harris","email":"Rylan.Harris@yahoo.com","location":"North Nyasiamouth","job_area":"Implementation","company":"Wiza Group","job_title":"Lead Communications Agent","id":"22eb5032-193f-4359-b2d6-9d6572c5ab84","timestamp":"2026-10-03T04:30:06.353Z"}
```

Cada linha tem em média ~338 bytes, então 1 GB fica em torno de **3,2 milhões de registros**, gerados em ~30 segundos.

### `npm run seed`

Lê o arquivo de log linha a linha e insere os registros na tabela `access_logs`.

| Opção | Atalho | Padrão | Descrição |
|---|---|---|---|
| `--input` | `-i` | `access_log.log` | Arquivo de log de entrada. |
| `--database` | `-d` | `database.db` | Banco SQLite de destino. |

- Ignora linhas vazias, linhas que não são JSON válido e registros sem algum dos campos obrigatórios. A carga continua normalmente quando encontra essas linhas.
- Usa `INSERT OR IGNORE`: rodar o seed de novo não duplica registros (o `id` é a chave primária).
- Exibe o progresso a cada 100 mil linhas e, ao final, um resumo com lidas, inseridas, duplicadas, vazias e inválidas.
- Cria os índices depois da carga (veja [Desempenho](#desempenho)).

Carregar 1 GB leva cerca de 20 a 40 segundos.

### `npm start`

Inicia o agente interativo. Digite uma pergunta e pressione Enter. Para sair, digite `sair`, ou pressione `CTRL+C` ou `CTRL+D`.

Perguntas para testar:

- Quantos registros existem no banco?
- Quais são os 10 acessos mais recentes?
- Quais cidades aparecem nos logs?
- Qual empresa possui mais acessos?
- Quantos acessos existem por cargo?
- Quais usuários acessaram mais recentemente?
- Quais áreas de trabalho aparecem com maior frequência?

### `npm test`

Roda os testes com o test runner nativo do Node (`node --test`).

## Como funciona

### Geração dos logs (`src/generate-access-logs.js`)

Um *async generator* produz blocos de 1.000 linhas, e `Readable.from()` o transforma em stream. O `pipeline()` de `node:stream/promises` liga esse stream ao `createWriteStream` do arquivo.

O ponto central é o **backpressure**: o `pipeline` só pede o próximo bloco ao generator quando o arquivo terminou de gravar o anterior. Por isso a memória fica estável mesmo gerando 1 GB, ao contrário de um `stream.write()` dentro de um `for`, que enfileira tudo na memória.

### Carga no banco (`src/seed.js`)

`createReadStream` + `readline.createInterface` entregam o arquivo uma linha por vez com `for await`, sem carregá-lo inteiro na memória. Cada linha é validada e inserida por um único *prepared statement* do `node:sqlite` (`DatabaseSync`).

Os inserts são agrupados em transações de 10 mil linhas. Sem isso o SQLite faria um commit (e uma escrita sincronizada em disco) por linha, o que tornaria a carga dezenas de vezes mais lenta. O banco usa `journal_mode = WAL`.

### Agente (`src/index.js` e `src/agent.js`)

```txt
pergunta ──▶ IA gera { sql, explanation } ──▶ validação da SQL ──▶ exibe SQL + explicação
                                                                          │
resposta no terminal ◀── IA gera resposta (streaming) ◀── SQLite ◀── usuário confirma
```

1. O usuário digita a pergunta (`readline/promises`).
2. `generateText` com `Output.object` do [AI SDK](https://github.com/vercel/ai) envia a pergunta e o esquema da tabela. A resposta é validada por um schema [zod](https://github.com/colinhacks/zod) no formato `{ sql, explanation }`.
3. A SQL passa pela validação de segurança. Se for bloqueada, o motivo é exibido e nada é executado.
4. A SQL e a explicação são exibidas, e o usuário confirma com `s`.
5. A consulta roda em uma conexão **somente leitura**. Para economizar tokens, no máximo 50 linhas são enviadas ao modelo, e ele é avisado quando o resultado foi truncado.
6. `streamText` gera a resposta final, exibida no terminal à medida que chega.

O esquema da tabela enviado ao modelo é lido do próprio banco (`sqlite_master`), então continua correto se a tabela mudar.

Para trocar de provider, basta mudar `AI_PROVIDER`: a função `createAgent` recebe qualquer modelo compatível com o AI SDK.

### Encerramento

`CTRL+C` (SIGINT), `CTRL+D`, `sair` e SIGTERM passam pela mesma função, que cancela a chamada à IA em andamento (`AbortController`), fecha o `readline` e a conexão com o banco.

## Segurança da SQL

A aplicação executa **apenas consultas de leitura**, com três camadas de proteção:

1. **Instruções ao modelo**: gerar só um `SELECT` (CTE com `WITH` é permitido), sem múltiplas queries, sem comentários e sem ponto e vírgula.
2. **Validação antes de executar** (`src/sql-guard.js`):
   - a consulta precisa começar com `SELECT` ou `WITH`;
   - bloqueia comentários (`--` e `/* */`) e mais de uma consulta (`;` no meio);
   - bloqueia `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `REPLACE`, `PRAGMA`, `ATTACH`, `DETACH`, `VACUUM`, `REINDEX`, `ANALYZE` e `TRUNCATE` em qualquer posição, inclusive em subconsultas;
   - o conteúdo de strings é ignorado na checagem, então `WHERE job_title = 'Update Manager'` é aceito.
3. **Conexão somente leitura**: o agente abre o banco com `readOnly: true`. Mesmo que algo passe pela validação, o próprio SQLite recusa qualquer escrita.

Além disso, nada é executado sem a confirmação explícita do usuário.

> Bloquear a palavra `REPLACE` também bloqueia a função `replace()` do SQL. É uma troca consciente para manter a regra simples.

## Desempenho

Cada pergunta faz **duas chamadas à IA**, que respondem pela maior parte do tempo. Medições com ~3,17 milhões de registros:

| Etapa | Tempo típico |
|---|---|
| Gerar a SQL | 2 a 5 s |
| Executar a consulta (com índices) | 0 a 0,2 s |
| Gerar a resposta (streaming) | 2 a 7 s |

**Índices.** O seed cria índices em `timestamp`, `company`, `job_title`, `job_area` e `location`, e roda `ANALYZE`. Sem eles cada consulta varre a tabela inteira:

| Consulta | Sem índice | Com índice |
|---|---|---|
| `COUNT(*)` | 2,3 s | 0,01 s |
| 10 acessos mais recentes | 1,9 s | 0,00 s |
| Empresa com mais acessos | 2,1 s | 0,14 s |

**Escolha do modelo.** O padrão é `gemini-3.5-flash-lite`, que gerou SQL correta para todas as perguntas de exemplo com a menor latência. Evite `gemini-flash-latest` no plano gratuito: nos testes ele levou mais de 60 segundos para responder.

## Estrutura do projeto

```txt
.
├── src/
│   ├── index.js                 # agente interativo no terminal
│   ├── agent.js                 # chamadas à IA (gera SQL e resposta)
│   ├── sql-guard.js             # validação de segurança da SQL
│   ├── sql-guard.test.js        # testes da validação
│   ├── generate-access-logs.js  # gera o arquivo de logs com faker
│   └── seed.js                  # carrega os logs no SQLite
├── .env.example                 # modelo de configuração
└── package.json
```

Arquivos gerados e **não versionados** (estão no `.gitignore`): `access_log.log`, `database.db` (e `-wal`/`-shm`), `.env.local`.

## Testes

```bash
npm test
```

Os testes cobrem a validação da SQL: consultas aceitas (SELECT, CTE, palavras bloqueadas dentro de strings) e bloqueadas (cada comando proibido, múltiplas queries, comando em subconsulta, comentários, string sem fechamento e SQL vazia).

## Solução de problemas

**`Defina GOOGLE_GENERATIVE_AI_API_KEY no arquivo .env.local`**
O `.env.local` não existe ou está sem a chave do provider escolhido em `AI_PROVIDER`.

**`You have no credits remaining` (OpenAI)**
A API da OpenAI é pré-paga e separada do ChatGPT; contas novas começam sem créditos. Adicione créditos em <https://platform.openai.com/settings/organization/billing> ou use o Gemini (`AI_PROVIDER=google`).

**`You exceeded your current quota` / erro 429 (Gemini)**
O plano gratuito limita as requisições por minuto. Espere alguns segundos e pergunte de novo. Cada pergunta usa duas requisições.

**`This model ... is no longer available to new users`**
O modelo definido em `AI_MODEL` foi descontinuado. Remova a variável para usar o padrão ou escolha outro modelo.

**`Banco database.db não encontrado` / `Tabela access_logs não encontrada`**
Rode `npm run generate` e `npm run seed` antes de `npm start`.

**`ExperimentalWarning: SQLite is an experimental feature`**
Aviso do próprio Node sobre o `node:sqlite`. Não afeta o funcionamento.

**Respostas lentas**
Confira se o banco tem índices (rodar `npm run seed` de novo cria os que faltarem sem duplicar dados) e se `AI_MODEL` não aponta para um modelo lento.
