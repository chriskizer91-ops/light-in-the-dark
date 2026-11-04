// the remastered creatures as the page's own files (the artifact build: fetched next to index.html)
const names = ['wolf'];
export const FILES = Object.fromEntries(names.map((n) => [n, { bin: 'assets/' + n + '.bin', tex: 'assets/' + n + '.webp' }]));
export const FOREST = 'assets/forest.bin';
