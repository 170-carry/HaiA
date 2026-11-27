// A late history page can enrich an imported row or advance a receipt. Revocations
// and explicit edit events already committed locally take precedence over stale pages.
const {applyChange}=require('../inbox.cjs');
function reconcile(previous,incoming) {
  if (!previous) return incoming;
  if (incoming.chat!==previous.chat || previous.type==='revoked') return previous;
  if (incoming.type==='revoked') {
    const revoked={...previous};
    applyChange(revoked,{revoked:true});
    return revoked;
  }
  let row=previous;
  if (previous.legacyProjection && !incoming.legacyProjection) {
    row={...incoming,ack:previous.ack,localAttachment:previous.localAttachment};
    if(previous.edited && !incoming.edited) {row.edited=true;row.text=previous.text;row.originalText=previous.originalText;}
  } else if (incoming.edited && !previous.edited) {
    row={...previous,edited:true,text:incoming.text,originalText:incoming.originalText};
  }
  const ack=incoming.ack;
  if (row.outgoing && Number.isInteger(ack) && ack!==row.ack && (ack<0 || row.ack==null || ack>row.ack)) return {...row,ack};
  return row;
}
module.exports={reconcile};
