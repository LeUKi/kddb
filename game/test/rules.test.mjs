import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  amountOf, budgetLeft, claim, createGame, dig, digBlocked, formatPoints,
  MIN_INTERVAL_MS, newPlayer, placeFor, privatePlayer, publicCard, publicGame,
  rulesOf, WRAP_UP_MS,
} from "../shared/rules.mjs";

const T0 = Date.parse("2026-11-06T12:00:00+08:00");
const DAY = 24 * 3600 * 1000;

/** @param {Partial<{ pool: number, params: Record<string, unknown>, seed: string }>} [options] */
function game({ pool = 10000, params = {}, seed = "seed-a" } = {}) {
  return createGame({ seed, rules: rulesOf({ boardSpec: "5", ...params }), pool, openedAt: T0, deadlineAt: T0 + DAY });
}

/** 把第 id 张卡的牌换成给定的（没写的格子是绿宝石），方便测一格一格的结果。 */
function stack(g, id, cells) {
  const card = g.cards[id];
  card.deck = card.deck.map(() => "emerald");
  for (const [index, kind] of Object.entries(cells)) card.deck[Number(index)] = kind;
  return card;
}

let clock = T0;
const later = () => (clock += MIN_INTERVAL_MS);

describe("规则和金额", () => {
  it("参数按判定器的写法读，没填、乱填用默认，超出的收住", () => {
    assert.deepEqual(rulesOf({}), {
      difficulty: "hard", boardSpec: "random", compositionVariation: "slight",
      smallReward: 10, bigMultiplier: 5, totemBonus: 3, tntPercent: 25, initialChances: 7, appleCap: 0,
    });
    const odd = rulesOf({ difficulty: "x", initialChances: 99, tntPercent: 300, appleCap: 50 });
    assert.equal(odd.difficulty, "hard");
    assert.equal(odd.initialChances, 20);
    assert.equal(odd.tntPercent, 100);
    assert.equal(odd.appleCap, 50);
  });
  it("红包信息的金额字符串和分来回换", () => {
    assert.equal(amountOf("100.00"), 10000);
    assert.equal(amountOf("0.5"), 50);
    assert.equal(amountOf("7"), 700);
    assert.equal(formatPoints(1234), "12.34");
    assert.equal(formatPoints(5), "0.05");
  });
});

describe("生成卡", () => {
  it("同一个种子同一副牌，换种子就不一样", () => {
    assert.deepEqual(game().cards[1].deck, game().cards[1].deck);
    assert.notDeepEqual(game().cards[1].deck, game({ seed: "seed-b" }).cards[1].deck);
  });
  it("格子数对得上，每张卡一颗珍珠，TNT 按难度", () => {
    for (const [difficulty, tnt] of [["easy", 3], ["hard", 4], ["hell", 8]]) {
      const card = game({ params: { difficulty, compositionVariation: "fixed" } }).cards[1];
      assert.equal(card.deck.length, 25);
      assert.equal(card.deck.filter((kind) => kind === "pearl").length, 1);
      assert.equal(card.deck.filter((kind) => kind === "tnt").length, tnt);
    }
  });
  it("每卡随机时规格在 5–7 之间", () => {
    const sizes = new Set();
    for (let i = 0; i < 40; i++) sizes.add(game({ seed: `s${i}`, params: { boardSpec: "random" } }).cards[1].size);
    assert.deepEqual([...sizes].sort(), [5, 6, 7]);
  });
});

describe("末影珍珠长新卡", () => {
  it("在离珍珠最近的那条边外", () => {
    const g = game();
    const card = g.cards[1];
    assert.deepEqual(placeFor(g, card, 4), { x: 1, y: 0 }); // A5：右边最近
    assert.deepEqual(placeFor(g, card, 20), { x: 0, y: 1 }); // E1：左、下一样近，下先
  });
  it("一样近按右、下、左、上，正中间也是", () => {
    const g = game();
    const card = g.cards[1];
    assert.deepEqual(placeFor(g, card, 12), { x: 1, y: 0 }); // C3 正中间：右
    assert.deepEqual(placeFor(g, card, 24), { x: 1, y: 0 }); // E5：右、下一样近，右先
    assert.deepEqual(placeFor(g, card, 0), { x: -1, y: 0 }); // A1：左、上一样近，左先
  });
  it("那边有卡就换下一近的边，四边都满找最近的空位", () => {
    const g = game();
    const card = g.cards[1];
    g.slots["1,0"] = 99;
    assert.deepEqual(placeFor(g, card, 4), { x: 0, y: -1 }); // A5：右满，上次近
    Object.assign(g.slots, { "0,1": 98, "-1,0": 97, "0,-1": 96 });
    assert.deepEqual(placeFor(g, card, 4), { x: 1, y: 1 }); // 四边都满：斜角，右下先
  });
});

