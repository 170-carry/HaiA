window.relayGroupMessage = (() => {
  function idOf(wid) {
    return typeof wid === 'string' ? wid : wid?._serialized || (wid?.user && wid.server ? wid.user+'@'+wid.server : '');
  }
  function member(wid, pushName) {
    const id = idOf(wid);
    if (id && id === idOf(WPP.conn.getMyUserId())) return '你';
    let contact;
    try { if (id) contact = WPP.whatsapp?.ContactStore?.get(wid); } catch { /* The contact may not be cached. */ }
    const name = contact?.name || contact?.pushname || pushName || contact?.formattedName;
    if (typeof name === 'string' && name.trim() && !name.endsWith('@lid')) return name;
    const phone = /^(\d+)(?::\d+)?@(c\.us|s\.whatsapp\.net)$/.exec(id);
    return phone ? '+'+phone[1] : '';
  }
  function sender(msg) {
    const wid = msg.author || msg.id?.participant;
    return {id:idOf(wid) || null,name:member(wid,msg.notifyName) || '群成员'};
  }
  function notice(msg) {
    const actor = member(msg.author || msg.id?.participant,msg.notifyName);
    const recipients = Array.isArray(msg.recipients) ? msg.recipients : [];
    const targets = recipients.map(wid=>member(wid) || '一位成员').join('、');
    const subject = typeof msg.body === 'string' ? msg.body.trim().slice(0,256) : '';
    switch (msg.subtype) {
      case 'add': return actor && targets ? actor+' 邀请 '+targets+' 加入群聊' : (targets || '新成员')+' 加入了群聊';
      case 'invite': case 'join': case 'linked_group_join': return (targets || actor || '新成员')+' 加入了群聊';
      case 'leave': case 'leaver': return (targets || actor || '一位成员')+' 退出了群聊';
      case 'remove':
        if (recipients.length === 1 && idOf(recipients[0]) === idOf(msg.author || msg.id?.participant)) return (actor || '一位成员')+' 退出了群聊';
        return targets && actor ? actor+' 将 '+targets+' 移出群聊' : (targets || '一位成员')+' 已被移出群聊';
      case 'promote': return (targets || '一位成员')+' 成为了群管理员';
      case 'demote': return (targets || '一位成员')+' 的管理员权限已移除';
      case 'create': return (actor ? actor+' 创建了群聊' : '群聊已创建')+(subject ? '「'+subject+'」' : '');
      case 'subject': return (actor ? actor+' 更改了群名称' : '群名称已更新')+(subject ? '为「'+subject+'」' : '');
      case 'description': return actor ? actor+' 更新了群描述' : '群描述已更新';
      case 'picture': return actor ? actor+' 更新了群头像' : '群头像已更新';
      case 'announce': return (actor || '管理员')+' 更改了发言权限，请查看群资料中的「群状态」';
      case 'restrict': return (actor || '管理员')+' 更改了群资料的修改权限';
      case 'suspend': case 'suspended': case 'group_suspended': return '此群已被 WhatsApp 停用';
      case 'unsuspend': case 'unsuspended': case 'group_unsuspended': return '此群已被 WhatsApp 恢复';
      case 'terminated': return '此群已被 WhatsApp 永久关闭';
      case 'membership_approval_mode': return '入群审批设置已更新';
      case 'member_add_mode': return '添加成员的权限已更新';
      case 'revoke': case 'revoke_invite': return (actor || '管理员')+' 重置了群邀请链接';
      case 'ephemeral': return '消息定时消失的设置已更新';
      default: return '群系统通知';
    }
  }
  return {sender,notice};
})();

