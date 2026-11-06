// 矿洞夺宝的游戏站（docs/V3_MAP.md §7）：hbweb-kddb.lafi.sh。
// 根路径照旧是 v2 的网页（开着的红包还在用），v3 的网页在 /v3/，接口在 /v3/api/，
// 和网页同源。每个红包一个 Durable Object（按红包编号起名，放亚太）。
//
// 环境变量：HB_ORIGIN（红包站，本地是开发包模拟器 http://127.0.0.1:8730）、
// PAGE_ORIGIN（这个网页的来源，令牌的 aud）、JUDGE_ID、MIN_JUDGE_VERSION（只认 v3
// 起的判定器版本）、CLAIM_KID。Secrets：CLAIM_KEY（签凭证的私钥 JWK）、TICKET_KEY（票据和
// nonce 的 HMAC 密钥）。

import { DurableObject } from "cloudflare:workers";
import { signVoucher } from "../shared/voucher.mjs";
import { makeNonce, makeTicket, nonceValid, readTicket, TICKET_TTL_MS, verifyIdentity } from "./auth.mjs";
import { pageFrom } from "./page.mjs";
import { MineRoom, RoomError } from "./room.mjs";

/**
 * @typedef {{
 *   HB_ORIGIN: string, PAGE_ORIGIN: string, JUDGE_ID: string, MIN_JUDGE_VERSION: string,
 *   CLAIM_KID: string, CLAIM_KEY: string, TICKET_KEY: string, LOCAL_SEED?: string,
 *   MINE: DurableObjectNamespace<MineObject>, ASSETS: Fetcher,
 * }} Env
 */

const HONGBAO_ID = /^[A-Za-z0-9_-]{1,64}$/;
const INFO_TTL_MS = 30_000;

const json = (/** @type {unknown} */ body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/**
 * 线上网页和接口同源，用不上跨域。本地联调时网页从开发包的模拟器
 * （http://localhost:8731）发出，接口在 wrangler dev 上：只对 PAGE_ORIGIN 放开。
 * @param {Request} request @param {Env} env @param {Response} response
 */
function withCors(request, env, response) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== env.PAGE_ORIGIN || origin === new URL(request.url).origin) return response;
  const out = new Response(response.body, response);
  out.headers.set("Access-Control-Allow-Origin", origin);
  out.headers.set("Vary", "Origin");
  return out;
}

export default {
  /** @param {Request} request @param {Env} env */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/v3") return Response.redirect(`${url.origin}/v3/${url.search}`, 301);
    if (url.pathname === "/v3/") return pageFrom(await env.ASSETS.fetch(request), env.HB_ORIGIN);
    if (!url.pathname.startsWith("/v3/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS")
      return withCors(request, env, new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Methods": "GET, POST",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Max-Age": "600",
        },
      }));
    const hongbao = url.searchParams.get("hb") ?? "";
    if (!HONGBAO_ID.test(hongbao)) return withCors(request, env, json({ message: "没有红包编号" }, 400));
    const stub = env.MINE.get(env.MINE.idFromName(hongbao), { locationHint: "apac" });
    const response = await stub.fetch(request);
    return response.status === 101 ? response : withCors(request, env, response);
  },
};

export class MineObject extends DurableObject {
  /** @type {{ info: import("./room.mjs").Info, at: number }|null} */
  infoKept = null;

