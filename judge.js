// 矿洞夺宝 · 代码协议第五版。金额单位是分；秘密牌面只存进 state。
// 同一份封存种子可以重放 setup 的洗牌及后续 tools.random 的换卡。

/** @type {import("./judge").Meta} */
export const meta = {
  name: "矿洞夺宝",
  description: "共享 5×5 矿洞卡，接棒挖宝、双铁镐加机会，随时收手结算",
  page: "https://hbweb-kddb.lafi.sh/",
};

/** @type {import("./judge").ParamDeclaration[]} */
export const params = [
  {
    key: "initialChances",
    label: "初始挖掘次数",
    hint: "每人第一次挖掘时获得；双铁镐另外增加 3 次，没有累计额度",
    type: "integer",
    default: 7,
    min: 1,
    max: 20,
  },
  {
    key: "waitSeconds",
    label: "连续操作等待时间",
    hint: "同一人连续挖掘需等待的秒数；其他玩家成功接棒后可立即挖掘",
    type: "integer",
    default: 10,
    min: 1,
    max: 60,
  },
  {
    key: "smallReward",
    label: "小奖金额",
    hint: "绿宝石奖励；钻石为此金额的 5 倍，金额越大奖池消耗越快",
    type: "money",
    default: 10,
    min: 1,
  },
  {
    key: "tntPercent",
    label: "TNT 扣除比例",
    hint: "扣除当前待结算奖励的百分比，向下取整到分；盾牌可挡一次",
    type: "integer",
    default: 25,
    min: 1,
    max: 100,
  },
];

/** @type {import("./judge").HongbaoRules} */
export const hongbao = {
  title: "矿洞夺宝",
  prompt: "打开游戏选格挖掘，或输入 cashout 收手",
  total: { min: 5, default: 10000 },
  deadline: { value: 1, unit: "days" },
  humanCheck: true,
  note: "大家共享一张 5×5 矿洞卡。每次成功挖掘消耗 1 次机会，双铁镐增加 3 次，没有累计额度。其他玩家接棒或等待后可再次挖掘；随时收手结算。机会用尽、奖池占满或红包结束时结算，结算后不能重新加入。TNT 只扣本场待结算奖励。\n\n[打开矿洞夺宝](#附带网页)",
};

/** @typedef {'emerald'|'diamond'|'apple'|'totem'|'tnt'|'pearl'|'shield'|'spyglass'} Kind */
/** @typedef {{initialChances:number,waitSeconds:number,smallReward:number,bigMultiplier:5,totemBonus:3,tntPercent:number}} Rules */
/** @typedef {{by:string,at:number}|null} OpenCell */
/** @typedef {{actorKey:string,name:string,at:number,cardId:number,index:number}} LastMove */
/** @typedef {{id:number,actor:string,kind:Kind,text:string,at:number,cardId:number,index:number}} FeedItem */
/** @typedef {{version:1,cardId:number,deck:Kind[],opened:OpenCell[],lastMove:LastMove|null,stats:{digs:number,players:number},feed:FeedItem[],nextEventId:number}} Game */
/** @typedef {{cardId:number,index:number,kind:Kind}} Peek */
/** @typedef {{kind:Kind,cardId:number,index:number,amount:number,blocked:boolean,text:string}} Result */
/** @typedef {{version:1,actorKey:string,chances:number,shield:boolean,peeks:Peek[],digs:number,status:'playing'|'settled',lastResult:Result|null}} Miner */

/** Fixed, public composition. Array order here never represents a dealt card. */
const COMPOSITION = /** @type {const} */ ({
  emerald: 10,
  diamond: 3,
  apple: 1,
  totem: 2,
  tnt: 4,
  pearl: 2,
  shield: 2,
  spyglass: 1,
});
const CELL_COUNT = 25;
const FEED_LIMIT = 10;

