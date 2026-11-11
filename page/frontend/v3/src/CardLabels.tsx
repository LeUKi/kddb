import { useAtomValue, useSetAtom } from 'jotai'
import { motion } from 'motion/react'
import type { CSSProperties } from 'react'
import { ItemIcon } from '../../src/ItemIcon'
import { CARD_PX, SLOT_PX } from './camera'
import { McText } from './McText'
import { aboutMoney, leftoversOf, noiseOf, regionName, richestOf } from './regions'
import { dialogAtom, focusRequestAtom, gameAtom, hongbaoAtom } from './state'
import type { PublicCard } from './types'
import { KIND_NAMES } from './types'

/**
 * 卡周围的说明（docs/V3_ITEMS.md §9，2026-11-11 用户：区块本身要有说明，底栏那些不用了，都放在卡周围）：
 * 挖卡这一级，当前卡的上面一行是区块名字带问号（点开是说明弹窗）和挖了几格，下面一行是余量（只说还有
 * 什么值得挖），深暗之域下面是噪音条。放在地图里（跟着拖动走），字按镜头缩放反着缩，屏幕上一直一样大；
 * 镜头在挖卡这一级上下各留了一行的地方（camera.ts LABEL_SPACE）。换卡时淡出淡入。
 */
export function CardLabels({ card }: { card: PublicCard }) {
  const setDialog = useSetAtom(dialogAtom)
  const style = {
    left: card.x * SLOT_PX - CARD_PX / 2,
    top: card.y * SLOT_PX - CARD_PX / 2,
    width: CARD_PX,
    height: CARD_PX,
  } as CSSProperties
  const fixed = Object.keys(card.fixed ?? {}).length
  const dug = card.cells.filter(cell => cell && !cell.burn).length
  const deep = card.kind === 'deep'
  return <motion.div className="card-labels" style={style} aria-label={`${regionName(card)}的说明`}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
    <div className="card-head">
      <button type="button" className={`region-name is-${card.kind ?? 'normal'}`} onClick={() => setDialog({ type: 'region', cardId: card.id })}
        aria-label={`${regionName(card)}：点开看说明`}>
        {regionName(card)}<i aria-hidden="true">?</i>
      </button>
      {deep ? <Leftovers card={card} /> : <span className="card-progress">
        {card.closed ? '监守者醒了，这张卡关了' : card.finished ? '挖完了' : `已挖 ${dug}/${card.cells.length - fixed}`}
      </span>}
    </div>
    <div className="card-foot">
      {deep ? <Noise card={card} /> : <Leftovers card={card} />}
    </div>
  </motion.div>
}

/**
 * 余量（docs/V3_ITEMS.md §9）：还藏着约多少钱、有哪几样宝贝（几个用原版乱码盖住，每一帧跳）；
 * 挖得差不多了（挖完、关了也一样）就指去最富的那张，点一下飞过去。
 */
function Leftovers({ card }: { card: PublicCard }) {
  const game = useAtomValue(gameAtom)
  const unit = useAtomValue(hongbaoAtom)?.unit ?? 'LDC'
  const focus = useSetAtom(focusRequestAtom)
  if (!game) return null
  const { worth, kinds, poor } = leftoversOf(card, game.rules, game.left)
  if (poor) {
    const richest = richestOf(game.cards, game.rules, game.left, card.id)
    const open = !card.finished && !card.closed
    if (!richest) return open ? <span className="leftovers is-empty">宝贝都被挖走了</span> : null
    const where = regionName(richest.card)
    return <span className="leftovers is-poor">
      {open ? <span className="leftovers-label">这张挖得差不多了</span> : null}
      <button type="button" className="go-richest" onClick={() => focus({ cardId: richest.card.id, at: Date.now(), dig: true })}>
        去{where} ➜ 还藏着约 <b>{aboutMoney(richest.worth)}</b> {unit}
      </button>
    </span>
  }
  return <span className="leftovers" aria-label={`还藏着约 ${aboutMoney(worth)} ${unit}${kinds.length ? `，有${kinds.map(kind => KIND_NAMES[kind]).join('、')}` : ''}`}>
    <span className="leftovers-label">还藏着约</span>
    <b className="leftovers-worth">{aboutMoney(worth)}</b>
    <span className="leftovers-label">{unit}</span>
    {kinds.map(kind => <span key={kind} className="leftover"><ItemIcon kind={kind} size={18} /><McText text={String(card.left[kind] ?? 0)} color="#ffaa00" obfuscate /></span>)}
  </span>
}

/** 深暗之域的噪音条：前面一段安全，斜纹那段是危险区，点是现在的噪音。 */
function Noise({ card }: { card: PublicCard }) {
  const noise = noiseOf(card)
  if (noise.closed) return <span className="noise-line is-closed"><ItemIcon kind="sculk" size={16} />监守者醒了，这张卡关了</span>
  const at = (value: number) => `${Math.min(100, (value / noise.cells) * 100)}%`
  return <span className={`noise-line${noise.danger ? ' is-danger' : ''}`} role="status">
    <ItemIcon kind="sculk" size={16} />
    <b>噪音 {noise.noise}</b>
    <span className="noise-track" style={{ '--a': at(noise.low), '--b': at(noise.high), '--n': at(noise.noise) } as CSSProperties} aria-hidden="true"><i /></span>
    <span className="noise-words">{noise.danger ? '随时可能惊醒监守者' : `再挖 ${noise.toDanger} 格进入危险区`}</span>
  </span>
}
