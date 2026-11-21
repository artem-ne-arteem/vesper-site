import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { createHalftone } from './halftone.js';

const db = createClient(SUPABASE_URL, SUPABASE_KEY);
createHalftone(document.getElementById('bg')).setDim(0.3);

const $ = (s, root = document) => root.querySelector(s);
const app = $('#app');
const MAX_FILE = 50 * 1024 * 1024;

// Пришли по ссылке «подтвердить почту» из письма (Supabase кладёт type=signup в адрес).
const justConfirmed = /type=signup/.test(location.hash + location.search);

const state = {
  session: null,
  profile: null,
  application: null,
  tab: 'overview',
  authMode: 'signin',
};

// ---------- утилиты ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => state.session?.user?.id;
const newPath = (ext) => `${uid()}/${crypto.randomUUID()}.${ext}`;
const publicURL = (bucket, path) => (path ? db.storage.from(bucket).getPublicUrl(path).data.publicUrl : null);
const fmtNum = (n) => Number(n || 0).toLocaleString('ru-RU');
const fmtDate = (d) => new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const baseURL = () => location.href.replace(/[^/]*([?#].*)?$/, '');
const isArtist = () => ['artist', 'admin'].includes(state.profile?.role);

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function msg(el, text, kind = 'err') {
  el.innerHTML = text ? `<div class="msg ${kind} fade-in">${esc(text)}</div>` : '';
}

function friendly(error) {
  const t = error?.message || String(error);
  if (/invalid login/i.test(t)) return 'Неверная почта или пароль';
  if (/already registered/i.test(t)) return 'Эта почта уже зарегистрирована';
  if (/not confirmed/i.test(t)) return 'Подтверди почту по ссылке из письма';
  if (/security purposes|rate limit/i.test(t)) return 'Слишком много попыток. Подожди минуту.';
  if (/exceeded the maximum allowed size|Payload too large/i.test(t)) return 'Файл больше 50 МБ';
  return t;
}

/** Квадратная обложка side×side в JPEG. */
function squareJPEG(file, side = 1000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = side;
      const s = Math.max(side / img.width, side / img.height);
      const w = img.width * s, h = img.height * s;
      c.getContext('2d').drawImage(img, (side - w) / 2, (side - h) / 2, w, h);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Не получилось обработать картинку'))), 'image/jpeg', 0.86);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Не получилось открыть картинку'));
    img.src = URL.createObjectURL(file);
  });
}

function audioDuration(file) {
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    a.preload = 'metadata';
    a.onloadedmetadata = () => { resolve(Number.isFinite(a.duration) ? a.duration : 0); URL.revokeObjectURL(a.src); };
    a.onerror = () => resolve(0);
    a.src = URL.createObjectURL(file);
  });
}

/** Поле выбора файла с перетаскиванием. */
function dropField(id, { label, hint, accept, icon }) {
  return `
    <label class="drop" id="${id}-drop">
      <input type="file" id="${id}" accept="${accept}">
      <div class="thumb" id="${id}-thumb">${icon}</div>
      <div><div class="name" id="${id}-name">${esc(label)}</div><div class="faint">${esc(hint)}</div></div>
    </label>`;
}

function bindDrop(id, onFile) {
  const input = $('#' + id), drop = $('#' + id + '-drop');
  const set = (file) => {
    if (!file) return;
    if (file.size > MAX_FILE) { alert('Файл больше 50 МБ'); return; }
    $('#' + id + '-name').textContent = file.name;
    drop.classList.add('done');
    if (file.type.startsWith('image/')) {
      $('#' + id + '-thumb').innerHTML = `<img class="thumb" src="${URL.createObjectURL(file)}" alt="">`;
    }
    onFile(file);
  };
  input.addEventListener('change', () => set(input.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); set(e.dataTransfer.files[0]); });
}

// ---------- данные ----------

async function loadProfile() {
  if (!uid()) { state.profile = null; state.application = null; return; }
  const { data } = await db.from('profiles').select('*').eq('id', uid()).single();
  state.profile = data;
  const { data: apps } = await db.from('artist_applications').select('*').eq('user_id', uid())
    .order('created_at', { ascending: false }).limit(1);
  state.application = apps?.[0] ?? null;
}

