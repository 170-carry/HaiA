const {test} = require('node:test');
const assert = require('node:assert/strict');
const {checkRelease} = require('../src/main/release-check.cjs');

test('update check compares stable release numbers and links to the matching tag',async () => {
  const fetch = async () => Response.json({tag_name:'v0.10.0'});
  assert.deepEqual(await checkRelease('0.9.8',fetch),{version:'0.10.0',available:true,url:'https://github.com/170-carry/HaiA/releases/tag/v0.10.0'});
  assert.equal((await checkRelease('0.10.0',fetch)).available,false);
  assert.equal((await checkRelease('1.0.0',fetch)).available,false);
});

test('an API failure or prerelease cannot be reported as a stable update',async () => {
  await assert.rejects(checkRelease('0.9.8',async () => new Response(null,{status:429})),/稍后重试/);
  await assert.rejects(checkRelease('0.9.8',async () => Response.json({tag_name:'v0.10.0',prerelease:true})),/正式版本/);
});
