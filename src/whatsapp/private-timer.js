// WhatsApp loads the private-chat timer action with its disappearing-messages drawer.
window.setPrivateChatTimer = async function (id, seconds) {
  const requireWeb = window.require;
  if (typeof requireWeb !== 'function') throw new Error('当前 WhatsApp 网页版本不支持修改私聊计时器');
  let action, trigger, entry;
  try {
    await requireWeb('JSResourceForInteraction')('WAWebEphemeralDrawer.react').load();
    action = requireWeb('WAWebChangeEphemeralDurationChatAction').changeEphemeralDuration;
    trigger = requireWeb('WAWebEphemeralityTypes').DisappearingModeTrigger.ChatSettings;
    entry = requireWeb('WAWebWamEnumEphemeralSettingEntryPointType').EPHEMERAL_SETTING_ENTRY_POINT_TYPE.CHAT_INFO;
  } catch { throw new Error('WhatsApp 私聊计时器未能加载，请重新连接后再试'); }
  const chat = WPP.chat.get(id);
  if (!chat || typeof action !== 'function') throw new Error('这个会话暂时无法修改定时消失');
  await action(chat, seconds, entry, trigger);
  if (Number(chat.ephemeralDuration || 0) !== seconds) throw new Error('WhatsApp 尚未确认新设置，请重新打开联系人资料核对');
};
