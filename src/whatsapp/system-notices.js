window.relaySystemNotice = function (msg) {
  if (msg.type === 'gp2') return window.relayGroupMessage.notice(msg);
  if (msg.type !== 'e2e_notification') return null;
  switch (msg.subtype) {
    case 'encrypt': return '此聊天的消息和通话受端到端加密保护。';
    case 'identity': case 'identity_change': return '此聊天的安全码已更改。';
    default: return 'WhatsApp 端到端加密通知';
  }
};

