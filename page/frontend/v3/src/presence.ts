// 在场（docs/V3_ITEMS.md §20）：别人的指针、谁在看哪张卡、表情气泡。另一条连接连游戏站的另一个房间
// （game/worker/presence.mjs，消息的样子写在那里），挖格子那条不受影响。
//
// 发得省：在看哪张卡只在镜头停下 0.5 秒后发，两次至少隔 2 秒；指针只在电脑上、鼠标动了时发，最多 5 次/秒，
// 停下就不发；页面到后台说一声不看了，回来再说。指针带着手上的道具（别人的指针上画那个图标）；拿着望远镜时
// 不发（看哪一格只有自己知道）。
import { atom } from 'jotai'
import { gameApi, store, toast, uidAtom } from './state'

export interface Seat { uid: number; name: string; c: number }
/** 别人：座位号 → 是谁、在看哪张卡（只有在看的） */
export const seatsAtom = atom<Record<string, Seat>>({})
export const mySidAtom = atom<string | null>(null)
/** 指针：世界坐标和手上的道具（Peers.tsx 的 TOOLS） */
export type Point = [number, number, number]
/** 别人的指针：座位号 → 在哪、拿着什么。游戏站只发我看得见的那些 */
export const pointersAtom = atom<Record<string, Point>>({})
/**
 * 正冒着的表情：uid（自己的是 'me'）→ 哪个、什么时候、冒在指针旁还是名字上。自己在地图上右键扔的带着
 * 扔的地方（世界坐标），从那里冒；用按钮扔的从按钮上冒
 */
export interface Bubble { n: number; at: number; onPointer: boolean; where?: [number, number] }
export const bubblesAtom = atom<Record<string, Bubble>>({})

export interface PresenceSettings {
  /** 显示别人的指针 */
  pointers: boolean
  /** 显示别人的表情 */
  emotes: boolean
  /** 让别人看到我的指针 */
  mine: boolean
}
const SETTINGS_KEY = 'kddb:v3:presence'
const DEFAULTS: PresenceSettings = { pointers: true, emotes: true, mine: true }
function readSettings(): PresenceSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}
export const settingsAtom = atom<PresenceSettings>(readSettings())
export function setSettings(change: Partial<PresenceSettings>) {
  const next = { ...store.get(settingsAtom), ...change }
  store.set(settingsAtom, next)
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  } catch {
    // 记不住就算了
  }
  if (change.mine === false) flushPointer()
}

export interface Watcher { sid: string; uid: number; name: string }
const byName = (a: Watcher, b: Watcher) => a.name.localeCompare(b.name)
/** 每张卡谁在看：不算自己，同一个人两个标签页算一个，按名字排。只在有人换卡时变，指针动不变 */
export const watchersAtom = atom(get => {
  const me = get(uidAtom)
  const byCard = new Map<number, Watcher[]>()
  const seen = new Set<string>()
  for (const [sid, seat] of Object.entries(get(seatsAtom))) {
    const key = `${seat.c}:${seat.uid}`
    if (seat.uid === me || seen.has(key)) continue
    seen.add(key)
    const list = byCard.get(seat.c) ?? []
    list.push({ sid, uid: seat.uid, name: seat.name })
    byCard.set(seat.c, list)
  }
  for (const list of byCard.values()) list.sort(byName)
  return byCard
})
/** 在矿洞里的人（在看某张卡的，算上自己） */
export const onlineAtom = atom(get => new Set([get(uidAtom), ...Object.values(get(seatsAtom)).map(seat => seat.uid)]).size)

/** 只有电脑上（有鼠标）才发自己的指针 */
export const canPoint = () => !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches

const WATCH_SETTLE_MS = 500
const WATCH_GAP_MS = 2000
const POINTER_GAP_MS = 200
export const EMOTE_COOL_MS = 2500
export const BUBBLE_MS = 3000

let conn: { send(text: string): boolean; close(): void } | null = null
let visible = typeof document === 'undefined' || document.visibilityState === 'visible'
let watchWanted: [number, number, number, 0 | 1 | 2] | null = null
let watchSent: string | null = null
let watchLastAt = 0
let watchTimer: ReturnType<typeof setTimeout> | undefined
let pointerOf: (() => Point | null) | null = null
let pointerSent: string | null = null
let pointerLastAt = 0
let pointerTimer: ReturnType<typeof setTimeout> | undefined

/** 连上在场的房间（地图打开时）；关掉地图时 stopPresence。 */
export function startPresence() {
  const api = gameApi()
  if (!api || conn) return
  conn = api.presence(onText, onOpen, onClose)
  document.addEventListener('visibilitychange', onVisibility)
}

export function stopPresence() {
  conn?.close()
  conn = null
  document.removeEventListener('visibilitychange', onVisibility)
  clearTimeout(watchTimer)
  clearTimeout(pointerTimer)
  pointerTimer = undefined
  onClose()
}

/** 房间里没有我的指针 */
const NO_POINTER = JSON.stringify({ p: null })

function onOpen() {
  // 新连上的房间什么都不知道：在看哪张重新说，指针有就再说
  watchSent = null
  pointerSent = NO_POINTER
  flushWatch()
}

function onClose() {
  store.set(seatsAtom, {})
  store.set(pointersAtom, {})
  store.set(mySidAtom, null)
}

