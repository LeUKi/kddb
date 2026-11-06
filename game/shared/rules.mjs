// 矿洞夺宝 v3 的规则（docs/V3_MAP.md §5）：生成卡、挖一格、长新卡、领取。
// 纯函数，游戏站的 Durable Object 和测试共用；随机数来自每个红包自己的种子，
// 同一个种子、同样的先后，结果一样，能重放核对。分和金额一样，单位是分。

/** @typedef {'emerald'|'diamond'|'apple'|'totem'|'tnt'|'pearl'|'shield'|'spyglass'|'eye'} Kind */
/** @typedef {3|5|6|7} Size */
/** @typedef {'easy'|'hard'|'hell'} Difficulty */
/** @typedef {Record<Kind, number>} Composition */
/**
 * @typedef {{
 *   difficulty: Difficulty,
 *   boardSpec: '5'|'6'|'7'|'random',
 *   compositionVariation: 'fixed'|'slight',
 *   smallReward: number,
 *   bigMultiplier: 5,
 *   totemBonus: 3,
 *   tntPercent: number,
 *   initialChances: number,
 *   appleCap: number,
 *   eyeEvery: number,
 * }} Rules
 */
/** @typedef {{ uid: number, name: string, at: number }} OpenCell */
/**
 * @typedef {{
 *   id: number, x: number, y: number, size: Size, kind?: 'end',
 *   composition: Composition, deck: Kind[], opened: (OpenCell|null)[],
 *   finished: boolean,
 * }} Card
 */
/** @typedef {{ cardId: number, index: number, kind: Kind }} Peek */
/**
 * @typedef {{
 *   kind: Kind, cardId: number, index: number, amount: number,
 *   blocked: boolean, text: string, newCardId: number|null,
 * }} Result
 */
/**
 * @typedef {{
 *   uid: number, name: string, chances: number, shield: boolean,
 *   peeks: Peek[], points: number, digs: number,
 *   status: 'playing'|'claimed', lastDigAt: number, lastResult: Result|null,
 * }} Player
 */
/**
 * @typedef {{
 *   seq: number, uid: number, name: string, kind: Kind, cardId: number,
 *   index: number, text: string, at: number, newCardId: number|null,
 * }} FeedItem
 */
/**
 * @typedef {{
 *   version: 3, seed: string, rules: Rules,
 *   pool: number, used: number,
 *   openedAt: number, deadlineAt: number|null,
 *   cards: Record<string, Card>, slots: Record<string, number>, nextCardId: number,
 *   feed: FeedItem[], seq: number,
 *   stats: { digs: number, players: number, claimed: number, claimedPoints: number },
 *   over: boolean,
 * }} Game
 */

/** 每张卡占一个 7×7 的格位，5×5、6×6 的卡在格位里居中。 */
export const SLOT = 7;
/** 截止前 2 分钟停止挖掘，开着网页的人自动领取（§2）。 */
export const WRAP_UP_MS = 2 * 60 * 1000;
/** 每人两次挖掘至少隔 1 秒，只防脚本（§4）。 */
export const MIN_INTERVAL_MS = 1000;
/** 动态留最近这么多条。 */
export const FEED_LIMIT = 30;

/** 公开的基准配比；顺序不代表洗过的牌。 */
const COMPOSITIONS = /** @type {const} */ ({
  5: { emerald: 11, diamond: 3, apple: 1, totem: 2, tnt: 4, pearl: 1, shield: 2, spyglass: 1, eye: 0 },
  6: { emerald: 14, diamond: 4, apple: 2, totem: 3, tnt: 6, pearl: 1, shield: 3, spyglass: 3, eye: 0 },
  7: { emerald: 20, diamond: 6, apple: 2, totem: 4, tnt: 8, pearl: 2, shield: 4, spyglass: 4, eye: 0 },
});
/** 末地宝藏卡：3×3，只有宝物，没有 TNT、珍珠和眼，不再长卡。 */
const END_COMPOSITION = /** @type {const} */ ({ emerald: 5, diamond: 3, apple: 1, totem: 0, tnt: 0, pearl: 0, shield: 0, spyglass: 0, eye: 0 });
/** 末影之眼默认每 3 张普通卡一颗；参数可改，0 是不开末地宝藏。 */
export const EYE_EVERY = 3
const TNT_COUNTS = /** @type {const} */ ({
  easy: { 5: 3, 6: 4, 7: 6 },
  hard: { 5: 4, 6: 6, 7: 8 },
  hell: { 5: 8, 6: 12, 7: 17 },
});
export const KINDS = /** @type {Kind[]} */ (["emerald", "diamond", "apple", "totem", "tnt", "pearl", "shield", "spyglass", "eye"]);
export const KIND_NAMES = /** @type {Record<Kind, string>} */ ({
  emerald: "绿宝石",
  diamond: "钻石",
  apple: "附魔金苹果",
  totem: "双铁镐",
  tnt: "TNT",
  pearl: "末影珍珠",
  shield: "盾牌",
  spyglass: "望远镜",
  eye: "末影之眼",
});