describe("挖", () => {
  it("绿宝石、钻石加分，机会少一次，大家看得见这一格", () => {
    const g = game();
    stack(g, 1, { 1: "diamond" });
    const p = newPlayer(g, 10001, "小明");
    const first = dig(g, p, { cardId: 1, index: 0, now: later() });
    assert.equal(first.ok && first.result.amount, 10);
    const second = dig(g, p, { cardId: 1, index: 1, now: later() });
    assert.equal(second.ok && second.result.amount, 50);
    assert.equal(p.points, 60);
    assert.equal(p.chances, 5);
    assert.equal(g.used, 60);
    assert.equal(budgetLeft(g), 9940);
    const card = publicCard(g.cards[1]);
    assert.equal(card.cells[1]?.kind, "diamond");
    assert.equal(card.cells[2], null);
    assert.equal(card.left.diamond, g.cards[1].composition.diamond - 1);
  });
  it("奖励按预算封顶，预算分完游戏结束，大家领取", () => {
    const g = game({ pool: 30 });
    stack(g, 1, { 0: "diamond" });
    const p = newPlayer(g, 10001, "小明");
    const out = dig(g, p, { cardId: 1, index: 0, now: later() });
    assert.ok(out.ok);
    assert.equal(out.result.amount, 30);
    assert.match(out.result.text, /奖池只剩这么多/);
    assert.equal(g.over, true);
    assert.equal(out.claimNow, true);
    assert.equal(digBlocked(g, newPlayer(g, 10002, "小红"), later()), "奖池已经分完，游戏结束了，请领取");
  });
  it("TNT 按比例向下取整扣，扣掉的回到预算；盾牌挡一次", () => {
    const g = game({ params: { tntPercent: 25 } });
    stack(g, 1, { 3: "tnt", 4: "shield", 5: "tnt" });
    const p = newPlayer(g, 10001, "小明");
    for (const index of [0, 1, 2]) dig(g, p, { cardId: 1, index, now: later() });
    assert.equal(p.points, 30);
    const boom = dig(g, p, { cardId: 1, index: 3, now: later() });
    assert.equal(boom.ok && boom.result.amount, -7);
    assert.equal(p.points, 23);
    assert.equal(g.used, 23);
    dig(g, p, { cardId: 1, index: 4, now: later() });
    assert.equal(p.shield, true);
    const saved = dig(g, p, { cardId: 1, index: 5, now: later() });
    assert.ok(saved.ok && saved.result.blocked);
    assert.equal(p.points, 23);
    assert.equal(p.shield, false);
  });
  it("双铁镐加 3 次机会；重复的盾牌转成小奖", () => {
    const g = game();
    stack(g, 1, { 0: "totem", 1: "shield", 2: "shield" });
    const p = newPlayer(g, 10001, "小明");
    dig(g, p, { cardId: 1, index: 0, now: later() });
    assert.equal(p.chances, 9);
    dig(g, p, { cardId: 1, index: 1, now: later() });
    const twice = dig(g, p, { cardId: 1, index: 2, now: later() });
    assert.equal(twice.ok && twice.result.amount, 10);
  });
  it("金苹果：没分时送小奖，有分时翻倍，有上限就加到上限", () => {
    const g = game({ params: { appleCap: 25 } });
    stack(g, 1, { 0: "apple", 3: "apple" });
    const p = newPlayer(g, 10001, "小明");
    const gift = dig(g, p, { cardId: 1, index: 0, now: later() });
    assert.equal(gift.ok && gift.result.amount, 10);
    dig(g, p, { cardId: 1, index: 1, now: later() });
    dig(g, p, { cardId: 1, index: 2, now: later() });
    const capped = dig(g, p, { cardId: 1, index: 3, now: later() });
    assert.equal(capped.ok && capped.result.amount, 25);
    assert.match(capped.ok ? capped.result.text : "", /最多加 0\.25/);
  });
  it("末影珍珠长出新卡，之后两张都能挖", () => {
    const g = game();
    stack(g, 1, { 4: "pearl" });
    const p = newPlayer(g, 10001, "小明");
    const out = dig(g, p, { cardId: 1, index: 4, now: later() });
    assert.ok(out.ok && out.newCard);
    assert.deepEqual([out.newCard.x, out.newCard.y], [1, 0]);
    assert.equal(out.feed.newCardId, 2);
    assert.ok(dig(g, p, { cardId: 1, index: 0, now: later() }).ok);
    assert.ok(dig(g, p, { cardId: 2, index: 0, now: later() }).ok);
    assert.equal(publicGame(g).cards.length, 2);
  });
  it("望远镜看到的格子一直有效，被挖开才消失", () => {
    const g = game();
    stack(g, 1, { 0: "spyglass" });
    const p = newPlayer(g, 10001, "小明");
    dig(g, p, { cardId: 1, index: 0, now: later() });
    assert.equal(p.peeks.length, 1);
    const seen = p.peeks[0];
    assert.equal(seen.kind, g.cards[1].deck[seen.index]);
    const other = newPlayer(g, 10002, "小红");
    dig(g, other, { cardId: 1, index: seen.index === 1 ? 2 : 1, now: later() });
    dig(g, p, { cardId: 1, index: seen.index === 3 ? 4 : 3, now: later() });
    assert.equal(p.peeks.length, 1);
    dig(g, p, { cardId: 1, index: seen.index, now: later() });
    assert.equal(p.peeks.length, 0);
  });
  it("挖开的格、挖完的卡、没有的卡和格都不行，也不扣机会", () => {
    const g = game();
    const p = newPlayer(g, 10001, "小明");
    dig(g, p, { cardId: 1, index: 0, now: later() });
    for (const [cardId, index, message] of [
      [1, 0, "这一格已经被挖开了，换一格"],
      [9, 0, "没有这张卡"],
      [1, 25, "没有这一格"],
      [1, -1, "没有这一格"],
    ]) {
      const out = dig(g, p, { cardId, index, now: later() });
      assert.deepEqual(out, { ok: false, message });
    }
    assert.equal(p.chances, 6);
    g.cards[1].finished = true;
    assert.deepEqual(dig(g, p, { cardId: 1, index: 3, now: later() }), { ok: false, message: "这张卡已经挖完了" });
  });
  it("一张卡挖完就变成挖完的", () => {
    const g = game({ params: { initialChances: 20 } });
    const p = newPlayer(g, 10001, "小明");
    const card = stack(g, 1, {});
    p.chances = 30;
    for (let index = 0; index < 25; index++) dig(g, p, { cardId: 1, index, now: later() });
    assert.equal(card.finished, true);
    assert.equal(publicCard(card).finished, true);
  });
});

