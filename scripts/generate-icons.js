const sharp = require('sharp')
const path = require('path')

const sizes = [72, 192, 512]
const BG = '#1D9E75'

async function generateIcon(size) {
  const fontSize = Math.round(size * 0.35)
  const radius = Math.round(size * 0.22)

  const svg = `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="r">
      <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}"/>
    </clipPath>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${BG}"/>
  <text
    x="50%" y="54%"
    text-anchor="middle"
    dominant-baseline="middle"
    font-family="Arial, Helvetica, sans-serif"
    font-weight="800"
    font-size="${fontSize}px"
    fill="white"
    letter-spacing="-1"
  >bG</text>
</svg>`

  const outPath = path.join(__dirname, '..', 'public', `icon-${size}.png`)
  await sharp(Buffer.from(svg)).png().toFile(outPath)
  console.log(`✓ icon-${size}.png`)
}

;(async () => {
  for (const size of sizes) await generateIcon(size)
  console.log('All icons generated.')
})()
