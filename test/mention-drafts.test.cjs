const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../src/ui/mention-drafts.js'),'utf8');

test('same-name mentions preserve their selected identity through edits and reopening a draft',async () => {
  const stored = new Map();
  const composerDisk={async load(_name,_legacy,map){for(const [key,value] of stored) map.set(key,structuredClone(value));},
    write(_name,key,value){if(value)stored.set(key,structuredClone(value));else stored.delete(key);}};
  const load = () => vm.runInNewContext(source+'\nmentionDrafts',{composerDisk});
  const thread = 'test-group', name = '@Vivian';
  const editor = load();await editor.ready;
  editor.add(thread,name+' ',0,name,'111@c.us');
  const text = name+' '+name;
  editor.add(thread,text,name.length+1,name,'222@lid');
  const restored = load();await restored.ready;
  const moved = restored.encode(thread,'Hi '+text);
  assert.equal(moved.text,'Hi @111 @222');
  assert.deepEqual([...moved.ids],['111@c.us','222@lid']);
  const edited = restored.encode(thread,'Hi @Vi @Vivian');
  assert.equal(edited.text,'Hi @Vi @222');
  assert.deepEqual([...edited.ids],['222@lid']);
  assert.deepEqual([...restored.encode('other-group',text).ids],[]);
});
