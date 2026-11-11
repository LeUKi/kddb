import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// 道具栏（v3/src/items.ts）和推送里的新东西（live.ts）：形状盖住哪几格、火把插在哪个角、
// 岩浆吞的格子、火把颜色变了、整张卡换掉时格子只增不减（docs/V3_ITEMS.md）。
let server
let items
let live
let chart
let regions
let mcfont
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' })
  items = await server.ssrLoadModule('/v3/src/items.ts')
  live = await server.ssrLoadModule('/v3/src/live.ts')
  chart = await server.ssrLoadModule('/v3/src/chart.ts')
  regions = await server.ssrLoadModule('/v3/src/regions.ts')
  mcfont = await server.ssrLoadModule('/v3/src/mcfont.ts')
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
  // 中毒不在工具条上（画成身上的效果，Effects.tsx）
  assert.deepEqual(items.slotsOf(me, true), { active: ['pick-v', 'spyglass', 'torch', 'key', 'potion'], passive: ['shield', 'coal'] })
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

test('整局补回来时：开的格子没变，但火把、宝库变了，也换成新的那一份（card 推送漏了靠这个补）', () => {
  const mine = card(2, { vaults: { 1: 4 } })
  const fresh = card(2, { vaults: { 1: 3 }, torches: [{ at: 3, level: 0, name: 'b' }] })
  const merged = live.mergeState(game([mine]), { ...game([fresh]), seq: 1 }, new Map())
  assert.deepEqual(merged.game.cards[0].vaults, { 1: 3 })
  assert.equal(merged.game.cards[0].torches.length, 1)
  // 什么都没变：沿用手上那一份（同一个对象，卡不重画）
  const same = live.mergeState(game([mine]), { ...game([card(2, { vaults: { 1: 4 } })]), seq: 1 }, new Map())
  assert.equal(same.game.cards[0], mine)
})

test('格子推送带着宝库还能开几次：跟着改', () => {
  const trial = card(2, { kind: 'trial', fixed: { 1: 'vault' }, vaults: { 1: 4 } })
  const step = { type: 'cell', seq: 1, cardId: 1, index: 0, cell: { kind: 'emerald', uid: 7, name: 'b', at: 5 }, newCard: null, text: '', left: 990, over: false, stats, vaults: { 1: 2 } }
  assert.deepEqual(live.mergeLive(game([trial]), new Map(), [step]).game.cards[0].vaults, { 1: 2 })
})

test('收益图：第几格只数挖的，中毒、末影箱、宝库这些不算', () => {
  const trail = [
    { k: 'emerald', a: 10, p: 10 }, { k: 'poison', a: -1, p: 9 }, { k: 'ender', a: -4, p: 5 }, { k: 'diamond', a: 50, p: 55 },
  ]
  const marker = chart.chartOf(trail).markers.find(item => item.kind === 'diamond')
  assert.equal(marker.dig, 2)
  assert.match(chart.markerWords(marker, value => String(value)), /^第 2 次挖：钻石/)
})

test('手里还有附魔台就不算挖不动（换得到附魔镐）', () => {
  const me = { chances: 0, shield: false, peeks: [], points: 0, digs: 3, status: 'playing', lastResult: null, items: { torch: 0, map: 0, potion: 0, ender: 0, table: 1, key: 0, pick: { h: 0, v: 0, x: 0 } } }
  assert.equal(items.outOfPicks(me), false)
  assert.equal(items.outOfPicks({ ...me, items: { ...me.items, table: 0 } }), true)
})

test('宝库：卡挖完了照样能开（关了的不行）', () => {
  assert.equal(items.vaultsLeft(card(2, { finished: true, vaults: { 1: 1 } })), true)
  assert.equal(items.vaultsLeft(card(2, { finished: true, vaults: { 1: 0 } })), false)
  assert.equal(items.vaultsLeft(card(2, { closed: true, vaults: { 1: 2 } })), false)
})


