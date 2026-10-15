'use strict';

// Запросы к Google Gemini (бесплатный ключ: https://aistudio.google.com/apikey).
// ИИ распознаёт текст работы и находит ошибки; оценку считает grading.js.
const AI = (() => {
  const BASE = 'https://generativelanguage.googleapis.com/v1beta';
  const TIMEOUT_MS = 120000;
  const MAX_INLINE_BYTES = 19 * 1024 * 1024; // лимит запроса Gemini ~20 МБ

  // Псевдоним Google, который всегда указывает на актуальную flash-модель
  const FALLBACK_MODEL = 'gemini-flash-latest';
  // Запасные модели, если выбранная отключена, перегружена или не ответила вовремя
  const BACKUP_MODELS = [FALLBACK_MODEL, 'gemini-flash-lite-latest'];

  const TYPES = ['spelling', 'punctuation', 'grammar'];

  const SCHEMA = {
    type: 'OBJECT',
    properties: {
      recognized_text: { type: 'STRING' },
      errors: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            type: { type: 'STRING', enum: TYPES },
            severity: { type: 'STRING', enum: ['gross', 'minor'] },
            repeat: { type: 'BOOLEAN' },
            wrong: { type: 'STRING' },
            correct: { type: 'STRING' },
            rule: { type: 'STRING' },
            context: { type: 'STRING' },
          },
          required: ['type', 'severity', 'repeat', 'wrong', 'correct', 'rule'],
          propertyOrdering: ['type', 'severity', 'repeat', 'wrong', 'correct', 'context', 'rule'],
        },
      },
      summary: { type: 'STRING' },
    },
    required: ['recognized_text', 'errors', 'summary'],
    propertyOrdering: ['recognized_text', 'errors', 'summary'],
  };

  const LANG_NAMES = {
    ru: 'Russian',
    uz: 'Uzbek (the text may be written in Latin or Cyrillic script; check it by the official orthography rules of the script used)',
  };
  const EXPLAIN_LANG = { ru: 'Russian', uz: 'Uzbek (Latin script)' };

  function buildPrompt({ dictLang, uiLang, texts, inlineCount }) {
    const lines = [
      `You are an experienced school teacher of the ${LANG_NAMES[dictLang] || LANG_NAMES.ru} language. You are checking a student's dictation.`,
      '',
      'STEP 1 — transcription. Put the student\'s text into "recognized_text" EXACTLY as the student wrote it:',
      'keep every mistake, the original spelling, punctuation, capital letters and paragraphs. Do NOT correct anything in the transcription.',
      'If a word cannot be read, write [?] in its place. If there are several pages/images, they go in order — join them into one text.',
      '',
      'STEP 2 — errors. Find all real errors according to the current official rules and put them into "errors":',
      '- type: "spelling" (орфографическая), "punctuation" (пунктуационная) or "grammar" (грамматическая: agreement, word forms, government, etc.).',
      '- severity: "minor" for non-gross errors as defined by school grading norms (негрубые ошибки: exceptions to rules, capital letters in compound proper names,',
      '  hyphenated/joint/separate spelling of complex adverbs, difficult cases of не/ни, и/ы after prefixes, missing comma in rare constructions, etc.); otherwise "gross".',
      '- repeat: true if this is the same mistake in the same word that is already listed earlier (повторяющаяся ошибка); otherwise false.',
      '- wrong: the erroneous fragment copied character-for-character from recognized_text (1–3 words, so it can be found by text search).',
      '  For a missing punctuation mark, give the words around the place where it is missing.',
      '- correct: the corrected fragment.',
      '- context: 3–6 words around the error, copied from recognized_text.',
      `- rule: a short explanation of the rule in ${EXPLAIN_LANG[uiLang] || EXPLAIN_LANG.ru}.`,
      'Do not invent errors. Do not mark stylistic choices or illegible places as errors. If there are no errors, return an empty list.',
      '',
      `STEP 3 — "summary": 1–3 sentences with an overall comment for the teacher in ${EXPLAIN_LANG[uiLang] || EXPLAIN_LANG.ru}.`,
      '',
      'Answer with JSON only.',
    ];
    if (inlineCount) {
      lines.push('', `The student's work is in the attached file(s) (${inlineCount}). Read the handwriting carefully.`);
    }
    texts.forEach((text, i) => {
      lines.push('', `=== STUDENT TEXT${texts.length > 1 ? ' #' + (i + 1) : ''} ===`, text, '=== END ===');
    });
    return lines.join('\n');
  }

  async function request(path, key, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch(`${BASE}/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (e) {
      const err = new Error(e.name === 'AbortError' ? t('errTimeout') : t('errNetwork'));
      err.timeout = e.name === 'AbortError';
      throw err;
    } finally {
      clearTimeout(timer);
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data.error?.message || resp.statusText || String(resp.status);
      let text;
      if (resp.status === 429) text = t('errQuota');
      else if (resp.status === 404) text = t('errModel');
      else if (resp.status === 401 || resp.status === 403 || /api key/i.test(msg)) text = t('errKey');
      else if (resp.status >= 500) text = t('errOverloaded');
      else text = t('errApi');
      const err = new Error(`${text} (${msg})`);
      err.status = resp.status;
      throw err;
    }
    return data;
  }

  async function listModels(key) {
    const data = await request('models?pageSize=1000', key);
    const skip = /(embedding|tts|image|live|audio|aqa|vision|learnlm|robotics|computer-use|banana|omni|transcribe|customtools)/i;
    return (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }))
      .filter(m => m.id.startsWith('gemini') && !skip.test(m.id))
      .sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }));
  }

  function normalize(res) {
    const str = v => (v == null ? '' : String(v));
    const errors = (Array.isArray(res.errors) ? res.errors : []).map(e => ({
      type: TYPES.includes(e.type) ? e.type : 'spelling',
      severity: e.severity === 'minor' ? 'minor' : 'gross',
      repeat: e.repeat === true,
      wrong: str(e.wrong),
      correct: str(e.correct),
      context: str(e.context),
      rule: str(e.rule),
    }));
    return { recognized_text: str(res.recognized_text), errors, summary: str(res.summary) };
  }

  async function check({ key, model, dictLang, uiLang, texts, inline }) {
    const inlineBytes = inline.reduce((sum, p) => sum + p.data.length * 0.75, 0);
    if (inlineBytes > MAX_INLINE_BYTES) throw new Error(t('errTooLarge'));

    const parts = [{ text: buildPrompt({ dictLang, uiLang, texts, inlineCount: inline.length }) }];
    inline.forEach(p => parts.push({ inlineData: { mimeType: p.mimeType, data: p.data } }));

    const data = await request(`models/${encodeURIComponent(model)}:generateContent`, key, {
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: SCHEMA },
    });

    const cand = data.candidates?.[0];
    if (!cand) throw new Error(data.promptFeedback?.blockReason ? t('errBlocked') : t('errEmpty'));
    const raw = (cand.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
    if (!raw) throw new Error(cand.finishReason === 'SAFETY' ? t('errBlocked') : t('errEmpty'));
    let res;
    try {
      res = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      try { res = JSON.parse(m ? m[0] : ''); } catch { throw new Error(t('errParse')); }
    }
    return normalize(res);
  }

  // Стоит ли повторить запрос на другой модели
  const isRetryable = e => e.timeout || e.status === 404 || e.status === 429 || e.status >= 500;

  return { FALLBACK_MODEL, BACKUP_MODELS, isRetryable, listModels, check };
})();