/** 判定器参数（红包信息里的 params，金额是分）→ 规则。 */
export function rulesOf(/** @type {Record<string, unknown>} */ params) {
  const integer = (/** @type {unknown} */ value, /** @type {number} */ fallback) =>
    Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  const difficulty = /** @type {Difficulty} */ (
    ["easy", "hard", "hell"].includes(String(params.difficulty)) ? params.difficulty : "hard"
  );
  const boardSpec = /** @type {Rules['boardSpec']} */ (
    ["5", "6", "7", "random"].includes(String(params.boardSpec)) ? String(params.boardSpec) : "random"
  );
  return /** @type {Rules} */ ({
    difficulty,
    boardSpec,
    compositionVariation: params.compositionVariation === "fixed" ? "fixed" : "slight",
    smallReward: integer(params.smallReward, 10),
    bigMultiplier: 5,
    totemBonus: 3,
    tntPercent: Math.min(100, integer(params.tntPercent, 25)),
    initialChances: Math.min(99, integer(params.initialChances, 20)),
    appleCap: params.appleCap == null ? 0 : integer(params.appleCap, 0),
    eyeEvery: params.eyeEvery == null || params.eyeEvery === "" || !Number.isSafeInteger(Number(params.eyeEvery))
      ? EYE_EVERY : Math.min(20, Math.max(0, Number(params.eyeEvery))),
  });
}

/** "100.00" → 10000；红包信息的金额是两位小数的字符串。 */
export function amountOf(/** @type {string} */ text) {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) throw new TypeError(`不是金额：${text}`);
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -cents : cents;
}