test('第 2 版：煤炭、木棍排在火把后面；火把照 3×3（出界的不算），只插挖开的格子', () => {
  const me = {
    chances: 3, shield: false, shields: 0, spyglasses: 1, peeks: [], points: 10, digs: 3, status: 'playing', lastResult: null,
    items: { torch: 1, map: 0, potion: 1, ender: 0, table: 0, key: 2, pick: { h: 0, v: 0, x: 0 } }, coal: 3, stick: 0, poison: 2,
  }
  assert.deepEqual(items.slotsOf(me, true, 2), { active: ['spyglass', 'torch', 'coal', 'key', 'potion'], passive: [] })
  assert.deepEqual(items.torchArea(5, 0), [0, 1, 5, 6])
  assert.deepEqual(items.torchArea(5, 12), [6, 7, 8, 11, 12, 13, 16, 17, 18])
  const c = card(5, { fixed: { 1: 'lava' } })
  c.cells[0] = { kind: 'emerald', uid: 1, name: 'a', at: 1 }
  c.cells[2] = { kind: 'diamond', uid: 0, name: '', at: 1, burn: 1 }
  assert.deepEqual([0, 1, 2, 3].map(index => items.dugCell(c, index)), [true, false, false, false])
  assert.equal(items.aimWhat('torch', 2), '点一个挖开的格子，照亮周围 9 格')
  assert.equal(items.aimTarget('torch', 1), '角')
  const about = items.aboutSlot('coal', me, true, 1, null, 2)
  assert.deepEqual(about.count, '3 个')
})

test('卡周围的说明：余量报还藏着多少钱、有哪几样宝贝，挖得差不多了指去最富的那张；深暗之域的危险区是格子数的 45%–75%', () => {
  const rules = { smallReward: 10, bigMultiplier: 5 }
  // 9 绿宝石 + 3 钻石 ×5 + 1 箱子矿车 ×1.5 = 25.5 份小奖 → 255（2.55），宝贝按先后最多 4 样
  const plain = { id: 1, left: { emerald: 9, diamond: 3, apple: 0, tnt: 6, pearl: 1, minecart: 1, shield: 2, coal: 3 }, finished: false }
  const out = regions.leftoversOf(plain, rules, 10000)
  assert.deepEqual(out, { worth: 255, kinds: ['diamond', 'pearl', 'minecart', 'emerald'], poor: false })
  assert.equal(regions.worthOf(plain, rules, 100), 100, '不超过奖池剩下的')
  assert.deepEqual([255, 1000, 85, 5, 0].map(regions.aboutMoney), ['2.6', '10.0', '0.85', '0.05', '0.00'])
  // 只剩一颗绿宝石：挖得差不多了；挖完、关了的也算
  assert.equal(regions.leftoversOf({ left: { emerald: 1, tnt: 2 }, finished: false }, rules, 10000).poor, true)
  assert.equal(regions.leftoversOf({ left: { diamond: 2 }, finished: true }, rules, 10000).poor, true)
  const cards = [
    { ...plain, id: 1 },
    { id: 2, left: { emerald: 1 }, finished: false },
    { id: 3, left: { debris: 3, diamond: 1 }, finished: false },
    { id: 4, left: { debris: 9 }, finished: false, closed: true },
    { id: 5, left: { emerald: 10 }, finished: false },
  ]
  assert.deepEqual(regions.richestOf(cards, rules, 10000, 2), { card: cards[2], worth: 350 })
  assert.equal(regions.richestOf(cards, rules, 10000, 3).card.id, 1)
  assert.equal(regions.richestOf([cards[1]], rules, 10000, 2), null)
  // 和最富的（350）比：255 是 2/3 以上 → 3 档，100 是 1/3 以下 → 1 档；不够 2 份小奖的、关了的不亮
  assert.deepEqual([...regions.richnessOf(cards, rules, 10000)], [[1, 3], [3, 3], [5, 1]])
  assert.deepEqual([...regions.richnessOf(cards.slice(0, 2), rules, 10000)], [[1, 3]])
  const deep = { cells: Array(49).fill(null), fixed: {}, noise: 18, closed: false }
  assert.deepEqual(regions.noiseOf(deep), { noise: 18, low: 23, high: 36, cells: 49, danger: false, closed: false, toDanger: 5 })
  assert.equal(regions.noiseOf({ ...deep, noise: 23 }).danger, true)
  assert.equal(regions.regionName({ id: 7 }), '第 7 张卡')
  assert.equal(regions.regionName({ id: 7, kind: 'deep' }), '深暗之域')
  assert.match(regions.regionAbout({ kind: 'mine' }, { items: 2, tntPercent: 25 })[0], /多等 10 秒/)
})

