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

test('线上的图标和说的话：钻石、金苹果、TNT 或末影水晶、挡住画盾牌', () => {
  const trail = [{ k: 'diamond', a: 50, p: 50 }, { k: 'apple', a: 20, p: 70 }, { k: 'tnt', a: -7, p: 63 }, { k: 'crystal', a: 0, p: 63, b: 1 }, { k: 'crystal', a: -12, p: 51 }, { k: 'tnt', a: 0, p: 51, b: 1 }]
  const markers = chart.chartOf(trail, box).markers
  const money = points => (points / 100).toFixed(2)
  assert.deepEqual(markers.map(marker => chart.iconOf(marker)), ['diamond', 'apple', 'tnt', 'shield', 'crystal', 'shield'])
  assert.deepEqual(markers.map(marker => chart.markerWords(marker, money)), [
    '第 1 格：钻石 +0.50',
    '第 2 格：附魔金苹果 +0.20',
    '第 3 格：TNT，被炸掉 0.07',
    '第 4 格：盾牌挡住了末影水晶',
    '第 5 格：末影水晶，被炸掉 0.12',
    '第 6 格：盾牌挡住了 TNT',
  ])
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