/** 10000 → "100.00"。 */
export function formatPoints(/** @type {number} */ points) {
  const sign = points < 0 ? "-" : "";
  const abs = Math.abs(points);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 字符串的 128 位散列（cyrb128），给随机数做种子。 */
function hash128(/** @type {string} */ text) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/**
 * 一条随机流：种子加用途（"card:3"、"spy:10001:4"），同样的种子和用途总是同一串。
 * @returns {(min: number, max: number) => number} 闭区间里的整数
 */
export function randomOf(/** @type {string} */ seed, /** @type {string} */ use) {
  let [a, b, c, d] = hash128(`${seed}:${use}`);
  const next = () => {
    // sfc32
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ (b >>> 9);
    b = c + (c << 3) | 0;
    c = (c << 21) | (c >>> 11);
    c = c + t | 0;
    return (t >>> 0) / 4294967296;
  };
  return (min, max) => min + Math.floor(next() * (max - min + 1));
}

/** @param {(min: number, max: number) => number} int @param {Composition} composition */
function shuffledDeck(int, composition) {
  /** @type {Kind[]} */
  const deck = [];
  for (const kind of KINDS) for (let i = 0; i < composition[kind]; i++) deck.push(kind);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = int(0, i);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** 第 id 张卡，放在 (x, y)；规格、配比和牌序都由种子和卡号定。 */
export function newCard(/** @type {Game} */ game, /** @type {number} */ id, /** @type {number} */ x, /** @type {number} */ y) {
  const int = randomOf(game.seed, `card:${id}`);
  const { rules } = game;
  const size = /** @type {Size} */ (rules.boardSpec === "random" ? int(5, 7) : Number(rules.boardSpec));
  /** @type {Composition} */
  const composition = { ...COMPOSITIONS[size], tnt: TNT_COUNTS[rules.difficulty][size] };
  if (rules.compositionVariation === "slight")
    for (const kind of /** @type {const} */ (["diamond", "totem", "tnt", "shield"])) composition[kind] += int(-1, 1);
  // 珍珠：5×5 一颗，6×6 随机一到两颗，7×7 两颗（地图会分叉，人少也能长出几张卡）
  if (size === 6) composition.pearl = int(1, 2);
  // 末影之眼：每第 eyeEvery 张普通卡藏一颗（末地宝藏卡不算张数）
  const nth = Object.values(game.cards).filter((other) => other.kind !== "end").length + 1;
  if (rules.eyeEvery > 0 && nth % rules.eyeEvery === 0) composition.eye = 1;
  composition.emerald = size * size - KINDS.filter((kind) => kind !== "emerald")
    .reduce((sum, kind) => sum + composition[kind], 0);
  return /** @type {Card} */ ({
    id, x, y, size, composition,
    deck: shuffledDeck(int, composition),
    opened: Array(size * size).fill(null),
    finished: false,
  });
}

const slotKey = (/** @type {number} */ x, /** @type {number} */ y) => `${x},${y}`;

/**
 * 开局：第一张卡在 (0, 0)。
 * @param {{ seed: string, rules: Rules, pool: number, openedAt: number, deadlineAt: number|null }} start
 * @returns {Game}
 */
export function createGame({ seed, rules, pool, openedAt, deadlineAt }) {
  /** @type {Game} */
  const game = {
    version: 3, seed, rules, pool, used: 0, openedAt, deadlineAt,
    cards: {}, slots: {}, nextCardId: 1, feed: [], seq: 0,
    stats: { digs: 0, players: 0, claimed: 0, claimedPoints: 0 },
    over: false,
  };
  addCard(game, 0, 0);
  return game;
}

/** 末地宝藏卡，放在 (x, y)；牌序也由种子和卡号定。 */
export function newEndCard(/** @type {Game} */ game, /** @type {number} */ id, /** @type {number} */ x, /** @type {number} */ y) {
  const composition = /** @type {Composition} */ ({ ...END_COMPOSITION });
  return /** @type {Card} */ ({
    id, x, y, size: 3, kind: "end", composition,
    deck: shuffledDeck(randomOf(game.seed, `card:${id}`), composition),
    opened: Array(9).fill(null),
    finished: false,
  });
}

function addCard(/** @type {Game} */ game, /** @type {number} */ x, /** @type {number} */ y, end = false) {
  const card = end ? newEndCard(game, game.nextCardId, x, y) : newCard(game, game.nextCardId, x, y);
  game.cards[card.id] = card;
  game.slots[slotKey(x, y)] = card.id;
  game.nextCardId += 1;
  return card;
}

/** 右、下、左、上：一样近时的先后（§5）。 */
const DIRECTIONS = /** @type {const} */ ([[1, 0], [0, 1], [-1, 0], [0, -1]]);

/**
 * 珍珠在第 index 格时，新卡放哪：离珍珠最近的那条边外；那边有卡就换下一近的边；
 * 四边都满，找离这张卡最近的空位（先按切比雪夫距离一圈一圈找，同一圈里按曼哈顿
 * 距离，再按右、下、左、上）。
 * @returns {{ x: number, y: number }}
 */
export function placeFor(/** @type {Game} */ game, /** @type {Card} */ card, /** @type {number} */ index) {
  const row = Math.floor(index / card.size);
  const col = index % card.size;
  const last = card.size - 1;
  // 到右、下、左、上四条边的距离
  const distances = [last - col, last - row, col, row];
  const order = [0, 1, 2, 3].sort((a, b) => distances[a] - distances[b] || a - b);
  for (const side of order) {
    const [dx, dy] = DIRECTIONS[side];
    if (!(slotKey(card.x + dx, card.y + dy) in game.slots)) return { x: card.x + dx, y: card.y + dy };
  }
  return nearestFree(game, card, 1);
}

/**
 * 末影之眼开的末地宝藏放哪：离这张卡至少隔一圈的最近空位（从第二圈找起），
 * 看上去是飞到远处开出来的。
 */
export function placeFar(/** @type {Game} */ game, /** @type {Card} */ card) {
  return nearestFree(game, card, 2);
}

/** 从第 fromRing 圈起，离这张卡最近的空位：切比雪夫距离一圈一圈找，同一圈里按曼哈顿距离，再按右、下、左、上。 */
function nearestFree(/** @type {Game} */ game, /** @type {Card} */ card, /** @type {number} */ fromRing) {
  for (let ring = fromRing; ; ring++) {
    /** @type {{ x: number, y: number, manhattan: number, rank: number }[]} */
    const free = [];
    for (let dy = -ring; dy <= ring; dy++)
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = card.x + dx;
        const y = card.y + dy;
        if (slotKey(x, y) in game.slots) continue;
        // 先看主要偏向哪边，再看另一个方向，都按右、下、左、上
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        const major = horizontal ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3);
        const minor = horizontal ? (dy > 0 ? 1 : dy < 0 ? 3 : 0) : (dx > 0 ? 0 : dx < 0 ? 2 : 0);
        const rank = major * 4 + minor;
        free.push({ x, y, manhattan: Math.abs(dx) + Math.abs(dy), rank });
      }
    free.sort((a, b) => a.manhattan - b.manhattan || a.rank - b.rank || a.y - b.y || a.x - b.x);
    if (free.length > 0) return { x: free[0].x, y: free[0].y };
  }
}

