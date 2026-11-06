import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// v3 的末影之眼和末地宝藏（v3/src/eye.ts）：底栏那一行和 JP 提示看的状况。
let server
let eye
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' })
  eye = await server.ssrLoadModule('/v3/src/eye.ts')
})
after(async () => { await server?.close() })

const card = (id, fields = {}) => ({ id, x: id, y: 0, size: 5, cells: [], left: {}, finished: false, ...fields })

test('参数 0 或旧局没有这个参数：不开', () => {
  assert.equal(eye.eyeStatus([card(1)], 0).kind, 'off')
  assert.equal(eye.eyeStatus([card(1)], undefined).kind, 'off')
})

test('还没有眼：再长几张普通卡出（宝藏卡不算张数）', () => {
  assert.deepEqual(eye.eyeStatus([card(1)], 3), { kind: 'coming', cards: 2 })
  assert.deepEqual(eye.eyeStatus([card(1), card(2)], 3), { kind: 'coming', cards: 1 })
  // 第 3 张的眼挖掉了、宝藏也挖完了：下一颗在第 6 张
  const cards = [card(1), card(2), card(3, { left: { eye: 0 } }), card(4, { kind: 'end', finished: true })]
  assert.deepEqual(eye.eyeStatus(cards, 3), { kind: 'coming', cards: 3 })
})

test('有眼没挖到就说眼在哪；宝藏卡没挖完最要紧', () => {
  const withEye = [card(1), card(2), card(3, { left: { eye: 1 } })]
  const status = eye.eyeStatus(withEye, 3)
  assert.equal(status.kind, 'eye')
  assert.equal(status.card.id, 3)
  const open = [...withEye, card(4, { kind: 'end' })]
  const first = eye.eyeStatus(open, 3)
  assert.equal(first.kind, 'treasure')
  assert.equal(first.card.id, 4)
})
