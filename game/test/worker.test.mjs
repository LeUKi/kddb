import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fromBase64url, makeNonce, makeTicket, nonceValid, NONCE_TTL_MS, readTicket, toBase64url, verifyIdentity } from "../worker/auth.mjs";
import { MineRoom } from "../worker/room.mjs";
import { signVoucher } from "../shared/voucher.mjs";
import { pageFrom, SDK_URL, withSdkFrom } from "../worker/page.mjs";

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
  it("nonce 只能用一次", async () => {
    const room = new MineRoom(memory(), tools);
    assert.equal(await room.takeNonce("abc", NOW), true);
    assert.equal(await room.takeNonce("abc", NOW + 1), false);
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
