import { useAtomValue, useSetAtom } from 'jotai'
import { animate, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { ItemIcon } from '../../src/ItemIcon'
import { blockedAtom, claim, claimingAtom, focusRequestAtom, gameAtom, hongbaoAtom, meAtom, settledAtom } from './state'
import type { Kind, PublicCard } from './types'
import { KIND_NAMES, KINDS, money } from './types'

/** 数字变了从旧的滚到新的；减少动画时直接到位。 */
export function Tween({ value, format = String }: { value: number; format?: (value: number) => string }) {
  const reduced = useReducedMotion() ?? false
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (reduced) {
      from.current = value
      setShown(value)
      return
    }
    const controls = animate(from.current, value, {
      duration: 0.45,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: latest => {
        from.current = latest
        setShown(Math.round(latest))
      },
    })
    // 页面在后台时动画帧不跑：到时间就直接是最终的数
    const settle = window.setTimeout(() => {
      from.current = value
      setShown(value)
    }, 600)
    return () => {
      controls.stop()
      window.clearTimeout(settle)
    }
  }, [reduced, value])
  return <>{format(shown)}</>
}

/** 上面一条：我的奖励、机会、盾牌，和领取。 */
export function TopBar({ onRules }: { onRules: () => void }) {
  const me = useAtomValue(meAtom)
  const hongbao = useAtomValue(hongbaoAtom)
  const claiming = useAtomValue(claimingAtom)
  const settled = useAtomValue(settledAtom)
  const blocked = useAtomValue(blockedAtom)
  const unit = hongbao?.unit ?? 'LDC'
  if (!me) return null
  const claimed = me.status === 'claimed'
  return <header className="top-bar">
    <div className="earned">
      <span>{settled ? '已领到' : '矿洞里的奖励'}</span>
      <strong><Tween value={settled ? Math.round(Number(settled.amount) * 100) : me.points} format={money} /> <small>{settled?.unit ?? unit}</small></strong>
    </div>
    <div className="chances" aria-label={`剩余机会 ${me.chances} 次${me.shield ? '，有盾牌' : ''}`}>
      <ItemIcon kind="pickaxe" size={22} />
      <strong><Tween value={me.chances} /></strong>
      {me.shield ? <ItemIcon kind="shield" size={20} className="has-shield" /> : null}
    </div>
    <div className="claim">
      {settled ? <span className="claim-done">领取完成</span>
        : <button type="button" className="claim-button" disabled={claiming === 'working'} onClick={() => void claim()}>
          {claiming === 'working' ? '正在领取' : claimed || claiming === 'filled' ? '再交一次' : blocked ? '领取' : '见好就收'}
        </button>}
    </div>
    <button type="button" className="rules-button" onClick={onRules} aria-label="怎么玩">?</button>
  </header>
}

/** 下面一条：居中这张卡、奖池、截止、动态。 */
export function BottomBar({ card }: { card: PublicCard | null }) {
  const game = useAtomValue(gameAtom)
  const hongbao = useAtomValue(hongbaoAtom)
  const setFocus = useSetAtom(focusRequestAtom)
  const [feedOpen, setFeedOpen] = useState(false)
  const [now, setNow] = useState(() => hb.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(hb.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  if (!game) return null
  const unit = hongbao?.unit ?? 'LDC'
  const opened = card ? card.cells.filter(Boolean).length : 0
  return <footer className="bottom-bar">
    {card ? <div className="card-info">
      <div className="card-title">
        <b>第 {card.id} 张卡</b>
        <span>{card.size}×{card.size} · 已挖 <Tween value={opened} />/{card.cells.length}{card.finished ? ' · 挖完了' : ''}</span>
      </div>
      <ul className="card-left" aria-label="这张卡还剩">
        {KINDS.filter(kind => card.left[kind] > 0 || kind !== 'emerald').map((kind: Kind) =>
          <li key={kind} className={card.left[kind] === 0 ? 'is-out' : ''} title={KIND_NAMES[kind]}>
            <ItemIcon kind={kind} size={18} />
            <Tween value={card.left[kind]} />
          </li>)}
      </ul>
    </div> : null}
    <div className="game-info">
      <span>奖池还剩 <b><Tween value={game.left} format={money} /></b> {unit}</span>
      <span>{game.stats.players} 人在挖 · {game.stats.claimed} 人已领</span>
      <span>{deadlineWords(game.deadlineAt, game.wrapUpAt, now, game.over)}</span>
      <button type="button" className="feed-toggle" onClick={() => setFeedOpen(open => !open)} aria-expanded={feedOpen}>动态 {feedOpen ? '▾' : '▸'}</button>
    </div>
    {feedOpen ? <ol className="feed">
      {game.feed.length === 0 ? <li className="feed-empty">还没有人挖</li> : game.feed.map(item =>
        <li key={item.seq}>
          <button type="button" onClick={() => setFocus({ cardId: item.cardId, at: Date.now() })}>
            <ItemIcon kind={item.kind} size={16} />
            <b>{item.name}</b> {item.text}
            <span className="feed-where">第 {item.cardId} 张</span>
          </button>
        </li>)}
    </ol> : null}
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
      {rules ? <dl className="rule-items">
        <dt><ItemIcon kind="emerald" size={18} /> 绿宝石</dt><dd>+{money(rules.smallReward)} {unit}</dd>
        <dt><ItemIcon kind="diamond" size={18} /> 钻石</dt><dd>+{money(rules.smallReward * rules.bigMultiplier)} {unit}</dd>
        <dt><ItemIcon kind="apple" size={18} /> 附魔金苹果</dt><dd>奖励翻倍{rules.appleCap > 0 ? `，一次最多加 ${money(rules.appleCap)}` : ''}；没有奖励时送一份小奖</dd>
        <dt><ItemIcon kind="totem" size={18} /> 双铁镐</dt><dd>机会 +{rules.totemBonus}</dd>
        <dt><ItemIcon kind="tnt" size={18} /> TNT</dt><dd>扣掉还没领的奖励的 {rules.tntPercent}%（盾牌能挡一次）</dd>
        <dt><ItemIcon kind="shield" size={18} /> 盾牌</dt><dd>挡下一次 TNT；已经有了就转成一份小奖</dd>
        <dt><ItemIcon kind="spyglass" size={18} /> 望远镜</dt><dd>看到这张卡上一个没开的格子，只有你看得见</dd>
        <dt><ItemIcon kind="pearl" size={18} /> 末影珍珠</dt><dd>旁边长出一张新卡</dd>
      </dl> : null}
      <p className="rules-tip">拖动地图平移，鼠标滚轮或捏合缩放。点邻卡边上的箭头或直接点那张卡就能换过去，方向键也行；+/- 缩放。</p>
      <div className="rules-actions">
        <button type="button" className="rules-practice" onClick={onPractice}>练习一下</button>
        <button type="button" onClick={onClose}>知道了</button>
      </div>
    </section>
  </div>
}
