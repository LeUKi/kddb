import type { Kind, Step } from './types'

// 收益曲线（收益卡里）：每挖一格后手里多少分，连成一条线；钻石、金苹果、踩雷、盾牌挡住
// 的那几格在线上画物品的图标（以前是小圆点加一行图例，图例像坐标刻度，看不懂）。纯函数，测试直接算。

export interface ChartBox { width: number; height: number; padX: number; padTop: number; padBottom: number }
export const CHART: ChartBox = { width: 320, height: 132, padX: 8, padTop: 16, padBottom: 10 }

export type Mark = 'big' | 'apple' | 'boom' | 'blocked'
export interface Marker {
  x: number; y: number; mark: Mark; step: number
  /** 第几次挖（逐格记录里还有中毒、末影箱、宝库、苦力怕、监守者这些不是挖的，不算） */
  dig?: number
  /** 挖到的是什么、多了（少了）多少分 */
  kind: Kind; amount: number
}

export interface Chart {
  /** 折线 */
  line: string
  /** 折线下面的面（填渐变） */
  area: string
  /** 0 分那条基线的 y */
  baseY: number
  markers: Marker[]
  /** 最高点（标数） */
  peak: { x: number; y: number; points: number } | null
  /** 最后一格的位置和分 */
  end: { x: number; y: number; points: number }
  max: number
}

const markOf = (kind: Kind, step: Step): Mark | null => {
  if (step.b) return 'blocked'
  if ((kind === 'tnt' || kind === 'crystal') && step.a < 0) return 'boom'
  if (kind === 'diamond') return 'big'
  if (kind === 'apple' && step.a > 0) return 'apple'
  return null
}

/** 逐格记录里不是挖格子的几种（有道具栏的局）：中毒、苦力怕、监守者、末影箱、宝库 */
const NOT_DIGS = new Set<string>(['poison', 'creeper', 'warden', 'ender', 'vault'])

/** 从 0 分开始，第 i 格挖完是 trail[i - 1].p；横轴按挖的次数平分。 */
export function chartOf(trail: Step[], box: ChartBox = CHART): Chart {
  const values = [0, ...trail.map(step => step.p)]
  const max = Math.max(1, ...values)
  const innerWidth = box.width - box.padX * 2
  const innerHeight = box.height - box.padTop - box.padBottom
  const xOf = (index: number) => box.padX + (values.length === 1 ? innerWidth : (index / (values.length - 1)) * innerWidth)
  const yOf = (points: number) => box.padTop + innerHeight - (points / max) * innerHeight
  const round = (value: number) => Math.round(value * 10) / 10
  const points = values.map((value, index) => `${round(xOf(index))},${round(yOf(value))}`)
  const line = `M${points.join('L')}`
  const baseY = round(yOf(0))
  const area = `${line}L${round(xOf(values.length - 1))},${baseY}L${round(xOf(0))},${baseY}Z`
  const markers: Marker[] = []
  let digs = 0
  trail.forEach((step, index) => {
    if (!NOT_DIGS.has(step.k)) digs += 1
    const mark = markOf(step.k, step)
    if (mark) markers.push({ x: round(xOf(index + 1)), y: round(yOf(step.p)), mark, step: index + 1, dig: digs, kind: step.k, amount: step.a })
  })
  let peakAt = 0
  values.forEach((value, index) => {
    if (value > values[peakAt]) peakAt = index
  })
  const last = values.length - 1
  return {
    line, area, baseY, markers, max,
    peak: values[peakAt] > 0 ? { x: round(xOf(peakAt)), y: round(yOf(values[peakAt])), points: values[peakAt] } : null,
    end: { x: round(xOf(last)), y: round(yOf(values[last])), points: values[last] },
  }
}

/** 图标画哪个：钻石、金苹果；踩雷画 TNT 或末影水晶；挡住画盾牌。 */
export function iconOf(marker: Pick<Marker, 'mark' | 'kind'>): 'diamond' | 'apple' | 'tnt' | 'crystal' | 'shield' {
  if (marker.mark === 'big') return 'diamond'
  if (marker.mark === 'apple') return 'apple'
  if (marker.mark === 'blocked') return 'shield'
  return marker.kind === 'crystal' ? 'crystal' : 'tnt'
}

/** 点（指着）图标时说的那一句。money 由调用的地方给（分 → 两位小数）。 */
export function markerWords(marker: Pick<Marker, 'mark' | 'kind' | 'amount' | 'step' | 'dig'>, money: (points: number) => string) {
  const at = `第 ${marker.dig ?? marker.step} 格`
  const bomb = marker.kind === 'crystal' ? '末影水晶' : 'TNT'
  if (marker.mark === 'blocked') return `${at}：盾牌挡住了${marker.kind === 'crystal' ? '' : ' '}${bomb}`
  if (marker.mark === 'boom') return `${at}：${bomb}，被炸掉 ${money(-marker.amount)}`
  return `${at}：${marker.mark === 'big' ? '钻石' : '附魔金苹果'} +${money(marker.amount)}`
}
