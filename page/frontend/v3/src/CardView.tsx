import { memo, useLayoutEffect, useRef } from 'react'
import { ItemIcon } from '../../src/ItemIcon'
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { AimInfo } from './aim'
import type { Held } from './items'
import type { Direction } from './camera'
import { BLOCK_PX, CARD_BORDER, CARD_PX, cellPx, entranceWave, GAP, PAD, SLOT_PX } from './camera'
import { drawThumb, THUMB_PX, whenImages } from './thumb'
import { isBulb, RAIL_TEXTURE, railOf, sculkOf } from './layout'
import { torchWords } from './aim'
import { digIntervalAtom, toast } from './state'
import type { DigResult, Loot, Peek, PublicCard, Torch } from './types'
import { BIOME_NAMES, KIND_NAMES, money } from './types'
import { useAtomValue } from 'jotai'
import { NoiseRail } from './CardLabels'
import { noiseDecayMs, WARDEN_FROM } from './regions'
import { torchArea } from './items'

const ROWS = 'ABCDEFG'

export interface Entrance { land: number; edge: Direction }

export interface CardProps {
  card: PublicCard
  /** 镜头居中的那张：边框亮 */
  focused: boolean
  /** 能挖：挖卡那一级、居中、没挖完 */
  diggable: boolean
  /** 画格子细节（近处）；false 时只画缩略图 */
  detail: boolean
  /** 显示谁挖的：只有当前卡、挖卡那一级（名字带着图标一起淡入淡出） */
  names: boolean
  myUid: number | null
  /** 下面三样只给这张卡自己的（没有就是同一个空的），别的卡有变化时这张不用重画 */
  peeks: Peek[]
  pending: Record<string, true>
  fresh: Record<string, { mine: boolean; at: number; result?: DigResult }>
  /** 是当前卡：画名字（names 为 false 时藏着，好淡出） */
  current: boolean
  /** 新长出来的：落地（land 毫秒）后从朝着旧卡的那条边一波一波翻出来 */
  entrance: Entrance | null
  /** 手里拿着的道具（只给能挖的当前卡）：点格子是预览、用它，不是挖 */
  held: Held | null
  /** 预览在哪（只给那张卡）：盖住的格子、跳过的格子、中心或角 */
  preview: (AimInfo & { at: number }) | null
  /** 刚用望远镜、藏宝图看到的那一格（只给那张卡）：格子上飘一下是什么 */
  peeked: number | null
  /** 自己开过的宝库（这张卡的格号） */
  opened: number[]
  /** 第几版的道具规则（rules.items；第 2 版火把插在挖开的格子上、照 3×3） */
  version: number
  /** 越富越亮的档位（0 不亮，1～3，regions.ts richnessOf）：区块外面一圈静止的金光 */
  rich: number
  onDig: (cardId: number, index: number) => void
  /** 拿着道具时点到、指到一格（qx、qy：点在这一格的右半、下半；指着时 hover 为真） */
  onAim: (cardId: number, index: number, qx: 0 | 1, qy: 0 | 1, hover: boolean) => void
  /** 指到火把上（电脑）：说它的颜色是什么意思；离开时 null */
  onTorch: (torch: Torch | null, event: ReactPointerEvent) => void
  onPick: (cardId: number) => void
}

/**
 * 一张卡：外框都一样大，放在它的区块正中（区块中心在 x·408, y·408，392 见方）。点区块就是换到这张；
 * 能挖的那张只有格子能点。
 */
