# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-10-31
- Primary product surfaces: 矿洞夺宝，lafish 红包站代码协议第五版的多人附带网页；单一游戏页面、规则弹窗、本地多人联调页。
- Evidence reviewed: 本轮用户确认的玩法、机会和参数讨论；官方 `AGENTS.md`、`judge.d.ts`、`page/hb.d.ts`、`examples/scratch-card/`、`cli/lib/page.mjs`。
- Official kit source: https://github.com/LeUKi/hb/tree/68ef3d2b1597219f6eb91db4625e995cd670b7ce/kit 。开发包运行时保持原样。
- Existing design evidence: `artifacts/desktop-cave.jpg`、`artifacts/mobile-cave.png` 和已实现的游戏页。最新用户要求：原版双铁镐表示额外机会、逐把展示机会、道具数量与问号合并、可恢复的底部日志、中央放大道具演出、单页规则弹窗、对角线翻卡，以及收敛背景。
- Design guidance: Anthropic `frontend-design` 的单一视觉重点、克制文案和截图自评；https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md 。

## Brand
- Personality: 有探索感的共享矿洞，像素道具与清晰、克制的游戏界面。
- Trust signals: 主界面展示实际待结算余额、逐把机会和剩余道具数量；规则在原页弹窗查看；成功判定后才揭示道具。
- Avoid: 隐藏次数额度、复杂背包系统、付费入口、未经确认的自动提交、把模拟奖励展示为真实到账。

## Product goals
- Goals: 两名以上玩家共享 5×5 卡片，交替挖掘，按道具改变自己的奖励和机会，可主动收手。
- Non-goals: 首版不增加攻击其他玩家、信标、道具交易、工具升级、固定座次、机会道具累计额度。
- Success signals: 打开即可看到棋盘、自己的奖励和机会；没有宣传区、侧栏或常驻规则说明；多人牌面同步；抢同格或旧卡操作不扣机会；资金、机会、结算均与判定器一致；手机能顺畅操作。

### Confirmed rules
1. 每人初始 7 次机会，可由红包参数修改。第一次成功挖掘加入游戏。
2. 每次成功挖掘先扣 1 次，再处理效果；效果处理完后机会为 0，立即结算。没有次数上限或机会道具累计额度。
3. 最近成功挖掘的人需要别人接棒，或等待默认 10 秒后才能再挖。A→B→A 可以立即接棒；平台自身冷却另外生效。
4. 不合法、已打开、卡片过期、等待未结束的操作不扣机会、不改变最近成功挖掘的记录。不自动重试提交。
5. 主动「收手结算」不消耗机会、不改变最近挖掘记录、不受游戏接棒等待限制；平台自身的提交限制仍适用。结算 0 也退出，不能重新加入。
6. 机会、奖励和盾牌跨卡保留。末影珍珠立即换卡；全部 25 格打开也自动换卡，不另扣次数。
7. 所有金额用整数分计算。正收益最多占用剩余可分配奖池，扣款最低到 0。平台奖池占满或截止时全员结算。
8. 未打开的位置内容只存在服务端 state；公开剩余种类数量，不公开位置。望远镜情报只发本人。

| kind | Minecraft 物品 | 每卡数量 | 效果 |
| --- | --- | ---: | --- |
| emerald | 绿宝石 | 10 | 一份小奖 |
| diamond | 钻石 | 3 | 小奖 ×5 |
| apple | 附魔金苹果 | 1 | 待结算奖励翻倍；余额为 0 时给一份小奖 |
| totem | 两把错位叠放的原版铁镐 | 2 | 扣除本次机会后增加 3 次；最后一次可救回，无累计额度；保留内部 kind 与判定器兼容 |
| tnt | TNT | 4 | 扣除当前待结算的指定百分比，扣除金额向下取整到分 |
| pearl | 末影珍珠 | 2 | 全体进入下一张随机卡 |
| shield | 盾牌 | 2 | 自动抵挡下一次 TNT，最多持有一面；重复获得给小奖 |
| spyglass | 望远镜 | 1 | 私下查看一个尚未公开、自己尚未获知的格子；没有新格子可看时给小奖 |

