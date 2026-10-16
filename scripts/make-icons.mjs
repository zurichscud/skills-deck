#!/usr/bin/env node
/**
 * 由一张源图生成 Skills Deck 全套应用图标（零依赖，只用 macOS 自带 sips）。
 *
 * 用法：
 *   node scripts/make-icons.mjs <源图.png|jpg> [--out <目录>]
 *
 * 默认原地更新；--out 时按同样相对路径写到目标目录（便于预览）：
 *   build/icon.icns / build/icon.ico / build/icon.png(512)
 *   resources/icon.png(256) / resources/tray-icon.png(32)
 *   src/renderer/public/icon.png(512)
 * 源图会留档为 build/logo.<ext>（同目录下的旧 logo.* 会被清掉）。
 */
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
/** PNG 梯度：容器取料的唯一来源 */
const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
/** Windows .ico：16–256 七档 */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
/** macOS .icns：与现有产物保持一致，只用 128–1024 四档 */
const ICNS_SIZES = [128, 256, 512, 1024]
const ICNS_TYPE = {
  16: 'icp4',
  32: 'icp5',
  64: 'icp6',
  128: 'ic07',
  256: 'ic08',
  512: 'ic09',
  1024: 'ic10',
}
/** EXIF Orientation → 需要烘焙的旋转角度；镜像类型（2/4/5/7）不支持 */
const ORIENT_ROTATE = { 3: '180', 6: '90', 8: '270' }
const ORIENT_MIRROR = [2, 4, 5, 7]

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function sips(args) {
  return execFileSync('sips', args, { encoding: 'utf8' })
}

function parsePNGSize(buffer) {
  const magic = buffer.subarray(0, 8).toString('latin1')
  if (magic !== '\x89PNG\r\n\x1a\n') fail('内部错误：生成了无效的 PNG')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/** 读取 PNG eXIf / JPEG APP1 中的 EXIF Orientation；读不到按 1 处理 */
function readOrientation(buffer, ext) {
  let tiff = null
  if (ext === '.png') {
    let off = 8
    while (off + 8 <= buffer.length) {
      const length = buffer.readUInt32BE(off)
      const type = buffer.toString('latin1', off + 4, off + 8)
      if (type === 'IEND') break
      if (type === 'eXIf') tiff = buffer.subarray(off + 8, off + 8 + length)
      off += 12 + length
    }
  } else if (ext === '.jpg' || ext === '.jpeg') {
    let off = 2
    while (off + 4 <= buffer.length) {
      if (buffer[off] !== 0xff) break
      const marker = buffer[off + 1]
      if (marker === 0xda || marker === 0xd9) break
      const length = buffer.readUInt16BE(off + 2)
      if (marker === 0xe1 && buffer.toString('latin1', off + 4, off + 10) === 'Exif\0\0') {
        tiff = buffer.subarray(off + 10, off + 2 + length)
        break
      }
      off += 2 + length
    }
  }
  if (!tiff || tiff.length < 8) return 1
  const big = tiff.toString('latin1', 0, 2) === 'MM'
  const read16 = (offset) => (big ? tiff.readUInt16BE(offset) : tiff.readUInt16LE(offset))
  const read32 = (offset) => (big ? tiff.readUInt32BE(offset) : tiff.readUInt32LE(offset))
  if (read16(2) !== 42) return 1
  const ifd = read32(4)
  if (ifd + 2 > tiff.length) return 1
  const count = read16(ifd)
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > tiff.length) break
    if (read16(entry) === 0x0112) {
      const value = read16(entry + 8)
      return value >= 1 && value <= 8 ? value : 1
    }
  }
  return 1
}

/**
 * 去掉 PNG 的 eXIf 与文本类元数据（iTXt / tEXt / zTXt），其余块保留。
 * 必须连 XMP（iTXt）一起删：sips 会依据 XMP 里的 Orientation 重新合成 eXIf，
 * 否则转正后的图在后续缩放时又带出旋转标记，导致二次旋转。
 */