/** 读 font/ascii.png 的不透明度（1 位调色板的 PNG，0 号色透明）：测试里不用画布也能量字宽。 */
function asciiAlpha() {
  const data = readFileSync(fileURLToPath(new URL('../public/assets/minecraft/1.21.4/textures/font/ascii.png', import.meta.url)))
  let at = 8
  let width = 0
  const parts = []
  while (at < data.length) {
    const length = data.readUInt32BE(at)
    const type = data.toString('latin1', at + 4, at + 8)
    const body = data.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      assert.deepEqual([body[8], body[9], body[12]], [1, 3, 0], '1 位调色板、不隔行')
    }
    if (type === 'IDAT') parts.push(body)
    at += 12 + length
  }
  const raw = inflateSync(Buffer.concat(parts))
  const stride = Math.ceil(width / 8)
  const rows = []
  let previous = Buffer.alloc(stride)
  for (let y = 0; y * (stride + 1) < raw.length; y++) {
    const filter = raw[y * (stride + 1)]
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let x = 0; x < stride; x++) {
      const left = x ? line[x - 1] : 0
      const up = previous[x]
      const corner = x ? previous[x - 1] : 0
      const paeth = () => {
        const p = left + up - corner
        const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)]
        return a <= b && a <= c ? left : b <= c ? up : corner
      }
      line[x] = (line[x] + [0, left, up, (left + up) >> 1, paeth()][filter]) & 255
    }
    rows.push(line)
    previous = line
  }
  return (x, y) => ((rows[y][x >> 3] >> (7 - (x & 7))) & 1 ? 255 : 0)
}

test('原版乱码：字宽从字图量出来，乱码只换成同样宽的字，阴影是颜色的四分之一', () => {
  const font = mcfont.measureFont(asciiAlpha())
  // 数字都是 5 像素宽（乱码里的个数不会忽长忽短），i 是 1，空格算 3
  assert.deepEqual([...'0123456789'].map(ch => font.glyphs.get(ch).w), Array(10).fill(5))
  assert.deepEqual(['i', 'l', ' ', 'W'].map(ch => font.glyphs.get(ch).w), [1, 2, 3, 5])
  assert.equal(mcfont.textWidth(font, '12'), 12)
  assert.ok(font.byWidth.get(5).length > 40, '5 像素宽的字够多，乱码看着在跳')
  for (let n = 0; n < 50; n++) {
    const shown = mcfont.obfuscated(font, '7', Math.random)
    assert.equal(shown.w, 5)
  }
  assert.equal(mcfont.obfuscated(font, ' ', () => 0.5), font.glyphs.get(' '))
  assert.equal(mcfont.shadowOf('#ffaa00'), '#3f2a00')
  assert.equal(mcfont.shadowOf('#ffffff'), '#3f3f3f')
})

test('工具条两头的箭头：只按格子排出来的长度算，放得下就没有；差 4 像素以内不算', () => {
  // 收起的那一格浮起来、把 scrollWidth 撑到 121 的那一刻：按排版只有 48，没有箭头
  assert.deepEqual(items.edgesOf(0, 48, 48), { start: false, end: false })
  assert.deepEqual(items.edgesOf(0, 51, 48), { start: false, end: false })
  assert.deepEqual(items.edgesOf(0, 300, 200), { start: false, end: true })
  assert.deepEqual(items.edgesOf(50, 300, 200), { start: true, end: true })
  assert.deepEqual(items.edgesOf(98, 300, 200), { start: true, end: false })
  // 滚过了头（浮起来的格子撑出来的地方）也不会两头都亮
  assert.deepEqual(items.edgesOf(60, 48, 48), { start: false, end: false })
})

test('火把一直在工具条上：没有时是 0，点开说怎么做出来（2026-11-11 用户转述的反馈）', () => {
  const me = {
    chances: 3, shield: false, shields: 0, spyglasses: 0, peeks: [], points: 0, digs: 1, status: 'playing', lastResult: null,
    items: { torch: 0, map: 0, potion: 0, ender: 0, table: 0, key: 0, pick: { h: 0, v: 0, x: 0 } }, coal: 1, stick: 0,
  }
  assert.deepEqual(items.slotsOf(me, true, 2), { active: ['torch', 'coal'], passive: [] })
  assert.equal(items.countOf(me, 'torch'), 0)
  const about = items.aboutSlot('torch', me, true, 1, null, 2)
  assert.equal(about.count, '还没有')
  assert.match(about.words, /^还没有火把：煤炭、木棍各挖到一个，就自动做成一个。插在一个挖开的格子上/)
  assert.match(items.aboutSlot('torch', { ...me, items: { ...me.items, torch: 2 } }, true, 1, null, 2).words, /^插在一个挖开的格子上/)
  // 没有道具栏的局没有火把
  assert.deepEqual(items.slotsOf({ ...me, items: undefined, coal: 0 }, false), { active: [], passive: [] })
})