### Hongbao parameters
- `initialChances`: integer，默认 7，1–20。
- `waitSeconds`: integer，默认 10，1–60。
- `smallReward`: money，默认 10 分，至少 1 分；默认只是首版试玩基数。
- `tntPercent`: integer，默认 25，1–100。
- 钻石 ×5、双铁镐 +3、5×5 尺寸和每卡道具构成固定。总奖池、截止、标题、说明使用平台设置。
- `check` 要求总奖池至少足够完整的一份钻石奖励；实际后续发奖仍按剩余奖池裁剪。参数为公开规则。

## Personas and jobs
- Primary personas: 从红包页进入的 LINUX DO 玩家；发红包的人；只看牌面的游客。
- User jobs: 知道能否操作、选格挖掘、观察余下风险、了解本人的道具和金额、决定收手。
- Key contexts of use: 手机抽屉或桌面附带网页；可随时进入，无需等全部玩家就座。

## Information architecture
- Primary navigation: 只有一个游戏页面；规则在原页弹窗中打开和关闭。
- Core routes/screens: `#/` 展示奖励、逐把机会、剩余道具入口、棋盘、状态、收手和最近挖掘；规则不切路由。
- Content hierarchy: 紧凑标题 → 奖励与剩余机会数字/铁镐列 → 8 种道具图标数量及问号组成的单一规则按钮 → 5×5 卡片 → 一句状态 → 收手 → 最近 10 条挖掘。
- 桌面与手机采用同一单列布局。新增的数量和日志只展示真实游戏信息，不恢复宣传区、背包容器、参与人数装饰或重复奖池。

## Design principles
- 服务端结果优先：网页展示实际判定结果，不自行决定奖励和秘密牌面。
- 一眼知道下一步：明确区分能挖、等待、平台冷却、已结算、红包结束。
- 保持少量规则：一把原版铁镐对应一次剩余机会，逐把排列且不截断；额外机会道具由两把原版铁镐错位叠放；盾牌一个状态；望远镜情报直接标在本人格子上。
- 先删信息，再排字号：主界面每段文字必须帮助当前动作；规则和边界情况按需查看。
- 棋盘是静止时的视觉重点；触发后中央道具短暂接管注意力。背景仅保留低对比洞壁，删除木梁、火把、矿轨、晶簇与环境粒子。
- Tradeoffs: 点击与轻拖都能挖；刮开动作保留触感，但不以精细刮擦作为可用性门槛。

### Earlier simplification baseline
- Palette (superseded by the cave direction below): 本轮移除旧版的全屏绿灰配色，保留简洁的信息层次。
- Type: 中文继续用系统苹方/思源回退，避免在线字体依赖；金额使用同字体的等宽数字。正文 16px，辅助标签和格子效果至少 14px，主界面金额 32–36px。
- Layout: 居中、最大约 480px 的单列游戏台，文字左右对齐，棋盘保持正方形；较矮桌面窗口按可用高度缩减游戏台宽度，保留按钮可见和格子点击尺寸。

```text
矿洞夺宝                         [?]
待结算                      剩余机会
0.00 LDC                       ⛏ 7
第 1 张卡片                 [已持盾时]
┌─────────────────────────────────┐
│             5 × 5               │
│              棋盘               │
└─────────────────────────────────┘
          选一格，挖开看看
          [ 收手结算 ]
```

- Brief review: 拒绝继续用仪表盘双栏和缩小文字来容纳功能；移除通用宣传标题、卡片嵌套、状态点、重复坐标和按钮箭头。Minecraft 特征集中在矿石、物品和石槽，避免给安静的周边再加装饰。
- Verification: 实际检查 360px/390px 手机和桌面截图，主界面无小于 14px 的可见文字，25 格可操作，帮助可返回，收手确认和多人接棒继续可用。