/** 预算还剩多少分：总奖池减去大家手里的分（领了的、没领的都算）。 */
export function budgetLeft(/** @type {Game} */ game) {
  return Math.max(0, game.pool - game.used);
}

/** 第一次来的人。 */
export function newPlayer(/** @type {Game} */ game, /** @type {number} */ uid, /** @type {string} */ name) {
  return /** @type {Player} */ ({
    uid, name: [...name].slice(0, 32).join(""),
    chances: game.rules.initialChances, shield: false, peeks: [],
    points: 0, digs: 0, status: "playing", lastDigAt: 0, lastResult: null,
  });
}

/** 现在还能不能挖；能挖时 null，不能时一句话。 */
export function digBlocked(/** @type {Game} */ game, /** @type {Player} */ player, /** @type {number} */ now) {
  if (player.status === "claimed") return "你已经领取了，不能再挖这个红包";
  if (game.over) return "奖池已经分完，游戏结束了，请领取";
  if (game.deadlineAt !== null && now >= game.deadlineAt - WRAP_UP_MS)
    return "快截止了，已经停止挖掘，请领取";
  if (player.chances <= 0) return "机会用完了，请领取";
  if (now - player.lastDigAt < MIN_INTERVAL_MS) return "挖得太快了，稍等一下";
  return null;
}

/**
 * 挖一格。先做完所有检查，再改牌面、机会和分；game、player 原地改。
 * @returns {{ ok: false, message: string } | { ok: true, result: Result, feed: FeedItem, newCard: Card|null, claimNow: boolean }}
 */
export function dig(
  /** @type {Game} */ game,
  /** @type {Player} */ player,
  /** @type {{ cardId: number, index: number, now: number }} */ { cardId, index, now },
) {
  const blocked = digBlocked(game, player, now);
  if (blocked) return { ok: false, message: blocked };
  const card = game.cards[cardId];
  if (!card) return { ok: false, message: "没有这张卡" };
  if (!Number.isSafeInteger(index) || index < 0 || index >= card.deck.length)
    return { ok: false, message: "没有这一格" };
  if (card.finished) return { ok: false, message: "这张卡已经挖完了" };
  if (card.opened[index] !== null) return { ok: false, message: "这一格已经被挖开了，换一格" };

  const { rules } = game;
  const kind = card.deck[index];
  card.opened[index] = { uid: player.uid, name: player.name, at: now };
  card.finished = card.opened.every((cell) => cell !== null);
  game.stats.digs += 1;
  if (player.digs === 0) game.stats.players += 1;
  player.chances -= 1;
  player.digs += 1;
  player.lastDigAt = now;
  player.peeks = player.peeks.filter((peek) => !(peek.cardId === cardId && peek.index === index));

  let wanted = 0;
  let blockedTnt = false;
  let appleCapped = 0;
  let text = "";
  let publicText = "";
  /** @type {Card|null} */
  let grown = null;
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
      const doubled = player.points === 0 ? rules.smallReward : player.points;
      wanted = rules.appleCap > 0 ? Math.min(doubled, rules.appleCap) : doubled;
      if (wanted < doubled) appleCapped = rules.appleCap;
      publicText = player.points === 0 ? "附魔金苹果送来一份小奖"
        : appleCapped ? "附魔金苹果让奖励翻倍，加到了上限" : "附魔金苹果让奖励翻倍";
      break;
    }
    case "totem":
      player.chances += rules.totemBonus;
      text = `双铁镐！机会 +${rules.totemBonus}`;
      publicText = `双铁镐增加了 ${rules.totemBonus} 次机会`;
      break;
    case "tnt":
      if (player.shield) {
        player.shield = false;
        blockedTnt = true;
        text = "盾牌挡住了 TNT，盾牌已消耗";
        publicText = "用盾牌挡住了 TNT";
      } else {
        // floor(points * percent / 100)，不让中间的乘法超出安全整数
        wanted = -(Math.floor(player.points / 100) * rules.tntPercent
          + Math.floor((player.points % 100) * rules.tntPercent / 100));
        publicText = "踩中了 TNT";
      }
      break;
    case "pearl": {
      const place = placeFor(game, card, index);
      grown = addCard(game, place.x, place.y);
      text = "末影珍珠！旁边长出了一张新卡";
      publicText = "末影珍珠长出了一张新卡";
      break;
    }
    case "eye": {
      const place = placeFar(game, card);
      grown = addCard(game, place.x, place.y, true);
      text = "末影之眼！远处开出了末地宝藏";
      publicText = "挖到末影之眼，末地宝藏开了！";
      break;
    }
    case "shield":
      if (player.shield) {
        wanted = rules.smallReward;
        publicText = "重复盾牌转成了一份小奖";
      } else {
        player.shield = true;
        text = "获得盾牌，自动挡下一次 TNT";
        publicText = "获得了一面盾牌";
      }
      break;
    case "spyglass": {
      const known = new Set(player.peeks.filter((peek) => peek.cardId === cardId).map((peek) => peek.index));
      const candidates = card.opened.flatMap((open, target) => open === null && !known.has(target) ? [target] : []);
      if (candidates.length === 0) {
        wanted = rules.smallReward;
        publicText = "望远镜没有新格子可看，转成一份小奖";
      } else {
        const target = candidates[randomOf(game.seed, `spy:${player.uid}:${player.digs}`)(0, candidates.length - 1)];
        player.peeks.push({ cardId, index: target, kind: card.deck[target] });
        text = `望远镜看见了 ${cellName(card, target)}，只有你看得见`;
        publicText = "用望远镜看到了一格";
      }
      break;
    }
  }

  // 正的按预算封顶，负的不扣到 0 以下；扣掉的回到预算
  const amount = wanted > 0 ? Math.min(wanted, budgetLeft(game)) : Math.max(wanted, -player.points);
  player.points += amount;
  game.used += amount;
  if (wanted > 0) {
    const item = kind === "emerald" ? "绿宝石" : kind === "diamond" ? "钻石大奖"
      : kind === "apple" ? "附魔金苹果" : kind === "shield" ? "重复盾牌转小奖" : "望远镜转小奖";
    text = `${item}，奖励 +${formatPoints(amount)}${amount < wanted ? "（奖池只剩这么多）"
      : appleCapped ? `（金苹果一次最多加 ${formatPoints(appleCapped)}）` : ""}`;
  } else if (kind === "tnt" && !blockedTnt) {
    text = `TNT！奖励 -${formatPoints(-amount)}（${rules.tntPercent}%，向下取整）`;
  }
  if (budgetLeft(game) === 0) game.over = true;

  /** @type {Result} */
  const result = { kind, cardId, index, amount, blocked: blockedTnt, text, newCardId: grown?.id ?? null };
  player.lastResult = result;
  game.seq += 1;
  /** @type {FeedItem} */
  const feed = { seq: game.seq, uid: player.uid, name: player.name, kind, cardId, index, text: publicText, at: now, newCardId: grown?.id ?? null };
  game.feed = [feed, ...game.feed].slice(0, FEED_LIMIT);
  return { ok: true, result, feed, newCard: grown, claimNow: player.chances === 0 || game.over };
}

