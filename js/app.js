'use strict';

// Интерфейс: экраны, навигация по адресу (#/...), модальные окна.

const app = document.getElementById('app');
const checking = new Set(); // id работ, которые сейчас проверяются
let lastHash = null;

// ---------- утилиты ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14 9l2 2"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
};
const icon = name => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const fmtNum = n => Number(n).toLocaleString(I18n.lang === 'uz' ? 'uz-UZ' : 'ru-RU', { maximumFractionDigits: 1 });

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

const finalGrade = work => work.manualGrade ?? work.result?.grade ?? null;

function average(works) {
  const grades = works.map(finalGrade).filter(Boolean);
  return grades.length ? (grades.reduce((a, b) => a + b, 0) / grades.length).toFixed(1) : '—';
}

function gradeBadge(work) {
  if (checking.has(work.id)) return `<span class="grade pending" title="${esc(t('checking'))}"><span class="spinner"></span></span>`;
  const g = finalGrade(work);
  if (g) return `<span class="grade g${g}">${g}</span>`;
  if (work.status === 'error') return `<span class="grade err" title="${esc(t('statusError'))}">!</span>`;
  return `<span class="grade none" title="${esc(t('statusNew'))}">—</span>`;
}

function crumbs(items) {
  return `<nav class="crumbs">${items
    .map(([label, href]) => (href ? `<a href="${href}">${esc(label)}</a>` : `<span>${esc(label)}</span>`))
    .join('<span class="sep">›</span>')}</nav>`;
}

const emptyState = (title, text = '') =>
  `<div class="empty"><div class="empty-mark">${icon('book')}</div><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}</div>`;

const keyBanner = () =>
  `<div class="notice warn">${icon('key')}<div>${esc(t('noKeyBanner'))} <a href="#/settings">${esc(t('openSettings'))}</a></div></div>`;

function toast(msg, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), kind === 'error' ? 6000 : 3000);
  setTimeout(() => el.remove(), kind === 'error' ? 6500 : 3500);
}

// Модальное окно. Возвращает форму при подтверждении или null при отмене.
// validate(form) может вернуть текст ошибки — тогда окно не закрывается.
function modal({ title, body, ok, danger = false, validate, onOpen, wide = false }) {
  return new Promise(resolve => {
    const dlg = $('#modal');
    dlg.className = wide ? 'wide' : '';
    dlg.innerHTML = `
      <form class="modal-card">
        <div class="modal-head">
          <h2>${esc(title)}</h2>
          <button type="button" class="icon-btn" data-act="cancel" aria-label="${esc(t('cancel'))}">${icon('x')}</button>
        </div>
        <div class="modal-body">${body}</div>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-act="cancel">${esc(t('cancel'))}</button>
          ${ok ? `<button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(ok)}</button>` : ''}
        </div>
      </form>`;
    const form = $('form', dlg);
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      dlg.close();
      resolve(value);
    };
    form.addEventListener('submit', e => {
      e.preventDefault();
      const err = validate?.(form);
      if (err) { toast(err, 'error'); return; }
      finish(form);
    });
    $$('[data-act=cancel]', dlg).forEach(b => (b.onclick = () => finish(null)));
    dlg.oncancel = e => { e.preventDefault(); finish(null); };
    dlg.showModal();
    onOpen?.(form);
    const first = $('input:not([type=hidden]):not([type=checkbox]), textarea, select', form);
    if (first && !onOpen) first.focus();
  });
}

const confirmBox = (title, text, ok = t('delete')) =>
  modal({ title, body: `<p>${esc(text)}</p>`, ok, danger: true }).then(Boolean);

// ---------- навигация ----------