async function myTracks() {
  const { data, error } = await db.from('tracks').select('*').eq('artist_id', uid()).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

// ---------- отрисовка ----------

async function render() {
  $('#signout').hidden = !state.session;
  $('#who').innerHTML = state.session
    ? `${esc(state.profile?.artist_name || state.profile?.username || '')}<br><span class="faint">${esc(state.session.user.email)}</span>`
    : '';
  if (!state.session) return renderAuth();
  if (!isArtist()) renderListener();
  else renderStudio();
  if (justConfirmed && !state.shownConfirmed) {
    state.shownConfirmed = true;
    app.insertAdjacentHTML('afterbegin', `<div class="msg ok fade-in">Почта подтверждена 🎉 Если регистрировался в приложении — вернись в vesper на iPhone и войди с этой почтой и паролем.</div>`);
  }
}

function renderAuth() {
  const up = state.authMode === 'signup';
  app.innerHTML = `
    <section class="hero fade-in">
      <div>
        <h1>Твоя музыка<br>на vesper</h1>
        <p class="lead">Нет iPhone — не проблема. Загружай треки с компьютера, планируй релизы и ставь виджет на свой сайт.</p>
        <ul>
          <li>Треки с обложкой, текстом и клипом</li>
          <li>Релиз по расписанию — слушатели ставят напоминание</li>
          <li>Слушатели за месяц, прослушивания, подписчики</li>
          <li>Виджет «скоро релиз» для твоего сайта</li>
        </ul>
      </div>
      <form class="auth glass" id="auth">
        <div class="seg">
          <button type="button" data-mode="signin" class="${up ? '' : 'on'}">Вход</button>
          <button type="button" data-mode="signup" class="${up ? 'on' : ''}">Регистрация</button>
        </div>
        ${up ? `<label class="field"><span>Имя пользователя</span><input type="text" name="username" minlength="2" maxlength="32" required></label>` : ''}
        <label class="field"><span>Почта</span><input type="email" name="email" autocomplete="email" required></label>
        <label class="field"><span>Пароль</span><input type="password" name="password" minlength="6" autocomplete="${up ? 'new-password' : 'current-password'}" required></label>
        <div id="auth-msg"></div>
        <button class="btn primary" style="width:100%">${up ? 'Создать аккаунт' : 'Войти'}</button>
        <p class="faint" style="margin:14px 0 0">Тот же аккаунт, что в приложении vesper. Продолжая, ты принимаешь <a href="terms.html" target="_blank">правила vesper</a>.</p>
      </form>
    </section>`;
  app.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { state.authMode = b.dataset.mode; renderAuth(); }));
  $('#auth').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const box = $('#auth-msg');
    const btn = e.target.querySelector('button.primary');
    btn.disabled = true;
    try {
      if (up) {
        const { data, error } = await db.auth.signUp({
          email: f.get('email').trim().toLowerCase(),
          password: f.get('password'),
          // ссылка из письма вернёт сюда, а не на localhost
          options: { data: { username: f.get('username').trim() }, emailRedirectTo: baseURL() },
        });
        if (error) throw error;
        if (!data.session) {
          state.authMode = 'signin';
          renderAuth();
          msg($('#auth-msg'), 'Мы отправили письмо. Подтверди почту и войди.', 'info');
        }
      } else {
        const { error } = await db.auth.signInWithPassword({ email: f.get('email').trim().toLowerCase(), password: f.get('password') });
        if (error) throw error;
      }
    } catch (err) {
      msg(box, friendly(err));
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- слушатель: заявка на артиста ----------

function renderListener() {
  const a = state.application;
  if (a?.status === 'pending') {
    app.innerHTML = `
      <section class="panel glass fade-in" style="max-width:620px">
        <span class="pill warn">На рассмотрении</span>
        <h2 style="margin-top:12px">Заявка отправлена</h2>
        <p class="muted">Администратор посмотрит видео и примет решение. Как только заявку одобрят, здесь откроется студия для загрузки треков.</p>
        <p class="faint">Отправлено ${fmtDate(a.created_at)} · «${esc(a.artist_name)}»</p>
      </section>`;
    return;
  }
  app.innerHTML = `
    <section class="fade-in" style="max-width:720px">
      <h1>Стать артистом</h1>
      <p class="muted" style="margin:12px 0 22px">Выкладывать треки на vesper могут только артисты. Расскажи о себе и приложи видео: как ты играешь, поёшь, сводишь — что угодно, что показывает твою музыку.</p>
      ${a?.status === 'rejected' ? `<div class="msg err">Прошлая заявка отклонена${a.review_note ? `: ${esc(a.review_note)}` : ''}. Можно подать заново.</div>` : ''}
      <form class="panel glass" id="apply">
        <div class="grid2">
          <label class="field"><span>Имя артиста</span><input type="text" name="artist_name" maxlength="60" required></label>
          <label class="field"><span>Жанр</span><input type="text" name="genre" maxlength="60"></label>
        </div>
        <label class="field"><span>Чем ты занимаешься (минимум 20 символов)</span><textarea name="about" minlength="20" maxlength="2000" required></textarea></label>
        <label class="field"><span>Ссылки (необязательно)</span><input type="text" name="links" placeholder="soundcloud, youtube, instagram…"></label>
        ${dropField('apply-video', { label: 'Видео для заявки', hint: 'mp4 или mov, до 50 МБ — лучше 1–3 минуты', accept: 'video/mp4,video/quicktime', icon: '🎬' })}
        <div id="apply-msg"></div>
        <div class="progress" id="apply-progress" hidden><i></i></div>
        <button class="btn primary">Отправить заявку</button>
      </form>
    </section>`;
  let video = null;
  bindDrop('apply-video', (f) => (video = f));
  $('#apply').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const box = $('#apply-msg');
    if (!video) return msg(box, 'Приложи видео');
    const btn = e.target.querySelector('button.primary');
    btn.disabled = true;
    const bar = $('#apply-progress');
    bar.hidden = false;
    bar.firstElementChild.style.width = '30%';
    try {
      const ext = video.name.toLowerCase().endsWith('.mov') ? 'mov' : 'mp4';
      const path = newPath(ext);
      const up = await db.storage.from('applications').upload(path, video, { contentType: video.type || `video/${ext}` });
      if (up.error) throw up.error;
      bar.firstElementChild.style.width = '80%';
      const { error } = await db.from('artist_applications').insert({
        user_id: uid(),
        artist_name: f.get('artist_name').trim(),
        genre: f.get('genre').trim(),
        about: f.get('about').trim(),
        links: f.get('links').trim(),
        video_path: path,
      });
      if (error) throw error;
      bar.firstElementChild.style.width = '100%';
      await loadProfile();
      render();
    } catch (err) {
      msg(box, friendly(err));
      btn.disabled = false;
      bar.hidden = true;
    }
  });
}