/** @param {import("./judge").Params} values @returns {Rules} */
function rulesOf(values) {
  return {
    initialChances: Number(values.initialChances ?? 7),
    waitSeconds: Number(values.waitSeconds ?? 10),
    smallReward: Number(values.smallReward ?? 10),
    bigMultiplier: 5,
    totemBonus: 3,
    tntPercent: Number(values.tntPercent ?? 25),
  };
}

/**
 * 至少能完整发出一个钻石；以后每笔奖励仍按当时剩余奖池裁剪。
 * 用除法检查，避免大金额乘 5 超出安全整数。
 * @param {import("./judge").Params} values
 * @param {{total:number}} pool
 * @returns {import("./judge").ParamProblem[]}
 */
export function check(values, pool) {
  return rulesOf(values).smallReward > Math.floor(pool.total / 5)
    ? [{ key: "smallReward", message: "总奖池至少需要小奖金额的 5 倍，才能容纳一份钻石奖励" }]
    : [];
}

/** @param {(min:number,max:number)=>number} int @returns {Kind[]} */
function shuffledDeck(int) {
  /** @type {Kind[]} */
  const deck = [];
  for (const [kind, count] of Object.entries(COMPOSITION)) {
    for (let index = 0; index < count; index += 1) deck.push(/** @type {Kind} */ (kind));
  }
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const other = int(0, index);
    [deck[index], deck[other]] = [deck[other], deck[index]];
  }
  return deck;
}

/** @param {(min:number,max:number)=>number} int @returns {Game} */
function newGame(int) {
  return {
    version: 1,
    cardId: 1,
    deck: shuffledDeck(int),
    opened: Array(CELL_COUNT).fill(null),
    lastMove: null,
    stats: { digs: 0, players: 0 },
    feed: [],
    nextEventId: 1,
  };
}

/** @param {Game} game @param {Rules} rules */
function publicView(game, rules) {
  const counts = { ...COMPOSITION };
  const cells = game.opened.map((open, index) => {
    if (open !== null) counts[game.deck[index]] -= 1;
    return {
      index,
      kind: open === null ? null : game.deck[index],
      by: open?.by ?? null,
      at: open?.at ?? null,
    };
  });
  const opened = cells.filter((cell) => cell.kind !== null).length;
  return {
    summary: `第 ${game.cardId} 张卡 · 已挖 ${opened}/25 格 · ${game.stats.players} 人加入`,
    data: {
      version: 1,
      cardId: game.cardId,
      cells,
      counts,
      rules,
      lastMove: game.lastMove,
      stats: game.stats,
      feed: game.feed,
    },
  };
}

/** 开放时使用协议提供的封存随机流；不在文件顶层抽牌。 */
export function setup(/** @type {import("./judge").Params} */ values) {
  const game = newGame((min, max) => min + Math.floor(Math.random() * (max - min + 1)));
  return { state: game, view: publicView(game, rulesOf(values)) };
}

/** @param {import("./judge").Submission} submission @param {Rules} rules @param {Game|null} game @returns {Miner} */
function minerOf(submission, rules, game) {
  const previous = /** @type {Miner|null} */ (submission.player.state);
  return {
    version: 1,
    actorKey: `u:${submission.user.id}`,
    chances: previous?.chances ?? rules.initialChances,
    shield: previous?.shield ?? false,
    // Other players' card changes cannot rewrite every private view. Prune on use;
    // the companion page also filters hints by the public cardId/opened status.
    peeks: (previous?.peeks ?? []).filter((peek) =>
      game !== null && peek.cardId === game.cardId && game.opened[peek.index] === null,
    ),
    digs: previous?.digs ?? 0,
    status: previous?.status ?? "playing",
    lastResult: previous?.lastResult ?? null,
  };
}

/** @param {Miner} miner */
function privateView(miner) {
  return {
    summary: miner.status === "settled"
      ? "本场已结算，感谢探索矿洞"
      : `剩余挖掘 ${miner.chances} 次${miner.shield ? " · 持有盾牌" : ""}`,
    data: miner,
  };
}

