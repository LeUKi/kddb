import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fromBase64url, makeNonce, makeTicket, nonceValid, NONCE_TTL_MS, readTicket, toBase64url, verifyIdentity } from "../worker/auth.mjs";
import { MineRoom } from "../worker/room.mjs";
import { signVoucher } from "../shared/voucher.mjs";
import { pageFrom, SDK_URL, withSdkFrom } from "../worker/page.mjs";
import { inScope, outOfScope } from "../worker/scope.mjs";
import { LivePushes, PUSH_EVERY_MS } from "../worker/push.mjs";

const SITE = "http://127.0.0.1:8730";
const PAGE = "http://127.0.0.1:8787";
const NOW = Date.parse("2026-11-06T12:00:00+08:00");
const encoder = new TextEncoder();

/** 一把只在测试里的钥匙，冒充红包站签令牌、游戏站签凭证。 */
async function keyPair() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return {
    pair,
    publicJwk: { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "t1" },
    privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
}
const site = await keyPair();
const fetcher = /** @type {typeof fetch} */ (async () => new Response(JSON.stringify({ keys: [site.publicJwk] })));

async function token(/** @type {Record<string, unknown>} */ overrides = {}) {
  const header = toBase64url(encoder.encode(JSON.stringify({ alg: "ES256", kid: "t1", typ: "JWT" })));
  const claims = {
    iss: SITE, aud: PAGE, sub: "10001", username: "xiaoming", hongbao: "hb1",
    judge: "test", judgeVersion: 3, nonce: "n", iat: NOW / 1000, exp: NOW / 1000 + 600,
    ...overrides,
  };
  const body = toBase64url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, site.pair.privateKey, encoder.encode(`${header}.${body}`));
  return `${header}.${body}.${toBase64url(new Uint8Array(signature))}`;
}

const expect = { site: SITE, page: PAGE, judgeId: "test", minJudgeVersion: 3, hongbao: "hb1", now: NOW, fetcher };

describe("认人", () => {
  it("红包站签的、给这个网页、这个判定器和红包的令牌认得", async () => {
    const identity = await verifyIdentity(await token(), expect);
    assert.equal(identity?.sub, "10001");
  });
  it("别的来源、签发方、判定器、旧版本、别的红包、过期、改过的都不认", async () => {
    for (const overrides of [{ aud: "https://evil.example" }, { iss: `${SITE}/judge` }, { judge: "other" }, { judgeVersion: 2 }, { hongbao: "hb2" }, { exp: NOW / 1000 - 31 }]) {
      assert.equal(await verifyIdentity(await token(overrides), expect), null, JSON.stringify(overrides));
    }
    const good = await token();
    const [h, b, s] = good.split(".");
    const forged = toBase64url(encoder.encode(JSON.stringify({ ...JSON.parse(new TextDecoder().decode(fromBase64url(b))), sub: "1" })));
    assert.equal(await verifyIdentity(`${h}.${forged}.${s}`, expect), null);
  });
  it("判定器编号可以是逗号隔开的几个：其中一个就认，空的不算", async () => {
    assert.equal((await verifyIdentity(await token(), { ...expect, judgeId: "other, test" }))?.sub, "10001");
    assert.equal(await verifyIdentity(await token(), { ...expect, judgeId: "other," }), null);
    assert.equal(await verifyIdentity(await token({ judge: "" }), { ...expect, judgeId: "test," }), null);
  });
  it("nonce 是这里发的才认，两分钟后过期，换个红包不认", async () => {
    const nonce = await makeNonce("k", "hb1", NOW);
    assert.match(nonce, /^[A-Za-z0-9_.~-]{8,128}$/);
    assert.equal(await nonceValid("k", "hb1", nonce, NOW + 1000), true);
    assert.equal(await nonceValid("k", "hb2", nonce, NOW + 1000), false);
    assert.equal(await nonceValid("k", "hb1", nonce, NOW + NONCE_TTL_MS + 1), false);
    assert.equal(await nonceValid("other", "hb1", nonce, NOW), false);
  });
  it("票据：同一个红包、没过期、没改过才认", async () => {
    const ticket = await makeTicket("k", { uid: 10001, name: "xiaoming", hongbao: "hb1", exp: NOW + 1000 });
    assert.equal((await readTicket("k", ticket, "hb1", NOW))?.uid, 10001);
    assert.equal(await readTicket("k", ticket, "hb2", NOW), null);
    assert.equal(await readTicket("k", ticket, "hb1", NOW + 1000), null);
    assert.equal(await readTicket("k", `${ticket}x`, "hb1", NOW), null);
  });
});

