import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { ItemIcon } from '../../src/ItemIcon'
import { mutedAtom, play, setMuted } from './sound'
import { blockedAtom, claim, claimingAtom, focusRequestAtom, gameAtom, hongbaoAtom, meAtom, readyAtAtom, settledAtom, summaryOpenAtom } from './state'
import type { Kind, PublicCard } from './types'
import { KIND_NAMES, KINDS, money } from './types'
import { crystalPercent, eyeStatus, isTreasure } from './eye'

/**
 * 数字变了从旧的滚到新的；减少动画时直接到位。滚动直接改这一小段文字（motion 值），
 * 不让整条栏每一帧重新渲染：手机上拖地图、吸附的时候不抢主线程。
 */
export function Tween({ value, format = String }: { value: number; format?: (value: number) => string }) {
  const reduced = useReducedMotion() ?? false
  const shown = useMotionValue(value)
  const formatRef = useRef(format)
  formatRef.current = format
  const text = useTransform(shown, latest => formatRef.current(Math.round(latest)))
  useEffect(() => {
    if (reduced) {
      shown.set(value)
      return
    }
    const controls = animate(shown, value, { duration: 0.45, ease: [0.22, 1, 0.36, 1] })
    // 页面在后台时动画帧不跑：到时间就直接是最终的数
    const settle = window.setTimeout(() => shown.set(value), 600)
    return () => {
      controls.stop()
      window.clearTimeout(settle)
    }
  }, [reduced, value, shown])
  return <motion.span>{text}</motion.span>
}

/**
 * 挖掘间隔拉长时（3 秒以上）还要等多久：seconds 是剩下的整秒（能挖时 0），left 是剩下的
 * 比例。间隔 1 秒时总是 0，什么都不显示。冷却时每 200 毫秒更新一次。
 */
export function useCooling() {
  const readyAt = useAtomValue(readyAtAtom)
  const interval = useAtomValue(gameAtom)?.rules.digInterval ?? 1
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (interval <= 1 || readyAt <= Date.now()) return
    const timer = window.setInterval(() => {
      const at = Date.now()
      setNow(at)
      if (at >= readyAt) window.clearInterval(timer)
    }, 200)
    return () => window.clearInterval(timer)
  }, [interval, readyAt])
  if (interval <= 1 || now >= readyAt) return { seconds: 0, left: 0 }
  return { seconds: Math.ceil((readyAt - now) / 1000), left: Math.min(1, (readyAt - now) / (interval * 1000)) }
}

/** 上面一条：我的奖励、机会、盾牌，和领取。 */
export function TopBar({ onRules }: { onRules: () => void }) {
  const me = useAtomValue(meAtom)
  const hongbao = useAtomValue(hongbaoAtom)
  const claiming = useAtomValue(claimingAtom)
  const settled = useAtomValue(settledAtom)
  const blocked = useAtomValue(blockedAtom)
  const cooling = useCooling()
  const unit = hongbao?.unit ?? 'LDC'
  if (!me) return null
  const claimed = me.status === 'claimed'
  // 手里没有分：领了也是 0，按钮不能点
  const empty = !claimed && me.points <= 0
  return <header className="top-bar">
    <div className="earned">
      <span>{settled ? '已领到' : '矿洞里的奖励'}</span>
      <strong><Tween value={settled ? Math.round(Number(settled.amount) * 100) : me.points} format={money} /> <small>{settled?.unit ?? unit}</small></strong>
    </div>
    <div className={`chances${cooling.seconds ? ' is-cooling' : ''}`} aria-label={`剩余机会 ${me.chances} 次${me.shield ? '，有盾牌' : ''}${cooling.seconds ? `，还要等 ${cooling.seconds} 秒` : ''}`}>
      <ItemIcon kind="pickaxe" size={22} />
      <strong><Tween value={me.chances} /></strong>
      {me.shield ? <ItemIcon kind="shield" size={20} className="has-shield" /> : null}
      {cooling.seconds ? <>
        <span className="cooling-text">{cooling.seconds} 秒</span>
        <span className="cooling-bar" style={{ transform: `scaleX(${cooling.left})` }} aria-hidden="true" />
      </> : null}
    </div>
    <div className="claim">
      {settled ? <span className="claim-done">领取完成</span>
        : <button type="button" className="claim-button" disabled={claiming === 'working' || empty} onClick={() => void claim()}>
          {claiming === 'working' ? '正在领取' : claimed || claiming === 'filled' ? '再交一次' : empty && blocked ? '没有奖励' : blocked ? '领取' : '见好就收'}
        </button>}
    </div>
    <SoundButton />
    <button type="button" className="rules-button" onClick={onRules} aria-label="怎么玩">?</button>
  </header>
}

