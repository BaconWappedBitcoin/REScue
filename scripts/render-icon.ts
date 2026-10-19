// Renders docs/brand/icon.svg to the PNG sizes the browsers need. The renderer is not a project
// dependency; run it on the fly:
//   npx -p @resvg/resvg-js@2.6.2 -p tsx tsx scripts/render-icon.ts docs/brand/icon.svg public/icon 16 32 48 96 128
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argv } from 'node:process';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- fetched by npx at run time, not installed in the project
import { Resvg } from '@resvg/resvg-js';

const [, , svgPath, outDir, ...sizes] = argv;
if (!svgPath || !outDir || !sizes.length) throw new Error('usage: render-icon <svg> <outDir> <size>...');
const svg = readFileSync(svgPath, 'utf8');
mkdirSync(outDir, { recursive: true });
for (const s of sizes.map(Number)) {
  const png = (new Resvg(svg, { fitTo: { mode: 'width', value: s } }) as { render(): { asPng(): Buffer } })
    .render()
    .asPng();
  writeFileSync(join(outDir, `${s}.png`), png);
}
