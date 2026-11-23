// Contact and chat details as WhatsApp shows them in "Contact info".
window.relayContact = (() => {
  const text = value => typeof value === 'string' ? value.trim() : '';
  const idOf = value => value?._serialized || value?.toString() || '';
  const attempt = async work => { try { return await work(); } catch { return null; } };
  function chatState(chatId) {
    const chat = WPP.chat.get(chatId), mute = chat?.muteExpiration ?? chat?.mute?.expiration;
    return {muted:Boolean(chat?.isMuted || mute === -1 || mute > Date.now()/1000), pinned:Boolean(chat?.pin), archived:Boolean(chat?.archive)};
  }
  async function info(chatId) {
    const chat = WPP.chat.get(chatId), state = chatState(chatId);
    if (chatId.endsWith('@g.us')) {
      const meta = chat?.groupMetadata;
      let admin = false;
      try { admin = Boolean(meta?.participants?.iAmAdmin?.()); } catch { /* Membership may not be loaded. */ }
      // Restrictions WhatsApp places on the group or on this member.
      const limits = {suspended:Boolean(meta?.suspended), terminated:Boolean(meta?.terminated), announce:Boolean(meta?.announce), restrict:Boolean(meta?.restrict),
        approval:Boolean(meta?.membershipApprovalMode), left:Boolean(chat?.isReadOnly), admin, blocked:chat?.canSend === false};
      return {...state, limits, ephemeral:Number(meta?.ephemeralDuration ?? chat?.ephemeralDuration) || 0, group:true, title:chat?.formattedTitle || '', description:text(meta?.desc),
        members:meta?.participants?.length ?? null, created:Number(meta?.creation) * 1000 || null};
    }
    const contact = await attempt(() => WPP.contact.get(chatId));
    const number = idOf(contact?.phoneNumber) || (chatId.endsWith('@lid') ? '' : chatId);
    const digits = number.split('@')[0].replace(/\D/g,'');
    const status = await attempt(() => WPP.contact.getStatus(chatId));
    const profile = contact?.isBusiness ? await attempt(() => WPP.contact.getBusinessProfile(chatId)) : null;
    const shared = await attempt(() => WPP.contact.getCommonGroups(chatId)) || [];
    const sites = [].concat(profile?.website || []).map(site => text(site?.url || site)).filter(Boolean);
    return {...state, ephemeral:Number(chat?.ephemeralDuration) || 0, group:false, title:chat?.formattedTitle || contact?.formattedName || '',
      remark:contact?.isMyContact ? text(contact.name) : '', nickname:text(contact?.pushname), verified:text(contact?.verifiedName),
      phone:digits ? '+'+digits : '', about:text(typeof status === 'string' ? status : status?.status),
      blocked:Boolean(await attempt(() => WPP.blocklist.isBlocked(chatId))),
      business:contact?.isBusiness ? {description:text(profile?.description), email:text(profile?.email), address:text(profile?.address),
        category:[].concat(profile?.categories || []).map(c=>text(c?.localized_display_name || c?.name || c)).filter(Boolean).join('、'), websites:sites.slice(0,4)} : null,
      groups:shared.slice(0,30).map(id => ({chat:idOf(id),title:WPP.chat.get(id)?.formattedTitle || '群聊'}))};
  }
  // The remark is the contact name stored in the WhatsApp account, without touching the phone's address book.
  async function rename(chatId, name) {
    if (name) await WPP.contact.save(chatId,name,{syncAddressBook:false});
    else await WPP.contact.remove(chatId);
    const contact = await attempt(() => WPP.contact.get(chatId));
    return name || WPP.chat.get(chatId)?.formattedTitle || contact?.formattedName || '';
  }
  async function set(chatId, key, value) {
    if (key === 'muted') await (value ? WPP.chat.mute(chatId,{expiration:-1}) : WPP.chat.unmute(chatId));
    else if (key === 'pinned') await WPP.chat.pin(chatId,value);
    else if (key === 'archived') await WPP.chat.archive(chatId,value);
    else if (key === 'unread') await (value ? WPP.chat.markIsUnread(chatId) : WPP.chat.markIsRead(chatId));
    else if (key === 'blocked') await (value ? WPP.blocklist.blockContact(chatId) : WPP.blocklist.unblockContact(chatId));
    else throw new Error('未知设置');
    return true;
  }
  return {info,rename,set};
})();
