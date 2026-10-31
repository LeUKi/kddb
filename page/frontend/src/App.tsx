import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useReducedMotion } from './useReducedMotion'
import { ItemIcon } from './ItemIcon'
import { CaveScene } from './CaveScene'
import { BoardFeedback, StoneBreak } from './GameFeedback'
import { ActivityLog } from './ActivityLog'
import type { PresentationEffect } from './presentation'
import { coordinate, defaultRules, formatMoney, kinds, loot } from './game'
import type { Cell, Kind, PublicGame, Rules } from './game'
import {
  checkingResultAtom, confirmSubmission, connect, connectionAtom, connectionErrorAtom, disconnect,
  hongbaoAtom, meAtom, nowAtom, pendingActionAtom, privateAtom, publicAtom,
  presentationAtom, setPresentationReducedMotion, settlementAtom, submit, toastAtom, unconfirmedInputAtom,
} from './store'

function useGameStatus() {
  const game = useAtomValue(publicAtom)
  const own = useAtomValue(privateAtom)
  const me = useAtomValue(meAtom)
  const packet = useAtomValue(hongbaoAtom)
  const connection = useAtomValue(connectionAtom)
  const pending = useAtomValue(pendingActionAtom)
  const unconfirmed = useAtomValue(unconfirmedInputAtom)
  const now = useAtomValue(nowAtom)
  const presentation = useAtomValue(presentationAtom)
  const ownTurnWait = own && game?.lastMove?.actorKey === own.actorKey ? game.lastMove.at + game.rules.waitSeconds * 1000 : 0
  const platformWait = me?.signedIn ? me.cooldownUntil ?? 0 : 0
  const gameSeconds = Math.max(0, Math.ceil((ownTurnWait - now) / 1000))
  const platformSeconds = Math.max(0, Math.ceil((platformWait - now) / 1000))
  const settled = Boolean(me?.signedIn && me.settled || own?.status === 'settled')
  const ended = packet?.status === 'ended'
  const participating = connection === 'ready' && packet?.status === 'active' && me?.signedIn && me.open && !settled && !unconfirmed
  return { game, own, me, packet, connection, pending, unconfirmed, now, gameSeconds, platformSeconds, settled, ended, presentation, canDig: Boolean(participating && !pending && !presentation.busy && !gameSeconds && !platformSeconds), canCashout: Boolean(participating && own && !pending && !presentation.busy && !platformSeconds) }
}

