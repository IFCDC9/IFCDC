const $ = id => document.getElementById(id);
let current = null, selected = [], uploading = false, stop = false;
const root = '/api/public/radio/stations';
function message(value) { $('workspace-message').textContent = value; }
function error(value) { $('workspace-error').textContent = value; $('workspace-error').hidden = !value; if (value) $('workspace-error').scrollIntoView?.({ block: 'center', behavior: 'smooth' }); }
async function api(suffix = '', body, method = body ? 'POST' : 'GET', headers = {}) {
  const raw = body instanceof Blob;
  const response = await fetch(root + suffix, { method, credentials: 'same-origin', cache: 'no-store', headers: { 'X-Radio-Client': 'website', ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: raw ? body : JSON.stringify(body) } : {}), signal: AbortSignal.timeout(raw ? 120000 : 15000) });
  if (response.status === 204) return {};
  const value = await response.json().catch(() => ({}));
  if (!response.ok) { const failure = new Error(value.error || `Station request failed (${response.status}).`); failure.status = response.status; throw failure; }
  return value;
}
async function action(button, fn) {
  button.disabled = true; error('');
  try { await fn(); } catch (e) { error(e.message); } finally { button.disabled = false; }
}
const element = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
function button(text, callback) { const node = element('button', text, 'r-ghost'); node.type = 'button'; node.addEventListener('click', () => void action(node, callback)); return node; }
function select(ids) { selected = [...ids]; renderLibrary(); }
function renderLibrary() {
  const list = $('track-list'); list.replaceChildren(); $('selection-count').textContent = `${selected.length} selected`;
  if (!current.tracks.length) list.append(element('p', 'Your uploaded music will appear here.'));
  for (const track of current.tracks) {
    const row = element('div', '', 'r-row'); const label = element('label'); const check = element('input'); check.type = 'checkbox'; check.checked = selected.includes(track.id);
    check.addEventListener('change', () => select(check.checked ? [...selected, track.id] : selected.filter(id => id !== track.id)));
    label.append(check, document.createTextNode(` ${track.title} · ${Math.round(track.duration)} sec`));
    row.append(label, button('Preview', async () => { const audio = $('track-preview'); audio.src = `${root}/${current.station.id}/library/${track.id}/audio`; await audio.play(); }), button('Remove', async () => {
      if (!confirm(`Remove ${track.title} from your library and draft shows?`)) return;
      await api(`/${current.station.id}/library/${track.id}`, null, 'DELETE'); await load(current.station.id);
    })); list.append(row);
  }
}
function render() {
  $('workspace').hidden = false; $('create').hidden = true;
  $('station-name').textContent = current.station.name;
  $('storage').textContent = `${current.tracks.length} / ${current.limits.tracks} tracks · ${(current.usedBytes / 1048576).toFixed(1)} / ${current.limits.storageBytes / 1048576} MB · Subscription not active`;
  const form = $('brand-form'); form.elements.name.value = current.station.name; form.elements.description.value = current.station.description;
  const logo = $('station-logo'); logo.hidden = !current.station.hasLogo; if (current.station.hasLogo) logo.src = `${root}/${current.station.id}/logo?v=${Date.now()}`; else logo.removeAttribute('src');
  selected = selected.filter(id => current.tracks.some(t => t.id === id)); renderLibrary();
  for (const [kind, listId, data] of [['crates', 'crate-list', current.crates], ['slots', 'show-list', current.slots]]) {
    const list = $(listId); list.replaceChildren(); if (!data.length) list.append(element('p', kind === 'crates' ? 'No crates saved yet.' : 'No draft shows yet.'));
    for (const item of data) {
      const row = element('div', '', 'r-row'); row.append(element('strong', `${item.name || item.title} · ${item.tracks.length} tracks${item.start ? ' · ' + new Date(item.start).toLocaleString() : ''}`));
      if (kind === 'crates') row.append(button('Load selection', async () => { select(item.tracks); message(`Loaded ${item.name}.`); }));
      row.append(button('Remove', async () => { await api(`/${current.station.id}/${kind}/${item.id}`, null, 'DELETE'); await load(current.station.id); })); list.append(row);
    }
  }
}
async function load(id) { current = await api('/' + id); render(); }
async function init() {
  for (const id of ['signin', 'closed', 'create', 'workspace']) $(id).hidden = true;
  try { const result = await api(); if (result.stations.length) await load(result.stations[0].id); else $(result.enabled ? 'create' : 'closed').hidden = false; }
  catch (e) { if (e.status === 401) $('signin').hidden = false; else error(e.message); }
}
for (const [formId, mode] of [['create-form', 'create'], ['brand-form', 'brand'], ['crate-form', 'crate'], ['schedule-form', 'schedule']]) {
  $(formId).addEventListener('submit', event => {
    event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return;
    void action(form.querySelector('button'), async () => {
      const data = Object.fromEntries(new FormData(form));
      if (mode === 'create') { const result = await api('', data); await load(result.station.id); message('Your private draft workspace is ready. No subscription has started.'); }
      else if (mode === 'brand') { await api('/' + current.station.id, data, 'PATCH'); await load(current.station.id); message('Station identity saved.'); }
      else {
        if (!selected.length) throw new Error('Select music from your library first.');
        const payload = mode === 'crate' ? { name: data.name, tracks: selected } : { title: data.title, start: new Date(data.start).toISOString(), tracks: selected };
        await api(`/${current.station.id}/${mode === 'crate' ? 'crates' : 'schedule'}`, payload); form.reset(); await load(current.station.id); message(mode === 'crate' ? 'Crate saved.' : 'Draft show saved. This is not broadcasting.');
      }
    });
  });
}
$('select-all').addEventListener('click', () => select(current.tracks.map(t => t.id)));
$('clear-selection').addEventListener('click', () => select([]));
$('logo-file').addEventListener('change', event => {
  const input = event.currentTarget, file = input.files?.[0]; input.value = ''; if (!file) return;
  void action(input, async () => { if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1048576) throw new Error('Choose a PNG, JPEG or WebP logo up to 1 MB.'); await api(`/${current.station.id}/logo`, file, 'POST', { 'Content-Type': file.type }); await load(current.station.id); message('Station logo saved.'); });
});
$('stop-upload').addEventListener('click', () => { stop = true; $('upload-progress').textContent = 'Stopping after the current file…'; });
async function importMusic(files) {
  if (uploading || !files.length) return;
  if (!$('upload-rights').checked) { error('Confirm your permission to upload and use these recordings first.'); return; }
  uploading = true; stop = false; error(''); const issues = []; let added = 0, skipped = 0, checked = 0;
  $('music-files').disabled = $('music-folder').disabled = $('delete-workspace').disabled = true; $('stop-upload').hidden = false; $('upload-issues').hidden = true;
  try {
    for (const file of files) {
      if (stop) break; checked++;
      if (!/\.mp3$/i.test(file.name) || file.name.startsWith('._')) { skipped++; continue; }
      if (file.size > 25 * 1048576 || !file.size) { issues.push(`${file.name}: empty or over 25 MB.`); continue; }
      $('upload-progress').textContent = `Checking ${checked} of ${files.length}: ${file.name}`;
      try { const result = await api(`/${current.station.id}/library?${new URLSearchParams({ title: file.name.replace(/\.mp3$/i, '') })}`, file, 'POST', { 'Content-Type': 'audio/mpeg', 'X-Radio-Upload-Rights': 'confirmed' }); if (result.duplicate) skipped++; else added++; }
      catch (e) { issues.push(`${file.name}: ${e.message}`); if ([401, 403, 409, 503].includes(e.status)) stop = true; }
    }
    await load(current.station.id);
  } catch (e) { error(e.message); }
  finally {
    uploading = false; $('music-files').disabled = $('music-folder').disabled = $('delete-workspace').disabled = false; $('stop-upload').hidden = true;
    $('upload-progress').textContent = `${stop ? 'Stopped' : 'Finished'} · ${added} added · ${skipped} skipped · ${issues.length} issues · ${files.length - checked} remaining`;
    $('issue-list').replaceChildren(...issues.map(text => element('li', text))); $('upload-issues').hidden = !issues.length;
  }
}
for (const id of ['music-files', 'music-folder']) $(id).addEventListener('change', event => { const files = [...event.currentTarget.files]; event.currentTarget.value = ''; void importMusic(files); });
$('delete-workspace').addEventListener('click', () => { if (uploading || !confirm('Permanently delete your station workspace, uploaded music, logo, crates and draft shows?')) return; void action($('delete-workspace'), async () => { $('track-preview').pause(); $('track-preview').removeAttribute('src'); await api('/' + current.station.id, null, 'DELETE'); current = null; selected = []; await init(); message('Workspace deleted. Your listener account is still available.'); }); });
void init();