/** Durable Object 的 storage，放在一个 Map 里。 */
function memory() {
  const map = new Map();
  return {
    map,
    get: async (/** @type {string} */ key) => structuredClone(map.get(key)),
    put: async (/** @type {Record<string, unknown>} */ entries) => {
      for (const [key, value] of Object.entries(entries)) map.set(key, structuredClone(value));
    },
    list: async ({ prefix }) => new Map([...map].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)])),
    delete: async (/** @type {string[]} */ keys) => keys.filter((key) => map.delete(key)).length,
  };
}

const claimKey = await keyPair();
const tools = {
  seed: () => "room-seed",
  sign: (/** @type {{ openedAt: number, id: number, points: number }} */ fields) => signVoucher({ ...fields, kid: "k1" }, claimKey.privateJwk),
};
/** @type {import("../worker/room.mjs").Info} */
const info = {
  id: "hb1", status: "active", paused: false,
  params: { boardSpec: "5", smallReward: 10, initialChances: 3 },
  unit: "LDC", pool: "100.00",
  openedAt: new Date(NOW - 3600_000).toISOString(),
  deadlineAt: new Date(NOW + 86400_000).toISOString(),
};

describe("一局", () => {
  it("第一次来就开局：一张卡、预算是奖池、参数照红包信息", async () => {
    const room = new MineRoom(memory(), tools);
    const { game, me } = await room.state(info, 10001, "xiaoming", NOW);
    assert.equal(game.cards.length, 1);
    assert.equal(game.pool, 10000);
    assert.equal(game.left, 10000);
    assert.equal(me.chances, 3);
  });
  it("挖一格：存下牌面、人和这一挖，推给大家的不带别人的私事", async () => {
    const storage = memory();
    const room = new MineRoom(storage, tools);
    const { answer, broadcast } = await room.dig(info, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    assert.equal(answer.ok, true);
    assert.equal(broadcast?.type, "dig");
    assert.equal(broadcast?.seq, 1);
    assert.ok(storage.map.has("player:10001"));
    assert.deepEqual(storage.map.get("log:000000001"), { uid: 10001, cardId: 1, index: 0, at: NOW });
    assert.ok(!JSON.stringify(broadcast).includes("peeks"));
    assert.ok(!JSON.stringify(broadcast).includes("deck"));
  });
  it("重启以后从存储读回整局和每个人", async () => {
    const storage = memory();
    const first = new MineRoom(storage, tools);
    await first.dig(info, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    const again = new MineRoom(storage, tools);
    const { game, me } = await again.state(info, 10001, "xiaoming", NOW + 2000);
    assert.equal(game.seq, 1);
    assert.equal(me.digs, 1);
    assert.equal(me.chances, 2);
    assert.notEqual(game.cards[0].cells[0], null);
  });
  it("机会用完要领；领取给一张凭证，再要还是同一张，之后不能挖", async () => {
    const room = new MineRoom(memory(), tools);
    const game = await room.gameFor(info);
    game.cards[1].deck = game.cards[1].deck.map(() => "emerald");
    let last;
    for (const [index, t] of [[0, 0], [1, 2000], [2, 4000]]) last = await room.dig(info, 10001, "xiaoming", { cardId: 1, index }, NOW + t);
    assert.equal(last?.answer.claimNow, true);
    const one = await room.claim(info, 10001, "xiaoming");
    const two = await room.claim(info, 10001, "xiaoming");
    assert.equal(one.answer.voucher, two.answer.voucher);
    assert.equal(one.broadcast?.type, "claim");
    assert.equal(two.broadcast, null);
    assert.match(String(one.answer.voucher), new RegExp(`^kd3\\.${Date.parse(info.openedAt ?? "")}\\.10001\\.${one.answer.points}\\.k1\\.`));
    const after = await room.dig(info, 10001, "xiaoming", { cardId: 1, index: 3 }, NOW + 6000);
    assert.equal(after.answer.message, "你已经领取了，不能再挖这个红包");
  });
  it("红包结束了不能挖；没领的不能再领", async () => {
    const room = new MineRoom(memory(), tools);
    await room.dig(info, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    const ended = { ...info, status: /** @type {const} */ ("ended") };
    assert.equal((await room.dig(ended, 10001, "xiaoming", { cardId: 1, index: 1 }, NOW + 2000)).answer.message, "红包已经结束了");
    assert.equal((await room.claim(ended, 10001, "xiaoming")).answer.message, "红包已经结束了，没领的奖励作废");
  });
  it("手里没有分不签凭证（不然红包里多一笔“领取 0.00”）", async () => {
    const room = new MineRoom(memory(), tools);
    const game = await room.gameFor(info);
    game.cards[1].deck = game.cards[1].deck.map(() => "tnt");
    await room.dig(info, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    const out = await room.claim(info, 10001, "xiaoming");
    assert.equal(out.answer.ok, false);
    assert.equal(out.answer.message, "手里还没有奖励，不用领取");
    assert.equal(out.broadcast, null);
  });
  it("收益卡：自己的逐格记录和全场前几名；记录以前开的局第一次要时从领过的人里算", async () => {
    const storage = memory();
    const room = new MineRoom(storage, tools);
    const game = await room.gameFor(info);
    game.cards[1].deck = game.cards[1].deck.map((_, index) => (index === 2 ? "diamond" : "emerald"));
    await room.dig(info, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    await room.dig(info, 10002, "xiaohong", { cardId: 1, index: 2 }, NOW);
    await room.claim(info, 10001, "xiaoming");
    await room.claim(info, 10002, "xiaohong");
    const summary = await room.summary(info, 10001, "xiaoming");
    assert.deepEqual(summary.me.trail, [{ k: "emerald", a: 10, p: 10 }]);
    assert.deepEqual(summary.top.map((entry) => [entry.name, entry.points]), [["xiaohong", 50], ["xiaoming", 10]]);
    // 记录以前开的局：整局里没有 top
    const meta = /** @type {Record<string, unknown>} */ (storage.map.get("game"));
    delete meta.top;
    const again = new MineRoom(storage, tools);
    const rebuilt = await again.summary(info, 10003, "xiaogang");
    assert.deepEqual(rebuilt.top.map((entry) => entry.uid), [10002, 10001]);
    assert.ok(Array.isArray(/** @type {{ top?: unknown }} */ (storage.map.get("game")).top));
  });
  it("第 2 版推送只有变了的那一格；网页要第 2 版时回答里的 update 也是", async () => {
    const room = new MineRoom(memory(), tools);
    const game = await room.gameFor(info);
    game.cards[1].deck = game.cards[1].deck.map(() => "emerald");
    const old = await room.dig(info, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    assert.equal(old.answer.update, old.broadcast);
    const out = await room.dig(info, 10002, "xiaohong", { cardId: 1, index: 1 }, NOW, { compact: true });
    assert.deepEqual(out.cell, {
      type: "cell", seq: 2, cardId: 1, index: 1,
      cell: { kind: "emerald", uid: 10002, name: "xiaohong", at: NOW },
      newCard: null, text: "挖到了绿宝石", left: 10000 - 20, over: false,
      stats: { digs: 2, players: 2, claimed: 0, claimedPoints: 0 },
    });
    assert.equal(out.answer.update, out.cell);
    assert.equal(out.answer.blocked, null);
    // 第 1 版带整张卡，第 2 版小得多
    assert.ok(JSON.stringify(out.cell).length < JSON.stringify(out.broadcast).length);
    // 之后的挖不改已经推过的那条（统计是当时的）
    await room.dig(info, 10003, "xiaogang", { cardId: 1, index: 2 }, NOW);
    assert.equal(out.cell?.stats.digs, 2);
  });
  it("漏了几条：按序号补；内存里没有了（重启）给整局", async () => {
    const storage = memory();
    const room = new MineRoom(storage, tools);
    for (const [uid, index] of [[10001, 0], [10002, 1], [10003, 2]]) await room.dig(info, uid, `p${uid}`, { cardId: 1, index }, NOW);
    assert.deepEqual(await room.since(info, 10001, "p10001", 3, NOW), { messages: [] });
    const some = await room.since(info, 10001, "p10001", 1, NOW);
    assert.deepEqual("messages" in some && some.messages.map((message) => [message.seq, message.index]), [[2, 1], [3, 2]]);
    const again = new MineRoom(storage, tools);
    const whole = await again.since(info, 10001, "p10001", 1, NOW);
    assert.ok("state" in whole && whole.state.game.seq === 3);
    // 重启以后挖的能补；重启以前的给整局
    await again.dig(info, 10004, "p10004", { cardId: 1, index: 3 }, NOW);
    const after = await again.since(info, 10001, "p10001", 3, NOW);
    assert.deepEqual("messages" in after && after.messages.map((message) => message.seq), [4]);
    assert.ok("state" in (await again.since(info, 10001, "p10001", 2, NOW)));
  });
  it("没挖成：回答里带那张卡现在的样子和为什么不能再挖", async () => {
    const room = new MineRoom(memory(), tools);
    await room.dig(info, 10001, "xiaoming", { cardId: 1, index: 0 }, NOW);
    const taken = await room.dig(info, 10002, "xiaohong", { cardId: 1, index: 0 }, NOW);
    assert.equal(taken.answer.ok, false);
    assert.equal(taken.answer.message, "这一格已经被挖开了，换一格");
    assert.equal(/** @type {{ cells: unknown[] }} */ (taken.answer.card).cells[0] !== null, true);
    assert.equal(taken.answer.blocked, null);
    assert.equal(taken.cell, null);
    const ended = await room.dig({ ...info, status: "ended" }, 10002, "xiaohong", { cardId: 1, index: 1 }, NOW);
    assert.equal(ended.answer.blocked, "红包已经结束了");
  });
  it("nonce 只能用一次", async () => {
    const room = new MineRoom(memory(), tools);
    assert.equal(await room.takeNonce("abc", NOW), true);
    assert.equal(await room.takeNonce("abc", NOW + 1), false);
  });
});

describe("推送攒一攒再发", () => {
  it("100 毫秒里的几条一次发出：第 2 版一个数组，第 1 版一条条；没有第 2 版的两边一样；发完再来的另起一批", () => {
    /** @type {{ v1: Record<string, unknown>[], v2: Record<string, unknown>[] }[]} */
    const sent = [];
    /** @type {{ run: () => void, ms: number }[]} */
    const timers = [];
    let cancelled = 0;
    const pushes = new LivePushes((out) => sent.push(out), (run, ms) => timers.push({ run, ms }), () => { cancelled += 1; });
    pushes.push({ type: "dig", seq: 1 }, { type: "cell", seq: 1 });
    pushes.push({ type: "dig", seq: 2 }, { type: "cell", seq: 2 });
    pushes.push({ type: "claim", name: "p" });
    assert.equal(sent.length, 0);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, PUSH_EVERY_MS);
    timers[0].run();
    assert.deepEqual(sent, [{
      v1: [{ type: "dig", seq: 1 }, { type: "dig", seq: 2 }, { type: "claim", name: "p" }],
      v2: [{ type: "cell", seq: 1 }, { type: "cell", seq: 2 }, { type: "claim", name: "p" }],
    }]);
    assert.equal(cancelled, 0);
    pushes.push({ type: "dig", seq: 3 }, { type: "cell", seq: 3 });
    assert.equal(timers.length, 2);
    pushes.flush();
    assert.equal(cancelled, 1);
    assert.deepEqual(sent[1].v2, [{ type: "cell", seq: 3 }]);
    pushes.flush();
    assert.equal(sent.length, 2);
  });
});

describe("领取范围", () => {
  it("没有范围谁都行；等级在里面或者是指定的人（名字不分大小写）才行；等级不知道的只看名字", () => {
    assert.equal(inScope(null, { username: "a", level: 0 }), true);
    assert.equal(inScope(undefined, { username: "a" }), true);
    const scope = { levels: [1], users: [{ username: "XiaoMing" }] };
    assert.equal(inScope(scope, { username: "a", level: 1 }), true);
    assert.equal(inScope(scope, { username: "a", level: 3 }), false);
    assert.equal(inScope(scope, { username: "xiaoming", level: 3 }), true);
    assert.equal(inScope(scope, { username: "a", level: null }), false);
  });
  it("不让进时的话和红包页上的“仅限”一样写", () => {
    assert.equal(outOfScope({ levels: [1] }), "这个红包仅限 Lv1，你不在里面：挖到的奖励领不了，所以进不了矿洞");
    assert.match(outOfScope({ levels: [2, 3, 4] }), /仅限 Lv2 及以上，/);
    assert.match(outOfScope({ levels: [0, 1, 3], users: [{ username: "a" }, { username: "b" }] }), /仅限 Lv0–1、Lv3 或指定的 2 人，/);
    assert.match(outOfScope({ users: [{ username: "a" }] }), /仅限指定的 1 人，/);
  });
});

describe("v3 的网页从这个环境的红包站加载 SDK", () => {
  const html = `<head><script src="${SDK_URL}"></script></head>`;
  const page = (body, type = "text/html; charset=utf-8", status = 200) =>
    new Response(status === 304 ? null : body, { status, headers: { "content-type": type, "content-length": String(body.length), etag: '"a"' } });

  it("Stage 换成 Stage 的地址，长度和 ETag 不再带着", async () => {
    const out = await pageFrom(page(html), "https://staging.hb.lafi.sh");
    assert.equal(await out.text(), '<head><script src="https://staging.hb.lafi.sh/sdk/v1.js"></script></head>');
    assert.equal(out.headers.get("content-length"), null);
    assert.equal(out.headers.get("etag"), null);
  });

  it("线上原样给；304 和别的类型也原样给", async () => {
    const same = page(html);
    assert.equal(await pageFrom(same, "https://hb.lafi.sh"), same);
    const notModified = page("", "text/html", 304);
    assert.equal(await pageFrom(notModified, "https://staging.hb.lafi.sh"), notModified);
    const script = page("x", "text/javascript");
    assert.equal(await pageFrom(script, "https://staging.hb.lafi.sh"), script);
    assert.equal(withSdkFrom(html, "http://127.0.0.1:8730"), '<head><script src="http://127.0.0.1:8730/sdk/v1.js"></script></head>');
  });
});
