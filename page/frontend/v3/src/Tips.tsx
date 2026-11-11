import { useAtomValue } from 'jotai'
import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import { aimInfo, torchHoverAtom, torchWords } from './aim'
import { useCooling } from './Hud'
import { aimAtom, gameAtom, heldAtom, meAtom, store } from './state'

/**
 * 电脑上跟着指针的小提示（docs/V3_ITEMS.md §5）：拿着道具时说这一下会怎样（挖开几格、跳过几格、
 * 能不能插火把），指到火把上说颜色的意思，指到宝库上说还能开几次，镐子冷却时说还要等几秒。
 * 只有鼠标有；样式和工具条上的提示框一样。位置直接改样式，不让地图跟着重画。
 */
export function FollowTip({ box }: { box: RefObject<HTMLDivElement | null> }) {
  const held = useAtomValue(heldAtom)
  const aim = useAtomValue(aimAtom)
  const torch = useAtomValue(torchHoverAtom)
  const me = useAtomValue(meAtom)
  const cooling = useCooling()
  const tip = useRef<HTMLDivElement>(null)
  const [inside, setInside] = useState(false)
  const [vault, setVault] = useState<string | null>(null)

  useEffect(() => {
    const element = box.current
    if (!element) return
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      const rect = element.getBoundingClientRect()
      const node = tip.current
      if (node) {
        const x = Math.max(6, Math.min(event.clientX - rect.left + 16, rect.width - node.offsetWidth - 6))
        const y = Math.min(event.clientY - rect.top + 20, rect.height - node.offsetHeight - 6)
        node.style.transform = `translate(${x}px, ${y}px)`
      }
      const target = event.target instanceof Element ? event.target.closest('[data-vault]') : null
      setVault(target?.getAttribute('data-vault') ?? null)
      setInside(true)
    }
    const leave = () => setInside(false)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerleave', leave)
    return () => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerleave', leave)
    }
  }, [box])

  let text = ''
  if (torch) text = torchWords(torch)
  else if (held && aim) {
    // 不订阅整局（每次推送都换）：指针一动、换了位置就重新算
    const card = store.get(gameAtom)?.cards.find(item => item.id === aim.cardId)
    if (card) text = aimInfo(held, card, aim.index, me).words
  } else if (!held && vault) text = vault
  else if (!held && cooling.seconds) text = `还要等 ${cooling.seconds} 秒才能再挖`
  return <div ref={tip} className="follow-tip" hidden={!inside || !text} aria-hidden="true">{text}</div>
}