// ---------- студия артиста ----------

const TABS = [
  ['overview', 'Обзор'],
  ['upload', 'Загрузить трек'],
  ['albums', 'Альбомы'],
  ['tracks', 'Мои треки'],
  ['page', 'Моя страница'],
  ['widgets', 'Виджеты'],
];

function renderStudio() {
  const tabs = state.profile.role === 'admin' ? [...TABS, ['admin', 'Заявки'], ['reports', 'Жалобы']] : TABS;
  app.innerHTML = `
    <nav class="tabs glass">${tabs.map(([k, v]) => `<button data-tab="${k}" class="${state.tab === k ? 'on' : ''}">${v}</button>`).join('')}</nav>
    <section id="tab" class="fade-in"></section>`;
  app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; renderStudio(); }));
  const box = $('#tab');
  ({ overview: tabOverview, upload: tabUpload, tracks: tabTracks, page: tabPage, widgets: tabWidgets, admin: tabAdmin, reports: tabReports, albums: tabAlbums }[state.tab] ?? tabOverview)(box);
}

async function tabOverview(box) {
  box.innerHTML = `<div class="row muted"><div class="spin"></div>Считаю…</div>`;
  const id = uid();
  const [tracks, listeners, followers, counts] = await Promise.all([
    myTracks().catch(() => []),
    db.rpc('artist_monthly_listeners', { p_artist: id }).then((r) => r.data ?? 0),
    db.rpc('artist_followers', { p_artist: id }).then((r) => r.data ?? 0),
    db.rpc('track_play_counts', { p_artist: id }).then((r) => r.data ?? []),
  ]);
  const plays = Object.fromEntries(counts.map((r) => [r.track_id, r.plays]));
  const total = counts.reduce((s, r) => s + Number(r.plays), 0);
  const top = [...tracks].sort((a, b) => (plays[b.id] ?? 0) - (plays[a.id] ?? 0));
  box.innerHTML = `
    <h1 style="margin-bottom:20px">Привет, ${esc(state.profile.artist_name || state.profile.username)}</h1>
    <div class="stats">
      <div class="stat glass"><b>${fmtNum(listeners)}</b><span>${plural(listeners, 'слушатель', 'слушателя', 'слушателей')} за месяц</span></div>
      <div class="stat glass"><b>${fmtNum(total)}</b><span>прослушиваний всего</span></div>
      <div class="stat glass"><b>${fmtNum(followers)}</b><span>${plural(followers, 'подписчик', 'подписчика', 'подписчиков')}</span></div>
      <div class="stat glass"><b>${tracks.length}</b><span>${plural(tracks.length, 'трек', 'трека', 'треков')}</span></div>
    </div>
    <div class="panel glass">
      <h2>Популярные треки</h2>
      ${top.length ? `<div class="tracks">${top.slice(0, 10).map((t, i) => trackRow(t, `<span class="faint">${fmtNum(plays[t.id] ?? 0)} ${plural(plays[t.id] ?? 0, 'прослушивание', 'прослушивания', 'прослушиваний')}</span>`, i + 1)).join('')}</div>`
        : `<p class="muted">Пока ни одного трека. <a href="#" data-go="upload">Загрузи первый →</a></p>`}
    </div>`;
  box.querySelector('[data-go]')?.addEventListener('click', (e) => { e.preventDefault(); state.tab = 'upload'; renderStudio(); });
}

function trackRow(t, right = '', num = null) {
  const cover = publicURL('covers', t.cover_path);
  const upcoming = t.release_at && new Date(t.release_at) > new Date();
  return `
    <div class="track">
      ${cover ? `<img src="${esc(cover)}" alt="">` : `<div class="ph"></div>`}
      <div>
        <div class="t">${num ? `<span class="faint">${num}</span>` : ''}${esc(t.title)} ${t.explicit ? '<span class="badge">E</span>' : ''}
          ${upcoming ? `<span class="pill">Выйдет ${fmtDate(t.release_at)}</span>` : ''}</div>
        <div class="a">${clock(t.duration || 0)}${t.lyrics ? ' · текст' : ''}${t.video_path ? ' · клип' : ''}</div>
      </div>
      <div class="row">${right}</div>
    </div>`;
}

