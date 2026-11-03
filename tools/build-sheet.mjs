import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';
const r = await build({ entryPoints: ['tools/sheet.js'], bundle: true, format: 'iife', write: false, target: 'es2019', loader: { '.webp': 'dataurl', '.jpg': 'dataurl' } });
writeFileSync('tools/sheet.out.html', readFileSync('tools/sheet.html', 'utf8').replace('/*__SCRIPT__*/', () => r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')));
console.log('sheet built');
