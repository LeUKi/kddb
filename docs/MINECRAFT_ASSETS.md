# Minecraft 原版资源来源

此页面使用 Minecraft 自己的物品贴图、方块贴图和背包图标。没有重画 SVG，也没有生成替代图案。资源位于 `page/frontend/public/assets/minecraft/1.21.4/`，打包后的 URL 前缀为 `/assets/minecraft/1.21.4/`。

## 官方 Java 1.21.4 原始资源

2026-10-31 从 Mojang 官方版本清单定位固定版本 `1.21.4`，下载客户端 JAR，先核对版本元数据 SHA-1、客户端大小与 SHA-1，再逐字节提取选用的文件。

| 对象 | 官方来源 / 校验值 |
| --- | --- |
| 版本清单 | <https://piston-meta.mojang.com/mc/game/version_manifest_v2.json> |
| 1.21.4 版本元数据 | <https://piston-meta.mojang.com/v1/packages/64843a304d7747da779448f853323962233f39ff/1.21.4.json> |
| 版本元数据 SHA-1 | `64843a304d7747da779448f853323962233f39ff` |
| 官方客户端 JAR | <https://piston-data.mojang.com/v1/objects/a7e5a6024bfd3cd614625aa05629adf760020304/client.jar> |
| JAR SHA-1 | `a7e5a6024bfd3cd614625aa05629adf760020304` |
| JAR 大小 | `28,335,587` 字节 |

`manifest.json` 记录 89 个官方原始文件：60 个 PNG 和 29 个模型 / 物品 JSON，合计 22,794 字节（2026-11-06 为末影之眼和末地宝藏卡，从同一个 JAR——核对过大小和 SHA-1——补提取 `ender_eye.png`、`end_stone.png` 两个文件，各 214、206 字节）。每个条目都有 JAR 内的原始路径、字节数和 SHA-256；PNG 另有宽高。文件内容未经重采样、改色或重新编码。这些是选用的资源，不是完整资源包。

| 页面用途 | 官方原始文件，相对资源根目录 | 尺寸 |
| --- | --- | --- |
| 绿宝石 | `textures/item/emerald.png` | 16 × 16 |
| 钻石 | `textures/item/diamond.png` | 16 × 16 |
| 金苹果基础贴图 | `textures/item/golden_apple.png` | 16 × 16 |
| 不死图腾（资源库保留，界面已替换） | `textures/item/totem_of_undying.png` | 16 × 16 |
| 末影珍珠 | `textures/item/ender_pearl.png` | 16 × 16 |
| 末影之眼 | `textures/item/ender_eye.png` | 16 × 16 |
| 末地石（末地宝藏卡） | `textures/block/end_stone.png` | 16 × 16 |
| 望远镜 | `textures/item/spyglass.png` | 16 × 16 |
| 铁镐 | `textures/item/iron_pickaxe.png` | 16 × 16 |
| 石头、深板岩、原矿、木材 | `textures/block/` 内对应名称的 PNG | 16 × 16 |
| TNT 六面材质 | `textures/block/tnt_side.png`、`tnt_top.png`、`tnt_bottom.png` | 16 × 16 |
| 挖掘裂纹 0–9 | `textures/block/destroy_stage_0.png` 至 `destroy_stage_9.png` | 16 × 16 |
| 盾牌原始图集 | `textures/entity/shield_base.png`、`shield_base_nopattern.png` | 64 × 64 |
| 单箱原始图集 | `textures/entity/chest/normal.png` | 64 × 64 |

金苹果的原始物品 PNG 没有附魔闪光；附魔金苹果的完整背包效果使用下面的原版背包动画。

## 背包渲染图

石头和 TNT 的背包图标由游戏根据方块模型渲染，盾牌和箱子由专用模型与实体图集渲染。客户端没有名为 `textures/item/stone.png`、`tnt.png`、`shield.png` 或 `chest.png` 的独立背包贴图。

这里采用 Minecraft Wiki 公开的原版背包渲染图。它们和上述直接提取的 Mojang 文件分开保存。通过 MediaWiki API 查询每个文件的真实 URL、大小和 SHA-1，下载后核对 SHA-1；四张 PNG 已逐张查看。每个文件的 Wiki 描述均标注 `License Mojang`，静态图另标注 `SpriteFile`。附魔金苹果明确描述为 animated inventory icon。其 `.png` Wiki 名称实际重定向到 GIF，因此本地保留真实 `.gif` 格式和动画。