const routes = [
  [/^#?\/?$/, viewGroups],
  [/^#\/group\/([\w-]+)$/, viewGroup],
  [/^#\/student\/([\w-]+)$/, viewStudent],
  [/^#\/work\/([\w-]+)$/, viewWork],
  [/^#\/settings$/, viewSettings],
];

async function render() {
  const hash = location.hash || '#/';
  const route = routes.find(([re]) => re.test(hash));
  if (!route) { location.hash = '#/'; return; }
  try {
    await route[1](...hash.match(route[0]).slice(1));
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="notice error">${esc(t('errGeneric'))}: ${esc(e.message)}</div>`;
  }
  $$('[data-nav]').forEach(a => a.classList.toggle('active',
    a.dataset.nav === (hash.startsWith('#/settings') ? 'settings' : 'groups')));
  if (hash !== lastHash) window.scrollTo(0, 0);
  lastHash = hash;
}

function notFound() {
  app.innerHTML = emptyState(t('notFound')) + `<p class="center"><a class="btn" href="#/">${esc(t('toGroups'))}</a></p>`;
}

// ---------- экран: группы ----------

async function viewGroups() {
  const [groups, students, works] = await Promise.all([DB.all('groups'), DB.all('students'), DB.all('works')]);
  groups.sort(byName);
  app.innerHTML = `
    ${Settings.get('apiKey') ? '' : keyBanner()}
    <div class="page-head">
      <div>
        <h1>${esc(t('groups'))}</h1>
        <p class="muted">${esc(t('groupsHint'))}</p>
      </div>
      <button class="btn primary" id="add-group">${icon('plus')}${esc(t('newGroup'))}</button>
    </div>
    ${groups.length ? `<div class="cards">${groups.map(g => {
      const st = students.filter(s => s.groupId === g.id);
      const ws = works.filter(w => w.groupId === g.id);
      return `
        <a class="card group-card" href="#/group/${g.id}">
          <div class="card-top">
            <h3>${esc(g.name)}</h3>
            <span class="tag">${esc(t('lang_' + g.lang))}</span>
          </div>
          <div class="stats">
            <div><b>${st.length}</b><span>${esc(t('studentsCount'))}</span></div>
            <div><b>${ws.length}</b><span>${esc(t('worksCount'))}</span></div>
            <div><b>${average(ws)}</b><span>${esc(t('avgGrade'))}</span></div>
          </div>
        </a>`;
    }).join('')}</div>` : emptyState(t('noGroups'), t('noGroupsHint'))}`;
  $('#add-group').onclick = () => editGroup();
}

async function editGroup(group) {
  const form = await modal({
    title: group ? t('editGroup') : t('newGroup'),
    ok: t('save'),
    body: `
      <label class="field">${esc(t('groupName'))}
        <input name="name" required maxlength="80" value="${esc(group?.name)}" placeholder="${esc(t('groupNamePh'))}">
      </label>
      <label class="field">${esc(t('dictLang'))}
        <select name="lang">
          ${['ru', 'uz'].map(l => `<option value="${l}" ${group?.lang === l ? 'selected' : ''}>${esc(t('lang_' + l))}</option>`).join('')}
        </select>
      </label>`,
  });
  if (!form) return;
  const data = { ...(group || { id: DB.uid(), createdAt: Date.now() }), name: form.name.value.trim(), lang: form.lang.value };
  await DB.put('groups', data);
  toast(t('saved'), 'success');
  if (group) render(); else location.hash = `#/group/${data.id}`;
}

// ---------- экран: группа (журнал) ----------

function journalColumns(works) {
  const map = new Map();
  for (const w of works) {
    const cur = map.get(w.title);
    if (!cur || w.date < cur) map.set(w.title, w.date);
  }
  return [...map.entries()]
    .map(([title, date]) => ({ title, date }))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.title.localeCompare(b.title));
}

async function viewGroup(id) {
  const group = await DB.get('groups', id);
  if (!group) return notFound();
  const [students, works] = await Promise.all([DB.byIndex('students', 'groupId', id), DB.byIndex('works', 'groupId', id)]);
  students.sort(byName);
  const cols = journalColumns(works);

  const cell = (student, col) => {
    const list = works.filter(w => w.studentId === student.id && w.title === col.title)
      .sort((a, b) => b.createdAt - a.createdAt);
    if (!list.length) {
      return `<td><button class="cell-add" data-student="${student.id}" data-title="${esc(col.title)}" title="${esc(t('addWork'))}">+</button></td>`;
    }
    const sc = list[0].result?.score;
    const pts = sc && !checking.has(list[0].id) ? `<span class="cell-pts">${fmtNum(sc.total)}/${sc.maxPoints}</span>` : '';
    return `<td><a href="#/work/${list[0].id}" class="cell-link">${gradeBadge(list[0])}${pts}</a></td>`;
  };

  app.innerHTML = `
    ${crumbs([[t('groups'), '#/'], [group.name]])}
    <div class="page-head">
      <div>
        <h1>${esc(group.name)}</h1>
        <p class="muted">${esc(t('dictLang'))}: ${esc(t('lang_' + group.lang))} · ${students.length} ${esc(t('studentsCount'))} · ${esc(t('avgGrade'))}: ${average(works)}</p>
      </div>
      <div class="actions">
        <button class="btn primary" id="add-work" ${students.length ? '' : 'disabled'}>${icon('plus')}${esc(t('addWork'))}</button>
        <button class="btn" id="add-students">${icon('users')}${esc(t('addStudents'))}</button>
        <button class="btn ghost" id="edit-group" title="${esc(t('editGroup'))}">${icon('edit')}</button>
        <button class="btn ghost danger-text" id="del-group" title="${esc(t('deleteGroup'))}">${icon('trash')}</button>
      </div>
    </div>
    ${!students.length ? emptyState(t('noStudents'), t('noStudentsHint')) : `
      <div class="journal-wrap">
        <table class="journal">
          <thead>
            <tr>
              <th class="sticky">${esc(t('student'))}</th>
              ${cols.map(c => `<th class="col"><div class="col-title" title="${esc(c.title)}">${esc(c.title)}</div><div class="col-date">${fmtDate(c.date)}</div></th>`).join('')}
              <th class="col avg-col">${esc(t('avgShort'))}</th>
            </tr>
          </thead>
          <tbody>
            ${students.map((s, i) => `
              <tr>
                <th class="sticky"><span class="row-num">${i + 1}</span><a href="#/student/${s.id}">${esc(s.name)}</a></th>
                ${cols.map(c => cell(s, c)).join('')}
                <td class="avg">${average(works.filter(w => w.studentId === s.id))}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${cols.length ? `<p class="muted small legend-line">${esc(t('journalHint'))}</p>` : `<p class="muted small legend-line">${esc(t('noWorksHint'))}</p>`}`}`;

  $('#add-work').onclick = () => addWork({ group, students });
  $('#add-students').onclick = () => addStudents(group);
  $('#edit-group').onclick = () => editGroup(group);
  $('#del-group').onclick = async () => {
    if (!(await confirmBox(t('deleteGroup'), t('deleteGroupConfirm', { name: group.name })))) return;
    await DB.deleteGroup(group.id);
    toast(t('deleted'), 'success');
    location.hash = '#/';
  };
  $$('.cell-add').forEach(b => (b.onclick = () => addWork({
    group, students, studentId: b.dataset.student, title: b.dataset.title,
  })));
}

async function addStudents(group) {
  const form = await modal({
    title: t('addStudents'),
    ok: t('add'),
    body: `
      <label class="field">${esc(t('studentsList'))}
        <textarea name="names" rows="8" required placeholder="${esc(t('studentsListPh'))}"></textarea>
      </label>
      <p class="muted small">${esc(t('studentsListHint'))}</p>`,
  });
  if (!form) return;
  const names = form.names.value.split('\n').map(s => s.trim()).filter(Boolean);
  for (const name of names) {
    await DB.put('students', { id: DB.uid(), groupId: group.id, name, createdAt: Date.now() });
  }
  toast(t('studentsAdded', { n: names.length }), 'success');
  render();
}

// ---------- экран: ученик ----------

async function viewStudent(id) {
  const student = await DB.get('students', id);
  if (!student) return notFound();
  const [group, works] = await Promise.all([DB.get('groups', student.groupId), DB.byIndex('works', 'studentId', id)]);
  works.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);

  const workRow = w => {
    const sc = w.result?.score;
    const info = checking.has(w.id) ? t('checking')
      : w.status === 'error' ? t('statusError')
      : sc ? t('pointsOf', { p: fmtNum(sc.total), max: sc.maxPoints, percent: sc.percent })
      : w.result ? t('statusDone')
      : `${t('statusNew')} · ${t('pointsMax', { max: w.maxPoints || Grading.DEFAULT_MAX })}`;
    return `
      <a class="work-row" href="#/work/${w.id}">
        ${gradeBadge(w)}
        <div class="work-main">
          <div class="work-title">${esc(w.title)}</div>
          <div class="muted small">${fmtDate(w.date)} · ${esc(info)}</div>
        </div>
        <span class="muted small">${(w.files || []).length ? `${icon('file')}${w.files.length}` : ''}</span>
      </a>`;
  };

  app.innerHTML = `
    ${crumbs([[t('groups'), '#/'], [group?.name || '?', `#/group/${student.groupId}`], [student.name]])}
    <div class="page-head">
      <div>
        <h1>${esc(student.name)}</h1>
        <p class="muted">${works.length} ${esc(t('worksCount'))} · ${esc(t('avgGrade'))}: ${average(works)}</p>
      </div>
      <div class="actions">
        <button class="btn primary" id="add-work">${icon('plus')}${esc(t('addWork'))}</button>
        <button class="btn ghost" id="edit-student" title="${esc(t('rename'))}">${icon('edit')}</button>
        <button class="btn ghost danger-text" id="del-student" title="${esc(t('deleteStudent'))}">${icon('trash')}</button>
      </div>
    </div>
    ${works.length ? `<div class="work-list">${works.map(workRow).join('')}</div>` : emptyState(t('noWorks'), t('noWorksStudentHint'))}`;

  $('#add-work').onclick = async () => addWork({ group, students: [student], studentId: student.id });
  $('#edit-student').onclick = async () => {
    const form = await modal({
      title: t('rename'),
      ok: t('save'),
      body: `<label class="field">${esc(t('studentName'))}<input name="name" required maxlength="120" value="${esc(student.name)}"></label>`,
    });
    if (!form) return;
    await DB.put('students', { ...student, name: form.name.value.trim() });
    render();
  };
  $('#del-student').onclick = async () => {
    if (!(await confirmBox(t('deleteStudent'), t('deleteStudentConfirm', { name: student.name })))) return;
    await DB.deleteStudent(student.id);
    toast(t('deleted'), 'success');
    location.hash = `#/group/${student.groupId}`;
  };
}

// ---------- добавление работы ----------

const maxPointsField = value => `
  <label class="field points-field">${esc(t('maxPoints'))}
    <div class="points-input">
      <input type="number" name="maxPoints" required min="1" max="100" step="1" inputmode="numeric" value="${esc(value)}">
      <span>${esc(t('pointsUnit'))}</span>
    </div>
    <span class="muted small hint">${esc(t('maxPointsHint'))}</span>
  </label>`;

async function addWork({ group, students, studentId, title }) {
  const groupWorks = await DB.byIndex('works', 'groupId', group.id);
  const titles = journalColumns(groupWorks).map(c => c.title);
  // Максимум баллов уже существующих работ с тем же названием
  const maxByTitle = new Map();
  [...groupWorks].sort((a, b) => a.createdAt - b.createdAt)
    .forEach(w => { if (w.maxPoints) maxByTitle.set(w.title, w.maxPoints); });
  const initialMax = maxByTitle.get(title) || Settings.get('lastMaxPoints') || Grading.DEFAULT_MAX;
  const picked = [];

  const renderFiles = form => {
    $('.file-list', form).innerHTML = picked.map((f, i) => `
      <li>
        ${icon('file')}<span class="fname">${esc(f.name)}</span><span class="muted small">${fmtSize(f.size)}</span>
        <button type="button" class="icon-btn small" data-remove="${i}" aria-label="${esc(t('delete'))}">${icon('x')}</button>
      </li>`).join('');
    $$('[data-remove]', form).forEach(b => (b.onclick = () => { picked.splice(Number(b.dataset.remove), 1); renderFiles(form); }));
  };

  const addFiles = (form, list) => {
    for (const f of list) {
      if (!Files.kindOf(f)) { toast(t('errUnsupported', { name: f.name }), 'error'); continue; }
      picked.push(f);
    }
    renderFiles(form);
  };

  const form = await modal({
    title: t('addWork'),
    ok: t('save'),
    wide: true,
    body: `
      <div class="grid-2">
        <label class="field">${esc(t('student'))}
          <select name="studentId" required>
            ${students.map(s => `<option value="${s.id}" ${s.id === studentId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field">${esc(t('date'))}
          <input type="date" name="date" required value="${today()}">
        </label>
      </div>
      <div class="grid-2 title-row">
        <label class="field">${esc(t('workTitle'))}
          <input name="title" required maxlength="80" list="work-titles" value="${esc(title || '')}" placeholder="${esc(t('workTitlePh'))}">
          <datalist id="work-titles">${titles.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
        </label>
        ${maxPointsField(initialMax)}
      </div>
      <div class="drop" tabindex="0">
        ${icon('upload')}
        <div><b>${esc(t('dropTitle'))}</b><div class="muted small">${esc(t('dropFormats'))}</div></div>
        <input type="file" name="files" multiple accept="${Files.ACCEPT}" hidden>
      </div>
      <ul class="file-list"></ul>
      <label class="field">${esc(t('orTypeText'))}
        <textarea name="text" rows="5" placeholder="${esc(t('textPh'))}"></textarea>
      </label>
      <label class="check"><input type="checkbox" name="checkNow" ${Settings.get('apiKey') ? 'checked' : ''}> ${esc(t('checkNow'))}</label>`,
    validate: f => (!picked.length && !f.text.value.trim() ? t('errNoInput') : null),
    onOpen: f => {
      const drop = $('.drop', f);
      const input = f.files;
      drop.onclick = () => input.click();
      drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
      input.onchange = () => { addFiles(f, input.files); input.value = ''; };
      drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); addFiles(f, e.dataTransfer.files); };
      f.title.addEventListener('input', () => {
        const known = maxByTitle.get(f.title.value.trim());
        if (known) f.maxPoints.value = known;
      });
      (title ? f.text : f.title).focus();
    },
  });
  if (!form) return;

  const work = {
    id: DB.uid(),
    groupId: group.id,
    studentId: form.studentId.value,
    title: form.title.value.trim(),
    date: form.date.value,
    maxPoints: Number(form.maxPoints.value),
    inputText: form.text.value.trim(),
    files: picked.map(f => ({ name: f.name, type: f.type, size: f.size, blob: f })),
    status: 'new',
    result: null,
    manualGrade: null,
    transcript: null,
    error: null,
    createdAt: Date.now(),
  };
  await DB.put('works', work);
  Settings.set('lastMaxPoints', work.maxPoints);
  toast(t('saved'), 'success');
  const checkNow = form.checkNow.checked;
  location.hash = `#/work/${work.id}`;
  if (checkNow) checkWork(work.id);
}

// ---------- проверка ----------

// Пересчёт баллов и оценки по ошибкам (после проверки и после правок учителя)
function reevaluate(r) {
  if (!r.aiCriteria) r.aiCriteria = Grading.aiCriteriaFrom(r.score);
  Object.assign(r, Grading.evaluate({
    aiCriteria: r.aiCriteria,
    errors: r.errors,
    maxPoints: r.maxPoints || r.score.maxPoints,
    scale: r.scale,
    capByNorms: r.capByNorms ?? false,
  }));
}

const hasTeacherEdits = r => (r?.errors || []).some(e => e.removed || e.byTeacher);

async function checkWork(id) {
  if (checking.has(id)) return;
  const key = Settings.get('apiKey');
  if (!key) {
    toast(t('noKeyBanner'), 'error');
    location.hash = '#/settings';
    return;
  }
  checking.add(id);
  render();
  let work = await DB.get('works', id);
  try {
    const group = await DB.get('groups', work.groupId);
    const texts = [];
    const inline = [];
    if (work.transcript) {
      texts.push(work.transcript); // текст, исправленный учителем
    } else {
      for (const f of work.files || []) {
        const r = await Files.extract(f);
        texts.push(...r.texts.filter(s => s.trim()));
        inline.push(...r.inline);
      }
      if (work.inputText) texts.push(work.inputText);
    }
    if (!texts.length && !inline.length) throw new Error(t('errNoContent'));

    // Выбранная модель, затем запасные: если Google отключил модель (404)
    // или она перегружена / не ответила вовремя — пробуем следующую.
    const selected = Settings.get('model');
    const models = [selected, ...AI.BACKUP_MODELS.filter(m => m !== selected)];
    const maxPoints = work.maxPoints || Grading.DEFAULT_MAX;
    const maxima = Grading.split(maxPoints);
    const request = { key, dictLang: group?.lang || 'ru', uiLang: I18n.lang, texts, inline, maxima };
    let ai;
    let model;
    for (let i = 0; i < models.length && !ai; i++) {
      model = models[i];
      try {
        ai = await AI.check({ ...request, model });
      } catch (e) {
        if (!AI.isRetryable(e) || i === models.length - 1) throw e;
        if (e.status === 404 && model === selected) Settings.set('model', models[i + 1]);
        toast(t('modelSwitched', { model: models[i + 1] }), 'info');
      }
    }

    work = await DB.get('works', id); // могли изменить, пока шла проверка
    if (!work) return;
    work.result = {
      recognizedText: ai.recognized_text,
      errors: ai.errors,
      aiCriteria: ai.criteria,
      summary: ai.summary,
      maxPoints,
      scale: { ...Settings.get('scale') },
      capByNorms: Settings.get('capByNorms'),
      model,
      checkedAt: Date.now(),
    };
    reevaluate(work.result);
    work.status = 'done';
    work.error = null;
    await DB.put('works', work);
    toast(t('checkDone'), 'success');
  } catch (e) {
    console.error(e);
    work = await DB.get('works', id);
    if (work) {
      work.status = 'error';
      work.error = e.message;
      await DB.put('works', work);
    }
    toast(e.message, 'error');
  } finally {
    checking.delete(id);
    render();
  }
}

// ---------- экран: работа ----------

// Подсветка ошибок в распознанном тексте
function highlight(text, errors) {
  const marks = [];
  const free = (s, e) => !marks.some(m => s < m.end && e > m.start);
  errors.forEach((err, i) => {
    if (!err.wrong || err.removed) return;
    const candidates = [];
    if (err.context && err.context.includes(err.wrong)) {
      let c = text.indexOf(err.context);
      while (c !== -1) {
        candidates.push(c + err.context.indexOf(err.wrong));
        c = text.indexOf(err.context, c + 1);
      }
    }
    let p = text.indexOf(err.wrong);
    while (p !== -1) {
      candidates.push(p);
      p = text.indexOf(err.wrong, p + 1);
    }
    const start = candidates.find(s => free(s, s + err.wrong.length));
    if (start !== undefined) marks.push({ start, end: start + err.wrong.length, err, i });
  });
  marks.sort((a, b) => a.start - b.start);
  let out = '';
  let cur = 0;
  for (const m of marks) {
    out += esc(text.slice(cur, m.start));
    out += `<mark class="err-${m.err.type}" title="${esc(`${m.err.correct} — ${m.err.rule}`)}">${esc(text.slice(m.start, m.end))}<sup>${m.i + 1}</sup></mark>`;
    cur = m.end;
  }
  return out + esc(text.slice(cur));
}

// Критерии: что правильно, за что и сколько снято
function criteriaHtml(r) {
  const sc = r.score;
  const cards = sc.criteria.map(c => {
    const ok = c.lost === 0;
    const pct = c.max ? Math.round((c.points / c.max) * 100) : 0;
    const deductions = c.deductions.map(d => {
      const e = d.error !== null ? r.errors[d.error] : null;
      return `
        <li>
          <span class="minus">−${fmtNum(d.points)}</span>
          <span>
            ${d.byTeacher ? `<span class="err-tag teacher">${esc(t('teacherTag'))}</span> ` : ''}
            ${e ? `<span class="err-fix"><s>${esc(e.wrong)}</s> <span class="arrow">→</span> <b>${esc(e.correct)}</b></span>${d.reason || e.rule ? ' — ' : ''}` : ''}
            ${esc(d.reason || e?.rule || (e ? '' : t('otherDeduction')))}
          </span>
        </li>`;
    }).join('');
    return `
      <div class="crit ${ok ? 'ok' : 'bad'}">
        <div class="crit-head">
          <span class="crit-icon">${icon(ok ? 'check' : 'x')}</span>
          <b class="crit-name">${esc(t('type_' + c.key))}</b>
          <span class="crit-pts">${fmtNum(c.points)} / ${c.max}</span>
          ${ok ? '' : `<span class="crit-lost">−${fmtNum(c.lost)}</span>`}
        </div>
        <div class="bar"><span style="width:${pct}%"></span></div>
        ${c.correct ? `<p class="crit-good"><b>${esc(t('doneRight'))}:</b> ${esc(c.correct)}</p>` : ''}
        ${deductions
          ? `<div class="crit-sub">${esc(t('deductedFor'))}:</div><ul class="deductions">${deductions}</ul>`
          : `<p class="crit-none">${esc(t('noDeductions'))}</p>`}
      </div>`;
  }).join('');
  const m = sc.maxima;
  return `
    <div class="crits">${cards}</div>
    <details class="rules">
      <summary>${esc(t('howScored'))}</summary>
      <ul>
        <li>${esc(t('ruleWeights', { s: m.spelling, p: m.punctuation, g: m.grammar }))}</li>
        <li>${esc(t('ruleGuide'))}</li>
        <li>${esc(t('ruleScoreAi', { model: r.model }))}</li>
        ${r.capByNorms ? `<li>${esc(t('ruleNorms'))}</li>` : ''}
        ${hasTeacherEdits(r) ? `<li>${esc(t('ruleTeacher'))}</li>` : ''}
      </ul>
    </details>`;
}

// Шкала перевода процента в оценку
function scaleHtml(r) {
  const sc = r.scale;
  const rows = [5, 4, 3, 2, 1].map(g => {
    const from = g === 1 ? 0 : sc[g];
    const to = g === 5 ? 100 : sc[g + 1] - 1;
    return `<tr class="${(r.scaleGrade ?? r.grade) === g ? 'active' : ''}"><td><span class="grade g${g}">${g}</span></td><td>${esc(t('scaleRow', { from, to }))}</td></tr>`;
  }).join('');
  return `<table class="norms scale"><tbody>${rows}</tbody></table>`;
}

// Ограничение оценки школьными нормами
function capHtml(r) {
  if (!r.capByNorms || !r.counts) return '';
  const vars = { s: r.counts.effSpelling, p: r.counts.effPunct, g: r.cap.grade, sg: r.scaleGrade };
  return r.cap.grade < r.scaleGrade
    ? `<div class="cap-note warn">${esc(t('capApplied', vars))}</div>`
    : `<div class="cap-note">${esc(t('capOk', vars))}</div>`;
}

// Список ошибок; editable — с кнопками правки учителя
function errorsHtml(errors, editable) {
  if (!errors.length) return `<p class="ok-text">${icon('check')} ${esc(t('noErrors'))}</p>`;
  const action = (e, i) => {
    if (e.byTeacher) return `<button class="link danger-link" data-delete-err="${i}">${esc(t('delete'))}</button>`;
    if (e.removed) return `<button class="link" data-restore-err="${i}">${esc(t('restoreError'))}</button>`;
    return `<button class="link" data-remove-err="${i}">${esc(t('notAnError'))}</button>`;
  };
  return `<ol class="errors">${errors.map((e, i) => `
    <li class="err-item ${e.repeat ? 'is-repeat' : ''} ${e.removed ? 'is-removed' : ''}">
      <div class="err-line">
        <span class="err-tag ${e.type}">${esc(t('type_' + e.type))}</span>
        ${e.severity === 'minor' ? `<span class="err-tag minor">${esc(t('minor'))}</span>` : ''}
        ${e.repeat ? `<span class="err-tag repeat">${esc(t('repeat'))}</span>` : ''}
        ${e.byTeacher ? `<span class="err-tag teacher">${esc(t('addedByTeacher'))} · −${fmtNum(e.points)}</span>` : ''}
        ${e.removed ? `<span class="err-tag teacher">${esc(t('removedByTeacher'))}</span>` : ''}
        ${editable ? `<span class="err-actions">${action(e, i)}</span>` : ''}
      </div>
      <div class="err-fix"><s>${esc(e.wrong)}</s> <span class="arrow">→</span> <b>${esc(e.correct)}</b></div>
      ${e.rule ? `<div class="muted small">${esc(e.rule)}</div>` : ''}
    </li>`).join('')}</ol>`;
}

// Окно «Добавить ошибку»: учитель добавляет то, что пропустил ИИ
async function addErrorModal(r) {
  const maxima = r.score.maxima;
  const types = Grading.CRITERIA.map(c => c.key).filter(k => maxima[k] > 0);
  const suggest = (type, severity) => Grading.guide(maxima[type])[severity];
  const form = await modal({
    title: t('addError'),
    ok: t('add'),
    body: `
      <div class="grid-2">
        <label class="field">${esc(t('errWrong'))}<input name="wrong" required maxlength="120" placeholder="${esc(t('errWrongPh'))}"></label>
        <label class="field">${esc(t('errCorrect'))}<input name="correct" required maxlength="120"></label>
        <label class="field">${esc(t('errType'))}
          <select name="type">${types.map(k => `<option value="${k}">${esc(t('type_' + k))}</option>`).join('')}</select>
        </label>
        <label class="field">${esc(t('errSeverity'))}
          <select name="severity"><option value="gross">${esc(t('gross'))}</option><option value="minor">${esc(t('minor'))}</option></select>
        </label>
      </div>
      <label class="field">${esc(t('errPoints'))}
        <input type="number" name="points" required min="0" step="0.5">
        <span class="muted small hint" data-points-hint></span>
      </label>
      <label class="field">${esc(t('errRule'))}<textarea name="rule" rows="2" maxlength="300"></textarea></label>`,
    validate: f => (Number(f.points.value) > maxima[f.type.value] ? t('errPointsTooMany', { max: maxima[f.type.value] }) : null),
    onOpen: f => {
      const update = () => {
        f.points.value = suggest(f.type.value, f.severity.value);
        f.points.max = maxima[f.type.value];
        $('[data-points-hint]', f).textContent = t('errPointsHint', { max: maxima[f.type.value] });
      };
      f.type.onchange = update;
      f.severity.onchange = update;
      update();
      f.wrong.focus();
    },
  });
  if (!form) return null;
  return {
    type: form.type.value,
    severity: form.severity.value,
    repeat: false,
    wrong: form.wrong.value.trim(),
    correct: form.correct.value.trim(),
    context: '',
    rule: form.rule.value.trim(),
    points: Number(form.points.value),
    byTeacher: true,
  };
}

async function viewWork(id) {
  const work = await DB.get('works', id);
  if (!work) return notFound();
  const [student, group] = await Promise.all([DB.get('students', work.studentId), DB.get('groups', work.groupId)]);
  const r = work.result;
  const busy = checking.has(id);
  const fg = finalGrade(work);

  const filesHtml = (work.files || []).map((f, i) => Files.isImage(f)
    ? `<a class="thumb" href="#" data-file="${i}" title="${esc(f.name)}"><img data-img="${i}" alt="${esc(f.name)}"></a>`
    : `<a class="file-chip" href="#" data-file="${i}">${icon('file')}<span>${esc(f.name)}</span><span class="muted small">${fmtSize(f.size)}</span></a>`).join('');

  app.innerHTML = `
    ${crumbs([[t('groups'), '#/'], [group?.name || '?', `#/group/${work.groupId}`], [student?.name || '?', `#/student/${work.studentId}`], [work.title]])}
    <div class="page-head">
      <div>
        <h1>${esc(work.title)}</h1>
        <p class="muted">${esc(student?.name || '')} · ${fmtDate(work.date)} · ${esc(t('pointsMax', { max: work.maxPoints || Grading.DEFAULT_MAX }))}</p>
      </div>
      <div class="actions">
        <button class="btn primary" id="check" ${busy ? 'disabled' : ''}>${icon(r ? 'refresh' : 'check')}${esc(r ? t('recheck') : t('check'))}</button>
        <button class="btn ghost" id="edit-work" title="${esc(t('edit'))}">${icon('edit')}</button>
        <button class="btn ghost danger-text" id="del-work" title="${esc(t('deleteWork'))}">${icon('trash')}</button>
      </div>
    </div>

    ${busy ? `<div class="notice loading"><span class="spinner"></span><div>${esc(t('checkingLong'))}</div></div>` : ''}
    ${!busy && work.status === 'error' ? `<div class="notice error"><div><b>${esc(t('checkFailed'))}</b><br>${esc(work.error)}</div></div>` : ''}
    ${!busy && !r && work.status !== 'error' ? `<div class="notice">${esc(t('notChecked'))}</div>` : ''}

    ${r ? `
      ${/lite/.test(r.model || '') ? `<div class="notice warn">${esc(t('liteWarning', { model: r.model }))}</div>` : ''}
      <div class="result-grid">
        <section class="panel grade-panel">
          <div class="grade-big g${fg}">${fg}</div>
          <div class="grade-caption">${esc(work.manualGrade ? t('manualGradeSet') : t('autoGradeLabel'))}</div>
          ${work.manualGrade ? `<p class="muted small">${esc(t('autoGradeWas', { g: r.grade }))}</p>` : ''}
          ${r.score ? `
            <div class="points-total"><b>${fmtNum(r.score.total)}</b> / ${r.score.maxPoints} <span>${esc(t('pointsUnit'))}</span></div>
            <div class="bar big"><span style="width:${r.score.percent}%"></span></div>
            <p class="muted small">${esc(t('scaleVerdict', { percent: r.score.percent, g: r.scaleGrade ?? r.grade }))}</p>
            ${scaleHtml(r)}
            ${capHtml(r)}` : ''}
          <label class="field compact">${esc(t('overrideGrade'))}
            <select id="manual">
              <option value="">${esc(t('byScale', { g: r.grade }))}</option>
              ${[5, 4, 3, 2, 1].map(g => `<option value="${g}" ${work.manualGrade === g ? 'selected' : ''}>${g}</option>`).join('')}
            </select>
          </label>
          ${r.summary ? `<p class="summary">${esc(r.summary)}</p>` : ''}
        </section>
        <section class="panel">
          <h2>${esc(t('criteriaTitle'))}</h2>
          ${r.score ? criteriaHtml(r) : `<div class="notice">${esc(t('legacyResult'))}</div>`}
        </section>
      </div>
      <section class="panel">
        <div class="panel-head">
          <h2>${esc(t('errorsTitle'))} <span class="count">${r.errors.filter(e => !e.removed).length}</span></h2>
          ${r.score ? `<button class="btn small" id="add-error">${icon('plus')}${esc(t('addError'))}</button>` : ''}
        </div>
        ${r.score ? `<p class="muted small edit-hint">${esc(t('editErrorsHint'))}</p>` : ''}
        ${errorsHtml(r.errors, Boolean(r.score))}
      </section>
      <section class="panel">
        <div class="panel-head">
          <h2>${esc(t('recognizedText'))}</h2>
          <button class="btn small" id="fix-text">${icon('edit')}${esc(t('fixTranscript'))}</button>
        </div>
        ${work.transcript ? `<p class="notice small-notice">${esc(t('usingTranscript'))} <button class="link" id="reset-text">${esc(t('resetTranscript'))}</button></p>` : ''}
        <div class="transcript">${highlight(r.recognizedText, r.errors)}</div>
        <p class="legend">
          <span><mark class="err-spelling">abc</mark> ${esc(t('type_spelling'))}</span>
          <span><mark class="err-punctuation">abc</mark> ${esc(t('type_punctuation'))}</span>
          <span><mark class="err-grammar">abc</mark> ${esc(t('type_grammar'))}</span>
        </p>
      </section>` : ''}

    <section class="panel">
      <h2>${esc(t('materials'))}</h2>
      ${filesHtml ? `<div class="files">${filesHtml}</div>` : ''}
      ${work.inputText ? `<div class="input-text">${esc(work.inputText)}</div>` : ''}
      ${!filesHtml && !work.inputText ? `<p class="muted">—</p>` : ''}
    </section>`;

  // превью изображений и открытие файлов
  const urls = [];
  $$('[data-img]').forEach(img => {
    const url = URL.createObjectURL(work.files[img.dataset.img].blob);
    urls.push(url);
    img.src = url;
  });
  $$('[data-file]').forEach(a => (a.onclick = e => {
    e.preventDefault();
    const f = work.files[a.dataset.file];
    const url = URL.createObjectURL(f.blob);
    const link = document.createElement('a');
    link.href = url;
    if (Files.isImage(f) || /pdf/i.test(f.type)) link.target = '_blank';
    else link.download = f.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }));
  window.addEventListener('hashchange', () => urls.forEach(URL.revokeObjectURL), { once: true });

  $('#check').onclick = async () => {
    if (hasTeacherEdits(r) && !(await confirmBox(t('recheck'), t('recheckLosesEdits'), t('recheck')))) return;
    checkWork(id);
  };

  // правка ошибок учителем: сразу пересчитываем баллы и оценку
  const editResult = async mutate => {
    const w = await DB.get('works', id);
    mutate(w.result);
    reevaluate(w.result);
    await DB.put('works', w);
    toast(t('recalculated', { total: fmtNum(w.result.score.total), max: w.result.score.maxPoints, g: w.result.grade }), 'success');
    render();
  };
  $$('[data-remove-err]').forEach(b => (b.onclick = () => editResult(res => { res.errors[b.dataset.removeErr].removed = true; })));
  $$('[data-restore-err]').forEach(b => (b.onclick = () => editResult(res => { delete res.errors[b.dataset.restoreErr].removed; })));
  $$('[data-delete-err]').forEach(b => (b.onclick = () => editResult(res => { res.errors.splice(Number(b.dataset.deleteErr), 1); })));
  const addErr = $('#add-error');
  if (addErr) addErr.onclick = async () => {
    const err = await addErrorModal(r);
    if (err) editResult(res => { res.errors.push(err); });
  };

  $('#del-work').onclick = async () => {
    if (!(await confirmBox(t('deleteWork'), t('deleteWorkConfirm', { name: work.title })))) return;
    await DB.deleteWork(id);
    toast(t('deleted'), 'success');
    location.hash = `#/student/${work.studentId}`;
  };
  $('#edit-work').onclick = async () => {
    const form = await modal({
      title: t('edit'),
      ok: t('save'),
      body: `
        <label class="field">${esc(t('workTitle'))}<input name="title" required maxlength="80" value="${esc(work.title)}"></label>
        <label class="field">${esc(t('date'))}<input type="date" name="date" required value="${esc(work.date)}"></label>
        ${maxPointsField(work.maxPoints || Grading.DEFAULT_MAX)}
        ${r?.score ? `<p class="muted small">${esc(t('maxPointsRecheck'))}</p>` : ''}`,
    });
    if (!form) return;
    await DB.put('works', { ...(await DB.get('works', id)), title: form.title.value.trim(), date: form.date.value, maxPoints: Number(form.maxPoints.value) });
    render();
  };
  const manual = $('#manual');
  if (manual) manual.onchange = async () => {
    const w = await DB.get('works', id);
    w.manualGrade = manual.value ? Number(manual.value) : null;
    await DB.put('works', w);
    render();
  };
  const fix = $('#fix-text');
  if (fix) fix.onclick = async () => {
    const form = await modal({
      title: t('fixTranscript'),
      ok: t('saveAndRecheck'),
      wide: true,
      body: `
        <p class="muted small">${esc(t('fixTranscriptHint'))}</p>
        <textarea name="text" rows="14" required class="mono">${esc(work.transcript || r.recognizedText)}</textarea>`,
    });
    if (!form) return;
    const w = await DB.get('works', id);
    w.transcript = form.text.value;
    await DB.put('works', w);
    checkWork(id);
  };
  const reset = $('#reset-text');
  if (reset) reset.onclick = async () => {
    const w = await DB.get('works', id);
    w.transcript = null;
    await DB.put('works', w);
    checkWork(id);
  };
}

// ---------- экран: настройки ----------

async function viewSettings() {
  const models = Settings.get('models');
  const current = Settings.get('model');
  const modelOptions = [...new Set([current, ...models.map(m => m.id)])]
    .map(m => `<option value="${esc(m)}" ${m === current ? 'selected' : ''}>${esc(m)}</option>`).join('');
  const scale = Settings.get('scale');

  app.innerHTML = `
    <div class="page-head"><div><h1>${esc(t('settings'))}</h1></div></div>

    <section class="panel">
      <h2>${icon('key')} ${esc(t('aiTitle'))}</h2>
      <ol class="steps">
        <li>${t('keyStep1')}</li>
        <li>${esc(t('keyStep2'))}</li>
        <li>${esc(t('keyStep3'))}</li>
      </ol>
      <label class="field">${esc(t('apiKey'))}
        <div class="input-row">
          <input type="password" id="api-key" autocomplete="off" spellcheck="false" value="${esc(Settings.get('apiKey'))}" placeholder="AIza...">
          <button type="button" class="btn ghost" id="toggle-key" title="${esc(t('show'))}">${icon('eye')}</button>
        </div>
      </label>
      <div class="actions left">
        <button class="btn primary" id="save-key">${esc(t('saveKey'))}</button>
      </div>
      <label class="field">${esc(t('model'))}
        <select id="model">${modelOptions}</select>
      </label>
      <p class="muted small">${esc(t('modelHint'))}</p>
      <p class="muted small">${esc(t('keyPrivacy'))}</p>
    </section>

    <section class="panel">
      <h2>${esc(t('scaleTitle'))}</h2>
      <p class="muted">${esc(t('scaleHelp'))}</p>
      <div class="norm-rows">
        ${[5, 4, 3, 2].map(g => `
          <label class="norm-row">
            <span class="grade g${g}">${g}</span>
            <span class="muted">${esc(t('scaleFrom'))}</span>
            <input type="number" min="0" max="100" step="1" data-grade="${g}" value="${esc(scale[g])}">
            <span class="muted">%</span>
          </label>`).join('')}
        <div class="norm-row"><span class="grade g1">1</span><span class="muted">${esc(t('scaleBelow'))}</span></div>
      </div>
      <label class="check"><input type="checkbox" id="opt-cap" ${Settings.get('capByNorms') ? 'checked' : ''}> ${esc(t('optCap'))}</label>
      <p class="muted small">${esc(t('normsText'))}</p>
      <p class="muted small">${esc(t('criteriaSplitInfo'))}</p>
      <p class="muted small">${esc(t('scaleNote'))}</p>
      <div class="actions left">
        <button class="btn primary" id="save-scale">${esc(t('save'))}</button>
        <button class="btn ghost" id="reset-scale">${esc(t('resetDefaults'))}</button>
      </div>
    </section>

    <section class="panel">
      <h2>${esc(t('dataTitle'))}</h2>
      <p class="muted">${esc(t('dataHelp'))}</p>
      <div class="actions left">
        <button class="btn" id="export">${icon('download')}${esc(t('export'))}</button>
        <button class="btn" id="import">${icon('upload')}${esc(t('import'))}</button>
        <input type="file" id="import-file" accept=".json,application/json" hidden>
        <button class="btn ghost danger-text" id="clear-all">${icon('trash')}${esc(t('clearAll'))}</button>
      </div>
    </section>`;

  const keyInput = $('#api-key');
  $('#toggle-key').onclick = () => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; };
  $('#save-key').onclick = async e => {
    const key = keyInput.value.trim();
    Settings.set('apiKey', key);
    if (!key) { toast(t('saved'), 'success'); return; }
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = t('checkingKey');
    try {
      const list = await AI.listModels(key);
      Settings.set('models', list);
      if (list.length && !list.some(m => m.id === Settings.get('model'))) {
        const preferred = list.find(m => m.id === AI.FALLBACK_MODEL)
          || list.find(m => /flash/.test(m.id) && !/lite|preview|exp/.test(m.id)) || list[0];
        Settings.set('model', preferred.id);
      }
      toast(t('keyOk', { n: list.length }), 'success');
      render();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = t('saveKey');
    }
  };
  $('#model').onchange = e => { Settings.set('model', e.target.value); toast(t('saved'), 'success'); };

  $('#save-scale').onclick = () => {
    const next = {};
    $$('[data-grade]').forEach(input => { next[input.dataset.grade] = Number(input.value); });
    if (!Grading.validScale(next)) { toast(t('errScale'), 'error'); return; }
    Settings.patch({ scale: next, capByNorms: $('#opt-cap').checked });
    toast(t('scaleSaved'), 'success');
  };
  $('#reset-scale').onclick = () => {
    Settings.patch({ scale: { ...Grading.DEFAULT_SCALE }, capByNorms: true });
    toast(t('scaleSaved'), 'success');
    render();
  };

  $('#export').onclick = async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const data = await DB.exportAll();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `dictant-backup-${today()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  };
  $('#import').onclick = () => $('#import-file').click();
  $('#import-file').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!(await confirmBox(t('import'), t('importConfirm'), t('import')))) return;
      await DB.importAll(data);
      toast(t('importDone'), 'success');
      location.hash = '#/';
    } catch (err) {
      toast(err instanceof SyntaxError ? t('errImportFormat') : err.message, 'error');
    }
  };
  $('#clear-all').onclick = async () => {
    if (!(await confirmBox(t('clearAll'), t('clearAllConfirm')))) return;
    await DB.clearAll();
    toast(t('deleted'), 'success');
    location.hash = '#/';
  };
}

// ---------- шапка: язык и тема ----------

const THEMES = ['auto', 'light', 'dark'];
const THEME_ICON = { auto: 'auto', light: 'sun', dark: 'moon' };

function applyTheme() {
  const theme = Settings.get('theme');
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const btn = $('#theme-btn');
  btn.innerHTML = icon(THEME_ICON[theme] || 'auto');
  btn.title = t('theme_' + theme);
  btn.setAttribute('aria-label', btn.title);
}

function applyLang() {
  I18n.setLang(Settings.get('uiLang'));
  document.documentElement.lang = I18n.lang;
  document.title = t('appTitle');
  $$('[data-i18n]').forEach(el => (el.textContent = t(el.dataset.i18n)));
  $$('[data-lang]').forEach(b => b.classList.toggle('active', b.dataset.lang === I18n.lang));
  applyTheme();
}

$$('[data-lang]').forEach(b => (b.onclick = () => {
  Settings.set('uiLang', b.dataset.lang);
  applyLang();
  render();
}));

$('#theme-btn').onclick = () => {
  const i = THEMES.indexOf(Settings.get('theme'));
  Settings.set('theme', THEMES[(i + 1) % THEMES.length]);
  applyTheme();
};

window.addEventListener('hashchange', render);

// Просим браузер не удалять наши данные при нехватке места
navigator.storage?.persist?.().catch(() => {});

if (!window.indexedDB) {
  app.innerHTML = `<div class="notice error">IndexedDB is not available in this browser.</div>`;
} else {
  applyLang();
  render();
}