export function AppShell({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion()
  useEffect(() => { void connect(); return disconnect }, [])
  useEffect(() => setPresentationReducedMotion(Boolean(reducedMotion)), [reducedMotion])
  return <><CaveScene /><div className="app-shell">
    <header className="site-header">
      <div className="brand"><ItemIcon kind="pickaxe" size={28} /><span>矿洞夺宝</span></div>
    </header>
    <main id="main">{children}</main>
    <Toast />
    <Settlement />
  </div></>
}

function ConnectionState() {
  const connection = useAtomValue(connectionAtom)
  const error = useAtomValue(connectionErrorAtom)
  return <section className="connection-screen" aria-live="polite">
    <div className="entrance-icon"><ItemIcon kind="pickaxe" size={64} /></div>
    <h1>{connection === 'error' ? '矿场连接失败' : '正在打开矿场…'}</h1>
    {connection === 'error' && <><p>{error}</p><button className="primary-button" onClick={() => void connect()}>重新连接</button></>}
  </section>
}

export function GamePage() {
  const status = useGameStatus()
  const [rulesOpen, setRulesOpen] = useState(false)
  const game = status.presentation.game ?? status.game
  if (!game || status.connection !== 'ready') return <ConnectionState />
  return <div className="game-page">
    <RecoveryBanner />
    <PlayerSummary />
    <LootDashboard game={game} onOpen={() => setRulesOpen(true)} />
    <MineBoard />
    <TurnStatus />
    <CashoutControl />
    <ActivityLog feed={game.feed} />
    <Dialog open={rulesOpen} onDismiss={() => setRulesOpen(false)} labelledBy="rules-title" className="rules-dialog"><RulesContent game={game} onClose={() => setRulesOpen(false)} /></Dialog>
  </div>
}

function LootDashboard({ game, onOpen }: { game: PublicGame; onOpen: () => void }) {
  return <button className="loot-dashboard" type="button" onClick={onOpen} aria-label="本卡剩余道具，点击查看玩法规则" aria-haspopup="dialog" data-testid="rules-trigger">
    <span className="loot-counts">{kinds.map(kind => <span className={`loot-count ${game.counts[kind] === 0 ? 'depleted' : ''}`} key={kind} title={`${loot[kind].name}剩余 ${game.counts[kind]} 个`}><ItemIcon kind={kind} size={23} /><span aria-label={`${loot[kind].name}剩余 ${game.counts[kind]} 个`} data-testid={`count-${kind}`}>{game.counts[kind]}</span></span>)}</span>
    <span className="help-mark" aria-hidden="true">?</span>
  </button>
}

function RecoveryBanner() {
  const unconfirmed = useAtomValue(unconfirmedInputAtom)
  const checking = useAtomValue(checkingResultAtom)
  if (!unconfirmed) return null
  return <div className="recovery-banner" role="status"><p>上一笔操作的结果尚未确认，请先查询。</p><button className="secondary-button" disabled={checking} onClick={() => void confirmSubmission()}>{checking ? '正在查询…' : '重新确认状态'}</button></div>
}

function MineBoard() {
  const { game: authoritative, canDig, pending, presentation } = useGameStatus()
  const game = presentation.game ?? authoritative
  const own = presentation.game ? presentation.own : null
  const effect = presentation.effect
  const reducedMotion = useReducedMotion()
  const flipping = presentation.phase === 'transition' && presentation.transitionFrom !== null
  if (!game) return null
  return <section className="mine-panel" aria-labelledby="board-title">
    <div className="board-heading"><h2 id="board-title" data-testid="card-number">第 {game.cardId} 张卡片</h2><span className="shield-slot" data-hud-target="shield">{own?.shield && <motion.span className="equipped-shield" data-testid="my-shield" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><ItemIcon kind="shield" size={22} />已装备盾牌</motion.span>}</span></div>
    <motion.div className={`board-surround ${effect ? `resolving-${effect.kind}` : ''}`} data-animation-phase={presentation.phase} animate={effect?.kind === 'tnt' && effect.phase === 'resolve' && !effect.blocked && !reducedMotion ? { x: [0, -5, 4, -2, 1, 0], y: [0, 1, -1, 0] } : { x: 0, y: 0 }} transition={{ duration: .36 }}>
      <div className="mine-grid" data-testid="mine-grid" aria-busy={flipping}>
        {game.cells.map(cell => {
          if (flipping) return <FlippingCell key={cell.index} before={presentation.transitionFrom!.cells[cell.index]} after={cell} rules={game.rules} reduced={Boolean(reducedMotion)} />
          const peek = own?.peeks.find(peek => peek.cardId === game.cardId && peek.index === cell.index && cell.kind === null)
          const available = canDig && authoritative?.cardId === game.cardId && authoritative.cells[cell.index]?.kind === null
          return <MineCell key={cell.index} cell={cell} peek={peek?.kind} cardId={game.cardId} canDig={available} isPending={pending === `dig ${game.cardId} ${cell.index + 1}`} rules={game.rules} activeEffect={effect?.cardId === game.cardId && effect.index === cell.index ? effect : null} />
        })}
      </div>
      <BoardFeedback effect={effect} />
    </motion.div>
  </section>
}

function FlippingCell({ before, after, rules, reduced }: { before: Cell; after: Cell; rules: Rules; reduced: boolean }) {
  const delay = (Math.floor(after.index / 5) + after.index % 5) * .075
  const face = (cell: Cell, side: string) => <div className={`mine-cell card-flip-face ${side} ${cell.kind ? `revealed kind-${cell.kind}` : 'covered'}`}><CellArtwork cell={cell} rules={rules} /></div>
  return <div className="card-flip-slot" data-testid={`flip-cell-${after.index}`} data-flip-delay={reduced ? 0 : delay} aria-hidden="true">
    {reduced ? <motion.div className="card-flip-inner" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .1 }}>{face(after, 'flip-static')}</motion.div> : <motion.div className="card-flip-inner" initial={{ rotateY: 0 }} animate={{ rotateY: 180 }} transition={{ delay, duration: .54, ease: [.45, 0, .2, 1] }}>{face(before, 'flip-front')}{face(after, 'flip-back')}</motion.div>}
  </div>
}

