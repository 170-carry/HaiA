// The account's own profile and privacy settings, as in WhatsApp Web's settings.
window.relayProfile = (() => {
  const attempt = async work => { try { return await work(); } catch { return null; } };
  const idOf = value => value?._serialized || value?.toString() || '';
  async function info() {
    const privacy = await attempt(() => WPP.privacy.get());
    const blocked = (await attempt(async () => WPP.blocklist.all())) || [];
    return {name:String(WPP.profile.getMyProfileName() || ''), about:String(await attempt(() => WPP.profile.getMyStatus()) || ''),
      business:Boolean(await attempt(async () => WPP.profile.isBusiness())),
      privacy:privacy ? {lastSeen:privacy.lastSeen, online:privacy.online, profilePicture:privacy.profilePicture, about:privacy.about, groupAdd:privacy.groupAdd, readReceipts:privacy.readReceipts} : null,
      blocked:blocked.slice(0,200).map(wid => ({id:idOf(wid), name:window.relayGroupMessage.sender({author:wid}).name || '+' + idOf(wid).split('@')[0]}))};
  }
  const setters = {lastSeen:'setLastSeen', online:'setOnline', profilePicture:'setProfilePic', about:'setAbout', groupAdd:'setAddGroup', readReceipts:'setReadReceipts'};
  async function save(field, value) {
    if (field === 'name') { if (await WPP.profile.setMyProfileName(value) === false) throw new Error('WhatsApp 未接受这个名称'); }
    else if (field === 'about') { if (await WPP.profile.setMyStatus(value) === false) throw new Error('WhatsApp 未接受这条签名'); }
    else if (field === 'photo') await WPP.profile.setMyProfilePicture(value);
    else if (field === 'removePhoto') await WPP.profile.removeMyProfilePicture();
    else if (field === 'unblock') await WPP.blocklist.unblockContact(value);
    else if (field.startsWith('privacy:') && setters[field.slice(8)]) await WPP.privacy[setters[field.slice(8)]](value);
    else throw new Error('未知的资料项');
    return true;
  }
  return {info,save};
})();
