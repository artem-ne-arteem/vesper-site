// Общее для виджета (widget.html) и страницы-ссылки (r.html):
// загружает релиз, рисует обложку, отсчёт и кнопку, которая открывает трек в приложении.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY, INSTALL_URL } from './config.js';

const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function countdown(target) {
  const ms = Math.max(0, target - Date.now());
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
  const cell = (v, l) => `<div class="cd"><b>${String(v).padStart(2, '0')}</b><span>${l}</span></div>`;
  return cell(d, 'дн') + cell(h, 'ч') + cell(m, 'мин') + cell(s, 'сек');
}

export async function mountRelease(root, { big = false } = {}) {
  const id = new URLSearchParams(location.search).get('r') || new URLSearchParams(location.search).get('id');
  if (!id) {
    root.innerHTML = `<p class="muted">Нет ссылки на релиз.</p>`;
    return;
  }
  const { data, error } = await db.rpc('release_info', { p_track: id });
  const r = data?.[0];
  if (error || !r) {
    root.innerHTML = `<p class="muted">Релиз не найден.</p>`;
    return;
  }
  document.title = `${r.artist_name} — ${r.title} · vesper`;
  const cover = r.cover_path ? db.storage.from('covers').getPublicUrl(r.cover_path).data.publicUrl : null;
  const appLink = `vesper://track/${r.id}`;
  const artistLink = `vesper://artist/${r.artist_id}`;
  const date = r.release_at ? new Date(r.release_at) : null;

  root.innerHTML = `
    <div class="card ${big ? 'big' : ''}">
      <div class="cover">${cover ? `<img src="${esc(cover)}" alt="">` : '<div class="ph"></div>'}
        <span class="tag" id="tag"></span>
      </div>
      <div class="title">${esc(r.title)} ${r.explicit ? '<span class="badge">E</span>' : ''}</div>
      <a class="artist" href="${artistLink}">${esc(r.artist_name)}</a>
      <div id="when"></div>
      <a class="btn primary" id="open" href="${appLink}"></a>
      ${INSTALL_URL ? `<a class="hint" href="${esc(INSTALL_URL)}" target="_blank" rel="noopener">Нет приложения? Как установить vesper</a>` : `<span class="hint">Нужно приложение vesper на iPhone</span>`}
      <div class="foot"><span class="brand">vesper</span></div>
    </div>`;

  const tick = () => {
    const released = !date || date <= new Date();
    root.querySelector('#tag').textContent = released ? 'Уже вышел' : 'Скоро';
    root.querySelector('#tag').classList.toggle('out', released);
    root.querySelector('#open').textContent = released ? '▶ Слушать в vesper' : '🔔 Открыть в vesper и напомнить';
    root.querySelector('#when').innerHTML = released
      ? `<p class="sub">${date ? 'Вышел ' + date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}</p>`
      : `<p class="sub">Релиз ${date.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</p><div class="countdown">${countdown(date)}</div>`;
    return released;
  };
  if (!tick()) {
    const timer = setInterval(() => { if (tick()) clearInterval(timer); }, 1000);
  }

  // Ссылка из виджета внутри чужого сайта (iframe) открывает приложение через верхнее окно.
  root.querySelector('#open').addEventListener('click', (e) => {
    if (window.top !== window.self) {
      e.preventDefault();
      try { window.top.location.href = appLink; } catch { window.open(appLink, '_blank'); }
    }
  });
}