## Visual language
- Color: 深灰蓝背景 `#13191f` 与低对比岩壁；石面使用原版纹理；暖白文字 `#f5e7cf` 和柔和琥珀强调。背景不与前景争夺颜色和轮廓。
- Typography: 中文使用系统苹方/思源黑体回退；金额和次数使用等宽数字。正文 16px，标签和格子效果至少 14px。
- Spacing/layout rhythm: 4px 基础节奏，主要间距 8/12/16/24/32；游戏内容最大约 480px。
- Shape/radius/elevation: 只有棋盘采用石槽和方块边缘；状态和个人信息直接排在背景上，不加面板。
- Motion: 按确认事件使用「裂纹 → 中央道具放大及文字停留 → 飞行/淡出 → 同步数值及牌面 → 按需翻卡 → 结算」。中央说明必须有足够阅读时间；下方联动延后，常规拾取不震屏。
- Imagery/iconography: 平面道具使用从 Minecraft Java 1.21.4 官方客户端提取的原始纹理；TNT、盾牌、箱子等使用 Minecraft Wiki 的原版背包渲染图，来源与具体生成版本的边界单独记录。禁止用原创 SVG 冒充 Minecraft 道具。矿洞背景是独立原创 SVG 环境插画，来源记录见 docs/MINECRAFT_ASSETS.md。

## Components
- Existing components to reuse: 原有 ItemIcon、Jotai 状态、提交恢复流程、公开 feed 和官方 SDK；保留判定器及其数据契约。feed 来自持久 state，最多 10 条且跨卡保留，不新增浏览器历史缓存。
- New/changed components: AppShell、MineBoard、MineCell、ItemIcon、TurnStatus、PlayerSummary、LootDashboard、RulesDialog、ActivityLog、BoardFeedback、SettlementDialog。
- Variants and states: 格子隐藏/正在提交/公开/本人私有情报；本人状态初始/游戏中/已结算；接棒允许/等待。
- Token/component ownership: `page/frontend/src/styles.css` 管理视觉变量；React 组件复用同一个 ItemIcon 和金额格式化工具。

## Accessibility
- Target standard: 以 WCAG 2.2 AA 可用性为目标，清楚的文字对比与焦点。
- Keyboard/focus behavior: 每个格子是有坐标的 button，Enter/Space 可操作；弹窗具备焦点管理与 Escape。
- Contrast/readability: 状态同时用文字和图标表达，不只靠颜色。
- Screen-reader semantics: 格子包含坐标和公开状态；未开的秘密不进入 DOM；奖励与错误使用温和的 aria-live。
- Reduced motion and sensory considerations: MotionConfig reducedMotion=user，并用媒体查询订阅实时偏好变化；保留中央说明约1.2秒，关闭飞行、震动与三维翻转，不使用频闪。

## Responsive behavior
- Supported breakpoints/devices: 360px 及以上手机、平板和桌面浏览器。
- Layout adaptations: 所有宽度单列，格子保持 5×5；手机缩减留白，保留可读字号，避免整页横向滚动。
- Touch/hover differences: 手指短距离刮动或点按可提交，键盘等价；长距离滚动不会意外挖掘。

## Interaction states
- Loading: 连接红包站，占位牌面不可挖。
- Empty: 尚未加入时显示初始次数与 0.00，说明第一次挖掘即加入。
- Error: 显示判定器或平台给出的原因；网络不确定时刷新本人记录和牌面，不自动重提。查询失败时保留牌面并锁住后续操作，通过“重新确认状态”恢复。
- Success: 以 SDK 实际 pending/settled 为准，中央道具说明后才更新格子和数值；公开挖掘记录在底部展示，最多10条。
- Disabled: 抢格失败不扣机会；游戏等待仍可收手；结算/结束后牌面供围观。
- Offline/slow network: 锁住当前提交，保留可读牌面，失败给出人工重试/重新连接入口。