function CellArtwork({ cell, rules, peek, fresh = false }: { cell: Cell; rules: Rules; peek?: Kind; fresh?: boolean }) {
  const reduced = useReducedMotion()
  const kind = cell.kind
  const effect = kind === 'emerald' ? `+${formatMoney(rules.smallReward)}` : kind === 'diamond' ? `+${formatMoney(rules.smallReward * rules.bigMultiplier)}` : kind === 'tnt' ? `−${rules.tntPercent}%` : kind === 'totem' ? `+${rules.totemBonus}次` : kind === 'apple' ? '×2' : kind === 'shield' ? '抵挡' : kind === 'spyglass' ? '透视' : '换卡'
  return kind ? <motion.div className="cell-reveal" initial={fresh ? { opacity: 0, scale: reduced ? 1 : .82 } : false} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .32, ease: [.22, 1, .36, 1] }}><ItemIcon kind={kind} size={43} /><span className="cell-effect">{effect}</span></motion.div> : <><span className="stone-cover" aria-hidden="true" />{peek && <><span className="peek-badge" aria-hidden="true"><ItemIcon kind="spyglass" size={16} /></span><ItemIcon kind={peek} size={39} className="peek-item" /></>}</>
}

function MineCell({ cell, peek, cardId, canDig, isPending, rules, activeEffect }: { cell: Cell; peek?: Kind; cardId: number; canDig: boolean; isPending: boolean; rules: Rules; activeEffect: PresentationEffect | null }) {
  const reducedMotion = useReducedMotion()
  const [trail, setTrail] = useState<string[]>([])
  const pointer = useRef<{ x: number; y: number; handled: boolean; cancelled: boolean; touch: boolean } | null>(null)
  const kind = cell.kind
  const perform = () => { if (canDig && !kind) void submit(`dig ${cardId} ${cell.index + 1}`) }
  const label = kind ? `${coordinate(cell.index)}，${loot[kind].name}，${cell.by ?? '玩家'}已挖开` : `${coordinate(cell.index)}，未挖掘${peek ? `，望远镜情报：${loot[peek].name}，仅你可见` : ''}`
  const fresh = activeEffect?.phase === 'resolve'
  return <motion.button type="button" className={`mine-cell ${kind ? `revealed kind-${kind}` : 'covered'} ${peek ? 'has-peek' : ''} ${isPending ? 'is-pending' : ''} ${activeEffect ? 'is-resolving' : ''}`} disabled={!canDig || kind !== null} aria-label={label} title={label} data-cell-index={cell.index} data-kind={kind ?? 'hidden'} data-private-hint={peek ?? undefined} data-testid={`cell-${cell.index}`} initial={false} whileHover={!reducedMotion && canDig && !kind ? { y: -2 } : undefined} whileTap={!reducedMotion && canDig && !kind ? { y: 2, scale: .96 } : undefined} transition={{ duration: .12 }}
    onClick={event => { if (event.detail === 0 || !pointer.current?.handled && !pointer.current?.cancelled) perform(); pointer.current = null; setTrail([]) }}
    onPointerDown={event => {
      if (!canDig || kind) return
      pointer.current = { x: event.clientX, y: event.clientY, handled: false, cancelled: false, touch: event.pointerType === 'touch' }
      setTrail([])
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={event => {
      const start = pointer.current
      if (!start || start.handled || start.cancelled || kind || !canDig) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (start.touch && Math.abs(dy) > 9 && Math.abs(dy) > Math.abs(dx)) { start.cancelled = true; setTrail([]); return }
      const box = event.currentTarget.getBoundingClientRect()
      setTrail(points => [...points.slice(-10), `${(event.clientX - box.left) / box.width * 100},${(event.clientY - box.top) / box.height * 100}`])
      if (Math.abs(dx) >= 24 && Math.abs(dx) > Math.abs(dy)) { start.handled = true; perform() }
    }}
    onPointerUp={() => setTrail([])}
    onPointerCancel={() => { if (pointer.current) pointer.current.cancelled = true; setTrail([]) }}>
    <CellArtwork key={kind ?? 'hidden'} cell={cell} rules={rules} peek={peek} fresh={fresh} />
    {isPending && <><span className="mining-crack" aria-hidden="true"/><motion.span className="mining-pickaxe" aria-label="正在判定" animate={reducedMotion ? { opacity: [.5, 1] } : { rotate: [-25, 35, -25], x: [2, -3, 2] }} transition={{ duration: .6, repeat: Infinity, ease: 'easeInOut' }}><ItemIcon kind="pickaxe" size={38}/></motion.span></>}
    {activeEffect?.phase === 'reveal' && <StoneBreak reduced={Boolean(reducedMotion)} />}
    {trail.length > 1 && <svg className="scratch-trail" viewBox="0 0 100 100" aria-hidden="true"><polyline points={trail.join(' ')} fill="none" stroke="#e6d6a4" strokeWidth="4" strokeLinecap="round" opacity=".7" /></svg>}
  </motion.button>
}

function TurnStatus() {
  const { game, own, me, pending, unconfirmed, settled, ended, gameSeconds, platformSeconds, presentation } = useGameStatus()
  let text = '选一格，挖开看看'
  let state = 'ready'
  const effect = presentation.effect
  if (effect) {
    text = effect.phase === 'reveal' ? '正在挖开…' : effect.phase === 'transition' ? '新卡片正在展开…' : effect.isOwn ? effect.kind === 'tnt' ? effect.blocked ? '盾牌挡住了 TNT' : `TNT · ${effect.amountDelta < 0 ? `损失 ${formatMoney(-effect.amountDelta)}` : '没有奖励损失'}` : effect.kind === 'totem' ? `双铁镐 · 机会 +${game?.rules.totemBonus ?? 2}` : effect.kind === 'pearl' ? '末影珍珠 · 前往下一张卡片' : effect.kind === 'spyglass' ? '望远镜 · 情报仅你可见' : effect.kind === 'shield' ? '盾牌已装备' : `${loot[effect.kind].name}${effect.amountDelta > 0 ? ` · +${formatMoney(effect.amountDelta)}` : ''}` : `${loot[effect.kind].name} · ${effect.kind === 'pearl' ? '大家一起换卡' : '有人挖开了这一格'}`
    state = 'effect'
  }
  else if (ended) { text = '本场已结束，结算记录见红包页'; state = 'finished' }
  else if (settled) { text = '你已结算，可以继续围观'; state = 'finished' }
  else if (unconfirmed) { text = '确认上一笔结果后即可继续'; state = 'waiting' }
  else if (!me?.signedIn) { text = '登录后即可参与挖掘'; state = 'waiting' }
  else if (!me.open) { text = me.why === 'not_in_scope' ? '你不在本场领取范围内' : me.why === 'paused' ? '本场暂时暂停' : '请在红包页查看参与条件'; state = 'waiting' }
  else if (pending) { text = pending === 'cashout' ? '正在结算…' : '正在挖开…'; state = 'waiting' }
  else if (platformSeconds > 0) { text = `操作冷却中，${platformSeconds} 秒后可提交`; state = 'waiting' }
  else if (gameSeconds > 0) { text = `等别人接棒，或 ${gameSeconds} 秒后继续`; state = 'waiting' }
  else if (own?.chances === 1) text = '最后一次机会，也可以现在收手'
  else if (game?.lastMove) text = game.lastMove.actorKey === own?.actorKey ? '可以继续挖掘了' : `${game.lastMove.name} 挖过了，轮到你了`
  return <div className={`turn-status ${state}`} role="status" data-testid="turn-status"><AnimatePresence mode="wait" initial={false}><motion.p key={text} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .08 }}>{text}</motion.p></AnimatePresence></div>
}

