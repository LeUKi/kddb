import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// 整张地图的画布（v3/src/MapCanvas.tsx）：上千张卡时，长一张新卡、光变一张，不再整张重画。
let server
let canvas
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' })
  canvas = await server.ssrLoadModule('/v3/src/MapCanvas.tsx')
})
after(async () => { await server?.close() })

test('画布范围：四周留地图跨度的一成五（至少 2 格），卡在范围里时不变', () => {
  const small = canvas.areaOf({ minX: 0, maxX: 3, minY: -1, maxY: 2 }, null)
  assert.deepEqual(small, { minX: -2, maxX: 5, minY: -3, maxY: 4 })
  const big = canvas.areaOf({ minX: -20, maxX: 20, minY: -10, maxY: 30 }, null)
  assert.deepEqual(big, { minX: -26, maxX: 26, minY: -16, maxY: 36 })
  assert.equal(canvas.areaOf({ minX: -25, maxX: 20, minY: -10, maxY: 35 }, big), big)
  assert.notEqual(canvas.areaOf({ minX: -27, maxX: 20, minY: -10, maxY: 30 }, big), big)
})

test('光的粗细按 2^¼ 一档：地图长一点不变', () => {
  assert.equal(canvas.stepped(9.6), canvas.stepped(10.2))
  assert.ok(canvas.stepped(10) < canvas.stepped(13))
})

test('光变了的卡：灭了的、换色的、新亮的', () => {
  const drawn = new Map([[1, 'eye'], [2, 'eye'], [3, 'end']])
  const wanted = new Map([[1, 'eye'], [3, 'eye'], [4, 'end']])
  assert.deepEqual(canvas.glowChanges(drawn, wanted).sort(), [2, 3, 4])
  assert.deepEqual(canvas.glowChanges(wanted, new Map(wanted)), [])
})

test('远处的光：末地宝藏、藏着眼的照旧，别的按越富越亮的档位（docs/V3_ITEMS.md §9）', () => {
  const plain = { id: 1, left: { diamond: 2 }, finished: false }
  assert.equal(canvas.glowOf(plain), null)
  assert.equal(canvas.glowOf(plain, 0), null)
  assert.deepEqual([1, 2, 3].map(rich => canvas.glowOf(plain, rich)), ['rich1', 'rich2', 'rich3'])
  assert.equal(canvas.glowOf({ ...plain, left: { eye: 1 } }, 3), 'eye')
  assert.equal(canvas.glowOf({ ...plain, kind: 'end' }, 3), 'end')
  assert.equal(canvas.glowOf({ ...plain, kind: 'end', finished: true }, 3), null)
})