/** 领取：分定下来，之后不能再挖。再领一次还是同样的分。 */
export function claim(/** @type {Game} */ game, /** @type {Player} */ player) {
  if (player.status !== "claimed") {
    player.status = "claimed";
    game.stats.claimed += 1;
    game.stats.claimedPoints += player.points;
  }
  return player.points;
}

/** A1、C5：行是字母，列是数字。 */
export function cellName(/** @type {Card} */ card, /** @type {number} */ index) {
  return `${"ABCDEFG"[Math.floor(index / card.size)]}${index % card.size + 1}`;
}

/** 一张卡给大家看的样子：挖开的格子、剩下各种道具的数量；没挖开的牌不出去。 */
export function publicCard(/** @type {Card} */ card) {
  const left = { ...card.composition };
  const cells = card.opened.map((open, index) => {
    if (open === null) return null;
    left[card.deck[index]] -= 1;
    return { kind: card.deck[index], uid: open.uid, name: open.name, at: open.at };
  });
  return { id: card.id, x: card.x, y: card.y, size: card.size, ...(card.kind ? { kind: card.kind } : {}), cells, left, finished: card.finished };
}

/** 整局给大家看的样子。 */
export function publicGame(/** @type {Game} */ game) {
  return {
    seq: game.seq,
    rules: game.rules,
    pool: game.pool,
    left: budgetLeft(game),
    deadlineAt: game.deadlineAt,
    wrapUpAt: game.deadlineAt === null ? null : game.deadlineAt - WRAP_UP_MS,
    over: game.over,
    stats: game.stats,
    cards: Object.values(game.cards).map(publicCard),
    feed: game.feed,
  };
}

/** 只给他自己看的。 */
export function privatePlayer(/** @type {Player} */ player) {
  return {
    chances: player.chances, shield: player.shield, peeks: player.peeks,
    points: player.points, digs: player.digs, status: player.status, lastResult: player.lastResult,
  };
}