function tabUpload(box) {
  box.innerHTML = `
    <form class="panel glass" id="upload" style="max-width:760px">
      <h2>Новый трек</h2>
      ${dropField('u-audio', { label: 'Аудиофайл', hint: 'mp3, m4a, wav, flac — до 50 МБ', accept: 'audio/*', icon: '🎵' })}
      ${dropField('u-cover', { label: 'Обложка', hint: 'квадратная, от 1000×1000 — необязательно', accept: 'image/*', icon: '🖼️' })}
      <label class="field"><span>Название</span><input type="text" name="title" maxlength="120" required></label>
      <label class="field" id="u-album-wrap" hidden><span>Альбом</span><select name="album_id" id="u-album"><option value="">Без альбома</option></select></label>
      <label class="field"><span>Текст песни (необязательно)</span>
        <textarea name="lyrics" placeholder="Обычный текст или синхронный: [00:12.50] первая строка"></textarea></label>
      ${dropField('u-video', { label: 'Клип', hint: 'mp4 до 50 МБ — необязательно', accept: 'video/mp4', icon: '🎬' })}
      <label class="check"><input type="checkbox" name="explicit"><span class="badge">E</span> Пометка 18+ (мат, откровенные темы)</label>
      <label class="check"><input type="checkbox" name="scheduled" id="u-scheduled"> Запланировать релиз — до даты трек виден как «Скоро»</label>
      <label class="field" id="u-date-wrap" hidden><span>Дата и время выхода</span><input type="datetime-local" name="release_at"></label>
      <label class="check" style="align-items:flex-start"><input type="checkbox" name="rights" required>
        <span><b>Я автор или правообладатель этого трека</b><br><span class="faint">или у меня есть разрешение всех соавторов, битмейкера и авторов сэмплов · <a href="terms.html" target="_blank">правила vesper</a></span></span></label>
      <div id="u-msg"></div>
      <div class="progress" id="u-progress" hidden><i></i></div>
      <button class="btn primary">Опубликовать</button>
    </form>`;
  const files = {};
  bindDrop('u-audio', (f) => {
    files.audio = f;
    const title = box.querySelector('[name=title]');
    if (!title.value) title.value = f.name.replace(/\.[^.]+$/, '');
  });
  bindDrop('u-cover', (f) => (files.cover = f));
  myAlbums().then((albums) => {
    if (!albums.length) return;
    $('#u-album').insertAdjacentHTML('beforeend', albums.map((a) => `<option value="${a.id}">${esc(a.title)} · ${KINDS[a.kind]}</option>`).join(''));
    $('#u-album-wrap').hidden = false;
  });
  bindDrop('u-video', (f) => (files.video = f));
  const date = box.querySelector('[name=release_at]');
  const tomorrow = new Date(Date.now() + 7 * 864e5);
  tomorrow.setMinutes(0, 0, 0);
  date.value = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  $('#u-scheduled').addEventListener('change', (e) => ($('#u-date-wrap').hidden = !e.target.checked));

  $('#upload').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const out = $('#u-msg');
    if (!files.audio) return msg(out, 'Выбери аудиофайл');
    if (!f.get('rights')) return msg(out, 'Подтверди, что ты автор или правообладатель трека');
    let releaseAt = null;
    if (f.get('scheduled')) {
      releaseAt = new Date(f.get('release_at'));
      if (!(releaseAt > new Date())) return msg(out, 'Дата релиза должна быть в будущем');
    }
    const btn = e.target.querySelector('button.primary');
    const bar = $('#u-progress');
    const step = (pct, text) => { bar.firstElementChild.style.width = pct + '%'; msg(out, text, 'info'); };
    btn.disabled = true;
    bar.hidden = false;
    try {
      const base = `${uid()}/${crypto.randomUUID()}`;
      const ext = (files.audio.name.split('.').pop() || 'mp3').toLowerCase();
      step(10, 'Загружаю трек…');
      const audioPath = `${base}.${ext}`;
      let r = await db.storage.from('tracks').upload(audioPath, files.audio, { contentType: files.audio.type || 'audio/mpeg' });
      if (r.error) throw r.error;

      let coverPath = null;
      if (files.cover) {
        step(55, 'Загружаю обложку…');
        coverPath = `${base}.jpg`;
        r = await db.storage.from('covers').upload(coverPath, await squareJPEG(files.cover), { contentType: 'image/jpeg' });
        if (r.error) throw r.error;
      }
      let videoPath = null;
      if (files.video) {
        step(70, 'Загружаю клип…');
        videoPath = `${base}.mp4`;
        r = await db.storage.from('videos').upload(videoPath, files.video, { contentType: 'video/mp4' });
        if (r.error) throw r.error;
      }
      step(90, 'Публикую…');
      const albumId = f.get('album_id') || null;
      let trackNumber = null;
      if (albumId) {
        const { data: inAlbum } = await db.from('tracks').select('track_number').eq('album_id', albumId);
        trackNumber = Math.max(0, ...(inAlbum ?? []).map((t) => t.track_number || 0)) + 1;
      }
      const { error } = await db.from('tracks').insert({
        album_id: albumId,
        track_number: trackNumber,
        artist_id: uid(),
        title: f.get('title').trim(),
        audio_path: audioPath,
        cover_path: coverPath,
        video_path: videoPath,
        lyrics: f.get('lyrics').trim() || null,
        explicit: !!f.get('explicit'),
        duration: await audioDuration(files.audio),
        release_at: releaseAt ? releaseAt.toISOString() : null,
        rights_confirmed: true,
      });
      if (error) throw error;
      step(100, releaseAt ? `Готово! Релиз выйдет ${fmtDate(releaseAt)}. Не забудь поставить виджет на свой сайт.` : 'Готово! Трек уже на vesper.');
      $('#u-msg').firstElementChild.className = 'msg ok fade-in';
      e.target.reset();
      setTimeout(() => { state.tab = releaseAt ? 'widgets' : 'tracks'; renderStudio(); }, 1600);
    } catch (err) {
      msg(out, friendly(err));
      btn.disabled = false;
      bar.hidden = true;
    }
  });
}

