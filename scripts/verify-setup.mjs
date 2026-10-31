// The platform JSON test runner skips setup; verify it in the official sandbox.
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { openSandbox } from '../cli/lib/sandbox.mjs'
import { setupSeed } from '../runtime/seeds.mjs'

const sandbox = await openSandbox(await readFile(new URL('../judge.js', import.meta.url), 'utf8'))
const params = { initialChances: 7, waitSeconds: 10, smallReward: 10, tntPercent: 25 }
// count/minEach are official runtime compatibility fields, not game share limits.
const pool = { title: 'setup verification', total: 10000, count: 100, minEach: 1 }
const now = Date.parse('2026-10-31T12:00:00+08:00')
const composition = { emerald: 10, diamond: 3, apple: 1, totem: 2, tnt: 4, pearl: 2, shield: 2, spyglass: 1 }
let checks = 0

try {
  assert.deepEqual(sandbox.declarations.problems, []); checks++
  const seedA = setupSeed('review', 'a'.repeat(64))
  const seedB = setupSeed('review', 'b'.repeat(64))
  const first = await sandbox.setup(params, pool, { now, seed: seedA })
  const again = await sandbox.setup(params, pool, { now, seed: seedA })
  const different = await sandbox.setup(params, pool, { now, seed: seedB })

  assert.ok(first && !first.failure, JSON.stringify(first)); checks++
  assert.deepEqual(first, again); checks++
  const state = first.state.value
  const view = first.view.value.data
  assert.notDeepEqual(state.deck, different.state.value.deck); checks++
  assert.deepEqual(Object.fromEntries(Object.keys(composition).map(kind => [kind, state.deck.filter(value => value === kind).length])), composition); checks++
  assert.equal(state.opened.length, 25); checks++
  assert.ok(view.cells.every(cell => cell.kind === null)); checks++
  assert.ok(!('deck' in view)); checks++
  assert.deepEqual(view.counts, composition); checks++
  assert.equal(view.rules.totemBonus, 3); checks++

  const valid = await sandbox.check(params, { ...pool, total: 50 })
  const invalid = await sandbox.check(params, { ...pool, total: 49 })
  assert.deepEqual(valid.problems, []); checks++
  assert.equal(invalid.problems[0].key, 'smallReward'); checks++
  const large = await sandbox.check({ ...params, smallReward: Math.floor(Number.MAX_SAFE_INTEGER / 5) }, { ...pool, total: Number.MAX_SAFE_INTEGER })
  assert.deepEqual(large.problems, []); checks++

  console.log(JSON.stringify({ checks, setupStateBytes: Buffer.byteLength(JSON.stringify(state)), publicDataBytes: Buffer.byteLength(JSON.stringify(view)), setupReproducible: true, setupSeedDependent: true, crossFieldCheck: true }))
} finally {
  await sandbox.close()
}
