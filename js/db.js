'use strict';

// Хранилище IndexedDB: группы, ученики, работы (вместе с самими файлами).
// Данные живут только в этом браузере на этом устройстве.
const DB = (() => {
  const NAME = 'dictant-web';
  const VERSION = 1;
  const STORES = ['groups', 'students', 'works'];
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(NAME, VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore('groups', { keyPath: 'id' });
          const students = db.createObjectStore('students', { keyPath: 'id' });
          students.createIndex('groupId', 'groupId');
          const works = db.createObjectStore('works', { keyPath: 'id' });
          works.createIndex('groupId', 'groupId');
          works.createIndex('studentId', 'studentId');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  const wrap = req => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  async function read(name, fn) {
    const db = await open();
    return wrap(fn(db.transaction(name).objectStore(name)));
  }

  async function write(names, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, 'readwrite');
      fn(tx);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  const all = name => read(name, s => s.getAll());
  const get = (name, id) => read(name, s => s.get(id));
  const byIndex = (name, index, value) => read(name, s => s.index(index).getAll(value));
  const put = (name, obj) => write([name], tx => tx.objectStore(name).put(obj));

  async function deleteGroup(id) {
    const [students, works] = await Promise.all([byIndex('students', 'groupId', id), byIndex('works', 'groupId', id)]);
    await write(STORES, tx => {
      tx.objectStore('groups').delete(id);
      students.forEach(s => tx.objectStore('students').delete(s.id));
      works.forEach(w => tx.objectStore('works').delete(w.id));
    });
  }

  async function deleteStudent(id) {
    const works = await byIndex('works', 'studentId', id);
    await write(['students', 'works'], tx => {
      tx.objectStore('students').delete(id);
      works.forEach(w => tx.objectStore('works').delete(w.id));
    });
  }

  const deleteWork = id => write(['works'], tx => tx.objectStore('works').delete(id));

  const clearAll = () => write(STORES, tx => STORES.forEach(n => tx.objectStore(n).clear()));

  // Резервная копия: файлы работ переводятся в base64, чтобы поместиться в JSON
  async function exportAll() {
    const [groups, students, works] = await Promise.all(STORES.map(all));
    const worksOut = [];
    for (const w of works) {
      const files = [];
      for (const f of w.files || []) {
        files.push({ name: f.name, type: f.type, size: f.size, data: await Files.toBase64(f.blob) });
      }
      worksOut.push({ ...w, files });
    }
    return { app: 'dictant-web', version: 1, exportedAt: new Date().toISOString(), groups, students, works: worksOut };
  }

  async function importAll(data) {
    if (!data || data.app !== 'dictant-web' || !Array.isArray(data.groups)) {
      throw new Error(t('errImportFormat'));
    }
    const works = (data.works || []).map(w => ({
      ...w,
      files: (w.files || []).map(f => ({ name: f.name, type: f.type, size: f.size, blob: Files.fromBase64(f.data, f.type) })),
    }));
    await write(STORES, tx => {
      STORES.forEach(n => tx.objectStore(n).clear());
      data.groups.forEach(g => tx.objectStore('groups').put(g));
      (data.students || []).forEach(s => tx.objectStore('students').put(s));
      works.forEach(w => tx.objectStore('works').put(w));
    });
  }

  return { uid, all, get, byIndex, put, deleteGroup, deleteStudent, deleteWork, clearAll, exportAll, importAll };
})();
