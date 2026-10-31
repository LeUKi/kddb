# 矿洞夺宝

Minecraft 主题的多人共享刮格红包，使用 lafish 红包站代码协议第五版。包含可独立上传的判定器 `judge.js`、平台测试 `tests.json`、React 游戏网页和真实 workerd 本地多人试玩入口。

正式网页已部署到 Cloudflare Workers：**<https://hbweb-kddb.lafi.sh/>**。`judge.js` 的 `meta.page` 已配置为该地址。游戏数据、身份和提交由红包站宿主提供；本地多人模拟入口继续保留。

## 本地试玩

需要 Node.js 22 或更新版本。在项目根目录执行：

```sh
npm ci
npm --prefix page/frontend ci
npm --prefix page/frontend run build
node page/dev/server.mjs
```

打开两个标签页，分别扮演两名玩家：

- 小明：<http://127.0.0.1:8740/?who=%E5%B0%8F%E6%98%8E>
- 小红：<http://127.0.0.1:8740/?who=%E5%B0%8F%E7%BA%A2>

这些页面共享一个本地判定器和奖池，各自拥有独立背包。每名玩家第一次操作时会出现本地代提交授权；顶部可以切换玩家、围观或重新开始。页面每 0.5 秒同步一次，所有金额都是模拟数据，不发生真实付款。退出服务器使用 Ctrl+C。

默认占用 `8740` 和 `8741` 两个端口，后者是 iframe 游戏源，试玩应从前者进入。可以用 `node page/dev/server.mjs --port 8750` 更换端口，游戏源相应使用 `8751`。修改前端后重新构建并刷新页面；修改判定器后重启本地服务器。

官方的 `npm run page` 入口也保留可用。项目的 `page/dev/` 包装层增加跨标签页同步、校准时钟和独立身份，未修改官方 SDK 或运行时。

## 玩法

所有玩家共用一张 5×5 卡片，点按或横向刮开一格。初始 7 次机会，每次成功挖掘先扣 1 次，再触发道具；处理完仍为 0 次则立即结算。双铁镐增加 3 次，没有累计额度，最后一次挖到双铁镐也能继续。判定器内部沿用 `totem` 名称，兼容已有数据。

上一位成功挖掘的玩家需要别人接棒，或者等 10 秒后再挖。A→B→A 可以立即接棒。抢到已开格子、旧卡指令、未等满时间都不扣机会。红包站自身的提交冷却和参与条件另外生效。

| 道具 | 每卡数量 | 效果 |
| --- | ---: | --- |
| 绿宝石 | 10 | 一份小奖，默认 0.10 |
| 钻石 | 3 | 小奖的 5 倍，默认 0.50 |
| 附魔金苹果 | 1 | 当前待结算翻倍；余额为 0 时给一份小奖 |
| 双铁镐 | 2 | 增加 3 次机会，无累计额度 |
| TNT | 4 | 默认扣除当前待结算的 25%，扣除金额向下取整到分 |
| 末影珍珠 | 2 | 所有人进入下一张随机卡；机会、奖励和盾牌保留 |
| 盾牌 | 2 | 自动挡住下一次 TNT；最多持有一面，重复获得给一份小奖 |
| 望远镜 | 1 | 私下查看一个未开、自己未知的格子；没有新格子可看则给小奖 |

加入后可以点顶部奖励右侧的「见好就收」领取奖励，不受游戏的接棒等待限制。主动领取或机会用尽都只结算一次；结算后不能再挖这个红包，零奖励也一样。TNT 只影响这个红包尚未结算的奖励；正收益按可分配奖池裁剪，待结算奖励也占用奖池。奖池占满、截止或发放者结束红包时，由红包站统一结算剩余玩家。

## 红包参数

| 参数 | 默认值 | 范围或说明 |
| --- | ---: | --- |
| `initialChances` | 7 | 初始次数，整数 1–20 |
| `waitSeconds` | 10 | 连续挖掘等待秒数，整数 1–60 |
| `smallReward` | 10 | 单位为分，即默认 0.10；至少 1 分 |
| `tntPercent` | 25 | TNT 扣除比例，整数 1–100 |

5×5 尺寸、卡组比例、钻石 ×5 和双铁镐 +3 固定。总奖池、截止时间、标题和说明使用平台字段。判定器还要求总奖池至少能容纳一份完整的钻石奖励。

判定器默认关闭领取前人机验证（`humanCheck: false`）。

## 验证

```sh
# 官方 workerd 判定测试与部署检查
npm test
npm run check
npm run simulate
node scripts/verify-setup.mjs

# 前端不确定提交、恢复与零奖励结算的针对性测试
npm --prefix page/frontend test
npm --prefix page/frontend run typecheck
npm --prefix page/frontend run build

# 先启动本地试玩服务器，再从另一个终端运行
node page/dev/verify.mjs
```

