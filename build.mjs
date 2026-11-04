import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
// two builds of the same game:
//   dist/hollow-crown-3d.html   one file, everything inlined (open it anywhere)
//   dist/web/index.html + assets/   the remastered creatures as files of their own, fetched (the artifact)
const files = (mode) => ({ name: 'remaster-files', setup(b) { b.onResolve({ filter: /^remaster-files$/ }, () => ({ path: new URL(`src/assets/remaster/${mode}.js`, import.meta.url).pathname })); } });
async function one(mode, out) {
  const r = await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2019', legalComments: 'none',
    loader: { '.webp': 'dataurl', '.jpg': 'dataurl', '.bin': 'binary' }, plugins: [files(mode)] });
  const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = readFileSync('src/template.html', 'utf8').replace('/*__SCRIPT__*/', () => js);
  writeFileSync(out, html); return html.length;
}
mkdirSync('dist/web/assets', { recursive: true });
const a = await one('inline', 'dist/hollow-crown-3d.html'), b = await one('files', 'dist/web/index.html');
let extra = 0;
copyFileSync('src/assets/forest/forest.bin', 'dist/web/assets/forest.bin'); extra += readFileSync('src/assets/forest/forest.bin').length;
for (const f of readdirSync('src/assets/remaster')) if (/\.(bin|webp)$/.test(f)) { copyFileSync('src/assets/remaster/' + f, 'dist/web/assets/' + f); extra += readFileSync('src/assets/remaster/' + f).length; }
console.log('built', (a / 1024).toFixed(0) + ' KB single file;', (b / 1024).toFixed(0) + ' KB page +', (extra / 1024).toFixed(0) + ' KB of creature files');
