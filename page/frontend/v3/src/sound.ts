import { atom } from 'jotai'

// 音效（docs/V3_MAP.md §6）：Minecraft 1.21.4 的原声（来源见 docs/MINECRAFT_ASSETS.md），
// 用 Web Audio 放。浏览器要等他点过一下才让出声，所以第一次点按时才建 AudioContext；
// 用到哪个才下载、解码哪个，解出来的留着。右上角能静音，记在本机。

export type Sound =
  | 'dig' | 'emerald' | 'diamond' | 'apple' | 'totem' | 'tnt' | 'crystal' | 'shield' | 'block'
  | 'spyglass' | 'throw' | 'teleport' | 'eye' | 'portal' | 'claim' | 'click'

/** 每种动作用哪几个文件（随机挑一个）、多响、音高上下浮动多少（像游戏里一样不完全一样）。 */
const SOUNDS: Record<Sound, { files: string[]; volume: number; pitch?: number }> = {
  dig: { files: ['dig/stone1', 'dig/stone2', 'dig/stone3', 'dig/stone4'], volume: 0.45, pitch: 0.1 },
  emerald: { files: ['random/orb'], volume: 0.4, pitch: 0.15 },
  diamond: { files: ['random/levelup'], volume: 0.45 },
  apple: { files: ['random/eat1', 'random/eat2', 'random/eat3'], volume: 0.5, pitch: 0.1 },
  totem: { files: ['item/armor/equip_iron1', 'item/armor/equip_iron2'], volume: 0.55 },
  tnt: { files: ['random/explode1', 'random/explode2'], volume: 0.4, pitch: 0.1 },
  crystal: { files: ['random/explode2'], volume: 0.55 },
  shield: { files: ['item/armor/equip_generic1', 'item/armor/equip_generic2'], volume: 0.6 },
  block: { files: ['item/shield/block1', 'item/shield/block2'], volume: 0.6 },
  spyglass: { files: ['item/spyglass/use'], volume: 0.6 },
  throw: { files: ['random/bow'], volume: 0.4, pitch: 0.1 },
  teleport: { files: ['mob/endermen/portal', 'mob/endermen/portal2'], volume: 0.4 },
  eye: { files: ['entity/endereye/endereye_launch1'], volume: 0.5 },
  portal: { files: ['block/end_portal/endportal'], volume: 0.3 },
  claim: { files: ['ui/toast/challenge_complete'], volume: 0.35 },
  click: { files: ['random/click'], volume: 0.3 },
}

/** 先下好的（最常听到的）；别的用到才下。 */
const WARM: Sound[] = ['dig', 'emerald', 'diamond', 'tnt']
/** 解码慢了就不放了：晚一大截再响，对不上画面。 */
const LATE_MS = 400
const MUTED_KEY = 'kddb:v3:muted'

function readMuted() {
  try {
    return localStorage.getItem(MUTED_KEY) === '1'
  } catch {
    return false
  }
}

export const mutedAtom = atom(readMuted())

let muted = readMuted()
let context: AudioContext | null = null
const buffers = new Map<string, Promise<AudioBuffer | null>>()

export function setMuted(next: boolean) {
  muted = next
  try {
    localStorage.setItem(MUTED_KEY, next ? '1' : '0')
  } catch {
    // 记不住就只管这一次
  }
}

const urlOf = (file: string) => new URL(`assets/minecraft/1.21.4/sounds/${file}.mp3`, document.baseURI).href

function load(file: string) {
  let buffer = buffers.get(file)
  if (!buffer) {
    const audio = context
    buffer = audio
      ? fetch(urlOf(file)).then(response => response.arrayBuffer()).then(data => audio.decodeAudioData(data)).catch(() => null)
      : Promise.resolve(null)
    if (audio) buffers.set(file, buffer)
  }
  return buffer
}

/** 第一次点按、按键时建好（并恢复）AudioContext，顺手把常用的几个下好。 */
function unlock() {
  if (!context) {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Context) return
    context = new Context()
    for (const sound of WARM) for (const file of SOUNDS[sound].files) void load(file)
  }
  if (context.state === 'suspended') void context.resume()
}

export function installSound() {
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true })
  window.addEventListener('keydown', unlock, { capture: true })
}

/** 放一个音效；静音、还没点过、网页在后台时什么都不做。delay 是过多少毫秒再放。 */
export function play(sound: Sound, { volume = 1, delay = 0 }: { volume?: number; delay?: number } = {}) {
  if (muted || !context || document.hidden) return
  const spec = SOUNDS[sound]
  const file = spec.files[Math.floor(Math.random() * spec.files.length)]
  const asked = performance.now()
  void load(file).then(buffer => {
    const audio = context
    if (!buffer || !audio || muted) return
    const wait = delay - (performance.now() - asked)
    if (wait < -LATE_MS) return
    const source = audio.createBufferSource()
    source.buffer = buffer
    if (spec.pitch) source.playbackRate.value = 1 + (Math.random() * 2 - 1) * spec.pitch
    const gain = audio.createGain()
    gain.gain.value = spec.volume * volume
    source.connect(gain).connect(audio.destination)
    source.start(audio.currentTime + Math.max(0, wait) / 1000)
  })
}

/** 挖到什么就放什么（自己挖的）。盾牌挡住、重复的盾牌和望远镜转成小奖时换个声音。 */
export function soundOfResult(result: { kind: string; amount: number; blocked: boolean }): Sound | null {
  if (result.blocked) return 'block'
  switch (result.kind) {
    case 'emerald': return 'emerald'
    case 'diamond': return 'diamond'
    case 'apple': return 'apple'
    case 'totem': return 'totem'
    case 'tnt': return 'tnt'
    case 'crystal': return 'crystal'
    case 'shield': return result.amount > 0 ? 'emerald' : 'shield'
    case 'spyglass': return result.amount > 0 ? 'emerald' : 'spyglass'
    // 珍珠和眼的声音跟着飞行动画放（起飞、落地）
    default: return null
  }
}