function PlayerSummary() {
  const { game, packet, presentation } = useGameStatus()
  const own = presentation.own
  const me = presentation.me
  const settled = Boolean(me?.signedIn && me.settled || own?.status === 'settled')
  const amount = me?.signedIn ? settled ? me.claim?.amount ?? '0.00' : me.pending ?? '0.00' : '0.00'
  const chances = own?.chances ?? game?.rules.initialChances ?? 7
  const effect = presentation.effect
  const transferring = effect?.isOwn && effect.phase === 'resolve'
  const reduced = useReducedMotion()
  return <section className="player-summary" aria-label="我的游戏状态">
    <div className={`earnings ${transferring && effect.amountDelta ? 'receiving-value' : ''}`} data-hud-target="reward"><span>{settled ? '已结算' : '待结算奖励'}</span><div><CountingAmount amount={amount} /><span>{packet?.unit ?? 'LDC'}</span></div><AnimatePresence>{transferring && effect.amountDelta !== 0 && <motion.b className={`hud-delta ${effect.amountDelta < 0 ? 'negative' : ''}`} key={effect.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: [0, 1, 1, 0], y: [8, 0, -8, -14] }} exit={{ opacity: 0 }} transition={{ duration: .6 }}>{effect.amountDelta > 0 ? '+' : '−'}{formatMoney(Math.abs(effect.amountDelta))}</motion.b>}</AnimatePresence></div>
    <div className={`chance-stat ${chances === 1 && !settled ? 'last-chance' : ''} ${transferring && effect.chanceDelta ? 'receiving-value' : ''}`}><span>剩余机会</span><div><AnimatePresence mode="popLayout" initial={false}><motion.strong key={chances} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .18 }} data-testid="my-chances">{chances}</motion.strong></AnimatePresence><span>次</span></div></div>
    <div className="chance-rack" data-hud-target="chances" aria-label={`${chances} 次挖掘机会`} data-testid="chance-rack"><AnimatePresence initial={false} mode="popLayout">{Array.from({ length: chances }, (_, index) => <motion.span key={index} className="chance-pickaxe" data-testid="chance-pickaxe" initial={{ opacity: 0, y: reduced ? 0 : -12, scale: reduced ? 1 : .7 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduced ? 0 : 10, scale: reduced ? 1 : .7 }} transition={{ duration: .3, delay: transferring && effect.chanceDelta > 0 ? Math.max(0, index - chances + effect.chanceDelta) * .07 : 0 }}><ItemIcon kind="pickaxe" size={25} /></motion.span>)}</AnimatePresence></div>
  </section>
}

