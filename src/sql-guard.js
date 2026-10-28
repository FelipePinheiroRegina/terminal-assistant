const BLOCKED_KEYWORDS = [
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'REPLACE',
    'PRAGMA', 'ATTACH', 'DETACH', 'VACUUM', 'REINDEX', 'ANALYZE', 'TRUNCATE',
]

const BLOCKED_PATTERN = new RegExp(`\\b(${BLOCKED_KEYWORDS.join('|')})\\b`, 'i')

// troca o conteúdo de strings ('...') por vazio para que um valor como
// WHERE job_title = 'Update Manager' não seja confundido com comando
function stripStringLiterals(sql) {
    return sql.replace(/'(?:[^']|'')*'/g, "''")
}

export function validateSql(rawSql) {
    let sql = rawSql.trim()

    if (sql.endsWith(';')) sql = sql.slice(0, -1).trimEnd()

    if (sql === '') return { ok: false, reason: 'A SQL está vazia.' }

    const code = stripStringLiterals(sql)

    if (/'/.test(code.replace(/''/g, ''))) {
        return { ok: false, reason: 'A SQL tem uma string sem fechamento.' }
    }

    if (code.includes('--') || code.includes('/*')) {
        return { ok: false, reason: 'Comentários SQL não são permitidos.' }
    }

    if (code.includes(';')) {
        return { ok: false, reason: 'Apenas uma consulta por vez é permitida.' }
    }

    if (!/^(SELECT|WITH)\b/i.test(code)) {
        return { ok: false, reason: 'Apenas consultas SELECT são permitidas.' }
    }

    const blocked = code.match(BLOCKED_PATTERN)

    if (blocked) {
        return { ok: false, reason: `Comando bloqueado: ${blocked[1].toUpperCase()}.` }
    }

    return { ok: true, sql }
}
