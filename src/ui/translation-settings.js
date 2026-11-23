const translationForm = document.getElementById('translation-form');
function updateEngineForm() {
  const engine=get('translation-engine').value, keyed=engine==='keyed';
  get('keyed-settings').hidden=!keyed;
  const names={googleFree:'Google 免费旧接口',memory:'MyMemory',apertium:'Apertium（部分欧洲语言）'};
  get('engine-hint').textContent=keyed ? '按 DeepL、Microsoft、Google Cloud、彩云小译的顺序尝试已配置服务。额度和费用由你的服务账号决定。' :
    '免 API Key。切换顺序为 '+[engine,...Object.keys(names).filter(id=>id!==engine)].map(id=>names[id]).join(' → ')+'。';
}
document.getElementById('translation-engine').onchange=updateEngineForm;
// Fills the translation part of the settings page from the saved values.
async function fillTranslationSettings() {
  const settings = await api.translationSettings();
  const languageSelect = (id,value) => {
    const select = get(id);
    select.replaceChildren(...settings.languages.map(item=>new Option(item.name,item.id)));
    select.value = value;
  };
  languageSelect('incoming-language',settings.incoming);
  languageSelect('draft-language',settings.draft);
  get('translation-engine').value=settings.engine;
  updateEngineForm();
  get('auto-translate').checked = settings.auto;
  get('azure-region').value = settings.region;
  const fields = get('provider-keys'); fields.replaceChildren();
  for (const provider of settings.providers) {
    const row = el('div','provider-row'), label = el('label','',provider.name);
    const input = el('input'); input.id = 'key-'+provider.id; input.type = 'password';
    input.autocomplete = 'new-password'; input.maxLength = 4096;
    input.placeholder = provider.configured ? '已保存 · 输入可替换' : 'API Key';
    label.htmlFor = input.id; row.append(label,input);
    if (provider.configured) {
      const remove = el('button','remove-key','清除'); remove.type='button';
      remove.onclick = () => { input.value=''; input.dataset.clear='true'; input.placeholder='保存后清除'; };
      row.append(remove);
    }
    fields.append(row);
  }
  get('translation-error').textContent = get('translation-saved').textContent = '';
}
// Translation settings live in the settings page; this opens it at that section.
function openTranslationSettings() {
  run(async () => {
    await settingsPanel.open();
    get('settings-translation').scrollIntoView({block:'start'});
    get('incoming-language').focus({preventScroll:true});
  });
}
document.getElementById('translation-settings').onclick = openTranslationSettings;
translationForm.onsubmit = async event => {
  event.preventDefault();
  const keys = {};
  for (const input of get('provider-keys').querySelectorAll('input')) {
    if (input.value.trim()) keys[input.id.slice(4)] = input.value.trim();
    else if (input.dataset.clear) keys[input.id.slice(4)] = null;
  }
  try {
    const saved = await api.saveTranslationSettings({engine:get('translation-engine').value,auto:get('auto-translate').checked,keys,
      incoming:get('incoming-language').value,draft:get('draft-language').value,region:get('azure-region').value});
    composerTools.reset(); chatTranslation.configure(saved); if (state) render(state);
    await fillTranslationSettings(); settingsPanel.refresh(); get('translation-saved').textContent = '已保存';
  } catch (e) { get('translation-error').textContent = translationError(e); }
};
document.getElementById('settings-dialog').addEventListener('close',() => get('provider-keys').replaceChildren());
translationForm.addEventListener('input',() => { get('translation-saved').textContent = ''; });

