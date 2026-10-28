import { createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { parseArgs } from 'node:util'
import { faker } from '@faker-js/faker'

const { values } = parseArgs({
    options: {
        output: { type: 'string', short: 'o', default: 'access_log.log' },
        size: { type: 'string', short: 's', default: '1024' }, // em MB
    },
})

const TARGET_BYTES = Number(values.size) * 1024 ** 2
const BATCH_SIZE = 1_000 // linhas por chunk, evita um write por linha

function createAccessLog() {
    const firstName = faker.person.firstName()
    const lastName = faker.person.lastName()

    return {
        ip: faker.internet.ipv4(),
        username: faker.internet.username({ firstName, lastName }),
        first_name: firstName,
        last_name: lastName,
        email: faker.internet.email({ firstName, lastName }),
        location: faker.location.city(),
        job_area: faker.person.jobArea(),
        company: faker.company.name(),
        job_title: faker.person.jobTitle(),
        id: faker.string.uuid(),
        timestamp: faker.date.recent({ days: 30 }).toISOString(),
    }
}

let totalLines = 0

async function* generateAccessLogs(targetBytes) {
    let generatedBytes = 0

    while (generatedBytes < targetBytes) {
        let chunk = ''

        for (let i = 0; i < BATCH_SIZE; i++) {
            chunk += JSON.stringify(createAccessLog()) + '\n'
        }

        generatedBytes += Buffer.byteLength(chunk)
        totalLines += BATCH_SIZE

        const progress = Math.min(generatedBytes / targetBytes, 1) * 100
        process.stdout.write(`\rGerando... ${progress.toFixed(1)}%`)

        // o pipeline só pede o próximo chunk quando o arquivo drena (backpressure)
        yield chunk
    }
}

console.time('Tempo total')

await pipeline(
    Readable.from(generateAccessLogs(TARGET_BYTES)),
    createWriteStream(values.output, { encoding: 'utf-8' }),
)

const { size } = await stat(values.output)

console.log(`\n${totalLines.toLocaleString('pt-BR')} linhas, ${(size / 1024 ** 2).toFixed(2)} MB em ${values.output}`)
console.timeEnd('Tempo total')

