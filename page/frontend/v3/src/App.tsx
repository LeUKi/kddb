import { useAtom, useAtomValue } from 'jotai'
import { useCallback, useEffect, useState } from 'react'
import { CaveScene } from '../../src/CaveScene'
import { Guide, GUIDE_SEEN } from './Guide'
import { BottomBar, Rules, TopBar } from './Hud'
import { MapView } from './MapView'
import { installSound } from './sound'
import { gameAtom, hongbaoAtom, meAtom, phaseAtom, problemAtom, signIn, start, summaryOpenAtom, toastAtom } from './state'
import { SummaryCard } from './Summary'
import { ItemDialogs } from './Dialogs'

export function App() {
  const phase = useAtomValue(phaseAtom)
  const problem = useAtomValue(problemAtom)
  const [rules, setRules] = useState(false)
  const [guide, setGuide] = useState(false)
  const game = useAtomValue(gameAtom)
  const me = useAtomValue(meAtom)
  const hongbao = useAtomValue(hongbaoAtom)
  const [summary, setSummary] = useAtom(summaryOpenAtom)
  const closeSummary = useCallback(() => setSummary(null), [setSummary])

  // 第一次来、还没挖过：先练一下
  const meReady = phase === 'ready' && me !== null
  useEffect(() => {
    if (!meReady || !me || me.digs > 0 || me.status !== 'playing') return
    let seen = false
    try {
      seen = localStorage.getItem(GUIDE_SEEN) === '1'
    } catch {
      // 记不住也照样练
    }
    if (!seen) setGuide(true)
    // 只在连上时看一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meReady])
  const closeGuide = () => {
    setGuide(false)
    try {
      localStorage.setItem(GUIDE_SEEN, '1')
    } catch {
      // 记不住就算了
    }
  }

  useEffect(() => {
    installSound()
    void start()
  }, [])

  // 素材路径跟着网页走（线上在 /v3/ 下，开发包里在根上）
  useEffect(() => {
    document.documentElement.style.setProperty('--stone', `url("${new URL('assets/minecraft/1.21.4/textures/block/stone.png', document.baseURI)}")`)
    document.documentElement.style.setProperty('--end-stone', `url("${new URL('assets/minecraft/1.21.4/textures/block/end_stone.png', document.baseURI)}")`)
    // 区块和道具用的原版贴图（docs/V3_ITEMS.md）
    for (const [name, path] of Object.entries({
      'tuff-bricks': 'block/tuff_bricks', 'chiseled-tuff': 'block/chiseled_tuff', 'copper-bulb': 'block/copper_bulb_lit', netherrack: 'block/netherrack',
      planks: 'block/oak_planks', rail: 'block/rail', 'rail-corner': 'block/rail_corner', 'deepslate-tiles': 'block/deepslate_tiles', sculk: 'block/sculk', lava: 'block/lava_still',
      creeper: 'entity/creeper/creeper', cobweb: 'block/cobweb', 'effect-bg': 'gui/sprites/hud/effect_background', 'toast-bg': 'gui/sprites/toast/advancement', 'goal-frame': 'gui/sprites/advancements/goal_frame_obtained', warden: 'entity/warden/warden', 'potion-overlay': 'item/potion_overlay', 'pick-mask': 'item/iron_pickaxe',
    })) document.documentElement.style.setProperty(`--${name}`, `url("${new URL(`assets/minecraft/1.21.4/textures/${path}.png`, document.baseURI)}")`)
  }, [])

  return <div className="v3-app">
    <CaveScene />
    {phase === 'starting' ? <div className="state-card"><div className="sheen" /><p>正在打开矿洞…</p></div>
      : phase === 'login' ? <div className="state-card"><p>登录以后才能挖宝</p><button type="button" onClick={() => void signIn()}>登录</button></div>
        : phase === 'error' ? <div className="state-card"><p>{problem}</p><button type="button" onClick={() => void start()}>再试一次</button></div>
          : phase === 'out' ? <div className="state-card"><p>{problem}</p></div>
          : <>
            <TopBar onRules={() => setRules(true)} />
            <MapView />
            <BottomBar />
          </>}
    {rules ? <Rules onClose={() => setRules(false)} onPractice={() => { setRules(false); setGuide(true) }} /> : null}
    {phase === 'ready' ? <ItemDialogs /> : null}
    {guide && game ? <Guide rules={game.rules} unit={hongbao?.unit ?? 'LDC'} onClose={closeGuide} /> : null}
    {summary && phase === 'ready' ? <SummaryCard reason={summary} onClose={closeSummary} /> : null}
    <Toast />
  </div>
}

function Toast() {
  const toast = useAtomValue(toastAtom)
  const [shown, setShown] = useState(toast)
  useEffect(() => {
    setShown(toast)
    if (!toast) return
    const timer = window.setTimeout(() => setShown(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])
  return shown ? <div className={`toast tone-${shown.tone}`} role="status" key={shown.id}>{shown.text}</div> : null
}
