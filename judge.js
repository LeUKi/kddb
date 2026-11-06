// 矿洞夺宝 v3 · 代码协议第五版。游戏在自己的服务上（hbweb-kddb.lafi.sh/v3/）记分，
// 这里只做一件事：领取时核对游戏站签的凭证，按凭证上的分结算（docs/V3_MAP.md）。
// 金额单位是分；凭证上的“分”就是这个单位。

/** @type {import("./judge").Meta} */
export const meta = {
  name: "矿洞夺宝",
  description: "一张不断长大的矿洞地图，大家一起挖宝，见好就收",
  page: "https://hbweb-kddb.lafi.sh/v3/",
};

/** @type {import("./judge").ParamDeclaration[]} */
export const params = [
  {
    key: "difficulty",
    label: "游戏难度",
    hint: "选择难度会填入初始机会、TNT扣除和道具配比；之后仍可手动调整",
    type: "choice",
    options: [
      {
        value: "easy",
        label: "简单",
        hint: "30次机会、TNT扣15%、固定配比；TNT数按5×5/6×6/7×7为3/4/6",
        set: { initialChances: 30, tntPercent: 15, compositionVariation: "fixed" },
      },
      {
        value: "hard",
        label: "困难",
        hint: "20次机会、TNT扣25%、小幅浮动；TNT数按5×5/6×6/7×7为4/6/8",
        set: { initialChances: 20, tntPercent: 25, compositionVariation: "slight" },
      },
      {
        value: "hell",
        label: "地狱",
        hint: "10次机会、TNT扣75%、小幅浮动；TNT数按5×5/6×6/7×7为8/12/17",
        set: { initialChances: 10, tntPercent: 75, compositionVariation: "slight" },
      },
    ],
    default: "hard",
  },
  {
    key: "boardSpec",
    label: "卡片规格",
    hint: "每卡随机为 5×5、6×6、7×7 等概率抽一种；卡片外框尺寸统一",
    type: "choice",
    options: [
      { value: "5", label: "5×5" },
      { value: "6", label: "6×6" },
      { value: "7", label: "7×7" },
      { value: "random", label: "每卡随机" },
    ],
    default: "random",
  },
  {
    key: "smallReward",
    label: "绿宝石奖励",
    hint: "钻石奖励为此金额的 5 倍；金额越大奖池消耗越快",
    type: "money",
    default: 10,
    min: 1,
  },
  {
    key: "appleCap",
    label: "金苹果上限",
    hint: "金苹果一次最多加这么多（翻倍或零余额时的小奖都算）；不填为不限制",
    type: "money",
    required: false,
  },
  {
    key: "initialChances",
    label: "初始机会",
    hint: "选难度时自动填入，之后可改为1–99次；双铁镐仍额外增加3次",
    type: "integer",
    default: 20,
    min: 1,
    max: 99,
  },
  {
    key: "tntPercent",
    label: "TNT 扣除比例（%）",
    hint: "选难度时自动填入，之后可改为1–100%；TNT格数由难度决定",
    type: "integer",
    default: 25,
    min: 1,
    max: 100,
  },
  {
    key: "compositionVariation",
    label: "道具配比",
    hint: "选难度时自动填入，之后可改；浮动仅调整钻石、双铁镐、TNT、盾牌各±1",
    type: "choice",
    options: [
      { value: "fixed", label: "固定" },
      { value: "slight", label: "小幅浮动" },
    ],
    default: "slight",
  },
  {
    key: "eyeEvery",
    label: "末地宝藏",
    hint: "每长出几张卡，其中一张藏一颗末影之眼；挖到它，远处开出一张末地宝藏卡（3×3，只有宝物，没领的人都能挖）。填 0 不开",
    type: "integer",
    default: 3,
    min: 0,
    max: 20,
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

/** @typedef {'easy'|'hard'|'hell'} Difficulty */

/**
 * 至少能完整发出一个钻石（小奖的 5 倍）。
 * 用除法检查，避免大金额乘 5 超出安全整数。
 * @param {import("./judge").Params} values
 * @param {{total:number}} pool
 * @returns {import("./judge").ParamProblem[]}
 */
export function check(values, pool) {
  return Number(values.smallReward ?? 10) > Math.floor(pool.total / 5)
    ? [{ key: "smallReward", message: "总奖池至少需要小奖金额的 5 倍，才能容纳一份钻石奖励" }]
    : [];
}

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
