#!/usr/bin/env node
// Renders assets/rocky-logo.webp into the extension icons (needs Playwright).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EXT_DIR } from './load-shared.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const SRC = path.resolve(EXT_DIR, '..', 'assets', 'rocky-logo.webp');
// [file, size, artwork size]. Chrome asks for 96px artwork inside the 128px icon.
const OUTPUTS = [['icon-16.png', 16, 16], ['icon-32.png', 32, 32], ['icon-48.png', 48, 48], ['icon-128.png', 128, 96], ['rocky.png', 256, 256]];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const dataUrl = `data:image/webp;base64,${fs.readFileSync(SRC).toString('base64')}`;
  const results = await page.evaluate(async ({ dataUrl, outputs }) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const src = new OffscreenCanvas(W, H);
    const sctx = src.getContext('2d');
    sctx.drawImage(img, 0, 0);
    const px = sctx.getImageData(0, 0, W, H);
    const d = px.data;
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4 + 3;
        if (d[i] < 24) { d[i] = 0; continue; }
        if (d[i] > 230) d[i] = 255;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    sctx.putImageData(px, 0, 0);

    // Square crop around the portrait with a 4% margin.
    const side = Math.ceil(Math.max(maxX - minX + 1, maxY - minY + 1) * 1.04);
    const sq = new OffscreenCanvas(side, side);
    sq.getContext('2d').drawImage(src, minX, minY, maxX - minX + 1, maxY - minY + 1,
      Math.round((side - (maxX - minX + 1)) / 2), Math.round((side - (maxY - minY + 1)) / 2), maxX - minX + 1, maxY - minY + 1);

    const out = {};
    for (const [name, size, art] of outputs) {
      let cur = sq;
      while (cur.width / 2 >= art) {
        const next = new OffscreenCanvas(Math.round(cur.width / 2), Math.round(cur.height / 2));
        const c = next.getContext('2d');
        c.imageSmoothingQuality = 'high';
        c.drawImage(cur, 0, 0, next.width, next.height);
        cur = next;
      }
      const fin = new OffscreenCanvas(size, size);
      const fc = fin.getContext('2d');
      fc.imageSmoothingQuality = 'high';
      const off = Math.round((size - art) / 2);
      fc.drawImage(cur, off, off, art, art);
      const blob = await fin.convertToBlob({ type: 'image/png' });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      out[name] = btoa(bin);
    }
    return out;
  }, { dataUrl, outputs: OUTPUTS });

  for (const [name] of OUTPUTS) {
    const file = path.join(EXT_DIR, 'icons', name);
    fs.writeFileSync(file, Buffer.from(results[name], 'base64'));
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
  }
} finally {
  await browser.close();
}