function onVisibility() {
  visible = document.visibilityState === 'visible'
  flushWatch()
}

/** 镜头停在哪张卡、哪一级（地图落定时报）；null 是没有卡。 */
export function reportWatch(card: { id: number; x: number; y: number } | null, level: 0 | 1 | 2) {
  watchWanted = card ? [card.id, card.x, card.y, level] : null
  clearTimeout(watchTimer)
  watchTimer = setTimeout(flushWatch, Math.max(WATCH_SETTLE_MS, watchLastAt + WATCH_GAP_MS - Date.now()))
}

function flushWatch() {
  clearTimeout(watchTimer)
  const text = JSON.stringify({ w: visible ? watchWanted : null })
  if (text !== watchSent && conn?.send(text)) {
    watchSent = text
    watchLastAt = Date.now()
    // 房间只收在看某张卡的人的指针：说了在看哪张以后，指针再说一遍（房间里本来没有就不用说收起）
    if (pointerSent !== NO_POINTER) pointerSent = null
  }
  flushPointer()
}

/**
 * 指针动了：where 在发的时候才算（算世界坐标要量地图的位置，鼠标每动一下都量不值得）；返回 null 是收起。
 * 最多 5 次/秒，最后一下一定发。
 */
export function reportPointer(where: (() => Point | null) | null) {
  pointerOf = where
  if (pointerTimer !== undefined) return
  const wait = pointerLastAt + POINTER_GAP_MS - Date.now()
  if (wait <= 0) flushPointer()
  else pointerTimer = setTimeout(() => {
    pointerTimer = undefined
    flushPointer()
  }, wait)
}

function flushPointer() {
  const allowed = visible && store.get(settingsAtom).mine && !!watchWanted && watchWanted[3] !== 0 && JSON.stringify({ w: watchWanted }) === watchSent
  const point = allowed ? pointerOf?.() ?? null : null
  const text = JSON.stringify({ p: point ? [Math.round(point[0]), Math.round(point[1]), ...(point[2] ? [point[2]] : [])] : null })
  if (text === pointerSent) return
  if (conn?.send(text)) {
    pointerSent = text
    pointerLastAt = Date.now()
  }
}

/** 扔一个表情：自己这边从扔的地方（where，世界坐标）或表情按钮上冒出来。没连上、还在冷却时不扔，返回 false。 */
export const emoteReadyAtAtom = atom(0)
export function sendEmote(n: number, where?: [number, number]) {
  const now = Date.now()
  if (now < store.get(emoteReadyAtAtom)) return false
  if (!watchSent || watchSent === JSON.stringify({ w: null }) || !conn?.send(JSON.stringify({ e: n }))) {
    toast('还没连上，稍后再扔')
    return false
  }
  store.set(emoteReadyAtAtom, now + EMOTE_COOL_MS)
  showBubble('me', n, false, where)
  return true
}

function showBubble(who: string, n: number, onPointer: boolean, where?: [number, number]) {
  const at = Date.now() + Math.random()
  store.set(bubblesAtom, value => ({ ...value, [who]: { n, at, onPointer, ...(where ? { where } : {}) } }))
  setTimeout(() => store.set(bubblesAtom, value => {
    if (value[who]?.at !== at) return value
    const next = { ...value }
    delete next[who]
    return next
  }), BUBBLE_MS)
}

const isRow = (row: unknown): row is unknown[] => Array.isArray(row) && typeof row[0] === 'string'

/** 房间发来的一批（样子见 game/worker/presence.mjs）。 */
export function onText(text: string) {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(text)
  } catch {
    return
  }
  if (typeof data !== 'object' || data === null) return
  const hello = typeof data.hi === 'string'
  if (hello) store.set(mySidAtom, data.hi as string)
  let pointers: Record<string, Point> | null = null
  if (Array.isArray(data.w)) {
    const seats = hello ? {} : { ...store.get(seatsAtom) }
    for (const row of data.w.filter(isRow)) {
      const [sid, uid, name, c] = row as [string, number, string, number | null]
      if (typeof c === 'number' && typeof uid === 'number' && typeof name === 'string') seats[sid] = { uid, name, c }
      else {
        delete seats[sid]
        pointers ??= { ...store.get(pointersAtom) }
        delete pointers[sid]
      }
    }
    store.set(seatsAtom, seats)
  }
  if (Array.isArray(data.P)) pointers = {}
  const moved = Array.isArray(data.P) ? data.P : Array.isArray(data.p) ? data.p : null
  if (moved) {
    pointers ??= { ...store.get(pointersAtom) }
    for (const row of moved.filter(isRow)) {
      const [sid, x, y, tool] = row as [string, number?, number?, number?]
      if (typeof x === 'number' && typeof y === 'number') pointers[sid] = [x, y, typeof tool === 'number' ? tool : 0]
      else delete pointers[sid]
    }
  }
  if (pointers) store.set(pointersAtom, pointers)
  if (Array.isArray(data.e)) {
    const seats = store.get(seatsAtom)
    const shown = store.get(pointersAtom)
    const showPointers = store.get(settingsAtom).pointers
    for (const row of data.e.filter(isRow)) {
      const [sid, n] = row as [string, number]
      const seat = seats[sid]
      if (seat && typeof n === 'number') showBubble(String(seat.uid), n, showPointers && !!shown[sid])
    }
  }
}
