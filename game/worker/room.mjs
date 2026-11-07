// 一个红包一局（docs/V3_MAP.md §7）：地图、每人的分和机会、预算、动态。
// Durable Object 里只有一份，挖和领都在这里排队，不会两个人挖到同一格。
// 存储按键分开：game（不含卡的整局）、card:<id>、player:<uid>、log:<seq>（每一挖，
// 用来重放核对）、nonce:<nonce>（用过的 nonce）。存储接口是 Durable Object 的
// storage 那几个方法，测试里用一个 Map 顶替。

import {
  amountOf, claim, createGame, dig, digBlocked, newPlayer, privatePlayer,
  publicCard, publicGame, rulesOf, summaryOf, topWith,
} from "../shared/rules.mjs";

/**
 * @typedef {{
 *   get(key: string): Promise<unknown>,
 *   put(entries: Record<string, unknown>): Promise<void>,
 *   list(options: { prefix: string }): Promise<Map<string, unknown>>,
 *   delete(keys: string[]): Promise<number>,
 * }} Storage
 */
/**
 * 红包信息（红包站 GET /api/hongbao/:id）里用到的几项。
 * @typedef {{
 *   id: string, status: 'active'|'ended'|'draft', paused?: boolean,
 *   params?: Record<string, unknown>, unit?: string, pool?: string,
 *   openedAt?: string, deadlineAt?: string|null,
 *   scope?: import("./scope.mjs").Scope|null,
 * }} Info
 */
/** @typedef {import("../shared/rules.mjs").Game} Game */
/** @typedef {import("../shared/rules.mjs").Player} Player */

/**
 * 推送第 2 版：只说变了的那一格（网页自己把它放到卡上、减掉剩下的数、看挖完没有），
 * 一条两百字节左右；第 1 版每条带整张卡（谁挖的名字每格一份），挖满的 7×7 卡一条一千五。
 * @typedef {{
 *   type: "cell", seq: number, cardId: number, index: number,
 *   cell: { kind: string, uid: number, name: string, at: number },
 *   newCard: ReturnType<typeof publicCard>|null, text: string,
 *   left: number, over: boolean, stats: Game["stats"],
 * }} CellMessage
 */
/** 内存里留最近这么多条第 2 版推送，网页漏了几条时按序号补（GET /since），不用重读整局。 */
export const RECENT_LIMIT = 2000;

export class RoomError extends Error {
  constructor(/** @type {number} */ status, /** @type {string} */ message) {
    super(message);
    this.status = status;
  }
}

export class MineRoom {
  /** @type {Game|null} */
  game = null;
  /** @type {Map<number, Player>} */
  players = new Map();
  loaded = false;
  /**
   * 最近的第 2 版推送，序号连着（重启以后从空的开始，补不上的就给整局）。
   * @type {CellMessage[]}
   */
  recent = [];

  /**
   * @param {Storage} storage
   * @param {{ sign: (fields: { openedAt: number, id: number, points: number }) => Promise<string>, seed: () => string }} tools
   */
  constructor(storage, tools) {
    this.storage = storage;
    this.tools = tools;
  }

  async load() {
    if (this.loaded) return;
    const meta = /** @type {Omit<Game, 'cards'>|undefined} */ (await this.storage.get("game"));
    if (meta) {
      const cards = await this.storage.list({ prefix: "card:" });
      this.game = /** @type {Game} */ ({ ...meta, cards: Object.fromEntries([...cards.values()].map((card) => [/** @type {{ id: number }} */ (card).id, card])) });
    }
    this.loaded = true;
  }

  /** 第一次有人来、红包已经开放时开局；参数、预算、时间都取红包信息的。 */
  async gameFor(/** @type {Info} */ info) {
    await this.load();
    if (this.game) return this.game;
    if (info.status === "draft" || !info.openedAt || !info.pool)
      throw new RoomError(409, "红包还没开放");
    const game = createGame({
      seed: this.tools.seed(),
      rules: rulesOf(info.params ?? {}, amountOf(info.pool)),
      pool: amountOf(info.pool),
      openedAt: Date.parse(info.openedAt),
      deadlineAt: info.deadlineAt ? Date.parse(info.deadlineAt) : null,
    });
    const { cards, ...meta } = game;
    /** @type {Record<string, unknown>} */
    const entries = { game: meta };
    for (const card of Object.values(cards)) entries[`card:${card.id}`] = card;
    await this.storage.put(entries);
    this.game = game;
    return game;
  }

