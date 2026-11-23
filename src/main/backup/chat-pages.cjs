// Each page can be read on its own after an import, including in very long conversations.
const {hash,readJson,writeJson}=require('./package.cjs');
const PAGE_SIZE=100;
const chatFile=(chat,index=0)=>'chat-'+hash(JSON.stringify([chat,index]))+'.json';
async function writeChat(folder,chat,rows) {
  for(let offset=0;offset<rows.length;offset+=PAGE_SIZE) {
    await writeJson(folder,chatFile(chat,offset/PAGE_SIZE),rows.slice(offset,offset+PAGE_SIZE));
  }
}
async function* chatPages(folder,summary) {
  for(let offset=0;offset<summary.count;offset+=PAGE_SIZE) {
    const rows=await readJson(folder,chatFile(summary.chat,offset/PAGE_SIZE));
    if(!Array.isArray(rows) || rows.length!==Math.min(PAGE_SIZE,summary.count-offset)) throw new Error('备份中的会话记录不完整');
    yield rows;
  }
}
async function historyPage(folder,summary,offset) {
  const end=Math.max(0,summary.count-offset), start=Math.max(0,end-PAGE_SIZE);
  const result=[];
  for(let index=Math.floor(start/PAGE_SIZE); index*PAGE_SIZE<end;index++){
    const rows=await readJson(folder,chatFile(summary.chat,index));
    result.push(...rows.slice(Math.max(0,start-index*PAGE_SIZE),end-index*PAGE_SIZE));
  }
  return result;
}
module.exports={chatFile,chatPages,writeChat,historyPage};