function CountingAmount({ amount, testId = 'my-amount' }: { amount: string; testId?: string }) {
  const reduced = useReducedMotion()
  const value = useMotionValue(Number(amount))
  const text = useTransform(value, current => current.toFixed(2))
  useEffect(() => {
    if (reduced) { value.set(Number(amount)); return }
    const animation = animate(value, Number(amount), { duration: .34, ease: [.16, 1, .3, 1] })
    return () => animation.stop()
  }, [amount, value, reduced])
  return <motion.strong data-testid={testId}>{text}</motion.strong>
}

function CashoutControl() {
  const { game, own, me, packet, pending, settled, ended, canCashout } = useGameStatus()
  const [confirm, setConfirm] = useState(false)
  const chances = own?.chances ?? game?.rules.initialChances ?? 7
  const pendingMoney = me?.signedIn ? me.pending ?? '0.00' : '0.00'
  const unit = packet?.unit ?? 'LDC'
  return <>
    {!me?.signedIn ? <button className="primary-button cashout-button" onClick={() => { void window.hb.login().catch(() => undefined) }}>登录参与</button> : <button className="primary-button cashout-button" disabled={!canCashout} onClick={() => setConfirm(true)} data-testid="cashout-button"><ItemIcon kind="chest" size={25} />{settled ? '本场已结算' : ended ? '本场已结束' : pending === 'cashout' ? '正在结算…' : '收手结算'}</button>}
    <Dialog open={confirm} onDismiss={() => setConfirm(false)} labelledBy="cashout-title"><div className="dialog-icon"><ItemIcon kind="chest" size={48} /></div><h2 id="cashout-title">收手结算？</h2><p>领取 <strong>{pendingMoney} {unit}</strong>，放弃剩余 {chances} 次机会。本场不能再次加入。</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setConfirm(false)}>继续挖掘</button><button className="primary-button" disabled={!canCashout} onClick={() => { setConfirm(false); void submit('cashout') }}>确定收手</button></div></Dialog>
  </>
}

