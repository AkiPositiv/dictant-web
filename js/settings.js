'use strict';

// Настройки хранятся в localStorage этого браузера (ключ API, модель, язык, тема, шкала оценки).
const Settings = (() => {
  const STORAGE_KEY = 'dictant-web:settings';
  const DEFAULTS = {
    apiKey: '',
    model: 'gemini-flash-latest',
    models: [],
    uiLang: (navigator.language || '').toLowerCase().startsWith('uz') ? 'uz' : 'ru',
    theme: 'auto',
    scale: { ...Grading.DEFAULT_SCALE },
    lastMaxPoints: Grading.DEFAULT_MAX,
  };

  let data = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    data = { ...DEFAULTS, ...saved, scale: { ...DEFAULTS.scale, ...(saved.scale || {}) } };
  } catch (e) {
    console.warn('Settings: cannot read localStorage', e);
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Settings: cannot write localStorage', e);
    }
  }

  return {
    get: key => data[key],
    set(key, value) { data[key] = value; save(); },
    patch(obj) { Object.assign(data, obj); save(); },
  };
})();