`verify.mjs` 会反复重置本地模拟，完成后保留一场全新游戏。自定义端口时传入完整基址，例如 `node page/dev/verify.mjs http://127.0.0.1:8750`。

已完成的检查、浏览器操作记录和验证边界见 [VALIDATION.md](docs/VALIDATION.md)。完整玩法、数据契约与界面约定见 [DESIGN.md](DESIGN.md)。

## 代码结构

| 文件或目录 | 用途 |
| --- | --- |
| `judge.js` | 单文件、无依赖的第五版判定器；隐藏牌面只在服务端 `state` |
| `tests.json` | 55 个平台测试用例，合计 83 次判定 |
| `simulate.json` | 多人模拟流程 |
| `page/frontend/src/` | React + TypeScript，TanStack Router hash 路由、Jotai 状态、Motion 动画 |
| `page/frontend/test/` | SDK 提交与查询恢复的针对性测试 |
| `page/frontend/dist/` | 构建生成的完整静态发布目录，已忽略 Git 跟踪 |
| `page/wrangler.jsonc` | Cloudflare Worker `hbweb-kddb` 与自定义域名配置，仅发布静态构建目录 |
| `page/index.html`、`page/assets/` | 同步生成的官方本地预览入口 |
| `page/dev/` | 项目自有的本地多人包装与 HTTP 验证脚本 |
| `scripts/verify-setup.mjs` | 在官方沙箱补充验证 setup 和参数交叉约束 |
| `artifacts/` | 实际浏览器预览截图 |
| `runtime/`、`cli/`、SDK 类型与 schema | 官方开发包原样保留 |

网页只展示公开牌面和当前玩家的私有数据。资金和权限判断都由判定器、红包站执行；提交结果未确认时先查询记录，查询失败会暂停继续挖掘和领取奖励，并显示“重新确认状态”，不会自动重提。

## 正式接入

网页地址为 **<https://hbweb-kddb.lafi.sh/>**，Worker 名为 `hbweb-kddb`。后续更新时，在仓库根目录执行：

```sh
npm --prefix page/frontend run build
npx wrangler deploy --config page/wrangler.jsonc
```

首次在其他机器部署前，先安装上述本地开发依赖并执行 `npx wrangler login`。配置只发布 **`page/frontend/dist/`**，不包含本地多人模拟服务、判定器、测试或源码；站内使用 hash 路由，缺失资源返回 404。

`judge.js` 已包含 `page: "https://hbweb-kddb.lafi.sh/"`。运行 `npm test` 和 `npm run check` 后，可到 <https://hb.lafi.sh/judges/new> 粘贴判定器及 `tests.json`，通过后用它发红包。在红包站内继续核对网页授权、登录、人机验证、平台冷却、真实结算和红包结束广播。普通静态网页直接打开时没有红包宿主，需要从红包页加载。

本次完成了网页部署与域名绑定，尚未上传判定器或发出真实红包。首次部署时公共 DNS 与 HTTPS 已验证通过；本机网络仍有域名创建前的 NXDOMAIN 缓存，内置浏览器的正常域名访问需等该缓存过期。详细证据见 [VALIDATION.md](docs/VALIDATION.md)。

## 来源与素材

官方第五版开发包来自 [LeUKi/hb，固定版本 68ef3d2](https://github.com/LeUKi/hb/tree/68ef3d2b1597219f6eb91db4625e995cd670b7ce/kit)。原始开发包说明保存在 [UPSTREAM_KIT_README.md](docs/UPSTREAM_KIT_README.md)，许可见 [LICENSE](LICENSE)。

道具使用 Minecraft 原版贴图与原版背包图像，来源与校验见 [MINECRAFT_ASSETS.md](docs/MINECRAFT_ASSETS.md)。双铁镐是两张原版铁镐 PNG 错位叠放，洞壁背景为项目原创。本项目不是 Minecraft 官方产品。

## 新玩家与多人反馈

机会数字与全部原版铁镐位于同一个资源区，一把对应一次；末次提醒独立于接棒倒计时。首次访问提供可跳过、可在玩法里重新打开的两步演示，固定标为示例，不消耗真实机会、不调用提交接口。浏览器仅保存一个版本化的引导已读标记，不缓存玩家记录。

中央道具演出只展示本人确认的操作；其他玩家的普通操作短暂亮起对应格子并更新持久日志。其他人触发珍珠时显示发起者并翻卡，远端快照合并处理。已开格显示挖掘者，点击查看完整姓名和道具；新版判定器为公开已开格提供可选 actorKey 以可靠标注本人。旧版判定器仍可显示作者姓名，但只有私人 lastResult 可证明的那一格能标为“你”。

研究与单份真实记录的匿名统计见 [docs/UX_RESEARCH.md](docs/UX_RESEARCH.md)。界面部署不会自动替换红包站已保存的判定器；新文案和完整跨刷新本人标记需使用同步更新的 judge.js。
