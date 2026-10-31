import { cp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

// Build into an isolated directory first. Publish the same artifact to the kit's
// page/ entry point only after a successful build, leaving source and SDK types intact.
await build()
const output = new URL('./dist/', import.meta.url)
const page = new URL('../', import.meta.url)
await rm(new URL('assets/', page), { recursive: true, force: true })
await cp(new URL('assets/', output), new URL('assets/', page), { recursive: true })
await cp(new URL('index.html', output), new URL('index.html', page))
console.log(`静态发布目录：${fileURLToPath(output)}`)
console.log('已同步至官方预览入口 page/index.html 和 page/assets/')
