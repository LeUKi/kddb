import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// v3 地图的镜头（v3/src/camera.ts）：三级缩放、居中、最近的卡、往哪个方向走、NEW 指向。
let server
let camera
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' })
  camera = await server.ssrLoadModule('/v3/src/camera.ts')
})
after(async () => { await server?.close() })

const phone = { width: 390, height: 600 }
const wide = { width: 900, height: 700 }
const cards = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 1 }]

test('挖卡这一级让 7×7 的卡占窄的那边九成，有上下限；中间那级更小；总览不比中间大', () => {
  assert.ok(Math.abs(camera.digScale(phone) * camera.cardPx(7) - 390 * 0.92) < 1)
  assert.equal(camera.digScale({ width: 2000, height: 2000 }), 1.3)
  assert.ok(camera.midScale(phone) < camera.digScale(phone))
  assert.ok(camera.overviewScale(phone, [{ x: 0, y: 0 }]) <= camera.midScale(phone))
  assert.ok(camera.overviewScale(phone, [{ x: -6, y: 0 }, { x: 6, y: 0 }]) < camera.midScale(phone))
})

test('总览放得下所有卡，四周留出边', () => {
  const view = wide
  const at = camera.overviewCamera(view, cards)
  for (const card of cards) assert.ok(camera.onScreen(card, at, view), JSON.stringify(card))
})

test('镜头对准一张卡：它在正中；最近的卡就是它', () => {
  const scale = camera.digScale(phone)
  const at = camera.cameraAt(camera.centerOf({ x: -1, y: 1 }), scale, phone)
  const center = camera.worldCenter(at, phone)
  assert.deepEqual([Math.round(center.x), Math.round(center.y)], [-camera.SLOT_PX, camera.SLOT_PX])
  assert.deepEqual(camera.nearestCard(cards, at, phone), { x: -1, y: 1 })
})

test('捏合松手吸到最近的那一级', () => {
  assert.equal(camera.nearestLevel(camera.digScale(phone) * 1.1, phone, cards), 2)
  assert.equal(camera.nearestLevel(camera.midScale(phone) * 0.95, phone, cards), 1)
})

test('方向：在那个方向 45° 以内（含 45°）、先近后正；没有就是 null', () => {
  const from = { x: 0, y: 0 }
  assert.deepEqual(camera.cardToward(cards, from, 'right'), { x: 1, y: 0 })
  assert.deepEqual(camera.cardToward(cards, from, 'down'), { x: 0, y: 1 })
  assert.equal(camera.cardToward(cards, from, 'up'), null)
  assert.deepEqual(camera.cardToward(cards, from, 'left'), { x: -1, y: 1 }) // 正好 45° 也算，不然按左没反应
  assert.deepEqual(camera.cardToward(cards, { x: 0, y: 1 }, 'left'), { x: -1, y: 1 })
})

test('NEW 指向：镜头外的卡在屏幕边上，箭头朝它', () => {
  const at = camera.cameraAt(camera.centerOf({ x: 0, y: 0 }), camera.digScale(phone), phone)
  assert.equal(camera.onScreen({ x: -1, y: 1 }, at, phone), false)
  const pointer = camera.edgePointer({ x: -1, y: 1 }, at, phone)
  assert.ok(pointer.x >= 0 && pointer.x <= phone.width && pointer.y >= 0 && pointer.y <= phone.height)
  assert.ok(pointer.angle > 90 && pointer.angle < 180) // 左下
})
