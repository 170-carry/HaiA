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
      // WhatsApp's own review of a suspended group: asked for, accepted or refused.
      const review = {IN_REVIEW:'review',APPROVED:'approved',REJECTED:'rejected'}[String(meta?.suspendAppealStatus || '').toUpperCase()] || '';
      const limits = {review, reviewAt:Number(meta?.suspendAppealUpdateTime) * 1000 || null, suspended:Boolean(meta?.suspended), terminated:Boolean(meta?.terminated), announce:Boolean(meta?.announce), restrict:Boolean(meta?.restrict),
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
    if (key === 'muted') {
      // "Always" is stored as -1, which WPP.chat.mute refuses, so the chat's own mute model is used the way WhatsApp Web does.
      const model = WPP.chat.get(chatId)?.mute;
      if (!value) await WPP.chat.unmute(chatId);
      else if (typeof model?.mute === 'function') await model.mute({expiration:-1,isAutoMuted:false,sendDevice:true});
      else await WPP.chat.mute(chatId,{duration:8 * 365 * 86400});
    }
    else if (key === 'pinned') await WPP.chat.pin(chatId,value);
    else if (key === 'archived') await WPP.chat.archive(chatId,value);
    else if (key === 'unread') await (value ? WPP.chat.markIsUnread(chatId) : WPP.chat.markIsRead(chatId));
    else if (key === 'blocked') await (value ? WPP.blocklist.blockContact(chatId) : WPP.blocklist.unblockContact(chatId));
    else throw new Error('未知设置');
    return true;
  }
  // WhatsApp loads the review code only when it is needed, so it is fetched the same way here.
  async function part(name) {
    try { const found = window.require(name); if (found) return found; } catch { /* Not loaded yet. */ }
    await new Promise((resolve,reject) => {
      const timer = setTimeout(() => reject(new Error('WhatsApp 的审核功能未能加载，请稍后重试')),20000);
      try { window.require('Bootloader').loadModules([name],() => { clearTimeout(timer); resolve(); },'group-review'); }
      catch { clearTimeout(timer); reject(new Error('此版本的 WhatsApp 不支持在这里请求审核，请在手机上操作')); }
    });
    return window.require(name);
  }
  // Asks WhatsApp to review a suspended group, the request its own "Request a review" button sends.
  async function review(chatId) {
    const chat = WPP.chat.get(chatId), meta = chat?.groupMetadata;
    if (!chatId.endsWith('@g.us') || !meta?.suspended || meta.terminated) throw new Error('此群没有被停用，无需请求审核');
    let admin = false;
    try { admin = Boolean(meta.participants?.iAmAdmin?.()); } catch { /* Membership may not be loaded. */ }
    if (!admin) throw new Error('只有群管理员可以请求审核');
    if (String(meta.suspendAppealStatus || '').toUpperCase() === 'IN_REVIEW') return {state:'review', at:Number(meta.suspendAppealUpdateTime) * 1000 || null};
    const user = String(chat.id?.user ?? chatId.split('@')[0]);
    const send = (await part('WAWebGroupSuspensionAppealMutation')).submitGroupSuspensionAppeal;
    let debug = '{}';
    try { debug = JSON.stringify(await (await part('WAWebLoggerDebugInfo')).getDebugInfo({supportTag:'group-suspend-appeal',convertFields:true,addUserAgentDetails:true,entityId:user})); }
    catch { /* The request is still valid without the diagnostic details. */ }
    const answer = await send(user,null,debug);
    if (!answer?.success) throw new Error('WhatsApp 没有接受审核请求' + (answer?.errorMessage ? '：' + String(answer.errorMessage).slice(0,200) : '，请稍后重试'));
    const change = {suspendAppealStatus:'IN_REVIEW', suspendAppealUpdateTime:answer.appealCreationTime};
    // Kept the way WhatsApp keeps it, so the state survives a restart.
    try { await (await part('WAWebDBGroupsGroupMetadata')).persistGroupMetadata(chat.id,change); } catch { /* The live copy below is enough for this run. */ }
    if (typeof meta.set === 'function') meta.set(change); else Object.assign(meta,change);
    return {state:'review', at:Number(answer.appealCreationTime) * 1000 || Date.now()};
  }
  return {info,rename,set,review};
})();
