window.relaySearchPeople = async function (term) {
  const query = term.trim().toLocaleLowerCase();
  const digits = phoneSearchDigits(query);
  const matches = new Map();
  function include(model, contact) {
    const chat = model.id?._serialized || model.id?.toString();
    if (!chat || !/@(c\.us|s\.whatsapp\.net|lid)$/.test(chat)) return;
    const phone = contactPhoneDigits(chat, contact?.phoneNumber, contact?.formattedUser);
    const names = [model.formattedTitle,contact?.name,contact?.pushname,contact?.shortName,contact?.formattedName,contact?.formattedUser]
      .filter(value => typeof value === 'string' && value.trim());
    if (!matchesContactQuery(query,digits,phone,names)) return;
    if (!matches.has(chat)) matches.set(chat,{chat,title:names[0] || '+'+phone,phone,existing:!!model.formattedTitle});
  }
  for (const chat of await WPP.chat.list({onlyUsers:true,ignoreGroupMetadata:true})) include(chat,chat.contact);
  if (WPP.contact?.list) {
    for (const contact of await WPP.contact.list({onlyMyContacts:true})) include(contact,contact);
  }
  return [...matches.values()];
};