  /** @param {DurableObjectState} ctx @param {Env} env */
  constructor(ctx, env) {
    super(ctx, env);
    /** @type {Env} */
    this.env = env;
    this.room = new MineRoom(/** @type {import("./room.mjs").Storage} */ (/** @type {unknown} */ (ctx.storage)), {
      // LOCAL_SEED 只在本地联调里有（wrangler.jsonc 的 env.local），线上每局随机
      seed: () => env.LOCAL_SEED || [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
      sign: async (fields) => signVoucher({ ...fields, kid: env.CLAIM_KID }, JSON.parse(env.CLAIM_KEY)),
    });
  }

  /** 红包信息：30 秒内用上次的；读不到用上次的；从没读到过就请他稍后再试。 */
  async info(/** @type {string} */ hongbao) {
    const now = Date.now();
    if (this.infoKept && now - this.infoKept.at < INFO_TTL_MS) return this.infoKept.info;
    try {
      const response = await fetch(`${this.env.HB_ORIGIN}/api/hongbao/${encodeURIComponent(hongbao)}`);
      if (response.ok) {
        this.infoKept = { info: await response.json(), at: now };
        return this.infoKept.info;
      }
      if (response.status === 404 && !this.infoKept) throw new RoomError(404, "没有这个红包");
    } catch (error) {
      if (error instanceof RoomError) throw error;
    }
    if (this.infoKept) return this.infoKept.info;
    throw new RoomError(503, "红包站暂时读不到，稍后再试");
  }

  /** 票据里的人；没有或过期就是 null。 */
  async ticketOf(/** @type {string|null} */ text, /** @type {string} */ hongbao) {
    if (!text) return null;
    return readTicket(this.env.TICKET_KEY, text.replace(/^Ticket /, ""), hongbao, Date.now());
  }

  /** @param {Request} request */
  async fetch(request) {
    const url = new URL(request.url);
    const hongbao = url.searchParams.get("hb") ?? "";
    const route = `${request.method} ${url.pathname.slice("/v3/api".length)}`;
    try {
      if (route === "GET /nonce")
        return json({ nonce: await makeNonce(this.env.TICKET_KEY, hongbao, Date.now()) });

      if (route === "POST /hello") {
        const token = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
        const now = Date.now();
        const identity = await verifyIdentity(token, {
          site: this.env.HB_ORIGIN,
          page: this.env.PAGE_ORIGIN,
          judgeId: this.env.JUDGE_ID,
          minJudgeVersion: Number(this.env.MIN_JUDGE_VERSION),
          hongbao,
          now,
        });
        if (!identity) return json({ message: "认不出你，请重新打开矿洞夺宝" }, 401);
        if (!identity.nonce || !(await nonceValid(this.env.TICKET_KEY, hongbao, identity.nonce, now)) || !(await this.room.takeNonce(identity.nonce, now)))
          return json({ message: "这次认人过期了，请重新打开矿洞夺宝" }, 401);
        const uid = Number(identity.sub);
        const name = identity.username;
        const ticket = await makeTicket(this.env.TICKET_KEY, { uid, name, hongbao, exp: now + TICKET_TTL_MS });
        const info = await this.info(hongbao);
        return json({ ticket, uid, ...(await this.room.state(info, uid, name, now)) });
      }

      if (route === "GET /live") {
        const who = await this.ticketOf(url.searchParams.get("ticket"), hongbao);
        if (!who) return json({ message: "票据过期了" }, 401);
        if (request.headers.get("Upgrade") !== "websocket") return json({ message: "要用 WebSocket" }, 426);
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1], [String(who.uid)]);
        return new Response(null, { status: 101, webSocket: pair[0] });
      }

      const who = await this.ticketOf(request.headers.get("Authorization"), hongbao);
      if (!who) return json({ message: "票据过期了，请重新打开矿洞夺宝" }, 401);
      const info = await this.info(hongbao);

      if (route === "GET /state") return json(await this.room.state(info, who.uid, who.name, Date.now()));

      if (route === "POST /dig") {
        const body = /** @type {{ cardId?: unknown, index?: unknown }} */ (await request.json().catch(() => ({})));
        const cardId = Number(body.cardId);
        const index = Number(body.index);
        if (!Number.isSafeInteger(cardId) || !Number.isSafeInteger(index)) return json({ message: "格子不对" }, 400);
        const { answer, broadcast } = await this.room.dig(info, who.uid, who.name, { cardId, index }, Date.now());
        if (broadcast) this.broadcast(broadcast);
        return json(answer);
      }

      if (route === "POST /claim") {
        const { answer, broadcast } = await this.room.claim(info, who.uid, who.name);
        if (broadcast) this.broadcast(broadcast);
        return json(answer);
      }

      return json({ message: "没有这个接口" }, 404);
    } catch (error) {
      if (error instanceof RoomError) return json({ message: error.message }, error.status);
      console.error("mine_error", { route, error: String(error) });
      return json({ message: "游戏站出了点问题，稍后再试" }, 500);
    }
  }

  /** 推给所有开着的网页。 */
  broadcast(/** @type {Record<string, unknown>} */ message) {
    const text = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(text);
      } catch {
        // 已经断了，网页会重连、重读整张
      }
    }
  }

  /** 网页只听不说：它说什么都不理，心跳由浏览器和平台管。 */
  async webSocketMessage() {}

  async webSocketClose(/** @type {WebSocket} */ socket, /** @type {number} */ code) {
    try {
      socket.close(code, "bye");
    } catch {
      // 已经关了
    }
  }
}
