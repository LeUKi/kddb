import type { Kind, Step } from './types'

// 收益曲线（收益卡里）：每挖一格后手里多少分，连成一条线；钻石、金苹果、踩雷、盾牌挡住
// 打上点。纯函数，测试直接算。

export interface ChartBox { width: number; height: number; padX: number; padTop: number; padBottom: number }
export const CHART: ChartBox = { width: 320, height: 132, padX: 8, padTop: 16, padBottom: 10 }

export type Mark = 'big' | 'apple' | 'boom' | 'blocked'
export interface Marker { x: number; y: number; mark: Mark; step: number }

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
  trail.forEach((step, index) => {
    const mark = markOf(step.k, step)
    if (mark) markers.push({ x: round(xOf(index + 1)), y: round(yOf(step.p)), mark, step: index + 1 })
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