export const CardView = memo(function CardView({ card, focused, diggable, detail, names, current, myUid, peeks, pending, fresh, entrance, held, preview, peeked, opened, version, rich, onDig, onAim, onTorch, onPick }: CardProps) {
  const side = cellPx(card.size)
  const blockStyle = {
    left: card.x * SLOT_PX - BLOCK_PX / 2,
    top: card.y * SLOT_PX - BLOCK_PX / 2,
    width: BLOCK_PX,
    height: BLOCK_PX,
    ...(entrance ? { '--land': `${entrance.land}ms` } : null),
  } as CSSProperties
  const wave = (index: number) => entrance ? { '--wave': `${entranceWave(card.size, index, entrance.edge)}ms` } as CSSProperties : undefined
  const style = {
    width: CARD_PX,
    height: CARD_PX,
    padding: PAD,
    gridTemplateColumns: `repeat(${card.size}, ${side}px)`,
    gridTemplateRows: `repeat(${card.size}, ${side}px)`,
    gap: GAP,
  }
  const icon = Math.round(side * 0.6)
  const end = card.kind === 'end'
  const biome = card.kind ?? null
  const hasEye = !end && (card.left.eye ?? 0) > 0
  const blockClass = `map-block${focused ? ' is-focused' : ''}${entrance ? ' is-grown' : ''}${end ? ' is-end' : ''}${biome && !end ? ` is-${biome}` : ''}${hasEye ? ' has-eye' : ''}${!end && !hasEye && rich > 0 ? ` rich-${rich}` : ''}${card.finished ? ' is-done' : ''}${card.closed ? ' is-closed' : ''}`
  const className = `map-card${focused ? ' is-focused' : ''}${card.finished ? ' is-finished' : ''}${detail ? '' : ' is-thumb'}${end ? ' is-end' : ''}${biome && !end ? ` biome-${biome}` : ''}${names ? ' show-names' : ''}`
  const pick = diggable ? undefined : () => onPick(card.id)
  const label = biome ? BIOME_NAMES[biome] : `第 ${card.id} 张卡`
  if (!detail)
    return <div className={blockClass} style={blockStyle} onClick={pick} role="button" aria-label={`${label}${hasEye ? '，有末影之眼' : ''}${card.finished ? '，已挖完' : ''}`}>
      <div className={className} style={{ width: CARD_PX, height: CARD_PX, padding: PAD }}>
        <ThumbCanvas card={card} />
      </div>
    </div>
  const peekAt = new Map(peeks.map(peek => [peek.index, peek]))
  const inPreview = new Set(preview?.cells ?? [])
  const skipped = new Set(preview?.skip ?? [])
  const aiming = !!held && diggable
  /** 拿着道具：点、指这一格的哪一半 */
  const half = (event: ReactMouseEvent | ReactPointerEvent): [0 | 1, 0 | 1] => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    return [event.clientX - rect.left > rect.width / 2 ? 1 : 0, event.clientY - rect.top > rect.height / 2 ? 1 : 0]
  }
  const aimHandlers = (index: number) => aiming ? {
    onClick: (event: ReactMouseEvent) => {
      event.stopPropagation()
      const [qx, qy] = half(event)
      onAim(card.id, index, qx, qy, false)
    },
    onPointerMove: (event: ReactPointerEvent) => {
      if (event.pointerType !== 'mouse') return
      const [qx, qy] = half(event)
      onAim(card.id, index, qx, qy, true)
    },
  } : {}
  const previewClass = (index: number, dug: boolean) => !preview || !inPreview.has(index) ? ''
    : held === 'torch' ? (version >= 2 ? '' : ' in-torch') : held === 'spyglass' ? ' in-look' : held === 'key' ? ' in-key'
      : dug || skipped.has(index) ? ' in-skip' : preview.ok ? ' in-box' : ' in-skip'
  // 第 1 版的火把在四格相交的角上，第 2 版（v: 2）在格子正中
  const torchAt = (at: number, center = false) => ({
    left: PAD + (at % card.size) * (side + GAP) + (center ? side / 2 : -GAP / 2),
    top: PAD + Math.floor(at / card.size) * (side + GAP) + (center ? side / 2 : -GAP / 2),
  })
  /** 几格围成的框（第 2 版火把照亮的 3×3、预览） */
  const areaOf = (cells: number[]) => {
    const rows = cells.map(index => Math.floor(index / card.size))
    const cols = cells.map(index => index % card.size)
    const [r0, r1, c0, c1] = [Math.min(...rows), Math.max(...rows), Math.min(...cols), Math.max(...cols)]
    return { left: PAD + c0 * (side + GAP) - 3, top: PAD + r0 * (side + GAP) - 3, width: (c1 - c0 + 1) * (side + GAP) - GAP + 6, height: (r1 - r0 + 1) * (side + GAP) - GAP + 6 }
  }
  const torch2 = held === 'torch' && version >= 2
  const ghost = preview && held === 'torch' && preview.ok ? torchAt(preview.at, torch2) : null
  const torchOn = new Map((card.torches ?? []).filter(torch => torch.v === 2).map(torch => [torch.at, torch]))
  /** 深暗之域石头上爬着的幽匿块（只是样子） */
  const sculks = sculkOf(card)
  return <div className={blockClass} style={blockStyle} onClick={pick} data-card={card.id}>
    {/* 挖卡这一级的当前卡：噪音在卡下面的噪音条里（CardLabels），这里不再写 */}
    {card.kind === 'deep' && !names ? <NoiseBadge card={card} /> : null}
    <div className={className} style={style} {...(card.torches?.length ? {
      // 火把不挡格子（手机上点它旁边的格子要点得到）：电脑上指针离哪个火把近，就说哪个火把
      onPointerMove: (event: ReactPointerEvent) => {
        if (event.pointerType !== 'mouse') return
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
        const scale = rect.width / CARD_PX
        const x = (event.clientX - rect.left) / scale - CARD_BORDER
        const y = (event.clientY - rect.top) / scale - CARD_BORDER
        const near = card.torches!.find(torch => {
          const at = torchAt(torch.at, torch.v === 2)
          return Math.hypot(x - at.left, y - at.top) < side * (torch.v === 2 ? 0.5 : 0.32)
        })
        onTorch(near ?? null, event)
      },
      onPointerLeave: (event: ReactPointerEvent) => onTorch(null, event),
    } : {})}>
    {card.cells.map((cell, index) => {
      const cellKey = `${card.id}:${index}`
      const name = `${ROWS[Math.floor(index / card.size)]}${(index % card.size) + 1}`
      const peek = peekAt.get(index)
      const flash = fresh[cellKey]
      const recent = flash && Date.now() - flash.at < 2400 ? flash : null
      const fixed = card.fixed?.[index]
      if (fixed) {
        const left = card.vaults?.[index] ?? 0
        const mineOpened = opened.includes(index)
        // 铁轨照形状摆贴图（layout.ts）；试炼密室正中的装饰是铜灯
        const rail = railOf(card, index)
        return <div key={index} style={wave(index)} {...aimHandlers(index)}
          data-vault={fixed === 'vault' ? (left <= 0 ? '宝库：开完了' : mineOpened ? `宝库：你开过了，别人还能开 ${left} 次` : `宝库：还能开 ${left} 次，拿试炼钥匙来开`) : undefined}
          className={`map-cell fixed fixed-${fixed}${isBulb(card, index) ? ' is-bulb' : ''}${fixed === 'vault' && (left <= 0 || mineOpened) ? ' is-spent' : ''}${previewClass(index, true)}`}
          aria-label={fixed === 'vault' ? `${name}：宝库，还能开 ${left} 次${mineOpened ? '，你开过了' : ''}` : fixed === 'lava' ? `${name}：岩浆` : rail ? `${name}：铁轨，不能挖` : `${name}：装饰，不能挖`}>
          {fixed === 'vault' ? <><ItemIcon kind="vault" size={icon} /><span className="vault-left">{left}</span></> : null}
          {rail ? <i className={`rail${RAIL_TEXTURE[rail].corner ? ' is-corner' : ''}`} style={{ transform: `rotate(${RAIL_TEXTURE[rail].turn}deg)` }} aria-hidden="true" /> : null}
        </div>
      }
      if (cell) {
        const mine = cell.uid === myUid
        if (cell.burn) return <div key={index} style={wave(index)} {...aimHandlers(index)}
          className={`map-cell fixed fixed-lava is-burned${recent ? ' just-burned' : ''}${previewClass(index, true)}`} aria-label={`${name}：被岩浆吞掉了（${KIND_NAMES[cell.kind]}）`}>
          {recent ? <ItemIcon kind={cell.kind} size={icon} className="burned-icon" /> : null}
        </div>
        const lit = torchOn.get(index)
        return <div key={index} style={wave(index)} {...(aiming ? aimHandlers(index) : lit ? { onClick: () => toast(torchWords(lit)) } : {})}
          className={`map-cell revealed kind-${cell.kind}${mine ? ' is-mine' : ''}${lit ? ' has-torch' : ''}${recent ? (recent.mine ? ' just-mine' : ' just-other') : ''}${previewClass(index, true)}`}
          aria-label={`${name}：${KIND_NAMES[cell.kind]}，${cell.name} 挖的${lit ? `；插着${torchWords(lit)}` : ''}`}>
          <ItemIcon kind={cell.kind} size={icon} />
          {current ? <span className="cell-who" aria-hidden={!names}>{mine ? '我' : cell.name}</span> : null}
          {recent?.mine && recent.result ? <span className={`cell-float${recent.result.amount < 0 ? ' is-bad' : ''}`}>{floatText(recent.result)}</span> : null}
        </div>
      }
      const busy = !!pending[cellKey]
      const closed = !!card.closed
      const sculk = sculks.get(index)
      return <button
        key={index}
        style={sculk === undefined ? wave(index) : { ...wave(index), '--sculk-frame': `${sculk * 33.333}%` } as CSSProperties}
        type="button"
        className={`map-cell covered${sculk === undefined ? '' : ' is-sculk'}${peek ? ' has-peek' : ''}${busy ? ' is-digging' : ''}${aiming ? ' is-aim' : ''}${previewClass(index, false)}`}
        disabled={!diggable || busy || closed}
        {...(aiming ? aimHandlers(index) : {
          onClick: (event: ReactMouseEvent) => {
            event.stopPropagation()
            onDig(card.id, index)
          },
        })}
        aria-label={`${name}${peek ? `，知道是${KIND_NAMES[peek.kind]}` : ''}，${aiming ? '点按预览，再点一次就用' : diggable ? '点按挖开' : '放大以后才能挖'}`}
      >
        {peek ? <ItemIcon kind={peek.kind} size={Math.round(icon * 0.85)} className="peek-icon" /> : null}
        {peek && peeked === index ? <span className="cell-float is-peek">{KIND_NAMES[peek.kind]}</span> : null}
        {busy ? <ItemIcon kind="pickaxe" size={Math.round(icon * 0.92)} className="digging-pick" /> : null}
      </button>
    })}
    {/* 第 2 版的火把：照亮的 3×3 有一层同色的光 */}
    {[...torchOn.values()].map(torch => <span key={`halo-${torch.at}`} className={`torch-halo halo-${torch.level}`} style={areaOf(torchArea(card.size, torch.at))} aria-hidden="true" />)}
    {(card.torches ?? []).map(torch => torch.v === 2
      ? <span key={torch.at} className={`torch is-v2 torch2-${torch.level}`} style={torchAt(torch.at, true)} role="img" aria-label={`${torchWords(torch)}`}>
        <ItemIcon kind={torch.level === 0 ? 'torch-green' : torch.level === 3 ? 'torch-red' : 'torch'} size={Math.round(side * 0.85)} className={torch.level === 2 ? 'is-orange' : ''} />
      </span>
      : <span key={torch.at} className={`torch torch-${torch.level}`} style={torchAt(torch.at)} role="img"
        aria-label={torch.level === 0 ? '绿色火把：这 4 格里没有危险' : torch.level === 1 ? '黄色火把：这 4 格里有 1～2 个危险' : '红色火把：这 4 格里有 3～4 个危险'}>
        <ItemIcon kind={torch.level === 0 ? 'torch-green' : torch.level === 1 ? 'torch' : 'torch-red'} size={Math.round(side * 0.85)} />
      </span>)}
    {torch2 && preview ? <span className={`torch-frame${preview.ok ? '' : ' is-bad'}`} style={areaOf(preview.cells)} aria-hidden="true" /> : null}
    {ghost ? <span className={`torch torch-ghost${torch2 ? ' is-v2' : ''}`} style={ghost} aria-hidden="true"><ItemIcon kind="torch" size={Math.round(side * 0.85)} /></span> : null}
    {card.closed ? <WardenWoke card={card} /> : null}
    </div>
  </div>
})

