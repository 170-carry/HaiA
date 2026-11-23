window.relayProfilePhoto = async function (who) {
  const id = who === 'self' ? WPP.conn.getMyUserId() : who;
  if (!id || !WPP.contact?.getProfilePictureUrl) return null;
  let url = await WPP.contact.getProfilePictureUrl(id,false) || await WPP.contact.getProfilePictureUrl(id,true);
  // The account's own picture is sometimes only available through the profile store.
  if (typeof url !== 'string' && who === 'self') {
    try { const mine = await WPP.profile.getMyProfilePicture(); url = mine?.eurl || mine?.imgFull || mine?.img; } catch { /* No picture set. */ }
  }
  if (typeof url !== 'string') return null;
  if (url.startsWith('https:') || url.startsWith('data:image/')) return url;
  if (!url.startsWith('blob:' + location.origin + '/')) return null;
  const blob = await (await fetch(url)).blob();
  if (!blob.type.startsWith('image/') || blob.size > 3000000) return null;
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};
