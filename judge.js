// 矿洞夺宝 · 代码协议第五版。金额单位是分；秘密牌面只存进 state。
// 同一份封存种子可以重放 setup 的洗牌及后续 tools.random 的换卡。

/** @type {import("./judge").Meta} */
export const meta = {
  name: "矿洞夺宝",
  description: "共享 5×5、6×6、7×7 矿洞卡，接棒挖宝，自选难度与领取时机",
  page: "https://hbweb-kddb.lafi.sh/",
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
        hint: "9次机会、TNT扣15%、固定配比；TNT数按5×5/6×6/7×7为3/4/6",
        set: { initialChances: 9, tntPercent: 15, compositionVariation: "fixed" },
      },
      {
        value: "hard",
        label: "困难",
        hint: "7次机会、TNT扣25%、小幅浮动；TNT数按5×5/6×6/7×7为4/6/8",
        set: { initialChances: 7, tntPercent: 25, compositionVariation: "slight" },
      },
      {
        value: "hell",
        label: "地狱",
        hint: "4次机会、TNT扣75%、小幅浮动；TNT数按5×5/6×6/7×7为8/12/17",
        set: { initialChances: 4, tntPercent: 75, compositionVariation: "slight" },
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
    hint: "选难度时自动填入，之后可改为1–20次；双铁镐仍额外增加3次",
    type: "integer",
    default: 7,
    min: 1,
    max: 20,
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
    key: "waitSeconds",
    label: "连续挖掘等待（秒）",
    hint: "默认 10 秒；其他玩家成功接棒后可立即挖掘，领取不受此等待限制",
    type: "integer",
    default: 10,
    min: 1,
    max: 60,
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
];

/** @type {import("./judge").HongbaoRules} */
export const hongbao = {
  title: "矿洞夺宝",
  prompt: "先打开矿洞夺宝，点格子挖宝；机会用完自动结算",
  total: { min: 5, default: 10000 },
  deadline: { value: 1, unit: "days" },
  humanCheck: false,
  pageAutoOpen: true,
  note: "[打开矿洞夺宝，点格子开始挖宝](#附带网页)\n\n大家共享同一张矿洞卡，可为 5×5、6×6、7×7 或每卡随机规格。机会和奖励各自独立，每挖一格用 1 把镐子，双铁镐增加 3 次机会，每张新卡只有 1 个末影珍珠。其他玩家挖过后可接棒，否则等倒计时。点「见好就收」可领取奖励并结束挖掘；机会用完也会自动结算，之后不能再挖这个红包。难度与有效奖励规则见网页「怎么玩」，TNT 只扣尚未结算的奖励。",
};

/** @typedef {'emerald'|'diamond'|'apple'|'totem'|'tnt'|'pearl'|'shield'|'spyglass'} Kind */
/** @typedef {5|6|7} Size */
/** @typedef {'easy'|'hard'|'hell'} Difficulty */
/** @typedef {Record<Kind,number>} Composition */
/** @typedef {{initialChances:number,waitSeconds:number,smallReward:number,bigMultiplier:5,totemBonus:3,tntPercent:number}} LegacyRules */
/** @typedef {LegacyRules & {version:2,difficulty:Difficulty,boardSpec:'5'|'6'|'7'|'random',compositionVariation:'fixed'|'slight',appleCap?:number}} CardRules */
/** @typedef {LegacyRules | CardRules} Rules */
/** @typedef {{by:string,at:number,actorKey?:string}|null} OpenCell */
/** @typedef {{actorKey:string,name:string,at:number,cardId:number,index:number,size?:Size}} LastMove */
/** @typedef {{id:number,actor:string,actorKey?:string,kind:Kind,text:string,at:number,cardId:number,index:number,size?:Size}} FeedItem */
/** @typedef {{cardId:number,deck:Kind[],opened:OpenCell[],lastMove:LastMove|null,stats:{digs:number,players:number},feed:FeedItem[],nextEventId:number}} GameCore */
/** @typedef {GameCore & ({version:1} | {version:2,size:Size,composition:Composition,rules:CardRules})} Game */
/** @typedef {{cardId:number,index:number,kind:Kind}} Peek */
/** @typedef {{kind:Kind,cardId:number,index:number,size?:Size,amount:number,blocked:boolean,text:string}} Result */
/** @typedef {{version:1|2,actorKey:string,chances:number,shield:boolean,peeks:Peek[],digs:number,status:'playing'|'settled',lastResult:Result|null}} Miner */