  async playerOf(/** @type {Game} */ game, /** @type {number} */ uid, /** @type {string} */ name) {
    let player = this.players.get(uid);
    if (!player) {
      player = /** @type {Player|undefined} */ (await this.storage.get(`player:${uid}`)) ?? newPlayer(game, uid, name);
      this.players.set(uid, player);
    }
    return player;
  }

  /** nonce 只能用一次；用过的记 15 分钟（比它的有效期长）。 */
  async takeNonce(/** @type {string} */ nonce, /** @type {number} */ now) {
    const key = `nonce:${nonce}`;
    if (await this.storage.get(key)) return false;
    await this.storage.put({ [key]: now });
    const used = await this.storage.list({ prefix: "nonce:" });
    const stale = [...used].filter(([, at]) => now - Number(at) > 15 * 60 * 1000).map(([name]) => name);
    if (stale.length > 0) await this.storage.delete(stale);
    return true;
  }

  /** 整局和自己的。 */
  async state(/** @type {Info} */ info, /** @type {number} */ uid, /** @type {string} */ name, /** @type {number} */ now) {
    const game = await this.gameFor(info);
    const player = await this.playerOf(game, uid, name);
    return { game: publicGame(game), me: privatePlayer(player, game, now), blocked: this.blocked(info, game, player, now) };
  }

  /** 现在为什么不能挖（能挖时 null）：红包结束、暂停也算。 */
  blocked(/** @type {Info} */ info, /** @type {Game} */ game, /** @type {Player} */ player, /** @type {number} */ now) {
    if (info.status !== "active") return "红包已经结束了";
    if (info.paused) return "红包暂停了，稍后再试";
    return digBlocked(game, player, now, { cooling: false });
  }

  /**
   * 挖一格：回给挖的人的，和推给大家的（broadcast 是第 1 版，cell 是第 2 版）。
   * compact：网页认第 2 版推送（它回答里的 update 也用第 2 版）。没挖成时回答里带上
   * 那张卡现在的样子（格子被别人先挖了，网页只改这一张，不重读整局）和现在为什么不能挖。
   * @returns {Promise<{ answer: Record<string, unknown>, broadcast: Record<string, unknown>|null, cell: CellMessage|null }>}
   */
  async dig(/** @type {Info} */ info, /** @type {number} */ uid, /** @type {string} */ name, /** @type {{ cardId: number, index: number }} */ at, /** @type {number} */ now, { compact = false } = {}) {
    const game = await this.gameFor(info);
    const player = await this.playerOf(game, uid, name);
    const refused = (/** @type {string} */ message) => {
      const card = game.cards[at.cardId];
      return {
        answer: {
          ok: false, message, me: privatePlayer(player, game, now), blocked: this.blocked(info, game, player, now),
          ...(card ? { card: publicCard(card) } : {}),
        },
        broadcast: null,
        cell: null,
      };
    };
    if (info.status !== "active") return refused("红包已经结束了");
    if (info.paused) return refused("红包暂停了，稍后再试");
    const out = dig(game, player, { cardId: at.cardId, index: at.index, now });
    if (!out.ok) return refused(out.message);
    const { cards, ...meta } = game;
    /** @type {Record<string, unknown>} */
    const entries = {
      game: meta,
      [`card:${at.cardId}`]: cards[at.cardId],
      [`player:${uid}`]: player,
      [`log:${String(game.seq).padStart(9, "0")}`]: { uid, cardId: at.cardId, index: at.index, at: now },
    };
    if (out.newCard) entries[`card:${out.newCard.id}`] = out.newCard;
    await this.storage.put(entries);
    const newCard = out.newCard ? publicCard(out.newCard) : null;
    const stats = { ...game.stats };
    const broadcast = {
      type: "dig",
      seq: game.seq,
      card: publicCard(cards[at.cardId]),
      newCard,
      feed: out.feed,
      left: game.pool - game.used,
      over: game.over,
      stats,
    };
    /** @type {CellMessage} */
    const cell = {
      type: "cell",
      seq: game.seq,
      cardId: at.cardId,
      index: at.index,
      cell: { kind: out.result.kind, uid, name: player.name, at: now },
      newCard,
      text: out.feed.text,
      left: game.pool - game.used,
      over: game.over,
      stats,
    };
    this.remember(cell);
    // 挖的人直接拿到这次的变化（update），不等推送
    return {
      answer: {
        ok: true, result: out.result, me: privatePlayer(player, game, now), claimNow: out.claimNow,
        blocked: this.blocked(info, game, player, now), update: compact ? cell : broadcast,
      },
      broadcast,
      cell,
    };
  }

