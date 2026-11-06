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

test('挖卡这一级画面放得下就是原大；放不下一张 7×7（加留白）才缩小；附近那级固定、更小；总览不比附近大', () => {
  assert.equal(camera.digScale(wide), 1)
  assert.equal(camera.digScale({ width: 2000, height: 2000 }), 1)
  assert.ok(Math.abs(camera.digScale(phone) * camera.cardPx(7) - (390 - camera.MARGIN * 2)) < 1)
  assert.equal(camera.midScale(wide), camera.MID_SCALE)
  assert.ok(camera.midScale(phone) < camera.digScale(phone))
  assert.ok(camera.overviewScale(phone, [{ x: 0, y: 0 }]) <= camera.midScale(phone))
  assert.ok(camera.overviewScale(phone, [{ x: -6, y: 0 }, { x: 6, y: 0 }]) < camera.midScale(phone))
})

test('区块一样大、间距一样：卡在区块正中，画面大小不改屏幕上的间距', () => {
  assert.equal(camera.BLOCK_PX + camera.BLOCK_GAP, camera.SLOT_PX)
  for (const size of [5, 6, 7]) assert.ok(camera.cardPx(size) <= camera.BLOCK_PX)
  const big = { width: 1400, height: 1000 }
  const step = view => {
    const at = camera.cameraAt(camera.centerOf({ x: 0, y: 0 }), camera.digScale(view), view)
    return camera.centerOf({ x: 1, y: 0 }).x * at.scale - camera.centerOf({ x: 0, y: 0 }).x * at.scale
  }
  assert.equal(step(wide), step(big))
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

test('滚轮都是缩放：一下的第一个事件就换一级；同一下里同方向再攒够、隔够了再换；停一下重新算', () => {
  const step = (state, deltaY, now, deltaMode = 0) => camera.wheelZoom(state, { deltaMode, deltaY }, now)
  let r = step(null, 4, 0) // macOS 慢慢滚一格只有几像素，也要动
  assert.equal(r.step, -1)
  r = step(r.state, 4, 100)
  assert.equal(r.step, 0) // 同一下里，隔得太近
  r = step(r.state, 30, 200)
  assert.equal(r.step, 0)
  r = step(r.state, 30, 300)
  assert.equal(r.step, 0) // 隔够了，但同一下里还没攒够 80
  r = step(r.state, 30, 400)
  assert.equal(r.step, -1)
  r = step(r.state, -10, 500)
  assert.equal(r.step, 0) // 反方向：重新攒，也还没隔够
  r = step(r.state, -3, 900) // 停过一下，是新的一下
  assert.equal(r.step, 1)
  assert.equal(step(null, -1, 0, 1).step, 1) // Firefox 按行滚
  assert.equal(step(null, 0, 0).step, 0)
})

test('卡的边框算在宽度里：格子正好铺满内容区，不往右下溢出', () => {
  for (const size of [5, 6, 7]) {
    const content = camera.cardPx(size) - (camera.PAD + camera.CARD_BORDER) * 2
    assert.equal(content, size * camera.CELL + (size - 1) * camera.GAP)
  }
  assert.equal(camera.cardPx(7), 360)
})

test('滚轮放大朝指针下面那张卡', () => {
  const at = camera.overviewCamera(wide, cards)
  const target = { x: -1, y: 1 }
  const point = { x: camera.centerOf(target).x * at.scale + at.x, y: camera.centerOf(target).y * at.scale + at.y }
  assert.deepEqual(camera.cardNear(cards, at, point), target)
})