/** Legacy games keep this composition on every later card, too. */
const LEGACY_COMPOSITION = /** @type {const} */ ({
  emerald: 10,
  diamond: 3,
  apple: 1,
  totem: 2,
  tnt: 4,
  pearl: 2,
  shield: 2,
  spyglass: 1,
});
/** Public baselines; their order never represents the secret shuffled deck. */
const COMPOSITIONS = /** @type {const} */ ({
  5: { emerald: 11, diamond: 3, apple: 1, totem: 2, tnt: 4, pearl: 1, shield: 2, spyglass: 1 },
  6: { emerald: 14, diamond: 4, apple: 2, totem: 3, tnt: 6, pearl: 1, shield: 3, spyglass: 3 },
  7: { emerald: 20, diamond: 6, apple: 2, totem: 4, tnt: 8, pearl: 1, shield: 4, spyglass: 4 },
});
const TNT_COUNTS = /** @type {const} */ ({
  easy: { 5: 3, 6: 4, 7: 6 },
  hard: { 5: 4, 6: 6, 7: 8 },
  hell: { 5: 8, 6: 12, 7: 17 },
});
const FEED_LIMIT = 10;

/** @param {import("./judge").Params} values @param {boolean} [legacy] @returns {Rules} */
function rulesOf(values, legacy = false) {
  /** @type {LegacyRules} */
  const numeric = {
    initialChances: Number(values.initialChances ?? 7),
    waitSeconds: Number(values.waitSeconds ?? 10),
    smallReward: Number(values.smallReward ?? 10),
    bigMultiplier: 5,
    totemBonus: 3,
    tntPercent: Number(values.tntPercent ?? 25),
  };
  if (legacy) return numeric;
  // Native option `set` runs in the author's form. Here use its final submitted
  // values, preserving manual overrides instead of applying a preset again.
  const appleCap = values.appleCap == null ? 0 : Number(values.appleCap);
  return {
    ...numeric,
    version: 2,
    difficulty: /** @type {Difficulty} */ (values.difficulty ?? "hard"),
    boardSpec: /** @type {CardRules['boardSpec']} */ (values.boardSpec ?? "random"),
    compositionVariation: /** @type {CardRules['compositionVariation']} */ (values.compositionVariation ?? "slight"),
    // Only when set: games saved without it, and their rules, stay as they were.
    ...(appleCap > 0 ? { appleCap } : {}),
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

/** @param {(min:number,max:number)=>number} int @param {Composition} composition @returns {Kind[]} */
function shuffledDeck(int, composition) {
  /** @type {Kind[]} */
  const deck = [];
  for (const [kind, count] of Object.entries(composition)) {
    for (let index = 0; index < count; index += 1) deck.push(/** @type {Kind} */ (kind));
  }
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const other = int(0, index);
    [deck[index], deck[other]] = [deck[other], deck[index]];
  }
  return deck;
}

/** @param {(min:number,max:number)=>number} int @param {CardRules} rules */
function newCard(int, rules) {
  const size = /** @type {Size} */ (rules.boardSpec === "random" ? int(5, 7) : Number(rules.boardSpec));
  /** @type {Composition} */
  const composition = { ...COMPOSITIONS[size], tnt: TNT_COUNTS[rules.difficulty][size] };
  if (rules.compositionVariation === "slight") {
    for (const kind of /** @type {const} */ (["diamond", "totem", "tnt", "shield"])) {
      composition[kind] += int(-1, 1);
    }
  }
  composition.emerald = size * size - Object.entries(composition)
    .filter(([kind]) => kind !== "emerald").reduce((sum, [, count]) => sum + count, 0);
  return { size, composition, deck: shuffledDeck(int, composition), opened: Array(size * size).fill(null) };
}

/** @param {(min:number,max:number)=>number} int @param {Rules} rules @returns {Game} */
function newGame(int, rules) {
  const card = "version" in rules
    ? { version: /** @type {const} */ (2), ...newCard(int, rules), rules }
    : { version: /** @type {const} */ (1), deck: shuffledDeck(int, LEGACY_COMPOSITION), opened: Array(25).fill(null) };
  return {
    ...card,
    cardId: 1,
    lastMove: null,
    stats: { digs: 0, players: 0 },
    feed: [],
    nextEventId: 1,
  };
}

/** @param {Game} game @param {Rules} rules */
function publicView(game, rules) {
  const counts = { ...(game.version === 2 ? game.composition : LEGACY_COMPOSITION) };
  const cells = game.opened.map((open, index) => {
    if (open !== null) counts[game.deck[index]] -= 1;
    return {
      index,
      kind: open === null ? null : game.deck[index],
      by: open?.by ?? null,
      at: open?.at ?? null,
      // Optional for games created by an earlier judge. Never infer identity
      // from display names; they can be duplicated or abbreviated by the UI.
      ...(open?.actorKey ? { actorKey: open.actorKey } : {}),
    };
  });
  const opened = cells.filter((cell) => cell.kind !== null).length;
  return {
    summary: `第 ${game.cardId} 张卡 · 已挖 ${opened}/${game.deck.length} 格 · ${game.stats.players} 人加入`,
    data: {
      version: game.version,
      cardId: game.cardId,
      ...(game.version === 2 ? { size: game.size, composition: game.composition } : {}),
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
  const rules = rulesOf(values);
  const game = newGame((min, max) => min + Math.floor(Math.random() * (max - min + 1)), rules);
  return { state: game, view: publicView(game, rules) };
}

/** @param {import("./judge").Submission} submission @param {Rules} rules @param {Game|null} game @returns {Miner} */
function minerOf(submission, rules, game) {
  const previous = /** @type {Miner|null} */ (submission.player.state);
  return {
    version: game?.version ?? 2,
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
      ? "这个红包的挖掘已结束，奖励已结算"
      : `剩余挖掘 ${miner.chances} 次${miner.shield ? " · 持有盾牌" : ""}`,
    data: miner,
  };
}

/** @param {number} index @param {Size} [size] */
function coordinate(index, size = 5) {
  return `${"ABCDEFG"[Math.floor(index / size)]}${index % size + 1}`;
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
  const saved = /** @type {Game|null} */ (submission.state);
  const rules = saved?.version === 2 ? saved.rules : rulesOf(submission.params, saved?.version === 1);
  const savedSize = saved?.version === 2 ? saved.size : 5;
  const maxCell = saved !== null ? savedSize * savedSize
    : "boardSpec" in rules && rules.boardSpec !== "random" ? Number(rules.boardSpec) ** 2 : 49;

  if (input === "cashout" || input === "收手") {
    const miner = minerOf(submission, rules, saved);
    miner.status = "settled";
    return {
      settle: true,
      player: { state: miner, view: privateView(miner) },
      message: `奖励已结算 ${tools.money.format(submission.player.pending)}，不能再挖这个红包`,
      announce: "领取奖励，结束了这个红包的挖掘",
    };
  }

  const command = /^dig ([1-9]\d*) ([1-9]\d*)$/.exec(input);
  if (!command)
    return { message: `请先打开矿洞夺宝点格子；手动挖掘需完整输入，如 dig ${saved?.cardId ?? 1} 1（最后一个数为格子 1–${maxCell}）；领取并结束输入 cashout。本次不消耗机会` };
  const cardId = Number(command[1]);
  const cell = Number(command[2]);
  if (!Number.isSafeInteger(cardId) || !Number.isSafeInteger(cell))
    return { message: `卡片编号需为正整数，格子编号为 1–${maxCell}；本次不消耗机会` };
  if (cardId !== (saved?.cardId ?? 1))
    return { message: "卡片已经更换，请在当前卡片重新选格；本次不消耗机会" };
  if (cell > maxCell)
    return { message: `卡片编号需为正整数，格子编号为 1–${maxCell}；本次不消耗机会` };
  const index = cell - 1;
  if (saved?.opened[index] !== undefined && saved.opened[index] !== null)
    return { message: `${coordinate(index, savedSize)} 已被挖开，请换一格；本次不消耗机会` };
  const actorKey = `u:${user.id}`;
  if (saved?.lastMove?.actorKey === actorKey) {
    const wait = saved.lastMove.at + rules.waitSeconds * 1000 - now;
    if (wait > 0)
      return { message: `等待其他玩家接棒，或 ${Math.ceil(wait / 1000)} 秒后再挖；本次不消耗机会` };
  }

  // Tests may start with null instead of running setup. Lazy initialization is
  // allowed only for a valid first dig; invalid input never deals a new card.
  const source = saved ?? newGame(tools.random.int, rules);
  const size = source.version === 2 ? source.size : 5;
  if (cell > source.deck.length)
    return { message: `本卡格子编号为 1–${source.deck.length}；请在当前卡片选格，本次不消耗机会` };
  /** @type {Game} */
  const game = {
    ...source,
    opened: [...source.opened],
    stats: { ...source.stats },
    feed: [...source.feed],
  };
  const miner = minerOf(submission, rules, game);
  if (miner.status === "settled" || miner.chances <= 0)
    return { message: "你已结束这个红包的挖掘，不能继续参与" };

  const kind = game.deck[index];
  const name = [...user.username].slice(0, 32).join("");
  game.opened[index] = { by: name, at: now, actorKey };
  game.stats.digs += 1;
  if (miner.digs === 0) game.stats.players += 1;
  miner.chances -= 1;
  miner.digs += 1;
  miner.peeks = miner.peeks.filter((peek) => peek.index !== index);

  const pending = submission.player.pending;
  let wanted = 0;
  let blocked = false;
  /** The apple's cap when it held it back; 0 otherwise. */
  let appleCapped = 0;
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
    case "apple": {
      const doubled = pending === 0 ? rules.smallReward : pending;
      const cap = "appleCap" in rules ? Number(rules.appleCap ?? 0) : 0;
      wanted = cap > 0 ? Math.min(doubled, cap) : doubled;
      if (wanted < doubled) appleCapped = cap;
      publicText = pending === 0 ? "附魔金苹果送来一份小奖"
        : appleCapped ? "附魔金苹果让待结算奖励翻倍，加到了上限" : "附魔金苹果让待结算奖励翻倍";
      break;
    }
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
        text = `望远镜看见了 ${coordinate(target, size)}，情报仅你可见`;
        publicText = "通过望远镜获得了一条私有情报";
      }
      break;
    }
  }

  const add = wanted > 0 ? Math.min(wanted, pool.unclaimed) : Math.max(wanted, -pending);
  if (wanted > 0) {
    const item = kind === "emerald" ? "绿宝石" : kind === "diamond" ? "钻石大奖"
      : kind === "apple" ? "附魔金苹果" : kind === "shield" ? "重复盾牌转小奖" : "望远镜转小奖";
    text = `${item}，奖励 +${tools.money.format(add)}${add < wanted ? "（剩余奖池不足，已按余额发放）" : appleCapped ? `（金苹果一次最多加 ${tools.money.format(appleCapped)}）` : ""}`;
  } else if (kind === "tnt" && !blocked) {
    text = `TNT！待结算奖励 -${tools.money.format(-add)}（${rules.tntPercent}%，向下取整）`;
  }
  const poolFilled = add > 0 && add === pool.unclaimed;
  const settle = miner.chances === 0 || poolFilled;
  miner.status = settle ? "settled" : "playing";
  miner.lastResult = { kind, cardId, index, size, amount: add, blocked, text };
  game.lastMove = { actorKey, name, at: now, cardId, index, size };
  const event = {
    id: game.nextEventId,
    actor: name,
    actorKey,
    kind,
    text: publicText,
    at: now,
    cardId,
    index,
    size,
  };
  game.nextEventId += 1;
  game.feed = [event, ...game.feed].slice(0, FEED_LIMIT);

  if (kind === "pearl" || game.opened.every((open) => open !== null)) {
    game.cardId += 1;
    if (game.version === 2) {
      Object.assign(game, newCard(tools.random.int, game.rules));
    } else {
      game.deck = shuffledDeck(tools.random.int, LEGACY_COMPOSITION);
      game.opened = Array(25).fill(null);
    }
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
    announce: `${coordinate(index, size)}：${publicText}`,
  };
}