function RulesContent({ game, onClose }: { game: PublicGame; onClose: () => void }) {
  const packet = useAtomValue(hongbaoAtom)
  const rules = game?.rules ?? defaultRules
  return <article className="rules-content">
    <header className="rules-dialog-heading"><h2 id="rules-title">怎么玩</h2><button type="button" className="dialog-close" aria-label="关闭玩法规则" onClick={onClose}>×</button></header>
    <ul className="rules-basics">
      <li>大家共用一张卡片，点按或横向刮开格子。初始 {rules.initialChances} 次，每挖一格消耗 1 次。</li>
      <li>别人挖过就能接棒；连续自己挖，需要间隔 {rules.waitSeconds} 秒。</li>
      <li>随时收手领取，机会用完自动结算。结算后本场不能再次加入。</li>
    </ul>
    <section className="rules-items" aria-labelledby="items-title">
      <div className="rules-section-heading"><h2 id="items-title">{game ? `第 ${game.cardId} 张的剩余道具` : '卡片里的道具'}</h2></div>
      {kinds.map(kind => <div className={`rules-item ${game?.counts[kind] === 0 ? 'depleted' : ''}`} key={kind}>
        <ItemIcon kind={kind} size={40} />
        <div><h3>{loot[kind].name}<span>{game ? `剩 ${game.counts[kind]} 个` : `每卡 ${loot[kind].count} 个`}</span></h3><p>{kind === 'emerald' ? `奖励 +${formatMoney(rules.smallReward)}` : kind === 'diamond' ? `奖励 +${formatMoney(rules.smallReward * rules.bigMultiplier)}` : kind === 'apple' ? '当前奖励翻倍' : kind === 'totem' ? `机会 +${rules.totemBonus}` : kind === 'tnt' ? `扣除当前奖励的 ${rules.tntPercent}%` : kind === 'pearl' ? '所有人换下一张卡，保留机会和奖励' : kind === 'shield' ? '自动抵挡一次 TNT' : '提前看见一个格子，仅你可见'}</p></div>
      </div>)}
    </section>
    <details className="rules-details"><summary>更多规则与奖池</summary>
      <p>双铁镐在扣除本次机会后增加 {rules.totemBonus} 次，最后一次也能救回，没有累计限制。金苹果在奖励为零时给一份小奖；重复获得盾牌也给小奖。</p>
      <p>望远镜情报用虚线格子标记。换卡后情报失效，盾牌保留。没有新格子可看时，望远镜给小奖。25 格全部打开后也会换卡。</p>
      <p>抢到已开格子、操作旧卡片或未等满接棒时间都不扣机会。红包页本身的提交冷却仍然生效。</p>
      <p>奖励在结算前暂存，TNT 只扣本场待结算奖励，按分向下取整。收手和机会耗尽都会结算，零奖励也会退出本场。</p>
      <p>单次奖励不超过可分配奖池。奖池占满、红包截止或发放者结束时，全员统一结算。随机牌面可在红包结束后核对。</p>
      <dl className="pool-details"><div><dt>总奖池</dt><dd>{packet?.pool ?? '—'} {packet?.unit ?? 'LDC'}</dd></div><div><dt>剩余可分配</dt><dd data-testid="pool-amount">{packet?.unclaimed ?? '—'} {packet?.unit ?? 'LDC'}</dd></div></dl>
      <p className="credits">Minecraft 主题小游戏，非官方产品。</p>
    </details>
    <button className="primary-button return-button" type="button" onClick={onClose}>继续挖宝</button>
  </article>
}

