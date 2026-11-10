// 矿洞夺宝 v3 · 代码协议第五版。游戏在自己的服务上（hbweb-kddb.lafi.sh/v3/）记分，
// 这里只做一件事：领取时核对游戏站签的凭证，按凭证上的分结算（docs/V3_MAP.md）。
// 金额单位是分；凭证上的“分”就是这个单位。

/** @type {import("./judge").Meta} */
export const meta = {
  name: "矿洞夺宝",
  description: "一张不断长大的矿洞地图，大家一起挖宝，见好就收",
  page: "https://hbweb-kddb.lafi.sh/v3/",
};

/**
 * v3 的参数（docs/V3_MAP.md §5，2026-11-06 用户定）：只留发红包的人心里有数的几样。
 * 绿宝石值多少按奖池、预计人数和每人机会算；TNT 扣多少跟着难度；卡的规格每张随机、
 * 配比小幅浮动、金苹果一次最多加 10 颗绿宝石，都不用填。
 * @type {import("./judge").ParamDeclaration[]}
 */
export const params = [
  {
    key: "players",
    label: "预计人数",
    hint: "大概多少人来挖。每颗绿宝石值多少按奖池、人数和每人机会算出来，大约八成奖池能发出去；钻石是绿宝石的 5 倍",
    type: "integer",
    default: 20,
    min: 1,
    max: 2000,
  },
  {
    key: "initialChances",
    label: "每人机会",
    hint: "每人开局能挖几格；挖到双铁镐另加 3 次",
    type: "integer",
    default: 20,
    min: 1,
    max: 99,
  },
  {
    key: "level",
    label: "难度",
    hint: "TNT 有多少、踩中扣掉多少还没领的奖励",
    type: "choice",
    options: [
      { value: "easy", label: "简单", hint: "TNT 少，踩中扣 15%" },
      { value: "normal", label: "普通", hint: "TNT 中等，踩中扣 25%" },
      { value: "tough", label: "困难", hint: "TNT 多，踩中扣 50%" },
    ],
    default: "normal",
  },
  {
    key: "interval",
    label: "挖掘间隔",
    hint: "每人两次挖掘至少隔多久。间隔长，一局玩得久，大家更容易在地图上碰面",
    type: "choice",
    options: [
      { value: "1", label: "1 秒" },
      { value: "3", label: "3 秒" },
      { value: "10", label: "10 秒" },
      { value: "30", label: "30 秒" },
    ],
    default: "1",
  },
  {
    key: "eyeEvery",
    label: "末地宝藏",
    hint: "每几张卡藏一颗末影之眼；挖到它，远处开出末地宝藏（3×3，宝物随机，藏 1–2 颗末影水晶，踩中扣双倍）。填 0 不开",
    type: "integer",
    default: 3,
    min: 0,
    max: 20,
  },
  {
    // docs/V3_ITEMS.md §3：防蹲守。游戏站把它收到至少是挖掘间隔的两倍；没有这一项的旧判定器按 60
    key: "creeper",
    label: "苦力怕",
    hint: "手上有奖励、这么多秒没挖也没用道具时，苦力怕会来炸掉手上的 20%。填 0 不开",
    type: "integer",
    default: 60,
    min: 0,
    max: 600,
  },
];

/** @type {import("./judge").HongbaoRules} */
export const hongbao = {
  title: "矿洞夺宝",
  prompt: "先打开矿洞夺宝挖宝；见好就收时网页会替你领取",
  total: { min: 5, default: 10000 },
  deadline: { value: 1, unit: "days" },
  humanCheck: false,
  pageAutoOpen: true,
  note: "[打开矿洞夺宝，点格子开始挖宝](#附带网页)\n\n矿洞卡铺成一张地图，大家一起挖，挖到末影珍珠会在旁边长出一张新卡，旧卡挖完以前一直能挖。每挖一格用 1 次机会，双铁镐加 3 次；挖到的奖励先记在矿洞里，点「见好就收」才领到红包里，机会用完也会自动领取。截止前要领取：截止前 2 分钟停止挖掘，开着网页的人会自动领取，没领的奖励作废。难度和奖励规则见网页「怎么玩」，TNT 只扣还没领的奖励。",
};

/**
 * 游戏站签凭证用的公钥，按钥匙编号查。私钥只在游戏站 Worker 的 secret 里。
 * 换钥匙：加一把新的、发新版本，旧的留到用它签的红包都结束。
 */
const PUBLIC_KEYS = /** @type {Record<string, JsonWebKey>} */ ({
  k1: {
    kty: "EC",
    crv: "P-256",
    x: "CFSQ00xzcDu3FDlep34ph5Cd8eLn_0GE2t1QJjMzuhU",
    y: "h74vR2iiqq_XmAL7Bn_HAQHpKW1WXOt1Q7qtW4gjc48",
  },
});

/** kd3.<开放时间毫秒>.<LINUX DO ID>.<分>.<钥匙编号>.<签名> */
const VOUCHER = /^kd3\.(\d{1,15})\.(\d{1,15})\.(\d{1,15})\.([a-z0-9]{1,8})\.([A-Za-z0-9_-]{86})$/;

/** @type {Map<string, Promise<CryptoKey>>} */
const keys = new Map();
/** @param {string} kid */
function keyOf(kid) {
  let key = keys.get(kid);
  if (!key) {
    key = crypto.subtle.importKey(
      "jwk",
      PUBLIC_KEYS[kid],
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    keys.set(kid, key);
  }
  return key;
}

/** @param {string} text */
function base64url(text) {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const NOT_A_VOUCHER = "请在矿洞夺宝里领取：打开网页挖宝，点「见好就收」，网页会替你提交";

/**
 * 一张凭证只认这个红包、这个人；同一个人结算以后，红包站不会再交给这里。
 * @param {import("./judge").Submission} submission
 * @param {import("./judge").Tools} tools
 * @returns {Promise<import("./judge").Verdict>}
 */
export async function judge(submission, tools) {
  const parts = VOUCHER.exec(submission.input);
  if (!parts) return { message: NOT_A_VOUCHER };
  const [, openedAt, id, points, kid, signature] = parts;
  if (!Object.hasOwn(PUBLIC_KEYS, kid))
    return { message: "这张凭证的钥匙已经停用，请回矿洞夺宝重新领取" };
  if (Number(openedAt) !== submission.hongbao.openedAt)
    return { message: "这张凭证不是这个红包的，请在这个红包的矿洞夺宝里领取" };
  if (Number(id) !== submission.user.id)
    return { message: "这张凭证不是你的，请用自己的账号在矿洞夺宝里领取" };
  const signed = new TextEncoder().encode(submission.input.slice(0, -signature.length - 1));
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    await keyOf(kid),
    base64url(signature),
    signed,
  );
  if (!valid) return { message: "凭证核对不上，请回矿洞夺宝重新领取" };
  const wanted = Number(points);
  if (!Number.isSafeInteger(wanted)) return { message: NOT_A_VOUCHER };
  const add = Math.min(wanted, submission.hongbao.unclaimed);
  const claimed = submission.claims.length + (add > 0 ? 1 : 0);
  const amount = submission.claims.reduce((sum, claim) => sum + claim.amount, 0) + add;
  return {
    add,
    settle: true,
    message: add < wanted
      ? `领取 ${tools.money.format(add)}（奖池只剩这么多）`
      : `领取 ${tools.money.format(add)}`,
    announce: `领走了 ${tools.money.format(add)}`,
    view: {
      summary: `${claimed} 人领取，共领走 ${tools.money.format(amount)}`,
      data: { claimed, amount },
    },
  };
}
