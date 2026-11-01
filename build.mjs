import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
const r = await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2019', legalComments: 'none' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('src/template.html', 'utf8').replace('/*__SCRIPT__*/', () => js);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/hollow-crown-3d.html', html);
console.log('built', (html.length / 1024).toFixed(0) + ' KB');
