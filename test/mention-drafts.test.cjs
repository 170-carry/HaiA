const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../src/ui/mention-drafts.js'),'utf8');

test('same-name mentions preserve their selected identity through edits and reopening a draft',() => {
  const stored = new Map();
  const localStorage = {getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)};
  const load = () => vm.runInNewContext(source+'\nmentionDrafts',{localStorage});
  const thread = 'test-group', name = '@Vivian';
  const editor = load();
  editor.add(thread,name+' ',0,name,'111@c.us');
  const text = name+' '+name;
  editor.add(thread,text,name.length+1,name,'222@lid');
  const restored = load();
  const moved = restored.encode(thread,'Hi '+text);
  assert.equal(moved.text,'Hi @111 @222');
  assert.deepEqual([...moved.ids],['111@c.us','222@lid']);
  const edited = restored.encode(thread,'Hi @Vi @Vivian');
  assert.equal(edited.text,'Hi @Vi @222');
  assert.deepEqual([...edited.ids],['222@lid']);
  assert.deepEqual([...restored.encode('other-group',text).ids],[]);
});
