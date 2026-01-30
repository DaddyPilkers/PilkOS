const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default || pngToIcoModule;

async function generateIco() {
  const svgPath = path.join(__dirname, '..', 'assets', 'icons', 'pilkos-logo.svg');
  const icoPath = path.join(__dirname, '..', 'assets', 'icons', 'pilkos-logo.ico');
  const sizes = [256, 128, 64, 48, 32, 16];

  const pngBuffers = await Promise.all(
    sizes.map((size) => sharp(svgPath).resize(size, size).png().toBuffer())
  );

  const icoBuffer = await pngToIco(pngBuffers);
  fs.writeFileSync(icoPath, icoBuffer);
  console.log(`Generated ${path.basename(icoPath)} from ${path.basename(svgPath)}.`);
}

generateIco().catch((error) => {
  console.error('Failed to generate ico:', error);
  process.exit(1);
});
