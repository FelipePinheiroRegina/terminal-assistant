import { existsSync } from 'node:fs'
import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { DatabaseSync } from 'node:sqlite'
import { styleText } from 'node:util'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'
import { createAgent } from './agent.js'
import { validateSql } from './sql-guard.js'

const PROVIDERS = {
    google: { create: google, apiKeyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY', defaultModel: 'gemini-3.5-flash-lite' },
    openai: { create: openai, apiKeyEnv: 'OPENAI_API_KEY', defaultModel: 'gpt-5.4-mini' },
}

const DATABASE_PATH = process.env.DATABASE_PATH ?? 'database.db'
const PROVIDER_NAME = process.env.AI_PROVIDER ?? 'google'
const MAX_ROWS = 50 // linhas enviadas ao modelo para gerar a resposta

const provider = PROVIDERS[PROVIDER_NAME]

if (!provider) {
    console.error(`AI_PROVIDER inválido: ${PROVIDER_NAME}. Use: ${Object.keys(PROVIDERS).join(', ')}.`)
    process.exit(1)
}

const MODEL = process.env.AI_MODEL ?? provider.defaultModel

if (!process.env[provider.apiKeyEnv]) {
    console.error(`Defina ${provider.apiKeyEnv} no arquivo .env.local (veja .env.example).`)
    process.exit(1)
}

if (!existsSync(DATABASE_PATH)) {
    console.error(`Banco ${DATABASE_PATH} não encontrado. Rode npm run generate e npm run seed antes.`)
    process.exit(1)
}

// readOnly: mesmo que uma SQL passe pela validação, o SQLite recusa escrita
const database = new DatabaseSync(DATABASE_PATH, { readOnly: true })

const tableSchema = database
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'access_logs'`)
    .get()?.sql

if (!tableSchema) {
    console.error('Tabela access_logs não encontrada. Rode npm run seed antes.')
    database.close()
    process.exit(1)
}

const agent = createAgent({ model: provider.create(MODEL) })
const rl = createInterface({ input, output })

let currentRequest = null
let closed = false

function shutdown() {
    if (closed) return
    closed = true

    currentRequest?.abort()
    rl.close()
    database.close()

    console.log('\nAté logo!')
    process.exit(0)
}

rl.on('SIGINT', shutdown) // CTRL+C
rl.on('close', shutdown) // CTRL+D
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

function runQuery(sql) {
    const rows = []

    // iterate() lê sob demanda: paramos em MAX_ROWS sem carregar o resto
    for (const row of database.prepare(sql).iterate()) {
        if (rows.length === MAX_ROWS) return { rows, truncated: true }
        rows.push(row)
    }

    return { rows, truncated: false }
}

async function handleQuestion(question) {
    currentRequest = new AbortController()
    const abortSignal = currentRequest.signal

    try {
        console.log(styleText('dim', 'Gerando SQL...'))

        const { sql, explanation } = await agent.generateSql({ question, tableSchema, abortSignal })

        if (sql.trim() === '') {
            console.log(`\n${explanation}`)
            return
        }

        const validation = validateSql(sql)

        if (!validation.ok) {
            console.log(styleText('red', `\nSQL bloqueada: ${validation.reason}`))
            console.log(styleText('dim', sql))
            return
        }

        console.log(`\n${styleText('bold', 'SQL sugerida:')}\n${styleText('cyan', validation.sql)}`)
        console.log(`\n${styleText('bold', 'Explicação:')}\n${explanation}\n`)

        const confirmation = (await rl.question('Executar esta consulta? (s/N) ')).trim().toLowerCase()

        if (!['s', 'sim', 'y', 'yes'].includes(confirmation)) {
            console.log('Consulta cancelada.')
            return
        }

        const { rows, truncated } = runQuery(validation.sql)
        console.log(styleText('dim', `${rows.length}${truncated ? '+' : ''} linha(s) retornada(s). Gerando resposta...\n`))

        for await (const delta of agent.streamAnswer({ question, sql: validation.sql, rows, truncated, abortSignal })) {
            output.write(delta)
        }

        output.write('\n')
    } catch (error) {
        console.error(styleText('red', `Erro: ${error.message}`))
    } finally {
        currentRequest = null
    }
}

console.log(styleText('bold', 'Agente de logs de acesso'))
console.log(styleText('dim', `Modelo ${PROVIDER_NAME}/${MODEL}. Faça uma pergunta sobre os acessos, ou digite "sair". CTRL+C encerra.`))

while (true) {
    const question = (await rl.question('\n> ')).trim()

    if (question === '') continue
    if (['sair', 'exit'].includes(question.toLowerCase())) break

    await handleQuestion(question)
}

shutdown()