async function tabTracks(box) {
  box.innerHTML = `<div class="row muted"><div class="spin"></div>Загружаю…</div>`;
  const tracks = await myTracks().catch(() => []);
  box.innerHTML = `
    <div class="panel glass">
      <h2>Мои треки</h2>
      ${tracks.length ? `<div class="tracks">${tracks.map((t) => trackRow(t, `
          <button class="btn small" data-edit="${t.id}">Изменить</button>
          <button class="btn small danger" data-del="${t.id}">Удалить</button>`)).join('')}</div>`
        : '<p class="muted">Пока пусто.</p>'}
    </div>`;
  const byId = Object.fromEntries(tracks.map((t) => [t.id, t]));
  box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editTrack(byId[b.dataset.edit])));
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const t = byId[b.dataset.del];
    if (!confirm(`Удалить «${t.title}» с vesper? Это нельзя отменить.`)) return;
    const { error } = await db.from('tracks').delete().eq('id', t.id);
    if (error) return alert(friendly(error));
    await db.storage.from('tracks').remove([t.audio_path]);
    if (t.cover_path) await db.storage.from('covers').remove([t.cover_path]);
    if (t.video_path) await db.storage.from('videos').remove([t.video_path]);
    tabTracks(box);
  }));
}

function editTrack(t) {
  const dlg = $('#dialog');
  const local = t.release_at ? new Date(new Date(t.release_at).getTime() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '';
  $('#dialog-body').innerHTML = `
    <form id="edit">
      <h2>Изменить трек</h2>
      <label class="field"><span>Название</span><input type="text" name="title" value="${esc(t.title)}" required></label>
      <label class="field"><span>Текст песни</span><textarea name="lyrics">${esc(t.lyrics ?? '')}</textarea></label>
      <label class="check"><input type="checkbox" name="explicit" ${t.explicit ? 'checked' : ''}><span class="badge">E</span> Пометка 18+</label>
      <label class="field"><span>Дата выхода (пусто — уже вышел)</span><input type="datetime-local" name="release_at" value="${local}"></label>
      <div id="e-msg"></div>
      <div class="row"><button class="btn primary">Сохранить</button><button type="button" class="btn" id="e-cancel">Отмена</button></div>
    </form>`;
  dlg.showModal();
  $('#e-cancel').onclick = () => dlg.close();
  $('#edit').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await db.from('tracks').update({
      title: f.get('title').trim(),
      lyrics: f.get('lyrics').trim() || null,
      explicit: !!f.get('explicit'),
      release_at: f.get('release_at') ? new Date(f.get('release_at')).toISOString() : null,
    }).eq('id', t.id);
    if (error) return msg($('#e-msg'), friendly(error));
    dlg.close();
    renderStudio();
  };
}

const PROFILE_COLORS = ['#4F6BED', '#7B5CE0', '#C04FD8', '#E0508A', '#E5484D', '#F07B2E', '#E0A82E', '#3FA764', '#2E9C96', '#2F8FD8', '#5A6B7D', '#3B3B44'];
const PATTERNS = {
  'music.note': '♪ Нота', 'music.mic': '🎤 Микрофон', headphones: '🎧 Наушники', guitars: '🎸 Гитара',
  pianokeys: '🎹 Клавиши', 'star.fill': '★ Звезда', 'heart.fill': '♥ Сердце', 'flame.fill': '🔥 Огонь',
  'bolt.fill': '⚡ Молния', 'moon.stars.fill': '🌙 Луна', sparkles: '✨ Искры', 'leaf.fill': '🍃 Лист',
  'drop.fill': '💧 Капля', 'crown.fill': '👑 Корона', waveform: '〰 Волна',
};