## Content voice
- Tone: 直接、轻松，使用简短的游戏提示。
- Terminology: 挖掘、剩余机会、待结算奖励、收手结算、接棒、换卡；不引入生命、耐久或能量。
- Microcopy rules: 10 秒等待只属于连续挖掘；清楚说明平台冷却；未结算金额不写成已到账。

## Implementation constraints
- Framework/styling system: React + TypeScript + TanStack Router 的 hash history + Jotai + Motion；CSS 原生变量，无新增组件库。
- Design-token constraints: 单一 CSS 变量来源；图标离线可用。
- Performance constraints: 判定器无依赖且单文件，50ms CPU；共用 state 64KB、公开 data 16KB、个人 state/data 各 4KB。历史有界，不记录全体玩家名单。
- Compatibility constraints: 原样保留官方 runtime、cli、类型、schema 与根 package.json；用户指定的前端依赖仅放在 `page/frontend/`。构建输出到 `page/index.html`、`page/assets/`。
- Test/screenshot expectations: `npm test`、`npm run check`；前端 typecheck/build；真实 workerd 多步判定测试；桌面/手机实际渲染、双人同步、私有情报隔离与抢同格验证。
- SDK: 使用 `hb.ready/view/me/myView/submit/on/now`；自己的 actorKey 与公共 lastMove.actorKey 比较，仅用于 UI，授权以 user.id 为准。以 `settled` 判断退出，包含 0 元结算。
- Local harness: 官方 npm run page 原样可用；另在 `page/dev/` 增加项目自有本地包装，轮询官方 API、推送 SDK 事件并校准模拟时钟，验证跨标签同步。该包装不参与静态发布。

### Data contract
- Commands: `dig <cardId> <1-based cell>`；`cashout` 或 `收手`。
- Public `view.data`: `{ version:1, cardId, cells:[{ index, kind:null|kind, by:null|string, at:null|number }], counts:{kind:remaining}, rules:{initialChances,waitSeconds,smallReward,bigMultiplier:5,totemBonus:3,tntPercent}, lastMove:null|{actorKey,name,at,cardId,index}, stats:{digs,players}, feed:[{id,actor,kind,text,at,cardId,index}] }`。
- Private `player.view.data`: `{ version:1, actorKey, chances, shield, peeks:[{cardId,index,kind}], digs, status:'playing'|'settled', lastResult:null|{kind,cardId,index,amount,blocked,text} }`。
- `index` 在数据中从 0 开始，指令中的格子从 1 开始。actorKey 使用稳定的玩家标识，仅用于匹配，不承担认证。
- Public feed 最多 10 条；私人情报仅保留当前卡；隐藏格子的 kind 必须为 null，不能带内部牌面或随机种子。

## Open questions
- [x] 用户已授权将网页发布至 Cloudflare Workers；正式地址 https://hbweb-kddb.lafi.sh/，Worker 为 `hbweb-kddb`，判定器 `meta.page` 已配置。只发布 `page/frontend/dist/`；身份、判定与结算继续由红包站提供。
- [ ] 默认小奖 0.10 和卡组比例属于首版试玩值，按实际参与人数与奖池消耗再调。
- [x] 已完成桌面、390px/360px 窄屏实际渲染检查及双人浏览器联调；截图见 artifacts/，触屏真机仍待复核。

## Current quiet cave and confirmed event choreography (2026-10-31)