  /** 记下一条第 2 版推送；序号接不上（不该有）就从这条重新记。 */
  remember(/** @type {CellMessage} */ message) {
    const last = this.recent.at(-1);
    if (last && last.seq + 1 !== message.seq) this.recent = [];
    this.recent.push(message);
    if (this.recent.length > RECENT_LIMIT) this.recent.splice(0, this.recent.length - RECENT_LIMIT);
  }

  /**
   * 网页手上到第 seq 条，后面漏了：内存里还有就给这几条，没有（刚重启、漏得太多）就给整局。
   * @returns {Promise<{ messages: CellMessage[] } | { state: Awaited<ReturnType<MineRoom["state"]>> }>}
   */
  async since(/** @type {Info} */ info, /** @type {number} */ uid, /** @type {string} */ name, /** @type {number} */ seq, /** @type {number} */ now) {
    const game = await this.gameFor(info);
    if (seq >= game.seq) return { messages: [] };
    const first = this.recent[0];
    if (first && seq >= 0 && first.seq <= seq + 1 && this.recent.at(-1)?.seq === game.seq)
      return { messages: this.recent.slice(seq + 1 - first.seq) };
    return { state: await this.state(info, uid, name, now) };
  }

  /** 收益卡：自己的逐格记录和数，全场前几名。 */
  async summary(/** @type {Info} */ info, /** @type {number} */ uid, /** @type {string} */ name) {
    const game = await this.gameFor(info);
    const player = await this.playerOf(game, uid, name);
    await this.topOf(game);
    return summaryOf(game, player);
  }

  /**
   * 前几名：新开的局一直记着；记录以前开的局第一次要时从所有领过的人里算一遍，存下来，
   * 之后每领一个人更新。
   */
  async topOf(/** @type {Game} */ game) {
    if (game.top) return game.top;
    const players = await this.storage.list({ prefix: "player:" });
    /** @type {import("../shared/rules.mjs").TopEntry[]} */
    let top = [];
    for (const value of players.values()) {
      const player = /** @type {Player} */ (value);
      const latest = this.players.get(player.uid) ?? player;
      if (latest.status === "claimed") top = topWith(top, latest);
    }
    game.top = top;
    const { cards: _cards, ...meta } = game;
    await this.storage.put({ game: meta });
    return top;
  }

  /**
   * 领取：分定下来，签一张凭证；再要一次还是同一张。
   * @returns {Promise<{ answer: Record<string, unknown>, broadcast: Record<string, unknown>|null }>}
   */
  async claim(/** @type {Info} */ info, /** @type {number} */ uid, /** @type {string} */ name) {
    const game = await this.gameFor(info);
    const player = await this.playerOf(game, uid, name);
    if (info.status !== "active" && player.status !== "claimed")
      return { answer: { ok: false, message: "红包已经结束了，没领的奖励作废", me: privatePlayer(player) }, broadcast: null };
    // 手里没有分：不签凭证（交上去只会在红包里记一笔“领取 0.00”）
    if (player.status !== "claimed" && player.points <= 0)
      return { answer: { ok: false, message: "手里还没有奖励，不用领取", me: privatePlayer(player) }, broadcast: null };
    await this.topOf(game);
    const first = player.status !== "claimed";
    const points = claim(game, player);
    // ECDSA 每次签出来不一样：第一次签的存下来，再要还是这一张
    const kept = /** @type {Player & { voucher?: string }} */ (player);
    kept.voucher ??= await this.tools.sign({ openedAt: game.openedAt, id: uid, points });
    const { voucher } = kept;
    if (first) {
      const { cards: _cards, ...meta } = game;
      await this.storage.put({ game: meta, [`player:${uid}`]: player });
    }
    return {
      answer: { ok: true, voucher, points, me: privatePlayer(player) },
      broadcast: first ? { type: "claim", name: player.name, points, stats: game.stats } : null,
    };
  }
}