function stripMetadata(png) {
  const kept = [png.subarray(0, 8)]
  let off = 8
  while (off + 8 <= png.length) {
    const length = png.readUInt32BE(off)
    const end = off + 12 + length
    const type = png.toString('latin1', off + 4, off + 8)
    if (!['eXIf', 'iTXt', 'tEXt', 'zTXt'].includes(type)) kept.push(png.subarray(off, end))
    if (type === 'IEND') break
    off = end
  }
  return Buffer.concat(kept)
}

function buildIco(entries) {
  const header = Buffer.alloc(6 + entries.length * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  let offset = header.length
  entries.forEach(({ size, png }, index) => {
    const at = 6 + index * 16
    header.writeUInt8(size >= 256 ? 0 : size, at)
    header.writeUInt8(size >= 256 ? 0 : size, at + 1)
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(png.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...entries.map((entry) => entry.png)])
}

function buildIcns(entries) {
  const parts = entries.map(({ size, png }) => {
    const head = Buffer.alloc(8)
    head.write(ICNS_TYPE[size], 0, 4, 'ascii')
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 4, 'ascii')
  head.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([head, body])
}

/** 回读容器：档数与每档 PNG 字节必须与梯度完全一致 */
function verifyIco(buffer, entries) {
  const count = buffer.readUInt16LE(4)
  if (count !== entries.length) fail('自检失败：ico 档数不符')
  for (let i = 0; i < count; i += 1) {
    const at = 6 + i * 16
    const size = buffer.readUInt8(at) || 256
    const length = buffer.readUInt32LE(at + 8)
    const offset = buffer.readUInt32LE(at + 12)
    const png = buffer.subarray(offset, offset + length)
    if (size !== entries[i].size || !png.equals(entries[i].png))
      fail(`自检失败：ico ${size}px 数据`)
  }
}

function verifyIcns(buffer, entries) {
  if (buffer.readUInt32BE(4) !== buffer.length) fail('自检失败：icns 总长不符')
  let off = 8
  for (const entry of entries) {
    const type = buffer.toString('latin1', off, off + 4)
    const length = buffer.readUInt32BE(off + 4) - 8
    if (type !== ICNS_TYPE[entry.size]) fail(`自检失败：icns ${entry.size}px 类型`)
    if (!buffer.subarray(off + 8, off + 8 + length).equals(entry.png)) {
      fail(`自检失败：icns ${entry.size}px 数据`)
    }
    off += length + 8
  }
  if (off !== buffer.length) fail('自检失败：icns 条目数不符')
}

function main() {
  const args = process.argv.slice(2)
  const outIndex = args.indexOf('--out')
  const outDir = outIndex >= 0 ? args[outIndex + 1] : undefined
  const input = args.find((arg) => !arg.startsWith('--') && arg !== outDir)
  if (!input || (outIndex >= 0 && !outDir)) {
    console.error('用法：node scripts/make-icons.mjs <源图.png|jpg> [--out <目录>]')
    process.exit(1)
  }

  const source = resolve(input)
  const ext = extname(source).toLowerCase()
  if (!existsSync(source)) fail(`找不到源图：${source}`)
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) fail('只支持 PNG / JPG 源图（可用预览导出 PNG）')

  const base = outDir ? resolve(outDir) : ROOT
  const scratch = mkdtempSync(join(tmpdir(), 'skillsdeck-icons-'))
  try {
    const orientation = readOrientation(readFileSync(source), ext)
    if (ORIENT_MIRROR.includes(orientation)) {
      fail(`源图带镜像 EXIF（orientation=${orientation}），请先在预览里转正另存 PNG`)
    }
    let master = source
    if (ORIENT_ROTATE[orientation]) {
      master = join(scratch, 'normalized.png')
      sips(['-s', 'format', 'png', '-r', ORIENT_ROTATE[orientation], source, '--out', master])
      writeFileSync(master, stripMetadata(readFileSync(master)))
      if (readOrientation(readFileSync(master), '.png') !== 1) {
        fail('未能清除源图的 EXIF 旋转标记，请手动转正后重试')
      }
    }

    const info = sips(['-g', 'pixelWidth', '-g', 'pixelHeight', master])
    const width = Number(/pixelWidth:\s*(\d+)/.exec(info)?.[1] ?? 0)
    const height = Number(/pixelHeight:\s*(\d+)/.exec(info)?.[1] ?? 0)
    if (!width || !height) fail('无法读取源图尺寸')
    if (width !== height) fail(`源图需为正方形，当前 ${width}x${height}，请先裁剪`)
    if (width < 256) fail(`源图太小（${width}px），至少要 256px，建议 ≥1024px`)
    if (width < 1024) console.warn(`⚠ 源图 ${width}px，会放大到 1024px，可能发虚（建议 ≥1024px）`)

    const ladder = new Map()
    for (const size of PNG_SIZES) {
      const target = join(scratch, `${size}.png`)
      sips([
        '-s',
        'format',
        'png',
        '-s',
        'dpiWidth',
        '96',
        '-s',
        'dpiHeight',
        '96',
        '-z',
        String(size),
        String(size),
        master,
        '--out',
        target,
      ])
      const png = readFileSync(target)
      const { width: w, height: h } = parsePNGSize(png)
      if (w !== size || h !== size) fail(`缩放 ${size}px 失败（得到 ${w}x${h}）`)
      if (readOrientation(png, '.png') !== 1) fail(`生成的 ${size}px PNG 仍带 EXIF 旋转标记`)
      ladder.set(size, png)
    }

    const icoEntries = ICO_SIZES.map((size) => ({ size, png: ladder.get(size) }))
    const icnsEntries = ICNS_SIZES.map((size) => ({ size, png: ladder.get(size) }))
    const ico = buildIco(icoEntries)
    const icns = buildIcns(icnsEntries)
    verifyIco(ico, icoEntries)
    verifyIcns(icns, icnsEntries)

    const outputs = [
      ['build/icon.icns', icns],
      ['build/icon.ico', ico],
      ['build/icon.png', ladder.get(512)],
      ['resources/icon.png', ladder.get(256)],
      ['resources/tray-icon.png', ladder.get(32)],
      ['src/renderer/public/icon.png', ladder.get(512)],
    ]
    const written = []
    for (const [rel, buffer] of outputs) {
      const path = join(base, rel)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, buffer)
      if (!readFileSync(path).equals(buffer)) fail(`写入校验失败：${rel}`)
      written.push([rel, buffer])
    }

    const logoPath = join(base, 'build', `logo${ext}`)
    if (resolve(logoPath) !== source) copyFileSync(source, logoPath)
    const buildDir = join(base, 'build')
    for (const name of readdirSync(buildDir)) {
      if (name.startsWith('logo.') && name !== `logo${ext}`) {
        unlinkSync(join(buildDir, name))
        console.log(`  已清理旧源图 build/${name}`)
      }
    }

    console.log(`✓ 图标已生成（基目录：${base}）`)
    console.log(`  源图      ${basename(source)}（${width}px 正方形 → build/logo${ext}）`)
    console.log(`  PNG 梯度  ${PNG_SIZES.join(' / ')}`)
    console.log(`  Windows   icon.ico ${ICO_SIZES.length} 档（16–256）`)
    console.log(`  macOS     icon.icns ${ICNS_SIZES.length} 档（128–1024）`)
    for (const [rel, buffer] of written) {
      console.log(`  ${rel.padEnd(34)} ${String(buffer.length).padStart(9)} B`)
    }
    console.log('  自检通过：ico/icns 容器条目与 PNG 字节逐一一致')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

main()
