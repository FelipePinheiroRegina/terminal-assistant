import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
    options: {
        input: { type: 'string', short: 'i', default: 'access_log.log' },
        database: { type: 'string', short: 'd', default: 'database.db' },
    },
})

const PROGRESS_INTERVAL = 100_000 // exibe progresso a cada N linhas lidas
const TRANSACTION_SIZE = 10_000 // inserts por transação, um commit por insert seria lento demais

const database = new DatabaseSync(values.database)

database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS access_logs (
        ip TEXT NOT NULL,
        username TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL,
        location TEXT NOT NULL,
        job_area TEXT NOT NULL,
        company TEXT NOT NULL,
        job_title TEXT NOT NULL,
        id TEXT PRIMARY KEY,
        timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
`)

// OR IGNORE: rodar o seed de novo não quebra no id duplicado
const insertAccessLog = database.prepare(`
    INSERT OR IGNORE INTO access_logs (
        ip, username, first_name, last_name, email, location,
        job_area, company, job_title, id, timestamp
    ) VALUES (
        :ip, :username, :first_name, :last_name, :email, :location,
        :job_area, :company, :job_title, :id, :timestamp
    )
`)

const FIELDS = [
    'ip', 'username', 'first_name', 'last_name', 'email', 'location',
    'job_area', 'company', 'job_title', 'id', 'timestamp',
]

const stats = { read: 0, inserted: 0, duplicated: 0, empty: 0, invalid: 0 }
let pendingInTransaction = 0

// devolve só os campos da tabela, ou null se a linha não for um registro válido
function parseLine(line) {
    let record

    try {
        record = JSON.parse(line)
    } catch {
        return null
    }

    if (record === null || typeof record !== 'object') return null

    const params = {}

    for (const field of FIELDS) {
        if (typeof record[field] !== 'string' || record[field] === '') return null
        params[field] = record[field]
    }

    return params
}

console.time('Tempo total')

const lines = createInterface({
    input: createReadStream(values.input, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
})

try {
    database.exec('BEGIN')

    for await (const line of lines) {
        stats.read++

        if (stats.read % PROGRESS_INTERVAL === 0) {
            console.log(`${stats.read.toLocaleString('pt-BR')} linhas lidas, ${stats.inserted.toLocaleString('pt-BR')} inseridas`)
        }

        if (line.trim() === '') {
            stats.empty++
            continue
        }

        const record = parseLine(line)

        if (!record) {
            stats.invalid++
            continue
        }

        const { changes } = insertAccessLog.run(record)

        if (changes === 0) stats.duplicated++
        else stats.inserted++

        if (++pendingInTransaction === TRANSACTION_SIZE) {
            database.exec('COMMIT; BEGIN')
            pendingInTransaction = 0
        }
    }

    database.exec('COMMIT')

    // criados depois da carga, que é mais rápido que manter os índices a cada insert;
    // ORDER BY timestamp e GROUP BY nessas colunas deixam de varrer a tabela inteira
    console.log('\nCriando índices...')
    database.exec(`
        CREATE INDEX IF NOT EXISTS idx_access_logs_timestamp ON access_logs (timestamp);
        CREATE INDEX IF NOT EXISTS idx_access_logs_company ON access_logs (company);
        CREATE INDEX IF NOT EXISTS idx_access_logs_job_title ON access_logs (job_title);
        CREATE INDEX IF NOT EXISTS idx_access_logs_job_area ON access_logs (job_area);
        CREATE INDEX IF NOT EXISTS idx_access_logs_location ON access_logs (location);
        ANALYZE access_logs;
    `)
} catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK')
    throw error
} finally {
    lines.close()
    database.close()
}

console.log(`\nLidas: ${stats.read.toLocaleString('pt-BR')}`)
console.log(`Inseridas: ${stats.inserted.toLocaleString('pt-BR')}`)
console.log(`Duplicadas ignoradas: ${stats.duplicated.toLocaleString('pt-BR')}`)
console.log(`Vazias ignoradas: ${stats.empty.toLocaleString('pt-BR')}`)
console.log(`Inválidas ignoradas: ${stats.invalid.toLocaleString('pt-BR')}`)
console.timeEnd('Tempo total')