/** 缩略图：整张卡画在一块画布里（thumb.ts），卡变了才重画；贴图还没到就等它到了再画。 */
function ThumbCanvas({ card }: { card: PublicCard }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    // 只读写这一小块：要普通内存里的画布，不让浏览器给每张卡开一块显存、各占一层
    const context = canvas.current?.getContext('2d', { willReadFrequently: true })
    if (!context) return
    let stop: (() => void) | null = null
    const draw = () => {
      stop = null
      if (!drawThumb(context, card)) stop = whenImages(draw)
    }
    draw()
    return () => {
      stop?.()
    }
  }, [card])
  return <canvas ref={canvas} className="thumb-canvas" width={THUMB_PX} height={THUMB_PX} aria-hidden="true" />
}

/** 格子上飘的字里道具的短名 */
const LOOT_NAMES: Record<Loot, string> = { spyglass: '望远镜', map: '藏宝图', key: '钥匙', table: '附魔台', ender: '末影箱', potion: '急迫药水', torch: '火把' }

function floatText(result: DigResult) {
  if (result.amount > 0) return `+${money(result.amount)}`
  if (result.amount < 0) return money(result.amount)
  if (result.kind === 'totem') return '+3 次'
  if (result.kind === 'pearl') return result.loot ? `新卡 +1 ${LOOT_NAMES[result.loot]}` : '新卡！'
  // 末影之眼、箱子矿车另得的道具（§19）
  if (result.loot) return `+1 ${LOOT_NAMES[result.loot]}`
  if (result.kind === 'shield') return result.blocked ? '挡住了' : '盾牌'
  // 没有盾牌、待领取是 0 时踩到：没挡，只是没东西可扣
  if (result.kind === 'tnt' || result.kind === 'crystal') return result.blocked ? '挡住了' : '没扣到'
  // 有道具栏的局：道具收进工具条
  if (result.kind === 'spyglass') return result.text.startsWith('获得望远镜') ? '+1 望远镜' : '看到一格'
  const got: Partial<Record<DigResult['kind'], string>> = {
    coal: '+1 煤炭', stick: '+1 木棍', map: '+1 藏宝图', potion: '+1 急迫药水', key: '+1 钥匙', ender: '+1 末影箱',
    cobweb: '被蜘蛛网缠住了', spawner: '中毒了', minecart: '箱子矿车',
  }
  if (result.kind === 'coal' || result.kind === 'stick') return result.text.includes('已经够了') ? '够了，不算' : got[result.kind] ?? ''
  return got[result.kind] ?? ''
}

