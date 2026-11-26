const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');

// The rules of docs/design-system.md that can be checked mechanically.
const dir = path.join(__dirname,'../src/ui');
const read = name => fs.readFileSync(path.join(dir,name),'utf8');
const sheets = fs.readdirSync(dir).filter(name => name.endsWith('.css'));
const layout = sheets.filter(name => !['tokens.css','components.css','app.css'].includes(name));
const hexes = text => text.match(/#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/g) || [];
const overlay = hex => /^#(0{3,4}|f{3,4}|0{6}[0-9a-f]{0,2}|f{6}[0-9a-f]{0,2}|000[0-9a-f]|fff[0-9a-f])$/i.test(hex);

test('layout stylesheets take every colour from tokens.css',()=>{
  for (const name of layout) {
    const stray = hexes(read(name)).filter(hex => !overlay(hex));
    assert.deepEqual(stray,[],name+' hard-codes '+stray.join(', ')+'; use a token from tokens.css');
  }
});

test('corner radii and type sizes stay on the scale',()=>{
  const radii = new Set(['5','6','8','12','999']), sizes = new Set(['10','11','12','13','14','15','17','20','30']);
  for (const name of layout) {
    const text = read(name);
    for (const [,value] of text.matchAll(/border-radius:(\d+)px/g)) assert.ok(radii.has(value),name+' uses border-radius:'+value+'px');
    for (const [,value] of text.matchAll(/font-size:(\d+)px/g)) assert.ok(sizes.has(value),name+' uses font-size:'+value+'px');
  }
});

test('the page links one stylesheet and it loads every layout file into the layout layer',()=>{
  const links = read('index.html').match(/<link rel="stylesheet"[^>]*>/g);
  assert.deepEqual(links,['<link rel="stylesheet" href="app.css">']);
  const app = read('app.css');
  for (const name of layout) assert.ok(app.includes('@import url('+name+') layer(layout);'),name+' is not imported into the layout layer');
  assert.ok(app.trimEnd().endsWith('@import url(components.css);'),'components.css must be the last, unlayered import');
});

test('every dialog that has a header closes with the shared close button',()=>{
  const closers = read('index.html').match(/<button id="[a-z]+-close"[^>]*>/g) || [];
  assert.ok(closers.length >= 10);
  for (const tag of closers) if (!/viewer-close|context-close/.test(tag)) assert.ok(tag.includes('class="icon-button dialog-close"'),tag);
});