/** @param {number} index */
function coordinate(index) {
  return `${"ABCDE"[Math.floor(index / 5)]}${index % 5 + 1}`;
}

/**
 * 每次挖掘仅在全部前置检查成功后才改牌面、机会和接棒记录。
 * 不用 user.attempts 代表机会：被拒绝的有效判定也会增加 attempts。
 * @param {import("./judge").Submission} submission
 * @param {import("./judge").Tools} tools
 * @returns {import("./judge").Verdict}
 */
export function judge(submission, tools) {
  const { input, user, now, hongbao: pool } = submission;
  const rules = rulesOf(submission.params);
  const saved = /** @type {Game|null} */ (submission.state);

  if (input === "cashout" || input === "收手") {
    const miner = minerOf(submission, rules, saved);
    miner.status = "settled";
    return {
      settle: true,
      player: { state: miner, view: privateView(miner) },
      message: `已收手，结算 ${tools.money.format(submission.player.pending)}，本场不能再参与`,
      announce: "收手结算，结束了本场探索",
    };
  }

  const command = /^dig ([1-9]\d*) ([1-9]\d*)$/.exec(input);
  if (!command)
    return { message: "请在网页选格，或输入 dig 卡片编号 格子编号（1–25）；收手输入 cashout" };
  const cardId = Number(command[1]);
  const cell = Number(command[2]);
  if (!Number.isSafeInteger(cardId) || !Number.isInteger(cell) || cell < 1 || cell > CELL_COUNT)
    return { message: "卡片编号需为正整数，格子编号为 1–25；本次不消耗机会" };
  if (cardId !== (saved?.cardId ?? 1))
    return { message: "卡片已经更换，请在当前卡片重新选格；本次不消耗机会" };
  const index = cell - 1;
  if (saved?.opened[index] !== undefined && saved.opened[index] !== null)
    return { message: `${coordinate(index)} 已被挖开，请换一格；本次不消耗机会` };
  const actorKey = `u:${user.id}`;
  if (saved?.lastMove?.actorKey === actorKey) {
    const wait = saved.lastMove.at + rules.waitSeconds * 1000 - now;
    if (wait > 0)
      return { message: `等待其他玩家接棒，或 ${Math.ceil(wait / 1000)} 秒后再挖；本次不消耗机会` };
  }

  // Tests may start with null instead of running setup. Lazy initialization is
  // allowed only for a valid first dig; invalid input never deals a new card.
  const source = saved ?? newGame(tools.random.int);
  /** @type {Game} */
  const game = {
    ...source,
    opened: [...source.opened],
    stats: { ...source.stats },
    feed: [...source.feed],
  };
  const miner = minerOf(submission, rules, game);
  if (miner.status === "settled" || miner.chances <= 0)
    return { message: "本场已经结束，不能继续挖掘" };

  const kind = game.deck[index];
  const name = [...user.username].slice(0, 32).join("");
  game.opened[index] = { by: name, at: now };
  game.stats.digs += 1;
  if (miner.digs === 0) game.stats.players += 1;
  miner.chances -= 1;
  miner.digs += 1;
  miner.peeks = miner.peeks.filter((peek) => peek.index !== index);

  const pending = submission.player.pending;
  let wanted = 0;
  let blocked = false;
  let text = "";
  let publicText = "";
  switch (kind) {
    case "emerald":
      wanted = rules.smallReward;
      publicText = "挖到了绿宝石";
      break;
    case "diamond":
      wanted = rules.smallReward * rules.bigMultiplier;
      publicText = "挖到了钻石大奖";
      break;
    case "apple":
      wanted = pending === 0 ? rules.smallReward : pending;
      publicText = pending === 0 ? "附魔金苹果送来一份小奖" : "附魔金苹果让待结算奖励翻倍";
      break;
    case "totem":
      miner.chances += rules.totemBonus;
      text = `双铁镐！机会 +${rules.totemBonus}`;
      publicText = `双铁镐增加了 ${rules.totemBonus} 次机会`;
      break;
    case "tnt":
      if (miner.shield) {
        miner.shield = false;
        blocked = true;
        text = "盾牌挡住了 TNT，盾牌已消耗";
        publicText = "用盾牌挡住了 TNT";
      } else {
        // floor(pending * percent / 100), without overflowing intermediate
        // multiplication for otherwise valid safe-integer money values.
        wanted = -(Math.floor(pending / 100) * rules.tntPercent
          + Math.floor((pending % 100) * rules.tntPercent / 100));
        publicText = "踩中了 TNT";
      }
      break;
    case "pearl":
      publicText = "末影珍珠把大家传送到了下一张卡";
      text = "末影珍珠！全体进入下一张卡，个人机会和道具保留";
      break;
    case "shield":
      if (miner.shield) {
        wanted = rules.smallReward;
        publicText = "重复盾牌转成了一份小奖";
      } else {
        miner.shield = true;
        text = "获得盾牌，自动抵挡下一次 TNT";
        publicText = "获得了一面盾牌";
      }
      break;
    case "spyglass": {
      const known = new Set(miner.peeks.map((peek) => peek.index));
      const candidates = game.opened.flatMap((open, target) =>
        open === null && !known.has(target) ? [target] : [],
      );
      if (candidates.length === 0) {
        wanted = rules.smallReward;
        publicText = "望远镜没有新格子可看，转成一份小奖";
      } else {
        const target = tools.random.pick(candidates);
        miner.peeks.push({ cardId, index: target, kind: game.deck[target] });
        text = `望远镜看见了 ${coordinate(target)}，情报仅你可见`;
        publicText = "通过望远镜获得了一条私有情报";
      }
      break;
    }
  }

  const add = wanted > 0 ? Math.min(wanted, pool.unclaimed) : Math.max(wanted, -pending);
  if (wanted > 0) {
    const item = kind === "emerald" ? "绿宝石" : kind === "diamond" ? "钻石大奖"
      : kind === "apple" ? "附魔金苹果" : kind === "shield" ? "重复盾牌转小奖" : "望远镜转小奖";
    text = `${item}，奖励 +${tools.money.format(add)}${add < wanted ? "（剩余奖池不足，已按余额发放）" : ""}`;
  } else if (kind === "tnt" && !blocked) {
    text = `TNT！待结算奖励 -${tools.money.format(-add)}（${rules.tntPercent}%，向下取整）`;
  }
  const poolFilled = add > 0 && add === pool.unclaimed;
  const settle = miner.chances === 0 || poolFilled;
  miner.status = settle ? "settled" : "playing";
  miner.lastResult = { kind, cardId, index, amount: add, blocked, text };
  game.lastMove = { actorKey, name, at: now, cardId, index };
  const event = {
    id: game.nextEventId,
    actor: name,
    kind,
    text: publicText,
    at: now,
    cardId,
    index,
  };
  game.nextEventId += 1;
  game.feed = [event, ...game.feed].slice(0, FEED_LIMIT);

  if (kind === "pearl" || game.opened.every((open) => open !== null)) {
    game.cardId += 1;
    game.deck = shuffledDeck(tools.random.int);
    game.opened = Array(CELL_COUNT).fill(null);
    miner.peeks = [];
  }

  const ending = poolFilled ? "；奖池已占满，全员结算"
    : settle ? `；机会用尽，结算 ${tools.money.format(pending + add)}`
      : `；剩余 ${miner.chances} 次机会`;
  return {
    add,
    settle,
    message: text + ending,
    player: { state: miner, view: privateView(miner) },
    state: game,
    view: publicView(game, rules),
    announce: `${coordinate(index)}：${publicText}`,
  };
}
