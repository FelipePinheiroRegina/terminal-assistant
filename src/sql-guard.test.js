import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateSql } from './sql-guard.js'

describe('validateSql', () => {
    it('aceita SELECT simples e remove o ; final', () => {
        assert.deepEqual(validateSql('SELECT COUNT(*) FROM access_logs;'), {
            ok: true,
            sql: 'SELECT COUNT(*) FROM access_logs',
        })
    })

    it('aceita CTE com WITH', () => {
        const result = validateSql('WITH t AS (SELECT company FROM access_logs) SELECT * FROM t')
        assert.equal(result.ok, true)
    })

    it('aceita palavra bloqueada dentro de string', () => {
        const result = validateSql("SELECT * FROM access_logs WHERE job_title = 'Update Manager'")
        assert.equal(result.ok, true)
    })

    for (const sql of [
        'INSERT INTO access_logs (id) VALUES (1)',
        "UPDATE access_logs SET ip = 'x'",
        'DELETE FROM access_logs',
        'DROP TABLE access_logs',
        'ALTER TABLE access_logs ADD COLUMN x',
        'CREATE TABLE x (a)',
        "REPLACE INTO access_logs (id) VALUES ('1')",
        'PRAGMA table_info(access_logs)',
        "ATTACH DATABASE 'x.db' AS x",
        'DETACH DATABASE x',
        'VACUUM',
    ]) {
        it(`bloqueia: ${sql}`, () => {
            assert.equal(validateSql(sql).ok, false)
        })
    }

    it('bloqueia comando escondido depois de um SELECT', () => {
        assert.equal(validateSql('SELECT 1; DROP TABLE access_logs').ok, false)
    })

    it('bloqueia comando dentro de subconsulta', () => {
        assert.equal(validateSql('SELECT * FROM (DELETE FROM access_logs RETURNING *)').ok, false)
    })

    it('bloqueia comentários', () => {
        assert.equal(validateSql('SELECT 1 -- comentário').ok, false)
        assert.equal(validateSql('SELECT /* x */ 1').ok, false)
    })

    it('bloqueia string sem fechamento', () => {
        assert.equal(validateSql("SELECT 'abc").ok, false)
    })

    it('bloqueia SQL vazia', () => {
        assert.equal(validateSql('  ;').ok, false)
    })
})
