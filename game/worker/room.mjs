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
 * }} Info
 */
/** @typedef {import("../shared/rules.mjs").Game} Game */
/** @typedef {import("../shared/rules.mjs").Player} Player */

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
   * 挖一格：回给挖的人的，和推给大家的。
   * @returns {Promise<{ answer: Record<string, unknown>, broadcast: Record<string, unknown>|null }>}
   */
  async dig(/** @type {Info} */ info, /** @type {number} */ uid, /** @type {string} */ name, /** @type {{ cardId: number, index: number }} */ at, /** @type {number} */ now) {
    const game = await this.gameFor(info);
    const player = await this.playerOf(game, uid, name);
    if (info.status !== "active") return { answer: { ok: false, message: "红包已经结束了", me: privatePlayer(player, game, now) }, broadcast: null };
    if (info.paused) return { answer: { ok: false, message: "红包暂停了，稍后再试", me: privatePlayer(player, game, now) }, broadcast: null };
    const out = dig(game, player, { cardId: at.cardId, index: at.index, now });
    if (!out.ok) return { answer: { ok: false, message: out.message, me: privatePlayer(player, game, now) }, broadcast: null };
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
    const broadcast = {
      type: "dig",
      seq: game.seq,
      card: publicCard(cards[at.cardId]),
      newCard: out.newCard ? publicCard(out.newCard) : null,
      feed: out.feed,
      left: game.pool - game.used,
      over: game.over,
      stats: game.stats,
    };
    // 挖的人直接拿到这次的变化（update），不等推送
    return {
      answer: { ok: true, result: out.result, me: privatePlayer(player, game, now), claimNow: out.claimNow, update: broadcast },
      broadcast,
    };
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
