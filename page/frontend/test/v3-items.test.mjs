import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// 道具栏（v3/src/items.ts）和推送里的新东西（live.ts）：形状盖住哪几格、火把插在哪个角、
// 岩浆吞的格子、火把颜色变了、整张卡换掉时格子只增不减（docs/V3_ITEMS.md）。
let server
let items
let live
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' })
  items = await server.ssrLoadModule('/v3/src/items.ts')
  live = await server.ssrLoadModule('/v3/src/live.ts')
})
after(() => server.close())

const stats = { digs: 0, players: 0, claimed: 0, claimedPoints: 0 }
function card(size, extra = {}) {
  return { id: 1, x: 0, y: 0, size, cells: Array(size * size).fill(null), left: { emerald: 3, tnt: 1, diamond: 1 }, finished: false, ...extra }
}
function game(cards) {
  return { seq: 0, rules: {}, pool: 1000, left: 1000, deadlineAt: null, wrapUpAt: null, over: false, stats, cards, feed: [] }
}

test('附魔镐：形状挪进卡里，盖住的格子从上到下、从左到右', () => {
  assert.deepEqual(items.clampCenter(5, 0, 0, 'x'), { row: 1, col: 1 })
  assert.deepEqual(items.clampCenter(5, 2, 4, 'h'), { row: 2, col: 3 })
  assert.deepEqual(items.clampCenter(5, 4, 2, 'h'), { row: 4, col: 2 })
  assert.deepEqual(items.shapeCells(5, 12, 'x'), [7, 11, 12, 13, 17])
  assert.deepEqual(items.shapeCells(5, 12, 'v'), [7, 12, 17])
  // 出界的不算
  assert.deepEqual(items.shapeCells(5, 0, 'x'), [0, 1, 5])
})

test('火把：点在格子的哪个四分之一，插在离得最近的角；卡边上的角挪到里面', () => {
  // 第 6 格（第 2 行第 2 列）的左上角：那个角右下的格子就是 6
  assert.equal(items.cornerOf(5, 6, 0, 0), 6)
  assert.equal(items.cornerOf(5, 6, 1, 1), 12)
  // 第 0 格的左上角在卡边上：挪到里面（右下的格子 6）
  assert.equal(items.cornerOf(5, 0, 0, 0), 6)
  assert.equal(items.cornerOf(5, 24, 1, 1), 24)
  assert.deepEqual(items.cornerCells(5, 6), [0, 1, 5, 6])
})

test('能不能挖：装饰、宝库、岩浆、开了的、卡关了都不能', () => {
  const c = card(5, { fixed: { 0: 'deco', 1: 'vault', 2: 'lava' } })
  c.cells[3] = { kind: 'emerald', uid: 1, name: 'a', at: 1 }
  assert.deepEqual([0, 1, 2, 3, 4].map(index => items.diggable(c, index)), [false, false, false, false, true])
  assert.equal(items.diggable({ ...c, closed: true }, 4), false)
})

test('工具条：主动的按顺序，被动的在后面；镐子和附魔镐都用完才算挖不动', () => {
  const me = {
    chances: 0, shield: true, shields: 2, spyglasses: 1, peeks: [], points: 10, digs: 3, status: 'playing', lastResult: null,
    items: { torch: 1, map: 0, potion: 1, ender: 0, table: 0, key: 2, pick: { h: 0, v: 2, x: 0 } }, coal: 1, stick: 0, poison: 3,
  }
  assert.deepEqual(items.slotsOf(me, true), { active: ['pick-v', 'spyglass', 'torch', 'key', 'potion'], passive: ['shield', 'coal', 'poison'] })
  assert.equal(items.countOf(me, 'pick-v'), 2)
  assert.equal(items.countOf(me, 'key'), 2)
  assert.equal(items.outOfPicks(me), false)
  assert.equal(items.outOfPicks({ ...me, items: { ...me.items, pick: { h: 0, v: 0, x: 0 } } }), true)
})

test('推送：岩浆吞掉的格子翻开、火把换颜色、噪音只增不减，装饰不算没挖完', () => {
  const before = card(2, { kind: 'nether', fixed: { 3: 'lava' }, torches: [{ at: 3, level: 1, name: 'a' }], left: { emerald: 1, diamond: 1, lava: 0 } })
  const step = {
    type: 'cell', seq: 1, cardId: 1, index: 0, cell: { kind: 'emerald', uid: 7, name: 'b', at: 5 }, newCard: null, text: '', left: 990, over: false, stats,
    burned: [{ index: 1, kind: 'diamond' }], torches: [{ at: 3, level: 0, name: 'a' }],
  }
  const merged = live.mergeLive(game([before]), new Map(), [step])
  const after = merged.game.cards[0]
  assert.equal(after.cells[1].burn, 1)
  assert.equal(after.cells[1].kind, 'diamond')
  assert.equal(after.torches[0].level, 0)
  assert.equal(after.left.diamond, 0)
  assert.equal(after.finished, false)
  assert.deepEqual(merged.opened.map(cell => cell.index), [0, 1])
  // 最后一格挖开：装饰（岩浆）不算，卡挖完了
  const last = live.mergeLive(merged.game, new Map(), [{ ...step, seq: 2, index: 2, burned: undefined, torches: undefined }])
  assert.equal(last.game.cards[0].finished, true)
})

test('整张卡（火把插上、宝库开了）：格子只增不减，火把和宝库用新的', () => {
  const mine = card(2)
  mine.cells[0] = { kind: 'emerald', uid: 1, name: 'a', at: 1 }
  const pushed = card(2, { torches: [{ at: 3, level: 2, name: 'b' }], vaults: { 1: 3 } })
  const merged = live.mergeLive(game([mine]), new Map(), [{ type: 'card', card: pushed }])
  const after = merged.game.cards[0]
  assert.equal(after.cells[0].kind, 'emerald')
  assert.deepEqual(after.torches, [{ at: 3, level: 2, name: 'b' }])
  assert.deepEqual(after.vaults, { 1: 3 })
  assert.equal(merged.game.seq, 0)
})

test('监守者醒了：卡关了就算挖完', () => {
  const deep = card(2, { kind: 'deep', noise: 2 })
  const step = { type: 'cell', seq: 1, cardId: 1, index: 0, cell: { kind: 'emerald', uid: 7, name: 'b', at: 5 }, newCard: null, text: '', left: 990, over: false, stats, noise: 3, closed: true }
  const after = live.mergeLive(game([deep]), new Map(), [step]).game.cards[0]
  assert.equal(after.closed, true)
  assert.equal(after.noise, 3)
  assert.equal(after.finished, true)
})