async function tabPage(box) {
  const p = state.profile;
  const avatar = publicURL('avatars', p.avatar_path);
  const tracks = (await myTracks().catch(() => [])).filter((t) => !t.release_at || new Date(t.release_at) <= new Date());
  const accent = p.accent_color || '#4F6BED';
  box.innerHTML = `
    <form class="panel glass" id="page" style="max-width:680px">
      <h2>Моя страница</h2>
      <p class="muted">Так тебя видят в приложении: шапка в твоём цвете, аватарка, трек под именем, описание.</p>
      <div id="p-preview" style="height:170px;border-radius:24px;margin-bottom:18px;display:grid;place-items:center;position:relative;overflow:hidden">
        <div style="text-align:center;position:relative">
          ${avatar ? `<img src="${esc(avatar)}" alt="" style="width:86px;height:86px;border-radius:50%;object-fit:cover;border:3px solid #fff">` : '<div style="width:86px;height:86px;border-radius:50%;border:3px solid #fff;margin:auto;background:rgba(255,255,255,.15)"></div>'}
          <div style="font-weight:700;font-size:20px;margin-top:8px">${esc(p.artist_name || p.username || '')}</div>
        </div>
      </div>
      ${dropField('p-avatar', { label: 'Аватарка', hint: 'квадратная фотография', accept: 'image/*', icon: avatar ? `<img class="thumb" src="${esc(avatar)}" alt="">` : '🙂' })}
      <label class="field"><span>Цвет профиля</span>
        <div class="row" id="p-colors">${PROFILE_COLORS.map((c) => `<button type="button" data-color="${c}" style="width:32px;height:32px;border-radius:50%;border:${c.toLowerCase() === accent.toLowerCase() ? '3px solid #fff' : '0'};background:${c};cursor:pointer"></button>`).join('')}
          <input type="color" name="accent" value="${esc(accent)}" style="width:40px;height:34px;border:0;background:none;cursor:pointer" title="Свой цвет">
        </div></label>
      <label class="field"><span>Узор на фоне</span><select name="pattern">${Object.entries(PATTERNS).map(([k, v]) => `<option value="${k}" ${k === (p.pattern || 'music.note') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      ${tracks.length ? `<label class="field"><span>Пузыри вокруг аватарки (до 6 — ничего не отмечено, пузырей нет)</span>
        <div class="row" id="p-bubbles">${tracks.map((t) => {
          const cover = publicURL('covers', t.cover_path);
          const on = (p.bubble_track_ids || []).includes(t.id);
          return `<label class="check" style="margin:0;gap:6px"><input type="checkbox" name="bubble" value="${t.id}" ${on ? 'checked' : ''}>${cover ? `<img src="${esc(cover)}" alt="" style="width:34px;height:34px;border-radius:50%;object-fit:cover">` : ''}<span class="faint">${esc(t.title)}</span></label>`;
        }).join('')}</div></label>` : ''}
      ${tracks.length ? `<label class="field"><span>Трек в профиле (плашка под именем)</span><select name="featured"><option value="">Не показывать</option>${tracks.map((t) => `<option value="${t.id}" ${t.id === p.featured_track_id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>Об артисте</span><textarea name="bio" maxlength="1500">${esc(p.bio ?? '')}</textarea></label>
      <div id="p-msg"></div>
      <button class="btn primary">Сохранить</button>
    </form>`;
  const colorInput = box.querySelector('[name=accent]');
  const paint = () => {
    const c = colorInput.value;
    $('#p-preview').style.background = `linear-gradient(${c}, color-mix(in srgb, ${c} 65%, black))`;
    box.querySelectorAll('[data-color]').forEach((b) => (b.style.border = b.dataset.color.toLowerCase() === c.toLowerCase() ? '3px solid #fff' : '0'));
  };
  box.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => { colorInput.value = b.dataset.color; paint(); }));
  colorInput.addEventListener('input', paint);
  paint();

  // не больше 6 пузырей
  box.querySelectorAll('[name=bubble]').forEach((cb) => cb.addEventListener('change', () => {
    const checked = box.querySelectorAll('[name=bubble]:checked');
    if (checked.length > 6) { cb.checked = false; alert('Можно выбрать до 6 треков'); }
  }));
  let file = null;
  bindDrop('p-avatar', (f) => (file = f));
  $('#page').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('#p-msg');
    const f = new FormData(e.target);
    try {
      let avatarPath = p.avatar_path;
      if (file) {
        avatarPath = newPath('jpg');
        const r = await db.storage.from('avatars').upload(avatarPath, await squareJPEG(file, 600), { contentType: 'image/jpeg' });
        if (r.error) throw r.error;
        if (p.avatar_path) await db.storage.from('avatars').remove([p.avatar_path]);
      }
      const { error } = await db.from('profiles').update({
        bio: f.get('bio'),
        avatar_path: avatarPath,
        accent_color: String(f.get('accent')).toUpperCase(),
        pattern: f.get('pattern'),
        featured_track_id: f.get('featured') || null,
        bubble_track_ids: f.getAll('bubble').slice(0, 6),
      }).eq('id', uid());
      if (error) throw error;
      await loadProfile();
      msg(out, 'Сохранено', 'ok');
    } catch (err) {
      msg(out, friendly(err));
    }
  });
}

async function tabWidgets(box) {
  box.innerHTML = `<div class="row muted"><div class="spin"></div>Загружаю…</div>`;
  const tracks = await myTracks().catch(() => []);
  const upcoming = tracks.filter((t) => t.release_at && new Date(t.release_at) > new Date());
  const pick = upcoming[0] ?? tracks[0];
  box.innerHTML = `
    <div class="panel glass">
      <h2>Виджет для твоего сайта</h2>
      <p class="muted">Карточка с обложкой, обратным отсчётом до релиза и кнопкой «Открыть в vesper» — нажатие сразу открывает трек в приложении. После выхода кнопка меняется на «Слушать».</p>
      ${tracks.length ? `
        <label class="field"><span>Трек</span><select id="w-track">${tracks.map((t) =>
          `<option value="${t.id}" ${t.id === pick?.id ? 'selected' : ''}>${esc(t.title)}${t.release_at && new Date(t.release_at) > new Date() ? ' — скоро' : ''}</option>`).join('')}</select></label>
        <div class="app-card">
          <div>
            <label class="field"><span>Код для сайта (вставь в HTML)</span><textarea class="code" id="w-code" readonly></textarea></label>
            <div class="row" style="margin-bottom:18px"><button class="btn small" id="w-copy">Скопировать код</button></div>
            <label class="field"><span>Ссылка на релиз (для соцсетей и шапки профиля)</span><textarea class="code" id="w-link" readonly style="min-height:48px"></textarea></label>
            <div class="row"><button class="btn small" id="w-copy-link">Скопировать ссылку</button><a class="btn small" id="w-open" target="_blank">Открыть</a></div>
          </div>
          <iframe class="widget-preview" id="w-preview" title="Превью виджета"></iframe>
        </div>` : '<p class="muted">Сначала загрузи трек — можно запланированный на будущее.</p>'}
    </div>`;
  if (!tracks.length) return;
  const update = () => {
    const id = $('#w-track').value;
    const widget = `${baseURL()}widget.html?r=${id}`;
    const link = `${baseURL()}r.html?id=${id}`;
    $('#w-code').value = `<iframe src="${widget}" width="360" height="470" style="border:0;border-radius:28px" loading="lazy" title="vesper"></iframe>`;
    $('#w-link').value = link;
    $('#w-open').href = link;
    $('#w-preview').src = widget;
  };
  $('#w-track').addEventListener('change', update);
  const copy = (sel, btn) => navigator.clipboard.writeText($(sel).value).then(() => { btn.textContent = 'Скопировано ✓'; setTimeout(() => (btn.textContent = 'Скопировать'), 1500); });
  $('#w-copy').onclick = (e) => copy('#w-code', e.target);
  $('#w-copy-link').onclick = (e) => copy('#w-link', e.target);
  update();
}

async function tabAdmin(box) {
  box.innerHTML = `<div class="row muted"><div class="spin"></div>Загружаю заявки…</div>`;
  const { data, error } = await db.from('artist_applications')
    .select('*, applicant:profiles!artist_applications_user_id_fkey(username)')
    .eq('status', 'pending').order('created_at', { ascending: false });
  if (error) { box.innerHTML = `<div class="msg err">${esc(friendly(error))}</div>`; return; }
  if (!data.length) { box.innerHTML = `<div class="panel glass"><h2>Новых заявок нет</h2><p class="muted">Когда кто-то захочет стать артистом, заявка появится здесь.</p></div>`; return; }
  box.innerHTML = data.map((a) => `
    <article class="panel glass app-card" data-app="${a.id}">
      <div>
        <h2 style="margin-bottom:4px">${esc(a.artist_name)}</h2>
        <p class="faint">@${esc(a.applicant?.username ?? '')} · ${esc(a.genre)} · ${fmtDate(a.created_at)}</p>
        <p>${esc(a.about)}</p>
        ${a.links ? `<p class="faint">${esc(a.links)}</p>` : ''}
        <label class="field"><span>Комментарий для артиста</span><input type="text" data-note placeholder="необязательно"></label>
        <div class="row">
          <button class="btn primary" data-approve>Принять</button>
          <button class="btn danger" data-reject>Отклонить</button>
        </div>
      </div>
      <video controls preload="metadata" data-video="${esc(a.video_path)}"></video>
    </article>`).join('');
  box.querySelectorAll('[data-video]').forEach(async (v) => {
    const { data: signed } = await db.storage.from('applications').createSignedUrl(v.dataset.video, 3600);
    if (signed?.signedUrl) v.src = signed.signedUrl;
  });
  box.querySelectorAll('[data-app]').forEach((card) => {
    const review = async (approve) => {
      const { error } = await db.rpc('review_application', {
        application_id: card.dataset.app,
        approve,
        note: card.querySelector('[data-note]').value.trim() || null,
      });
      if (error) return alert(friendly(error));
      card.style.transition = 'opacity .3s, transform .3s';
      card.style.opacity = '0';
      card.style.transform = 'scale(.97)';
      setTimeout(() => tabAdmin(box), 300);
    };
    card.querySelector('[data-approve]').onclick = () => review(true);
    card.querySelector('[data-reject]').onclick = () => review(false);
  });
}

const REASONS = {
  copyright: 'Нарушает авторские права',
  explicit: '18+ без пометки',
  offensive: 'Оскорбительный или запрещённый контент',
  spam: 'Спам или пустой файл',
  other: 'Другое',
};

async function tabReports(box) {
  box.innerHTML = `<div class="row muted"><div class="spin"></div>Загружаю жалобы…</div>`;
  const { data, error } = await db.from('reports')
    .select('*, track:tracks(*, artist:profiles(username, artist_name)), reporter:profiles!reports_reporter_id_fkey(username)')
    .eq('status', 'pending').order('created_at', { ascending: false });
  if (error) { box.innerHTML = `<div class="msg err">${esc(friendly(error))}</div>`; return; }
  if (!data.length) { box.innerHTML = `<div class="panel glass"><h2>Жалоб нет</h2><p class="muted">Когда кто-то пожалуется на трек в приложении, жалоба появится здесь.</p></div>`; return; }
  box.innerHTML = data.map((r) => {
    const t = r.track;
    const audio = t ? publicURL('tracks', t.audio_path) : null;
    return `
      <article class="panel glass" data-report="${r.id}">
        <div class="row" style="justify-content:space-between">
          <span class="pill warn">${esc(REASONS[r.reason] ?? r.reason)}</span>
          <span class="faint">${fmtDate(r.created_at)}${r.reporter?.username ? ` · от @${esc(r.reporter.username)}` : ''}</span>
        </div>
        ${t ? `<div class="tracks" style="padding:8px 0">${trackRow(t, `<span class="faint">${esc(t.artist?.artist_name || t.artist?.username || '')}</span>`)}</div>
              <audio controls preload="none" src="${esc(audio)}" style="width:100%;margin-bottom:12px"></audio>`
            : '<p class="muted">Трек уже удалён.</p>'}
        ${r.details ? `<p>${esc(r.details)}</p>` : ''}
        <div class="row">
          <button class="btn" data-dismiss>Отклонить жалобу</button>
          ${t ? '<button class="btn danger" data-remove>Удалить трек</button>' : ''}
        </div>
      </article>`;
  }).join('');
  const byId = Object.fromEntries(data.map((r) => [r.id, r]));
  box.querySelectorAll('[data-report]').forEach((card) => {
    const report = byId[card.dataset.report];
    const finish = async (remove) => {
      if (remove && !confirm(`Удалить «${report.track.title}» с vesper у всех? Это нельзя отменить.`)) return;
      const { error } = await db.from('reports')
        .update({ status: remove ? 'resolved' : 'dismissed', resolved_at: new Date().toISOString() })
        .eq('id', report.id);
      if (error) return alert(friendly(error));
      if (remove) {
        const t = report.track;
        const del = await db.from('tracks').delete().eq('id', t.id);
        if (del.error) return alert(friendly(del.error));
        await db.storage.from('tracks').remove([t.audio_path]);
        if (t.cover_path) await db.storage.from('covers').remove([t.cover_path]);
        if (t.video_path) await db.storage.from('videos').remove([t.video_path]);
      }
      card.style.transition = 'opacity .3s, transform .3s';
      card.style.opacity = '0';
      card.style.transform = 'scale(.97)';
      setTimeout(() => tabReports(box), 300);
    };
    card.querySelector('[data-dismiss]').onclick = () => finish(false);
    card.querySelector('[data-remove]')?.addEventListener('click', () => finish(true));
  });
}

const KINDS = { album: 'Альбом', ep: 'EP', single: 'Сингл' };

async function myAlbums() {
  const { data } = await db.from('albums').select('*').eq('artist_id', uid()).order('created_at', { ascending: false });
  return data ?? [];
}

async function tabAlbums(box) {
  box.innerHTML = `<div class="row muted"><div class="spin"></div>Загружаю…</div>`;
  const [albums, tracks] = await Promise.all([myAlbums(), myTracks().catch(() => [])]);
  const count = (id) => tracks.filter((t) => t.album_id === id).length;
  box.innerHTML = `
    <div class="grid2">
      <form class="panel glass" id="album-form">
        <h2>Новый альбом или EP</h2>
        ${dropField('a-cover', { label: 'Обложка', hint: 'квадратная, от 1000×1000', accept: 'image/*', icon: '🖼️' })}
        <label class="field"><span>Название</span><input type="text" name="title" maxlength="120" required></label>
        <label class="field"><span>Тип</span><select name="kind"><option value="album">Альбом</option><option value="ep">EP</option><option value="single">Сингл</option></select></label>
        <label class="field"><span>Пара слов об альбоме (необязательно)</span><textarea name="description" maxlength="1500" style="min-height:80px"></textarea></label>
        <div id="a-msg"></div>
        <button class="btn primary">Создать</button>
        <p class="faint" style="margin:12px 0 0">Потом выбирай этот альбом при загрузке каждого трека — номера проставятся по порядку.</p>
      </form>
      <div class="panel glass">
        <h2>Мои альбомы</h2>
        ${albums.length ? `<div class="tracks">${albums.map((a) => {
          const cover = publicURL('covers', a.cover_path);
          return `<div class="track">
            ${cover ? `<img src="${esc(cover)}" alt="">` : '<div class="ph"></div>'}
            <div><div class="t">${esc(a.title)}</div><div class="a">${KINDS[a.kind]} · ${count(a.id)} ${plural(count(a.id), 'трек', 'трека', 'треков')}</div></div>
            <div class="row"><button class="btn small danger" data-del-album="${a.id}">Удалить</button></div>
          </div>`;
        }).join('')}</div>` : '<p class="muted">Пока нет альбомов.</p>'}
      </div>
    </div>`;
  let cover = null;
  bindDrop('a-cover', (f) => (cover = f));
  $('#album-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const out = $('#a-msg');
    try {
      let coverPath = null;
      if (cover) {
        coverPath = newPath('jpg');
        const r = await db.storage.from('covers').upload(coverPath, await squareJPEG(cover), { contentType: 'image/jpeg' });
        if (r.error) throw r.error;
      }
      const { error } = await db.from('albums').insert({
        artist_id: uid(),
        title: f.get('title').trim(),
        kind: f.get('kind'),
        description: f.get('description').trim(),
        cover_path: coverPath,
      });
      if (error) throw error;
      tabAlbums(box);
    } catch (err) {
      msg(out, friendly(err));
    }
  });
  box.querySelectorAll('[data-del-album]').forEach((b) => b.addEventListener('click', async () => {
    const a = albums.find((x) => x.id === b.dataset.delAlbum);
    if (!confirm(`Удалить альбом «${a.title}»? Треки останутся опубликованными, просто без альбома.`)) return;
    const { error } = await db.from('albums').delete().eq('id', a.id);
    if (error) return alert(friendly(error));
    if (a.cover_path) await db.storage.from('covers').remove([a.cover_path]);
    tabAlbums(box);
  }));
}

// ---------- старт ----------

$('#signout').addEventListener('click', () => db.auth.signOut());

db.auth.onAuthStateChange((_event, session) => {
  state.session = session;
  // колбэк не должен ждать запросы к базе — иначе supabase-js может зависнуть
  setTimeout(async () => {
    await loadProfile();
    render();
  }, 0);
});
