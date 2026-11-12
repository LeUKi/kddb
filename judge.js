// 矿洞夺宝 v3 · 代码协议第五版。游戏在自己的服务上（hbweb-kddb.lafi.sh/v3/）记分，
// 这里只做一件事：领取时核对游戏站签的凭证，按凭证上的数结算（docs/V3_MAP.md）。
// 金额是多少个最小单位（meta.points，docs/V3_ITEMS.md §11）：LDC 和🐟的最小单位是 0.01，就是分；
// 三方积分红包按那种积分的最小单位。凭证上的数也是这个单位，游戏站按红包信息的 units 记账。

/** @type {import("./judge").Meta} */
export const meta = {
  name: "矿洞夺宝",
  description: "一张不断长大的矿洞地图，大家一起挖宝，见好就收",
  page: "https://hbweb-kddb.lafi.sh/v3/",
  // 能用在三方积分红包上：金额都是多少个最小单位（游戏站、凭证、这里一样）
  points: true,
};

/**
 * v3 的参数（docs/V3_MAP.md §5，2026-11-06 用户定；第 11 版按 docs/V3_ITEMS.md §14，2026-11-12 用户定）：
 * 只留发红包的人心里有数的几样，能选的不让填数。“玩法”一选就顺手填好难度、末影之眼、苦力怕，之后还能改；
 * 特殊区块（末地宝藏、深暗之域、下界）一直都有，不能改。绿宝石值多少按奖池、预计人数、每人挖几次和
 * 末影之眼的档位算；键名和以前一样，游戏站照旧读，以前开的局不变。
 * @type {import("./judge").ParamDeclaration[]}
 */
export const params = [
  {
    key: "style",
    label: "玩法",
    hint: "选一个，下面的难度、末影之眼、苦力怕自动填好，之后还能改",
    type: "choice",
    options: [
      { value: "relaxed", label: "轻松", hint: "TNT 少、扣得少，没有苦力怕，适合慢慢挖", set: { level: "easy", eyeEvery: "3", creeper: "0" } },
      { value: "standard", label: "标准", hint: "TNT 和末影之眼都适中，有苦力怕催着挖", set: { level: "normal", eyeEvery: "3", creeper: "60" } },
      { value: "thrilling", label: "刺激", hint: "TNT 多、踩中扣一半，末影之眼多，特殊区块更多", set: { level: "tough", eyeEvery: "2", creeper: "60" } },
    ],
    default: "standard",
  },
  {
    key: "players",
    label: "预计人数",
    hint: "大概多少人来挖。绿宝石值多少按奖池、人数和每人挖几次算，大约八成奖池能发出去",
    type: "integer",
    default: 20,
    min: 1,
    max: 2000,
  },
  {
    key: "initialChances",
    label: "每人挖几次",
    hint: "每人开局能挖几格；挖到双铁镐另加 3 次",
    type: "integer",
    default: 20,
    min: 1,
    max: 99,
  },
  {
    key: "level",
    label: "难度",
    hint: "TNT 和末影水晶有多少、踩中扣掉多少待领取的奖励",
    type: "choice",
    options: [
      { value: "easy", label: "简单", hint: "TNT 少，踩中扣待领取的 15%；末影水晶扣 30%" },
      { value: "normal", label: "普通", hint: "TNT 中等，踩中扣待领取的 25%；末影水晶扣一半" },
      { value: "tough", label: "困难", hint: "TNT 多，踩中扣待领取的一半；末影水晶全部扣光" },
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
    // docs/V3_ITEMS.md §14、§17：以前填数（0–20），第 11 版三档；末影之眼开的是末地宝藏 50、深暗之域 25、下界 25
    key: "eyeEvery",
    label: "末影之眼",
    hint: "挖到末影之眼，远处开出一个特殊区块：末地宝藏、深暗之域或下界",
    type: "choice",
    options: [
      { value: "5", label: "少", hint: "每 5 张卡藏一颗眼；挖到它，远处开出末地宝藏（占一半）、深暗之域或下界" },
      { value: "3", label: "正常", hint: "每 3 张卡藏一颗眼；挖到它，远处开出末地宝藏（占一半）、深暗之域或下界" },
      { value: "2", label: "多", hint: "每 2 张卡藏一颗眼；挖到它，远处开出末地宝藏（占一半）、深暗之域或下界" },
    ],
    default: "3",
  },
  {
    // docs/V3_ITEMS.md §3、§14：防蹲守。以前填秒数，第 11 版三档；游戏站把它收到至少是挖掘间隔的两倍
    key: "creeper",
    label: "苦力怕",
    hint: "手上有待领取的奖励、一直不挖时，苦力怕会来炸掉待领取的 20%",
    type: "choice",
    options: [
      { value: "0", label: "不开", hint: "不会有苦力怕" },
      { value: "60", label: "1 分钟", hint: "有待领取的奖励、1 分钟没挖也没用道具，苦力怕来炸掉待领取的 20%" },
      { value: "180", label: "3 分钟", hint: "有待领取的奖励、3 分钟没挖也没用道具，苦力怕来炸掉待领取的 20%" },
    ],
    default: "60",
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
  note: "[打开矿洞夺宝，点格子开始挖宝](#附带网页)\n\n矿洞卡铺成一张地图，大家一起挖，挖到末影珍珠会在旁边长出一张新卡，旧卡挖完以前一直能挖。每人能挖的次数写在镐子上，挖到双铁镐加 3 次；挖到的奖励先记在矿洞里，点「见好就收」才领到红包里，都挖完也会自动领取。截止前要领取：截止前 2 分钟停止挖掘，开着网页的人会自动领取，没领的奖励作废。难度和奖励规则见网页「怎么玩」，TNT 只扣还没领的奖励。",
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

/** kd3.<开放时间毫秒>.<LINUX DO ID>.<多少个最小单位>.<钥匙编号>.<签名> */
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