| 本地文件，相对资源根目录 | 来源文件页 | 尺寸 / 大小 | 来源 SHA-1 |
| --- | --- | --- | --- |
| `inventory/tnt.png` | [Invicon TNT](https://minecraft.wiki/w/File:Invicon_TNT.png) | 32 × 32 / 512 字节 | `3319bab1084e847c70e1496a2125f0411658b324` |
| `inventory/shield.png` | [Invicon Shield](https://minecraft.wiki/w/File:Invicon_Shield.png) | 32 × 32 / 343 字节 | `54d391c13fc2a418bbab481bf73baacb0baed481` |
| `inventory/chest.png` | [Invicon Chest](https://minecraft.wiki/w/File:Invicon_Chest.png) | 32 × 32 / 775 字节 | `56521798cec43fb49c9b5b0538cc2609989dc06c` |
| `inventory/stone.png` | [Invicon Stone](https://minecraft.wiki/w/File:Invicon_Stone.png) | 32 × 32 / 434 字节 | `a5028873b84838e4f1a2d36a79a8e602155a71c3` |
| `inventory/enchanted_golden_apple.gif` | [Invicon Enchanted Golden Apple](https://minecraft.wiki/w/File:Invicon_Enchanted_Golden_Apple.gif) | 32 × 32 / 561,974 字节 | `eb9adf78243cc3fa58f73f1a104a6109673c8c66` |

另有 `inventory/enchanted_golden_apple.png`：用 Pillow 将上述 GIF 的第一帧解码为 RGBA，再保存为 32 × 32 PNG（970 字节，SHA-1 `f153666dd7ea093fb93c7575e7df1efbb6e4a896`）。这是原动画的静态首帧，用于 `prefers-reduced-motion`；没有缩放、改色或重画，已核对 PNG 与 GIF 第一帧的 RGBA 像素完全一致。该 PNG 是本地派生文件，来源记录中明确标注这一点。

`inventory/provenance.json` 保留每份图像的来源文件页、下载地址、Wiki 描述文本、尺寸、字节数、SHA-1 与 SHA-256，以及静态首帧的派生方式。这里的背包图是 Wiki 提供的原版游戏图像，不把它们称为从 1.21.4 JAR 提取的文件，也不声明其具体生成版本；它们的来源记录和官方文件校验记录独立。

## 显示与模型参考

使用 `<img>` 引用上述资源，并设置 `image-rendering: pixelated`。保持原始宽高比，以整数倍放大可以保留像素边缘。附魔金苹果 GIF 已包含原版闪光，无需叠加自画高光。

当前额外机会道具显示为“双铁镐”：两次引用同一张原版 `textures/item/iron_pickaxe.png`，在 CSS 中错位叠放，没有修改源图像。剩余机会也逐把引用这张铁镐图。内部仍使用 `kind: "totem"` 与原有判定器和持久数据兼容。背景是 `CaveScene.tsx` 中独立原创的低对比岩壁轮廓，不作为 Minecraft 原版资源。

如需要自行绘制方块三维面，`models/block/tnt.json`、`cube_bottom_top.json`、`cube.json` 和 `block.json` 保留了官方模型与材质映射。普通方块背包姿态位于 `models/block/block.json`：旋转 `[30, 225, 0]`，缩放 `[0.625, 0.625, 0.625]`。箱子姿态位于 `models/item/template_chest.json`：旋转 `[30, 45, 0]`，相同缩放。盾牌姿态位于 `models/item/shield.json`：旋转 `[15, -25, -5]`、平移 `[2, 3, 0]`、缩放 `[0.65, 0.65, 0.65]`。实体图集不能直接当作背包图显示。

Minecraft 的美术资源由 Mojang / Microsoft 持有权利；本项目没有将其重新授权为自己的原创素材。Wiki 的 `License Mojang` 标记也不等于给游戏图像授予 Wiki 正文的许可。项目与 Minecraft、Mojang 或 Microsoft 没有官方关联。
