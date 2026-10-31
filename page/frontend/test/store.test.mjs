import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

let server
let gameStore
let sdk
let submissions
const previousWindow = globalThis.window

before(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'silent',
  })
  gameStore = await server.ssrLoadModule('/src/store.ts')
})

after(async () => {
  gameStore?.disconnect()
  await server?.close()
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
})

beforeEach(() => {
  submissions = []
  sdk = {
    submit: async input => { submissions.push(input); return { judged: false, reason: 'unconfirmed' } },
    mine: async () => ({ items: [{ input: 'dig 1 1', reply: '挖到了钻石大奖' }] }),
    me: async () => ({ signedIn: true, name: '小明', open: true, settled: false, pending: '0.50', claim: null }),
    myView: async () => ({ data: { version: 1, actorKey: 'u:1', chances: 6, shield: false, peeks: [], digs: 1, status: 'playing', lastResult: null } }),
    view: async () => null,
    now: () => 1000,
  }
  globalThis.window = { hb: sdk }
  const { store } = gameStore
  store.set(gameStore.connectionAtom, 'ready')
  store.set(gameStore.pendingActionAtom, null)
  store.set(gameStore.unconfirmedInputAtom, null)
  store.set(gameStore.checkingResultAtom, false)
  store.set(gameStore.settlementAtom, null)
  store.set(gameStore.hongbaoAtom, { unit: 'LDC' })
  store.set(gameStore.toastAtom, null)
})

test('an unconfirmed submit queries records and never resubmits', async () => {
  await gameStore.submit('dig 1 1')
  assert.deepEqual(submissions, ['dig 1 1'])
  assert.equal(gameStore.store.get(gameStore.unconfirmedInputAtom), null)
  assert.equal(gameStore.store.get(gameStore.privateAtom).chances, 6)
  assert.match(gameStore.store.get(gameStore.toastAtom).text, /钻石大奖/)
})

test('failed record queries keep all further money actions locked', async () => {
  sdk.mine = async () => { throw new Error('offline') }
  await gameStore.submit('dig 1 1')
  await gameStore.submit('dig 1 2')
  await gameStore.submit('cashout')
  assert.deepEqual(submissions, ['dig 1 1'])
  assert.equal(gameStore.store.get(gameStore.unconfirmedInputAtom), 'dig 1 1')
  assert.equal(gameStore.store.get(gameStore.pendingActionAtom), null)
  assert.equal(gameStore.store.get(gameStore.checkingResultAtom), false)
})

test('manual recovery only queries state and permits one recovery at a time', async () => {
  gameStore.store.set(gameStore.unconfirmedInputAtom, 'dig 1 1')
  let finishQuery
  let queries = 0
  sdk.mine = () => { queries++; return new Promise(resolve => { finishQuery = resolve }) }
  const recovery = gameStore.confirmSubmission()
  await gameStore.confirmSubmission()
  assert.equal(queries, 1)
  assert.equal(gameStore.store.get(gameStore.checkingResultAtom), true)
  finishQuery({ items: [] })
  await recovery
  assert.deepEqual(submissions, [])
  assert.equal(gameStore.store.get(gameStore.unconfirmedInputAtom), null)
  assert.equal(gameStore.store.get(gameStore.meAtom).pending, '0.50')
})

test('a transport exception recovers from records without repeating the action', async () => {
  sdk.submit = async input => { submissions.push(input); throw new Error('response lost') }
  await gameStore.submit('dig 1 1')
  assert.deepEqual(submissions, ['dig 1 1'])
  assert.equal(gameStore.store.get(gameStore.unconfirmedInputAtom), null)
  assert.match(gameStore.store.get(gameStore.toastAtom).text, /已刷新最近记录/)
})

test('a zero settlement is shown even when claimed is false', async () => {
  sdk.submit = async input => { submissions.push(input); return { judged: true, settled: true, claimed: false, reply: '已收手' } }
  sdk.me = async () => ({ signedIn: true, name: '小明', open: false, settled: true, pending: '0.00', claim: null })
  await gameStore.submit('cashout')
  assert.deepEqual(gameStore.store.get(gameStore.settlementAtom), { amount: '0.00', unit: 'LDC' })
  assert.equal(gameStore.store.get(gameStore.unconfirmedInputAtom), null)
})

test('recovered zero cashout opens settlement from confirmed own state', async () => {
  gameStore.store.set(gameStore.meAtom, { signedIn: true, name: '小明', settled: false, pending: '0.00' })
  sdk.mine = async () => ({ items: [{ input: 'cashout', reply: '已收手' }] })
  sdk.me = async () => ({ signedIn: true, name: '小明', open: false, settled: true, pending: '0.00', claim: null })
  await gameStore.submit('cashout')
  assert.deepEqual(gameStore.store.get(gameStore.settlementAtom), { amount: '0.00', unit: 'LDC' })
  assert.equal(gameStore.store.get(gameStore.unconfirmedInputAtom), null)
  assert.deepEqual(submissions, ['cashout'])
})

test('a refresh started before disconnect cannot overwrite the next connection', async () => {
  let finishOld
  sdk.me = () => new Promise(resolve => { finishOld = resolve })
  const stale = gameStore.refreshOwn()
  gameStore.disconnect()
  const currentMe = { signedIn: true, name: '小红', settled: false, pending: '0.80' }
  gameStore.store.set(gameStore.meAtom, currentMe)
  finishOld({ signedIn: true, name: '小明', settled: false, pending: '0.10' })
  await stale
  assert.deepEqual(gameStore.store.get(gameStore.meAtom), currentMe)
})

test('platform settlement events open one result and do not reopen after dismissal', async () => {
  const listeners = new Map()
  let remoteMe = { signedIn: true, name: '小明', open: true, settled: false, pending: '0.50', claim: null }
  sdk.ready = async () => ({ hongbao: { unit: 'LDC' } })
  sdk.on = (kind, listener) => { listeners.set(kind, listener); return () => listeners.delete(kind) }
  sdk.me = async () => remoteMe
  sdk.view = async () => ({ data: {
    version: 1, cardId: 1,
    cells: Array.from({ length: 25 }, (_, index) => ({ index, kind: null, by: null, at: null })),
    counts: { emerald: 10, diamond: 3, apple: 1, totem: 2, tnt: 4, pearl: 2, shield: 2, spyglass: 1 },
    rules: { initialChances: 7, waitSeconds: 10, smallReward: 10, bigMultiplier: 5, totemBonus: 2, tntPercent: 25 },
    lastMove: null, stats: { digs: 0, players: 0 }, feed: [],
  } })
  await gameStore.connect()
  assert.equal(gameStore.store.get(gameStore.settlementAtom), null)
  remoteMe = { ...remoteMe, open: false, pending: '0.00', settled: true, claim: { amount: '0.50', unit: 'LDC', payment: 'paid' } }
  listeners.get('me')(remoteMe)
  await Promise.resolve()
  assert.deepEqual(gameStore.store.get(gameStore.settlementAtom), { amount: '0.50', unit: 'LDC' })
  gameStore.store.set(gameStore.settlementAtom, null)
  listeners.get('me')(remoteMe)
  await Promise.resolve()
  assert.equal(gameStore.store.get(gameStore.settlementAtom), null)
  gameStore.disconnect()
})