function Dialog({ open, onDismiss, labelledBy, children, className = '' }: { open: boolean; onDismiss: () => void; labelledBy: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const reduced = useReducedMotion()
  useEffect(() => { const dialog = ref.current; if (!dialog) return; if (open && !dialog.open) dialog.showModal(); else if (!open && dialog.open) { const timer = setTimeout(() => dialog.close(), reduced ? 80 : 240); return () => clearTimeout(timer) } }, [open, reduced])
  return <motion.dialog className={`game-dialog ${className}`} ref={ref} data-open={open} aria-labelledby={labelledBy} initial={false} animate={open ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: reduced ? 0 : 18, scale: reduced ? 1 : .95 }} transition={{ duration: reduced ? .08 : .24, ease: [.22, 1, .36, 1] }} onCancel={event => { event.preventDefault(); onDismiss() }} onClose={onDismiss}>{children}</motion.dialog>
}

function Settlement() {
  const settlement = useAtomValue(settlementAtom)
  const lastSettlement = useRef(settlement)
  if (settlement) lastSettlement.current = settlement
  const result = settlement ?? lastSettlement.current
  const setSettlement = useSetAtom(settlementAtom)
  const presentation = useAtomValue(presentationAtom)
  const reduced = useReducedMotion()
  const visible = settlement !== null && !presentation.busy
  return <Dialog open={visible} onDismiss={() => setSettlement(null)} labelledBy="settlement-title"><div className="settlement-art"><motion.div className="settlement-rays" animate={visible ? { opacity: [0, .8, .45], scale: reduced ? 1 : [.5, 1.12, 1], rotate: reduced ? 0 : [0, 15] } : { opacity: 0 }} transition={{ duration: .8 }} /><motion.div className="dialog-icon" animate={visible && !reduced ? { y: [8, -5, 0], scale: [.85, 1.12, 1], rotate: [-5, 3, 0] } : { y: 0, scale: 1, rotate: 0 }} transition={{ duration: .5, ease: 'easeOut' }}><ItemIcon kind="chest" size={80} /></motion.div></div><h2 id="settlement-title">本场已结算</h2><motion.div className="settled-amount" initial={false} animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }} transition={{ delay: reduced ? 0 : .18, duration: .2 }}><CountingAmount amount={result?.amount ?? '0.00'} testId="settled-amount" /><small>{result?.unit ?? 'LDC'}</small></motion.div><p>结算记录可在红包页查看。</p><button className="primary-button" onClick={() => setSettlement(null)}>继续围观</button></Dialog>
}

function Toast() {
  const message = useAtomValue(toastAtom)
  const setMessage = useSetAtom(toastAtom)
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(null), message.tone === 'error' ? 7000 : 5000); return () => clearTimeout(timer) }, [message, setMessage])
  return <div className="toast-region" aria-live="polite"><AnimatePresence>{message && <motion.div className={`toast ${message.tone}`} key={message.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}><span aria-hidden="true">{message.tone === 'error' ? '!' : '✦'}</span><p>{message.text}</p><button aria-label="关闭提示" onClick={() => setMessage(null)}>×</button></motion.div>}</AnimatePresence></div>
}
