import type { Kind, Step } from './types'

// 收益曲线（收益卡里）：每挖一格后待领取多少，连成一条线。线上只标三处：最高点、最大的一笔、
// 被炸得最狠的一下；钻石、金苹果、踩雷、盾牌挡住这些事画在图下面一条细刻度上（2026-11-11 用户：
// 线上挂满图标不好看）；在图上拖动（电脑上指着）看每一步是什么。纯函数，测试直接算。

export interface ChartBox { width: number; height: number; padX: number; padTop: number; padBottom: number }
export const CHART: ChartBox = { width: 320, height: 132, padX: 8, padTop: 16, padBottom: 10 }

export type Mark = 'big' | 'apple' | 'boom' | 'blocked' | 'loss'
export interface Marker {
  x: number; y: number; mark: Mark; step: number
  /** 第几次挖（逐格记录里还有中毒、末影箱、宝库、苦力怕、监守者这些不是挖的，不算） */
  dig?: number
  /** 挖到的是什么、多了（少了）多少分 */
  kind: Kind | Step['k']; amount: number
}

/** 图上拖到的那一步：位置、第几次挖（不是挖的没有）、是什么、加减多少、之后待领取多少。 */
export interface Point { x: number; y: number; step: number; dig?: number; kind: Step['k']; amount: number; points: number }

export interface Chart {
  /** 折线 */
  line: string
  /** 折线下面的面（填渐变） */
  area: string
  /** 0 分那条基线的 y */
  baseY: number
  /** 刻度上的事：钻石、金苹果、踩雷、盾牌挡住，和中毒、苦力怕、监守者扣的 */
  markers: Marker[]
  /** 线上标的：最大的一笔（加的）、被炸得最狠的一下（扣的）；没有就是 null */
  best: Marker | null
  worst: Marker | null
  /** 每一步的位置（拖动时找最近的那一步） */
  points: Point[]
  /** 最高点（标数） */
  peak: { x: number; y: number; points: number } | null
  /** 最后一格的位置和分 */
  end: { x: number; y: number; points: number }
  max: number
}

const markOf = (kind: Step['k'], step: Step): Mark | null => {
  if (step.b) return 'blocked'
  if ((kind === 'tnt' || kind === 'crystal') && step.a < 0) return 'boom'
  if (kind === 'diamond') return 'big'
  if (kind === 'apple' && step.a > 0) return 'apple'
  if ((kind === 'poison' || kind === 'creeper' || kind === 'warden') && step.a < 0) return 'loss'
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
  const stepPoints: Point[] = [{ x: round(xOf(0)), y: round(yOf(0)), step: 0, kind: 'emerald', amount: 0, points: 0 }]
  let digs = 0
  trail.forEach((step, index) => {
    const dig = NOT_DIGS.has(step.k) ? undefined : (digs += 1)
    const x = round(xOf(index + 1))
    const y = round(yOf(step.p))
    stepPoints.push({ x, y, step: index + 1, ...(dig ? { dig } : {}), kind: step.k, amount: step.a, points: step.p })
    const mark = markOf(step.k, step)
    if (mark) markers.push({ x, y, mark, step: index + 1, dig: dig ?? digs, kind: step.k, amount: step.a })
  })
  const gains = markers.filter(marker => marker.amount > 0)
  const losses = markers.filter(marker => marker.amount < 0)
  const best = gains.reduce<Marker | null>((most, marker) => (!most || marker.amount > most.amount ? marker : most), null)
  const worst = losses.reduce<Marker | null>((most, marker) => (!most || marker.amount < most.amount ? marker : most), null)
  let peakAt = 0
  values.forEach((value, index) => {
    if (value > values[peakAt]) peakAt = index
  })
  const last = values.length - 1
  return {
    line, area, baseY, markers, best, worst, points: stepPoints, max,
    peak: values[peakAt] > 0 ? { x: round(xOf(peakAt)), y: round(yOf(values[peakAt])), points: values[peakAt] } : null,
    end: { x: round(xOf(last)), y: round(yOf(values[last])), points: values[last] },
  }
}

/** 图标画哪个：钻石、金苹果；踩雷画 TNT 或末影水晶；挡住画盾牌；中毒、苦力怕、监守者没有图标。 */
export function iconOf(marker: Pick<Marker, 'mark' | 'kind'>): 'diamond' | 'apple' | 'tnt' | 'crystal' | 'shield' | null {
  if (marker.mark === 'big') return 'diamond'
  if (marker.mark === 'apple') return 'apple'
  if (marker.mark === 'blocked') return 'shield'
  if (marker.mark === 'loss') return null
  return marker.kind === 'crystal' ? 'crystal' : 'tnt'
}

/** 刻度的颜色：大奖金色、被炸红色、盾牌挡住蓝色。 */
export const tickOf = (mark: Mark) => (mark === 'big' || mark === 'apple' ? 'gain' : mark === 'blocked' ? 'block' : 'loss')

const STEP_NAMES: Partial<Record<Step['k'], string>> = { poison: '中毒', creeper: '苦力怕', warden: '监守者', ender: '存进末影箱', vault: '宝库' }

/** 一件事说的那一句（线上标的、刻度上的）。money 由调用的地方给（分 → 两位小数）。 */
export function markerWords(marker: Pick<Marker, 'mark' | 'kind' | 'amount' | 'step' | 'dig'>, money: (points: number) => string) {
  const at = `第 ${marker.dig ?? marker.step} 次挖`
  const bomb = marker.kind === 'crystal' ? '末影水晶' : 'TNT'
  if (marker.mark === 'loss') return `${STEP_NAMES[marker.kind as Step['k']] ?? ''}扣掉 ${money(-marker.amount)}`
  if (marker.mark === 'blocked') return `${at}：盾牌挡住了${marker.kind === 'crystal' ? '' : ' '}${bomb}`
  if (marker.mark === 'boom') return `${at}：${bomb}，被炸掉 ${money(-marker.amount)}`
  return `${at}：${marker.mark === 'big' ? '钻石' : '附魔金苹果'} +${money(marker.amount)}`
}

/** 拖到 x（图的坐标）时最近的那一步。 */
export function pointAt(chart: Pick<Chart, 'points'>, x: number) {
  let best = chart.points[0]
  for (const point of chart.points) if (Math.abs(point.x - x) < Math.abs(best.x - x)) best = point
  return best
}

/** 拖到的那一步说的那一句：第几次挖、挖到什么、加减多少、之后待领取多少。names 是物品名（网页给）。 */
export function pointWords(point: Point, money: (points: number) => string, names: Partial<Record<string, string>>) {
  if (point.step === 0) return '开始：待领取 0.00'
  const what = point.dig ? `第 ${point.dig} 次挖 · ${names[point.kind] ?? ''}` : STEP_NAMES[point.kind] ?? ''
  const change = point.amount > 0 ? ` +${money(point.amount)}` : point.amount < 0 ? ` ${money(point.amount)}` : ''
  return `${what}${change} · 待领取 ${money(point.points)}`
}
