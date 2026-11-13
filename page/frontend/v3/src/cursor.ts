// 电脑上的鼠标指针（docs/V3_ITEMS.md §5）：左上一个像素箭头，箭头尖就是点到的位置，右下挂着
// 拿着的道具的小图标；冷却时镐子变灰，附魔镐带紫光。浏览器的指针图不能缩放，所以在这里按原版
// 16 像素贴图画一张 32 像素的，放进 CSS 变量（--cur-*）。画不出来就用默认指针。

const BASE = 'assets/minecraft/1.21.4/'
export const ARROW = [
  'X..........', 'XX.........', 'XWX........', 'XWWX.......', 'XWWWX......', 'XWWWWX.....', 'XWWWWWX....', 'XWWWWWWX...',
  'XWWWWWWWX..', 'XWWWWWXXXX.', 'XWWXWWX....', 'XWX.XWWX...', 'XX..XWWX...', 'X....XWWX..', '.....XWWX..', '......XX...',
]

type Mode = 'plain' | 'gray' | 'ench'
const CURSORS: Record<string, [string, Mode]> = {
  pick: ['textures/item/iron_pickaxe.png', 'plain'],
  cool: ['textures/item/iron_pickaxe.png', 'gray'],
  ench: ['textures/item/iron_pickaxe.png', 'ench'],
  spyglass: ['textures/item/spyglass.png', 'plain'],
  torch: ['textures/block/torch.png', 'plain'],
  key: ['textures/item/trial_key.png', 'plain'],
}

function draw(image: HTMLImageElement, mode: Mode) {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const context = canvas.getContext('2d')
  if (!context) return null
  context.imageSmoothingEnabled = false
  const icon = document.createElement('canvas')
  icon.width = 16
  icon.height = 16
  const ic = icon.getContext('2d')
  if (!ic) return null
  ic.imageSmoothingEnabled = false
  ic.drawImage(image, 0, 0, 16, 16)
  if (mode === 'gray') {
    const data = ic.getImageData(0, 0, 16, 16)
    for (let at = 0; at < data.data.length; at += 4) {
      const value = (data.data[at] * 0.3 + data.data[at + 1] * 0.59 + data.data[at + 2] * 0.11) * 0.75
      data.data[at] = data.data[at + 1] = data.data[at + 2] = value
    }
    ic.putImageData(data, 0, 0)
  }
  if (mode === 'ench') {
    ic.globalCompositeOperation = 'source-atop'
    ic.fillStyle = 'rgba(170, 90, 255, 0.45)'
    ic.fillRect(0, 0, 16, 16)
  }
  // 图标描一圈黑边，压在箭头尾巴上也分得清
  const outline = document.createElement('canvas')
  outline.width = 16
  outline.height = 16
  const oc = outline.getContext('2d')
  if (!oc) return null
  oc.drawImage(icon, 0, 0)
  oc.globalCompositeOperation = 'source-in'
  oc.fillStyle = '#000'
  oc.fillRect(0, 0, 16, 16)
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) context.drawImage(outline, 13 + dx, 14 + dy)
  context.drawImage(icon, 13, 14)
  ARROW.forEach((row, y) => [...row].forEach((pixel, x) => {
    if (pixel === '.') return
    context.fillStyle = pixel === 'X' ? '#000' : '#fff'
    context.fillRect(x, y, 1, 1)
  }))
  return canvas.toDataURL()
}

let made = false
/** 画一次所有指针；只在有鼠标的设备上画。 */
export function makeCursors() {
  if (made || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return
  made = true
  for (const [name, [path, mode]] of Object.entries(CURSORS)) {
    const image = new Image()
    image.onload = () => {
      try {
        const url = draw(image, mode)
        if (url) document.documentElement.style.setProperty(`--cur-${name}`, `url("${url}") 0 0, default`)
      } catch {
        // 画不出来就用默认指针
      }
    }
    image.src = new URL(BASE + path, document.baseURI).href
  }
}