/** 声音开关：记在本机；打开时响一下，让他知道有声音。 */
function SoundButton() {
  const [muted, setMutedState] = useAtom(mutedAtom)
  const toggle = () => {
    const next = !muted
    setMuted(next)
    setMutedState(next)
    if (!next) play('click')
  }
  return <button type="button" className={`sound-button${muted ? ' is-muted' : ''}`} onClick={toggle} aria-pressed={!muted} aria-label={muted ? '打开音效' : '关掉音效'} title={muted ? '打开音效' : '关掉音效'}>
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      <g className="sound-waves" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M16 9.5a3.5 3.5 0 0 1 0 5" /><path d="M18.5 7a7 7 0 0 1 0 10" /></g>
      <path className="sound-cross" d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  </button>
}

/** 下面一条：居中这张卡、奖池、截止，和收益卡的按钮。 */
export function BottomBar({ card }: { card: PublicCard | null }) {
  const game = useAtomValue(gameAtom)
  const hongbao = useAtomValue(hongbaoAtom)
  const setFocus = useSetAtom(focusRequestAtom)
  const setSummary = useSetAtom(summaryOpenAtom)
  const [now, setNow] = useState(() => hb.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(hb.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  if (!game) return null
  const unit = hongbao?.unit ?? 'LDC'
  const opened = card ? card.cells.filter(Boolean).length : 0
  const treasure = card ? isTreasure(card) : false
  const left = (kind: Kind) => card?.left[kind] ?? 0
  // 宝藏卡只列它有的几样（以前开的宝藏卡没有末影水晶）；普通卡照旧（挖完的绿宝石不列），末影之眼有才列
  const shown = (kind: Kind) => treasure ? ['emerald', 'diamond', 'apple'].includes(kind) || (kind === 'crystal' && card?.left.crystal !== undefined)
    : kind === 'crystal' ? false : kind === 'eye' ? left(kind) > 0 : left(kind) > 0 || kind !== 'emerald'
  const eye = eyeStatus(game.cards, game.rules.eyeEvery)
  return <footer className="bottom-bar">
    {card ? <div className="card-info">
      <div className="card-title">
        <b>{treasure ? '末地宝藏' : `第 ${card.id} 张卡`}</b>
        <span>{card.size}×{card.size} · 已挖 <Tween value={opened} />/{card.cells.length}{card.finished ? ' · 挖完了' : ''}</span>
      </div>
      <ul className="card-left" aria-label="这张卡还剩">
        {KINDS.filter(shown).map((kind: Kind) =>
          <li key={kind} className={left(kind) === 0 ? 'is-out' : kind === 'eye' ? 'is-eye' : kind === 'crystal' ? 'is-crystal' : ''} title={KIND_NAMES[kind]}>
            <ItemIcon kind={kind} size={18} />
            <Tween value={left(kind)} />
          </li>)}
      </ul>
    </div> : null}
    <div className="game-info">
      <span>奖池还剩 <b><Tween value={game.left} format={money} /></b> {unit}</span>
      <span>{game.stats.players} 人在挖 · {game.stats.claimed} 人已领</span>
      <span>{deadlineWords(game.deadlineAt, game.wrapUpAt, now, game.over)}</span>
      {eye.kind === 'treasure' ? <button type="button" className="eye-status is-treasure" onClick={() => setFocus({ cardId: eye.card.id, at: Date.now() })}><ItemIcon kind="eye" size={14} />末地宝藏开了，点这里过去</button>
        : eye.kind === 'eye' ? <button type="button" className="eye-status" onClick={() => setFocus({ cardId: eye.card.id, at: Date.now() })}><ItemIcon kind="eye" size={14} />末影之眼藏在第 {eye.card.id} 张卡里</button>
          : eye.kind === 'coming' ? <span className="eye-status"><ItemIcon kind="eye" size={14} />{eye.cards === 1 ? '下一张新卡里藏着末影之眼' : `往后第 ${eye.cards} 张新卡里藏着末影之眼`}</span> : null}
      <button type="button" className="summary-toggle" onClick={() => setSummary('button')}>
        <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M2 16h16M3 13l4-4 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        收益
      </button>
    </div>
  </footer>
}

function deadlineWords(deadlineAt: number | null, wrapUpAt: number | null, now: number, over: boolean) {
  if (over) return '奖池分完了，游戏结束'
  if (deadlineAt === null || wrapUpAt === null) return '没有截止时间'
  if (now >= deadlineAt) return '红包已截止'
  if (now >= wrapUpAt) return `停止挖掘，${clock(deadlineAt - now)} 后截止，请领取`
  return `${clock(wrapUpAt - now)} 后停止挖掘`
}

function clock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h > 0 ? `${h} 小时 ${m} 分` : m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`
}

/** 怎么玩：规则和这个红包的参数。 */
export function Rules({ onClose, onPractice }: { onClose: () => void; onPractice: () => void }) {
  const game = useAtomValue(gameAtom)
  const hongbao = useAtomValue(hongbaoAtom)
  const unit = hongbao?.unit ?? 'LDC'
  const rules = game?.rules
  return <div className="rules-backdrop" onClick={onClose}>
    <section className="rules" role="dialog" aria-modal="true" aria-label="怎么玩" onClick={event => event.stopPropagation()}>
      <h2>怎么玩</h2>
      <ul>
        <li>矿洞卡铺成一张地图，大家一起挖。放大到一张卡上才能挖，点一格用 1 次机会。</li>
        <li>挖到的奖励先记在矿洞里，点「见好就收」才领进红包；机会用完、奖池分完会自动领取。</li>
        <li><b>截止前要领取</b>：截止前 2 分钟停止挖掘，开着网页的人自动领取，没领的作废。</li>
        <li>末影珍珠会在这张卡旁边长出一张新卡；旧卡挖完以前一直能挖。</li>
      </ul>
      {rules?.players ? <p className="rules-money">这个红包按大约 {rules.players} 人、每人 {rules.initialChances} 次机会算：绿宝石 {money(rules.smallReward)} {unit}，钻石 {money(rules.smallReward * rules.bigMultiplier)} {unit}。</p> : null}
      {rules && (rules.digInterval ?? 1) > 1 ? <p className="rules-money">每人两次挖掘至少隔 {rules.digInterval} 秒。</p> : null}
      {rules ? <dl className="rule-items">
        <dt><ItemIcon kind="emerald" size={18} /> 绿宝石</dt><dd>+{money(rules.smallReward)} {unit}</dd>
        <dt><ItemIcon kind="diamond" size={18} /> 钻石</dt><dd>+{money(rules.smallReward * rules.bigMultiplier)} {unit}</dd>
        <dt><ItemIcon kind="apple" size={18} /> 附魔金苹果</dt><dd>奖励翻倍{rules.appleCap > 0 ? `，一次最多加 ${money(rules.appleCap)}` : ''}；没有奖励时送一份小奖</dd>
        <dt><ItemIcon kind="totem" size={18} /> 双铁镐</dt><dd>机会 +{rules.totemBonus}</dd>
        <dt><ItemIcon kind="tnt" size={18} /> TNT</dt><dd>扣掉还没领的奖励的 {rules.tntPercent}%（盾牌能挡一次）</dd>
        <dt><ItemIcon kind="shield" size={18} /> 盾牌</dt><dd>挡下一次 TNT；已经有了就转成一份小奖</dd>
        <dt><ItemIcon kind="spyglass" size={18} /> 望远镜</dt><dd>看到这张卡上一个没开的格子，只有你看得见</dd>
        <dt><ItemIcon kind="pearl" size={18} /> 末影珍珠</dt><dd>旁边长出一张新卡</dd>
        {rules.eyeEvery ? <><dt><ItemIcon kind="eye" size={18} /> 末影之眼</dt><dd>每 {rules.eyeEvery} 张卡有一颗，那张卡发紫光；挖到它，远处开出末地宝藏（3×3{rules.endMix === 2 ? '，每张随机：钻石 1–2 颗、双铁镐 1–2 把、金苹果 0–1 个，其余是绿宝石' : ''}），没领奖的人都能挖</dd>
          <dt><ItemIcon kind="crystal" size={18} /> 末影水晶</dt><dd>藏在末地宝藏里，一张{rules.endMix === 2 ? '一到两颗' : '一颗'}；踩中扣掉还没领的奖励的 {crystalPercent(rules)}%（TNT 的两倍，盾牌能挡）</dd></> : null}
      </dl> : null}
      <p className="rules-tip">拖动地图平移，滚轮或捏合缩放。点旁边的卡就能换过去，方向键也行；+/- 缩放。全图那一级能看到所有的卡，不能拖动。</p>
      <div className="rules-actions">
        <button type="button" className="rules-practice" onClick={onPractice}>练习一下</button>
        <button type="button" onClick={onClose}>知道了</button>
      </div>
    </section>
  </div>
}
