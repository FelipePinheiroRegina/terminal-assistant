import { generateText, Output, streamText } from 'ai'
import { z } from 'zod'

const sqlResponseSchema = z.object({
    sql: z.string().describe('Uma única consulta SELECT do SQLite, ou string vazia se a pergunta não puder ser respondida com o banco'),
    explanation: z.string().describe('Explicação curta, em português, do que a consulta faz'),
})

function sqlInstructions(tableSchema) {
    return `Você converte perguntas em português para SQL do SQLite.

Esquema do banco:
${tableSchema}

Sobre os dados:
- Cada linha é um acesso de um usuário.
- location é o nome de uma cidade.
- timestamp é texto ISO 8601 (ex.: 2026-06-15T10:00:00.000Z), então ORDER BY timestamp ordena por data.
- A tabela tem milhões de linhas.

Regras obrigatórias:
- Gere apenas UMA consulta SELECT (CTE com WITH é permitido).
- Nunca gere INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, REPLACE, PRAGMA, ATTACH, DETACH ou VACUUM.
- Não inclua comentários SQL nem ponto e vírgula.
- Use somente a tabela access_logs e as colunas do esquema.
- Quando a consulta listar linhas (sem agregação), use LIMIT de no máximo 50.
- Se a pergunta não tiver relação com o banco, devolva sql vazio e explique o motivo em explanation.`
}

export function createAgent({ model, providerOptions }) {
    async function generateSql({ question, tableSchema, abortSignal }) {
        const { output } = await generateText({
            model,
            instructions: sqlInstructions(tableSchema),
            prompt: question,
            output: Output.object({ schema: sqlResponseSchema }),
            providerOptions,
            abortSignal,
        })

        return output
    }

    async function* streamAnswer({ question, sql, rows, truncated, abortSignal }) {
        let streamError

        const { textStream } = streamText({
            model,
            instructions: `Você responde perguntas sobre logs de acesso usando apenas os dados fornecidos.
Responda em português, de forma direta e curta. Não invente dados que não estejam no resultado.
Se o resultado estiver vazio, diga que nenhum registro foi encontrado.`,
            prompt: `Pergunta: ${question}

SQL executada: ${sql}

Resultado (${rows.length} linhas${truncated ? ', truncado; existem mais linhas' : ''}):
${JSON.stringify(rows)}`,
            providerOptions,
            abortSignal,
            onError: ({ error }) => { streamError = error },
        })

        yield* textStream

        if (streamError) throw streamError
    }

    return { generateSql, streamAnswer }
}
