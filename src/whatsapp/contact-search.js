window.relaySearchPeople = async function (term) {
  const query = term.normalize('NFKC').trim().toLocaleLowerCase();
  const digits = phoneSearchDigits(query);
  const matches = new Map();
  let incomplete=false, lookup='not-requested';
  function include(model, contact) {
    const chat = model.id?._serialized || model.id?.toString();
    if (!chat || !/@(c\.us|s\.whatsapp\.net|lid)$/.test(chat)) return;
    const phone = contactPhoneDigits(chat, contact?.phoneNumber, contact?.formattedUser);
    const names = [model.formattedTitle,contact?.name,contact?.pushname,contact?.shortName,contact?.formattedName,contact?.formattedUser]
      .filter(value => typeof value === 'string' && value.trim());
    if (!matchesContactQuery(query,digits,phone,names)) return;
    if (!matches.has(chat)) matches.set(chat,{chat,title:names[0] || '+'+phone,phone,existing:!!model.formattedTitle});
  }
  try {for (const chat of await WPP.chat.list({onlyUsers:true,ignoreGroupMetadata:true})) include(chat,chat.contact);}
  catch {incomplete=true;}
  if (WPP.contact?.list) {
    try {for (const contact of await WPP.contact.list()) include(contact,contact);} catch {incomplete=true;}
  }
  // A full phone number that is neither a contact nor an existing chat is looked up on WhatsApp itself,
  // so a conversation can be started with someone who has never written to this account.
  if (/^[1-9]\d{6,14}$/.test(digits) && ![...matches.values()].some(row => row.phone === digits)) {
    try {
      const query = WPP.contact.queryWidExists || WPP.contact.queryExists;
      if(!query) throw Error('Contact lookup unavailable');
      const found = await query(digits + '@c.us');
      lookup=found?'found':'not-found';
      const chat = found?.wid?._serialized || found?.wid?.toString();
      if (chat && /@(c\.us|s\.whatsapp\.net|lid)$/.test(chat) && !matches.has(chat)) matches.set(chat,{chat,title:'+' + digits,phone:digits,existing:false,fresh:true});
    } catch {incomplete=true;lookup='failed';}
  }
  if(query.startsWith('@') && query.length>1 && !matches.size){
    try {
      if(!WPP.contact.queryUsernameExists)throw Error('Username lookup unavailable');
      const found=await WPP.contact.queryUsernameExists(query);
      lookup=found?.keyRequired?'key-required':found?'found':'not-found';
      const chat=found?.wid?._serialized || found?.wid?.toString();
      if(chat && /@(c\.us|s\.whatsapp\.net|lid)$/.test(chat)){
        matches.set(chat,{chat,title:found.username?'@'+found.username:query,phone:'',fresh:true,existing:false});
      }
    }catch{incomplete=true;lookup='failed';}
  }
  // A linked-device contact can appear under both its phone JID and its LID.
  // Keep one result per number, preferring an existing conversation, then the LID.
  const contacts = new Map();
  for (const row of matches.values()) {
    const key = row.phone || row.chat, previous = contacts.get(key);
    if (!previous || (row.existing && !previous.existing) ||
        (row.existing === previous.existing && row.chat.endsWith('@lid'))) contacts.set(key,row);
  }
  return {rows:[...contacts.values()],incomplete,lookup};
};