- Visual thesis: 低对比的大块洞壁只暗示空间，安静地衬托实际牌面；删除原背景的木梁、火把、轨道和晶簇。道具与石面继续使用原版 Minecraft 纹理。
- Composition: 中央深色区域干净，岩壁只在边缘轻微出现，手机减少更多环境细节；棋盘容器与每个格子的占位在换卡时保持不变。
- Materials: 岩层使用大轮廓和有限阴影，不使用全屏纹理噪点；石块不软弹。道具使用像素最近邻缩放，不重新绘制图标。
- HUD: 奖励数字、剩余机会数字与逐把铁镐；图标数量与问号合并为一个规则入口；棋盘、状态、收手及底部最近 10 条挖掘。中央道具反馈临时出现，规则使用带进出动画的原页弹窗。
- References applied: 社区 game-feel skill https://github.com/gamedev-skills/awesome-gamedev-agent-skills/blob/main/skills/disciplines/game-feel/SKILL.md 的离散事件、分级反馈和呈现独立；GDC Folmer Kelly《Don't Juice It or Lose It》https://www.gdcvault.com/play/1020861/don-t-juice-it-or 的材质语义与避免过量反馈；Motion https://motion.dev/docs/react-accessibility 的 reducedMotion。
- Art guidance applied: atmospheric-game-art-director/SKILL.md 的世界/HUD分离、少量持久信息、环境层次和低强度待机。用户已经指定矿洞与自主实施，无需重新采访已确定方向。

| 阶段 | 从确认时刻起 | 呈现契约 |
| --- | --- | --- |
| 按下/等待确认 | 网络耗时独立 | 格子下压、原版铁镐敲击、局部裂纹；不提前揭示或改钱 |
| reveal | 0–260ms | 确认后的局部裂纹，牌面和数值保留原值 |
| effect | 260–1760ms | 中央大图标、道具名称与效果说明；其他玩家不显示其私有奖励 |
| transfer | 1760–2460ms | 图标飞向奖励、机会、盾牌或侦察目标；无需联动则自然淡出，底部尚不更新 |
| resolve | 2460–2840ms | 飞行落定后更新真实数值、机会铁镐、格子、情报、盾牌与日志 |
| transition | 按需追加1160ms | 25 格原地绕 Y 轴翻转，按行号加列号 stagger，从左上向右下推进 |
| settle | 全序列后 | 完成最后一击后展开宝箱与结算金额；后端在确认时已经禁止后续操作 |

- Multiplayer: 权威数据持续接收；呈现层去重、短队列/合并远端变化；不播初次进入时已有历史，不把远端效果加到自己 HUD。旧卡拒绝恢复最新牌面，不补造本地成功。
- Reduced motion: 保留约 1.2 秒的中央说明阅读时间，其余阶段短淡入；禁用碎屑、震动、飞行和三维翻转。
- Hard non-goals: 不恢复绿色仪表盘；不把石面做成软糖；不把原创图标称为原版；不添加永久漂浮、闪烁或全屏强光。
- Checks: 原始PNG和SHA-1来源、确认前无泄露、珍珠旧卡演出、末击结算、同格失败、多人快速更新、移动端完整棋盘/按钮、减少动态偏好、所有动作结束归位。

### Implementation brief

使用现有 React/TanStack Router/Jotai/Motion 实现单页多人 5×5 矿洞红包。保留判定器和所有金钱规则，只改呈现。道具使用原版 Minecraft 本地素材，双铁镐由两张原版铁镐贴图错位叠放；剩几次机会就排几把铁镐。背景仅保留低对比灰蓝洞壁轮廓，删除木梁、火把、轨道、晶簇与漂浮粒子。主界面依次为奖励与机会、逐把铁镐、道具数量及问号入口、棋盘、状态、收手和持久化的最近10条挖掘。规则在原页弹窗中打开和关闭。确认后先局部裂纹，再中央放大道具及效果文字停留，随后飞入目标或淡出，最后同步数值和牌面；珍珠换卡追加25格按对角线错开的原地翻转。错误不播成功，未确认不揭示，远端效果不改本人数值。减少动态模式保留阅读时间并取消三维翻转、震动及飞行。验证桌面和360/390手机实际渲染、键盘/点按/刮动、多人、珍珠、末击结算、刷新日志与恢复错误路径。保持现有官方开发包不变，不增加依赖。
