import type { DigResult, Live, LiveStep, Me, PublicCard, State, Summary } from './types'

declare const __API_BASE__: string

/** 游戏站的接口：线上同源 /v3/api/，开发包里是本机的 wrangler dev。 */
const BASE = new URL(__API_BASE__, window.location.href)

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/**
 * 认人（docs/V3_MAP.md §4）：要一个 nonce → hb.identity → /hello 换游戏站的票据。
 * 之后的请求都带票据；票据过期（401）时再走一遍，不会再问他。
 */
export class GameApi {
  ticket: string | null = null
  uid: number | null = null

  constructor(readonly hongbao: string) {}

  url(path: string) {
    const url = new URL(path, BASE)
    url.searchParams.set('hb', this.hongbao)
    return url
  }

  async hello(): Promise<State> {
    const { nonce } = await this.raw<{ nonce: string }>('GET', 'nonce')
    const identity = await hb.identity({ nonce })
    if (!identity.identified) throw new ApiError(401, identity.message ?? identityWords[identity.reason] ?? '没能认出你')
    const answer = await this.raw<State & { ticket: string; uid: number }>('POST', 'hello', undefined, `Bearer ${identity.token}`)
    this.ticket = answer.ticket
    this.uid = answer.uid
    return answer
  }

  private async raw<T>(method: 'GET' | 'POST', path: string, body?: unknown, authorization?: string): Promise<T> {
    let response: Response
    try {
      response = await fetch(this.url(path), {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(authorization ? { authorization } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new ApiError(0, '连不上矿洞，检查一下网络')
    }
    const data = await response.json().catch(() => ({})) as T & { message?: string }
    if (!response.ok) throw new ApiError(response.status, data.message ?? '矿洞出了点问题，稍后再试')
    return data
  }

  /** 带票据的请求；票据过期就重新认人再来一次。 */
  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!this.ticket) await this.hello()
    try {
      return await this.raw<T>(method, path, body, `Ticket ${this.ticket}`)
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error
      await this.hello()
      return this.raw<T>(method, path, body, `Ticket ${this.ticket}`)
    }
  }

  state() {
    return this.call<State>('GET', 'state')
  }

  /** 收益卡：自己的逐格记录和数，全场前几名。 */
  summary() {
    return this.call<Summary>('GET', 'summary')
  }

  /**
   * 挖一格（v: 2：回答里的 update 是第 2 版，只有这一格）。没挖成时带着那张卡现在的样子；
   * blocked 是挖完以后为什么不能再挖（能挖时 null，不算间隔）。
   */
  dig(cardId: number, index: number) {
    return this.call<
      | { ok: true; result: DigResult; me: Me; claimNow: boolean; update: LiveStep; blocked?: string | null }
      | { ok: false; message: string; me: Me; card?: PublicCard; blocked?: string | null }
    >('POST', 'dig', { cardId, index, v: 2 })
  }

  /** 手上到第 seq 条，后面漏了：游戏站给漏的那几条，或者（太多、刚重启）给整局。 */
  since(seq: number) {
    return this.call<{ messages: LiveStep[] } | { state: State }>('GET', `since?seq=${seq}`)
  }

  claim() {
    return this.call<
      | { ok: true; voucher: string; points: number; me: Me }
      | { ok: false; message: string; me: Me }
    >('POST', 'claim')
  }

  /** 实时推送：断了就退避重连，连上时 onOpen（网页借机按序号补上断开时漏的）。 */
  live(onMessage: (message: Live) => void, onOpen: () => void) {
    let socket: WebSocket | null = null
    let closed = false
    let delay = 1000
    let timer: ReturnType<typeof setTimeout> | undefined
    const open = () => {
      if (closed || !this.ticket) return
      const url = this.url('live')
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.searchParams.set('ticket', this.ticket)
      url.searchParams.set('v', '2')
      socket = new WebSocket(url)
      socket.onopen = () => {
        delay = 1000
        onOpen()
      }
      socket.onmessage = event => {
        try {
          onMessage(JSON.parse(String(event.data)) as Live)
        } catch {
          // 看不懂的不理
        }
      }
      socket.onclose = () => {
        if (closed) return
        timer = setTimeout(open, delay)
        delay = Math.min(delay * 2, 30_000)
      }
    }
    open()
    return () => {
      closed = true
      clearTimeout(timer)
      socket?.close()
    }
  }
}

const identityWords: Record<string, string> = {
  login: '登录以后才能挖',
  denied: '要允许矿洞夺宝认出你，才能记你的分',
  away: '回到红包页再试一次',
  busy: '红包页正忙，稍后再试',
  unavailable: '现在认不了人，稍后再试',
  error: '没能认出你，稍后再试',
}
