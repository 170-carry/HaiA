// Classification is based on observed protocol state; a logout alone cannot prove a ban.
function effectiveRestriction(account,session,now=Date.now()) {
  const value=session?.restriction || account.restriction;
  return value?.kind==='new-chats'?{...value,pendingVerification:!!value.until && value.until<=now}:null;
}
function observe(accounts,session,batch,now=Date.now()) {
  const account=session.account;
  let dirty=false;
  const patch={};
  if(batch.status==='online' && Object.hasOwn(batch,'restriction')) {
    const limit=batch.restriction?.kind==='new-chats'
      ? {kind:'new-chats',until:Number(batch.restriction.until)>0?Number(batch.restriction.until):null,...(batch.restriction.type?{type:String(batch.restriction.type).slice(0,60)}:{})}:null;
    if(JSON.stringify(limit)!==JSON.stringify(account.restriction || null)) {patch.restriction=limit;dirty=true;}
    session.restriction=limit;
  }
  if(batch.status==='online' && account.appeal?.state==='watching') {
    patch.appeal={...account.appeal,state:'connected',checkedAt:now};dirty=true;
  }
  if(dirty) accounts.update(account.id,patch);
  return dirty;
}
function classification(account,session,now=Date.now()) {
  if(effectiveRestriction(account,session,now)) return 'limited';
  if(account.dropped?.reason==='account_locked' || (account.appeal?.source==='official-phone-screen' && ['can-review','in-review','banned'].includes(account.appeal.state))) return 'locked';
  return account.dropped?'disconnected':'normal';
}
module.exports={effectiveRestriction,observe,classification};
