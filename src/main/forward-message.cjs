const media = require('./media.cjs');

async function forwardMessage(desk, account, chat, id, to, destination = account) {
  const {session:source,message} = desk.current(account,chat,id);
  const {session:target} = desk.target(destination,to);
  if (message.media?.once || message.pendingText || message.type === 'revoked') throw new Error('这条消息无法转发');
  if (destination === account) return source.call('forward',to,id);
  if (message.media) {
    const sourceIdentity = source.identity, targetIdentity = target.identity;
    await desk.deliver(target,destination,async () => {
      const file = await media.download(source,message);
      if (source.disposed || target.disposed || source.identity !== sourceIdentity || target.identity !== targetIdentity || target.status !== 'online') throw new Error('账号连接已变更，请重新选择会话');
      return media.upload(target,to,file.path,{name:file.name || message.media.name || '附件',mime:file.mime,
        kind:message.media.kind, caption:message.media.caption ? message.text : ''});
    });
  } else if (['chat','text'].includes(message.type) && message.text) {
    await desk.send(destination,to,message.text);
  } else throw new Error('这种消息暂不支持跨账号转发');
}
module.exports={forwardMessage};
