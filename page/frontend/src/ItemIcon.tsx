import type { IconKind } from './game'

const base = './assets/minecraft/1.21.4'
const textures: Record<IconKind, string> = {
  emerald: 'textures/item/emerald.png',
  diamond: 'textures/item/diamond.png',
  apple: 'inventory/enchanted_golden_apple.png',
  totem: 'textures/item/totem_of_undying.png',
  pearl: 'textures/item/ender_pearl.png',
  spyglass: 'textures/item/spyglass.png',
  pickaxe: 'textures/item/iron_pickaxe.png',
  tnt: 'inventory/tnt.png',
  shield: 'inventory/shield.png',
  chest: 'inventory/chest.png',
  ore: 'inventory/stone.png',
}

/** Unmodified vanilla textures/renders. Provenance: docs/MINECRAFT_ASSETS.md. */
export function ItemIcon({ kind, size = 32, className = '' }: { kind: IconKind; size?: number; className?: string }) {
  if (kind === 'totem') return <span className={`item-icon pickaxe-pair ${className}`} style={{ width: size, height: size }} aria-hidden="true"><img className="pair-back" src={`${base}/${textures.pickaxe}`} alt="" draggable={false} /><img className="pair-front" src={`${base}/${textures.pickaxe}`} alt="" draggable={false} /></span>
  if (kind === 'apple') return <picture className={`item-icon ${className}`} style={{ width: size, height: size }} aria-hidden="true"><source media="(prefers-reduced-motion: reduce)" srcSet={`${base}/${textures.apple}`} /><img src={`${base}/inventory/enchanted_golden_apple.gif`} width={size} height={size} alt="" draggable={false} /></picture>
  return <img className={`item-icon ${className}`} src={`${base}/${textures[kind]}`} width={size} height={size} alt="" aria-hidden="true" draggable={false} />
}
