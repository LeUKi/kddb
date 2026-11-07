import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  amountOf, budgetLeft, claim, createGame, crystalPercent, dig, digBlocked, formatPoints,
  averageUnits, coolingOf, MIN_INTERVAL_MS, newEndCard, newPlayer, placeFor, POOL_TARGET, privatePlayer, publicCard, publicGame,
  rewardFor, rulesOf, summaryOf, topWith, WRAP_UP_MS,
} from "../shared/rules.mjs";

const T0 = Date.parse("2026-11-06T12:00:00+08:00");
const DAY = 24 * 3600 * 1000;

/** @param {Partial<{ pool: number, params: Record<string, unknown>, seed: string }>} [options] */
function game({ pool = 10000, params = {}, seed = "seed-a" } = {}) {
  // 绿宝石按 10 分写死（新判定器是按奖池和人数算的，见“参数”那一组）
  return createGame({ seed, rules: rulesOf({ boardSpec: "5", smallReward: 10, ...params }), pool, openedAt: T0, deadlineAt: T0 + DAY });
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
  it("新判定器四个参数：没填、乱填用默认，超出的收住；绿宝石按奖池和人数算", () => {
    const rules = rulesOf({}, 2000);
    assert.equal(rules.difficulty, "normal");
    assert.equal(rules.players, 20);
    assert.equal(rules.initialChances, 20);
    assert.equal(rules.eyeEvery, 3);
    assert.equal(rules.digInterval, 1);
    assert.equal(rules.boardSpec, "random");
    assert.equal(rules.compositionVariation, "slight");
    assert.equal(rules.tntPercent, 25);
    assert.equal(rules.smallReward, rewardFor(2000, 20, 20, "normal"));
    assert.equal(rules.appleCap, rules.smallReward * 10);
    const odd = rulesOf({ level: "x", players: 9999, initialChances: 150, eyeEvery: 50, interval: 7 }, 2000);
    assert.equal(odd.difficulty, "normal");
    assert.equal(odd.players, 2000);
    assert.equal(odd.initialChances, 99);
    assert.equal(odd.eyeEvery, 20);
    assert.equal(odd.digInterval, 1);
    assert.equal(rulesOf({ eyeEvery: 0 }).eyeEvery, 0);
    assert.equal(rulesOf({ interval: "10" }).digInterval, 10);
    assert.deepEqual([rulesOf({ level: "easy" }).tntPercent, rulesOf({ level: "tough" }).tntPercent], [15, 50]);
  });
  it("绿宝石：大约八成奖池够预计人数把机会挖完；人多、机会多就少，至少 1 分", () => {
    const units = averageUnits("normal");
    assert.ok(units > 0.9 && units < 1.1, String(units));
    const reward = rewardFor(100000, 20, 20, "normal");
    const spent = reward * 20 * 20 * units;
    assert.ok(spent <= 100000 * POOL_TARGET && spent > 100000 * POOL_TARGET * 0.95, String(spent));
    assert.ok(rewardFor(100000, 40, 20, "normal") < reward);
    assert.equal(rewardFor(100, 2000, 99, "tough"), 1);
    assert.ok(averageUnits("tough") < averageUnits("easy")); // TNT 多，宝物少
  });
  it("旧判定器的参数照旧用：difficulty、smallReward、tntPercent、appleCap（null 不限）", () => {
    const old = rulesOf({ difficulty: "hard", smallReward: 10, tntPercent: 25, appleCap: null, boardSpec: "random", compositionVariation: "slight", initialChances: 7 }, 2000);
    assert.equal(old.difficulty, "hard");
    assert.equal(old.smallReward, 10);
    assert.equal(old.appleCap, 0);
    assert.equal(old.players, undefined);
    assert.equal(rulesOf({ difficulty: "hell" }).tntPercent, 75);
    assert.equal(rulesOf({ appleCap: 50 }).appleCap, 50);
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
  it("珍珠：7×7 两颗，6×6 一到两颗（两种都会有），5×5 一颗", () => {
    const pearls = (boardSpec, seed) => game({ seed, params: { boardSpec } }).cards[1].deck.filter((kind) => kind === "pearl").length;
    const seeds = Array.from({ length: 24 }, (_, index) => `pearl-${index}`);
    for (const seed of seeds) assert.equal(pearls("7", seed), 2);
    for (const seed of seeds) assert.equal(pearls("5", seed), 1);
    const six = new Set(seeds.map((seed) => pearls("6", seed)));
    assert.deepEqual([...six].sort(), [1, 2]);
    const card = game({ params: { boardSpec: "7" } }).cards[1];
    assert.equal(card.deck.length, 49);
  });
  it("格子数对得上，5×5 一颗珍珠，TNT 按难度", () => {
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
    assert.equal(p.chances, 18); // 默认 20 次
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
    assert.equal(digBlocked(g, p, later()), "奖池已经分完，游戏结束了，请领取");
    // 手里没有分的人不叫他领（领了只会记一笔“领取 0.00”）
    assert.equal(digBlocked(g, newPlayer(g, 10002, "小红"), later()), "奖池已经分完，游戏结束了");
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
    assert.equal(p.chances, 22); // 20 - 1 + 3
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
  it("末影之眼：每第 3 张普通卡一颗；挖到它在隔一圈的空位开出 3×3 的末地宝藏，宝藏卡不算张数", () => {
    const eyes = (g) => Object.values(g.cards).map((card) => card.deck.filter((kind) => kind === "eye").length);
    const g = game();
    const p = newPlayer(g, 10001, "小明");
    p.chances = 50;
    // 一张一张长：第 1 张挖珍珠长出第 2 张，第 2 张挖珍珠长出第 3 张
    stack(g, 1, { 0: "pearl" });
    dig(g, p, { cardId: 1, index: 0, now: later() });
    stack(g, 2, { 0: "pearl" });
    const third = dig(g, p, { cardId: 2, index: 0, now: later() });
    assert.ok(third.ok && third.newCard);
    assert.deepEqual(eyes(g), [0, 0, 1]);
    // 挖第 3 张上的眼
    const card = g.cards[3];
    const at = card.deck.indexOf("eye");
    const out = dig(g, p, { cardId: 3, index: at, now: later() });
    assert.ok(out.ok && out.newCard);
    assert.equal(out.newCard.kind, "end");
    assert.equal(out.newCard.size, 3);
    assert.equal(out.result.amount, 0);
    assert.match(out.feed.text, /末地宝藏开了/);
    assert.ok(Math.max(Math.abs(out.newCard.x - card.x), Math.abs(out.newCard.y - card.y)) >= 2);
    // 新局的宝藏卡随机配：末影水晶 1–2、双铁镐 1–2、金苹果 0–1、钻石 3–5，其余绿宝石
    const count = (kind) => out.newCard.deck.filter((item) => item === kind).length;
    assert.equal(out.newCard.deck.length, 9);
    for (const [kind, [low, high]] of Object.entries({ crystal: [1, 2], totem: [1, 2], apple: [0, 1], diamond: [3, 5] }))
      assert.ok(count(kind) >= low && count(kind) <= high, `${kind} ${count(kind)}`);
    assert.equal(count("emerald"), 9 - count("crystal") - count("totem") - count("diamond") - count("apple"));
    assert.equal(publicCard(out.newCard).kind, "end");
    // 宝藏卡不算张数：再长的第 4 张没有眼，第 6 张有
    const free = [0, 1, 2, 3, 4].filter((index) => index !== at).slice(0, 3);
    stack(g, 3, Object.fromEntries(free.map((index) => [index, "pearl"])));
    for (const index of free) assert.ok(dig(g, p, { cardId: 3, index, now: later() }).ok);
    const normal = Object.values(g.cards).filter((other) => other.kind !== "end").map((other) => other.composition.eye === 1);
    assert.deepEqual(normal, [false, false, true, false, false, true]);
    // 宝藏卡上照常挖
    const safe = out.newCard.deck.findIndex((kind) => kind === "emerald" || kind === "diamond");
    const dug = dig(g, p, { cardId: out.newCard.id, index: safe, now: later() });
    assert.ok(dug.ok && dug.result.amount > 0);
  });
  it("宝藏卡的配比：新局在范围里随机（两头都会出现），钻石多过绿宝石，以前开的局照旧 4 绿宝石、3 钻石、1 金苹果、1 水晶", () => {
    /** @type {Record<string, Set<number>>} */
    const seen = {};
    let diamonds = 0;
    let emeralds = 0;
    for (let n = 0; n < 200; n++) {
      const g = game({ seed: `end-${n}` });
      assert.equal(g.rules.endMix, 2);
      const card = newEndCard(g, 99, 5, 5);
      for (const kind of ["crystal", "totem", "diamond", "apple", "emerald"]) (seen[kind] ??= new Set()).add(card.composition[kind]);
      diamonds += card.composition.diamond;
      emeralds += card.composition.emerald;
      assert.equal(card.deck.length, 9);
      assert.equal(card.composition.tnt + card.composition.pearl + card.composition.eye + card.composition.shield + card.composition.spyglass, 0);
    }
    assert.deepEqual([...seen.crystal].sort(), [1, 2]);
    assert.deepEqual([...seen.totem].sort(), [1, 2]);
    assert.deepEqual([...seen.diamond].sort(), [3, 4, 5]);
    assert.deepEqual([...seen.apple].sort(), [0, 1]);
    assert.deepEqual([...seen.emerald].sort(), [0, 1, 2, 3, 4]);
    // 平均每张约 4 颗钻石、1.5 颗绿宝石：约 21 份小奖
    assert.ok(diamonds / 200 > 3.7 && emeralds / 200 < 2);
    const old = game();
    delete old.rules.endMix;
    assert.deepEqual([...newEndCard(old, 99, 5, 5).deck].sort(), ["apple", "crystal", "diamond", "diamond", "diamond", "emerald", "emerald", "emerald", "emerald"]);
  });
  it("末影之眼可以关掉：参数 0 就没有眼", () => {
    const g = game({ params: { eyeEvery: 0 } });
    const p = newPlayer(g, 10001, "小明");
    p.chances = 50;
    for (let id = 1; id <= 4; id++) {
      stack(g, id, { 0: "pearl" });
      dig(g, p, { cardId: id, index: 0, now: later() });
    }
    assert.ok(Object.values(g.cards).every((card) => !card.deck.includes("eye")));
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
    assert.equal(p.chances, 19);
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

describe("末影水晶", () => {
  it("扣 TNT 的两倍比例，向下取整，最多扣光；盾牌照样挡一次", () => {
    assert.deepEqual(["easy", "normal", "tough"].map((level) => crystalPercent(rulesOf({ level }))), [30, 50, 100]);
    const g = game({ params: { tntPercent: 25 } });
    stack(g, 1, { 2: "crystal", 3: "shield", 4: "crystal" });
    const p = newPlayer(g, 10001, "小明");
    for (const index of [0, 1]) dig(g, p, { cardId: 1, index, now: later() });
    assert.equal(p.points, 20);
    const boom = dig(g, p, { cardId: 1, index: 2, now: later() });
    assert.ok(boom.ok);
    assert.equal(boom.result.amount, -10); // 20 × 50%
    assert.match(boom.result.text, /末影水晶爆炸！奖励 -0\.10（双倍，50%/);
    assert.match(boom.feed.text, /末影水晶/);
    assert.equal(g.used, 10);
    dig(g, p, { cardId: 1, index: 3, now: later() });
    const blocked = dig(g, p, { cardId: 1, index: 4, now: later() });
    assert.ok(blocked.ok && blocked.result.blocked);
    assert.equal(blocked.result.amount, 0);
    assert.equal(p.shield, false);
    const tough = game({ params: { level: "tough" } });
    stack(tough, 1, { 1: "crystal" });
    const q = newPlayer(tough, 10002, "小红");
    dig(tough, q, { cardId: 1, index: 0, now: later() });
    dig(tough, q, { cardId: 1, index: 1, now: later() });
    assert.equal(q.points, 0); // 困难：一下扣光
  });
});

describe("收益卡", () => {
  it("逐格记下挖到什么、加减多少、挖完手里多少；数出最大一笔、炸了几次、挡了几次", () => {
    const g = game({ params: { tntPercent: 50 } });
    stack(g, 1, { 1: "diamond", 2: "tnt", 3: "shield", 4: "tnt", 5: "totem" });
    const p = newPlayer(g, 10001, "小明");
    for (const index of [0, 1, 2, 3, 4, 5]) assert.ok(dig(g, p, { cardId: 1, index, now: later() }).ok);
    assert.deepEqual(p.trail, [
      { k: "emerald", a: 10, p: 10 }, { k: "diamond", a: 50, p: 60 }, { k: "tnt", a: -30, p: 30 },
      { k: "shield", a: 0, p: 30 }, { k: "tnt", a: 0, p: 30, b: 1 }, { k: "totem", a: 0, p: 30 },
    ]);
    const summary = summaryOf(g, p);
    assert.deepEqual({ best: summary.me.best, tnt: summary.me.tnt, blocked: summary.me.blocked, lost: summary.me.lost, digs: summary.me.digs },
      { best: 50, tnt: 1, blocked: 1, lost: 30, digs: 6 });
    assert.deepEqual(summary.top, []);
    // 记录以前就来过的人没有 trail：收益卡说没有记录
    const old = newPlayer(g, 10002, "小红");
    delete old.trail;
    old.digs = 3;
    assert.ok(dig(g, old, { cardId: 1, index: 6, now: later() }).ok);
    assert.equal(summaryOf(g, old).me.trail, null);
  });
  it("前几名：领了才算，0 分不算，分一样先领的在前，最多 5 个", () => {
    let top = [];
    const people = [[1, 30], [2, 50], [3, 0], [4, 30], [5, 10], [6, 70], [7, 20]];
    for (const [uid, points] of people) top = topWith(top, { uid, name: `u${uid}`, points });
    assert.deepEqual(top.map((entry) => entry.uid), [6, 2, 1, 4, 7]);
    const g = game();
    const p = newPlayer(g, 10001, "小明");
    dig(g, p, { cardId: 1, index: 0, now: later() });
    claim(g, p);
    assert.deepEqual(g.top, [{ uid: 10001, name: "小明", points: p.points }]);
  });
  it("手里没有分：机会用完、奖池分完都不自动领", () => {
    const g = game({ params: { initialChances: 1, tntPercent: 100 } });
    stack(g, 1, { 0: "tnt" });
    const p = newPlayer(g, 10001, "小明");
    const out = dig(g, p, { cardId: 1, index: 0, now: later() });
    assert.ok(out.ok);
    assert.equal(out.claimNow, false);
    assert.equal(digBlocked(g, p, later()), "机会用完了");
  });
});

describe("什么时候不能挖", () => {
  it("挖掘间隔：参数拉长以后要等够；还要等几秒说出来，也给本人", () => {
    const g = game({ params: { interval: 10 } });
    const p = newPlayer(g, 10001, "小明");
    const now = later();
    assert.ok(dig(g, p, { cardId: 1, index: 0, now }).ok);
    assert.equal(coolingOf(g, p, now + 4000), 6000);
    assert.equal(digBlocked(g, p, now + 4000), "还要等 6 秒才能再挖");
    assert.equal(dig(g, p, { cardId: 1, index: 1, now: now + 9999 }).ok, false);
    assert.equal(privatePlayer(p, g, now + 4000).coolingMs, 6000);
    assert.ok(dig(g, p, { cardId: 1, index: 1, now: now + 10000 }).ok);
    clock = now + 10000;
  });
  it("挖得太快、机会用完、领过了、快截止了", () => {
    const g = game({ params: { initialChances: 1 } });
    const p = newPlayer(g, 10001, "小明");
    const now = later();
    const out = dig(g, p, { cardId: 1, index: 0, now });
    assert.ok(out.ok && out.claimNow);
    const fresh = newPlayer(g, 10002, "小红");
    fresh.lastDigAt = now;
    assert.equal(digBlocked(g, fresh, now + MIN_INTERVAL_MS - 1), "挖得太快了，稍等一下");
    assert.equal(digBlocked(g, fresh, now + MIN_INTERVAL_MS - 1, { cooling: false }), null);
    assert.equal(digBlocked(g, p, now + 5000), "机会用完了，请领取");
    claim(g, p);
    assert.equal(digBlocked(g, p, now + 5000), "你已经领取了，不能再挖这个红包");
    const late = newPlayer(g, 10003, "小刚");
    assert.equal(digBlocked(g, late, T0 + DAY - WRAP_UP_MS), "快截止了，已经停止挖掘");
    late.points = 10;
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