/**
 * 深暗之域卡角上的噪音（不是挖卡这一级的当前卡）：旧局写数；新局噪音会退，画一小段条，自己往回走（不重画网页）。
 */
function NoiseBadge({ card }: { card: PublicCard }) {
  const digInterval = useAtomValue(digIntervalAtom)
  if (card.closed) return <div className="card-noise" aria-label="监守者醒了"><ItemIcon kind="sculk" size={22} /><b>监守者醒了</b></div>
  if (card.noiseAt === undefined) return <div className="card-noise" aria-label={`噪音 ${card.noise ?? 0}`}><ItemIcon kind="sculk" size={22} /><span>噪音 {card.noise ?? 0}</span></div>
  const cells = card.cells.length - Object.keys(card.fixed ?? {}).length
  return <div className="card-noise" aria-label="噪音">
    <ItemIcon kind="sculk" size={22} /><span>噪音</span>
    <span className="noise-track is-v2 is-small" style={{ '--from': `${WARDEN_FROM * 100}%` } as CSSProperties} aria-hidden="true">
      <NoiseRail card={card} cells={cells} decay={noiseDecayMs({ digInterval })} />
    </span>
  </div>
}

/**
 * 监守者醒了：卡暗下来，监守者的脸浮在中间。刚醒（4 秒内）的那一下像原版的“黑暗”效果一明一暗几下，脸从下面升上来；
 * 打开网页时早就关了的卡直接是暗的（docs/V3_ITEMS.md §16）。
 */
function WardenWoke({ card }: { card: PublicCard }) {
  const fresh = !!card.wokeBy?.at && hb.now() - card.wokeBy.at < 4000
  return <div className={`card-closed${fresh ? ' is-fresh' : ''}`} aria-hidden="true">
    <span className="warden-face" />
    <span className="warden-words">监守者醒了</span>
  </div>
}
