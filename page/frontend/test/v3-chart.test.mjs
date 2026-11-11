import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// 收益卡的曲线（v3/src/chart.ts）和自己挖到东西时放哪个音效（v3/src/sound.ts）。
let server
let chart
let sound
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' })
  chart = await server.ssrLoadModule('/v3/src/chart.ts')
  sound = await server.ssrLoadModule('/v3/src/sound.ts')
})
after(async () => { await server?.close() })

const box = { width: 100, height: 60, padX: 0, padTop: 10, padBottom: 0 }

test('从 0 分起，最高的点在最上面，最后一格是手里的分', () => {
  const trail = [{ k: 'emerald', a: 10, p: 10 }, { k: 'diamond', a: 50, p: 60 }, { k: 'tnt', a: -30, p: 30 }]
  const out = chart.chartOf(trail, box)
  assert.equal(out.line, 'M0,60L33.3,51.7L66.7,10L100,35')
  assert.equal(out.baseY, 60)
  assert.ok(out.area.endsWith('L100,60L0,60Z'))
  assert.deepEqual(out.peak, { x: 66.7, y: 10, points: 60 })
  assert.deepEqual(out.end, { x: 100, y: 35, points: 30 })
  assert.deepEqual(out.markers.map(marker => [marker.step, marker.mark]), [[2, 'big'], [3, 'boom']])
})

test('盾牌挡住、金苹果、末影水晶打点；扣到 0 的雷也算；一直 0 分没有最高点', () => {
  const trail = [{ k: 'apple', a: 10, p: 10 }, { k: 'crystal', a: 0, p: 10, b: 1 }, { k: 'crystal', a: -10, p: 0 }]
  const out = chart.chartOf(trail, box)
  assert.deepEqual(out.markers.map(marker => marker.mark), ['apple', 'blocked', 'boom'])
  const flat = chart.chartOf([{ k: 'totem', a: 0, p: 0 }], box)
  assert.equal(flat.peak, null)
  assert.equal(flat.markers.length, 0)
})

test('线上挂的图标按加减多少挑、挨得近的跳过；条形码加往上扣往下；图例按物品排、不加不减的合成其他', () => {
  const trail = [
    { k: 'emerald', a: 10, p: 10 }, { k: 'diamond', a: 50, p: 60 }, { k: 'coal', a: 0, p: 60 }, { k: 'tnt', a: -20, p: 40 },
    { k: 'poison', a: -2, p: 38 }, { k: 'tnt', a: 0, p: 38, b: 1 }, { k: 'debris', a: 100, p: 138 }, { k: 'crystal', a: -69, p: 69 },
  ]
  const wide = { width: 320, height: 132, padX: 0, padTop: 10, padBottom: 0 }
  const out = chart.chartOf(trail, wide)
  // 绿宝石、中毒、煤炭不挂；挡住的按一笔中等的算
  assert.deepEqual(chart.picksOf(out).map(point => point.kind), ['diamond', 'tnt', 'tnt', 'debris', 'crystal'])
  // 挨得近（图上 100 以内）就只留加减最多的
  assert.deepEqual(chart.picksOf(out, 6, 100).map(point => point.kind), ['diamond', 'debris'])
  assert.deepEqual(chart.picksOf(out, 2).map(point => point.kind), ['debris', 'crystal'])
  const bars = chart.barsOf(out)
  assert.equal(bars.length, 8)
  assert.deepEqual(bars.map(bar => Math.sign(bar.size)), [1, 1, 0, -1, -1, 1, 1, -1])
  assert.equal(bars[6].size, 1)
  assert.equal(bars[2].color, chart.COLORS.other)
  assert.equal(bars[5].color, chart.COLORS.blocked)
  assert.deepEqual(chart.legendOf(out).map(entry => [entry.key, entry.count]),
    [['debris', 1], ['diamond', 1], ['emerald', 1], ['blocked', 1], ['tnt', 1], ['crystal', 1], ['poison', 1], ['other', 1]])
})

test('图下面六格：平均每格按挖到的算；踩到雷（挡住的也算）断开连着没踩雷；扣掉的分开记，存进末影箱不算', () => {
  const trail = [
    { k: 'emerald', a: 10, p: 10 }, { k: 'diamond', a: 50, p: 60 }, { k: 'tnt', a: 0, p: 60, b: 1 }, { k: 'emerald', a: 10, p: 70 },
    { k: 'emerald', a: 10, p: 80 }, { k: 'coal', a: 0, p: 80 }, { k: 'tnt', a: -20, p: 60 }, { k: 'poison', a: -3, p: 57 },
    { k: 'ender', a: -28, p: 29 }, { k: 'creeper', a: -5, p: 24 },
  ]
  assert.deepEqual(chart.statsOf(trail), { digs: 7, average: 11, longest: 3, blocked: 1, lost: 28, bomb: 20, poison: 3, other: 5 })
  assert.deepEqual(chart.statsOf([]), { digs: 0, average: 0, longest: 0, blocked: 0, lost: 0, bomb: 0, poison: 0, other: 0 })
})

test('挖到什么放什么：挡住是格挡声，重复盾牌和望远镜转小奖是经验球，珍珠和眼跟着动画放', () => {
  const of = (kind, amount = 0, blocked = false) => sound.soundOfResult({ kind, amount, blocked })
  assert.equal(of('emerald', 10), 'emerald')
  assert.equal(of('diamond', 50), 'diamond')
  assert.equal(of('tnt', -5), 'tnt')
  assert.equal(of('crystal', -5), 'crystal')
  assert.equal(of('tnt', 0, true), 'block')
  assert.equal(of('shield'), 'shield')
  assert.equal(of('shield', 10), 'emerald')
  assert.equal(of('spyglass', 10), 'emerald')
  assert.equal(of('pearl'), null)
  assert.equal(of('eye'), null)
})

test('最大的一笔和扣得最多的一下（中毒、苦力怕也算）；拖到哪一步说哪一步', () => {
  const trail = [
    { k: 'emerald', a: 10, p: 10 }, { k: 'diamond', a: 50, p: 60 }, { k: 'tnt', a: -15, p: 45 }, { k: 'apple', a: 45, p: 90 },
    { k: 'creeper', a: -18, p: 72 }, { k: 'tnt', a: 0, p: 72, b: 1 }, { k: 'emerald', a: 10, p: 82 },
  ]
  const out = chart.chartOf(trail, box)
  assert.deepEqual([out.best.kind, out.best.amount], ['diamond', 50])
  assert.deepEqual([out.worst.kind, out.worst.amount], ['creeper', -18])
  const money = points => (points / 100).toFixed(2)
  assert.equal(out.points.length, 8)
  const names = { emerald: '绿宝石', diamond: '钻石' }
  assert.equal(chart.pointWords(chart.pointAt(out, 0), money, names), '开始：待领取 0.00')
  assert.equal(chart.pointWords(chart.pointAt(out, 29), money, names), '第 2 次挖 · 钻石 +0.50 · 待领取 0.60')
  assert.equal(chart.pointWords(chart.pointAt(out, 72), money, names), '苦力怕 -0.18 · 待领取 0.72')
  assert.equal(chart.pointWords(chart.pointAt(out, 100), money, names), '第 6 次挖 · 绿宝石 +0.10 · 待领取 0.82')
})