describe("什么时候不能挖", () => {
  it("挖得太快、机会用完、领过了、快截止了", () => {
    const g = game({ params: { initialChances: 1 } });
    const p = newPlayer(g, 10001, "小明");
    const now = later();
    const out = dig(g, p, { cardId: 1, index: 0, now });
    assert.ok(out.ok && out.claimNow);
    const fresh = newPlayer(g, 10002, "小红");
    fresh.lastDigAt = now;
    assert.equal(digBlocked(g, fresh, now + MIN_INTERVAL_MS - 1), "挖得太快了，稍等一下");
    assert.equal(digBlocked(g, p, now + 5000), "机会用完了，请领取");
    claim(g, p);
    assert.equal(digBlocked(g, p, now + 5000), "你已经领取了，不能再挖这个红包");
    const late = newPlayer(g, 10003, "小刚");
    assert.equal(digBlocked(g, late, T0 + DAY - WRAP_UP_MS), "快截止了，已经停止挖掘，请领取");
    assert.equal(digBlocked(g, late, T0 + DAY - WRAP_UP_MS - 1), null);
  });
});

describe("领取", () => {
  it("分定下来，再领一次还是一样，统计只算一次", () => {
    const g = game();
    const p = newPlayer(g, 10001, "小明");
    dig(g, p, { cardId: 1, index: 0, now: later() });
    const first = claim(g, p);
    assert.equal(claim(g, p), first);
    assert.deepEqual(g.stats, { digs: 1, players: 1, claimed: 1, claimedPoints: first });
    assert.equal(privatePlayer(p).status, "claimed");
  });
});

describe("给大家看的", () => {
  it("没挖开的牌不出去", () => {
    const g = game();
    const shown = JSON.stringify(publicGame(g));
    assert.ok(!shown.includes("deck"));
    assert.ok(!shown.includes("seed"));
    assert.deepEqual(publicCard(g.cards[1]).cells, Array(25).fill(null));
  });
});
