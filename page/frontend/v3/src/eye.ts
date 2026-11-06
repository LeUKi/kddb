import type { PublicCard } from './types'

// 末影之眼和末地宝藏（docs/V3_MAP.md §5）：每第 eyeEvery 张普通卡藏一颗眼，挖到它
// 远处开出一张末地宝藏卡。底栏的一行和 JP 提示都看这里。

export type EyeStatus =
  /** 这一局不开末地宝藏（参数 0，或开局时还没有这个参数） */
  | { kind: 'off' }
  /** 有宝藏卡还没挖完：最要紧，先说它 */
  | { kind: 'treasure'; card: PublicCard }
  /** 有一颗眼还没挖到 */
  | { kind: 'eye'; card: PublicCard }
  /** 再长几张普通卡出下一颗眼 */
  | { kind: 'coming'; cards: number }

export const isTreasure = (card: Pick<PublicCard, 'kind'>) => card.kind === 'end'

export function eyeStatus(cards: PublicCard[], eyeEvery: number | undefined): EyeStatus {
  if (!eyeEvery) return { kind: 'off' }
  const treasure = [...cards].reverse().find(card => isTreasure(card) && !card.finished)
  if (treasure) return { kind: 'treasure', card: treasure }
  const eye = cards.find(card => !isTreasure(card) && (card.left.eye ?? 0) > 0)
  if (eye) return { kind: 'eye', card: eye }
  const normal = cards.filter(card => !isTreasure(card)).length
  return { kind: 'coming', cards: eyeEvery - (normal % eyeEvery) }
}
