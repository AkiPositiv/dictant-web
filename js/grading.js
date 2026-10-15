'use strict';

// Подсчёт оценки по школьным нормам.
// Оценку ставит не ИИ, а этот модуль: ИИ только находит ошибки,
// а здесь они считаются и сравниваются с таблицей норм.
const Grading = (() => {
  // Нормы: для каждой оценки — допустимые сочетания «орфографические + пунктуационные».
  // Работа получает оценку, если укладывается хотя бы в одно сочетание.
  // Всё, что хуже нормы «2», — оценка «1».
  const DEFAULT_NORMS = {
    5: '0+0',
    4: '2+2; 1+3; 0+4',
    3: '4+4; 3+5; 0+7',
    2: '7+7; 6+8; 5+9; 8+6',
  };

  const DEFAULT_OPTIONS = {
    grammarAsSpelling: true, // грамматические ошибки считаются вместе с орфографическими
    minorPairs: true,        // две негрубые ошибки = одна грубая
    ignoreRepeats: true,     // повторная ошибка в том же слове не считается
  };

  // "2+2; 1+3" -> [[2,2],[1,3]]; null, если строка некорректна
  function parse(str) {
    const combos = [];
    for (const part of String(str ?? '').split(/[;,\n]+/)) {
      const s = part.trim();
      if (!s) continue;
      const m = s.match(/^(\d+)\s*\+\s*(\d+)$/);
      if (!m) return null;
      combos.push([Number(m[1]), Number(m[2])]);
    }
    return combos.length ? combos : null;
  }

  function combosFor(norms, grade) {
    return parse(norms?.[grade]) || parse(DEFAULT_NORMS[grade]);
  }

  function count(errors, options) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const c = {
      spelling: { gross: 0, minor: 0 },
      punctuation: { gross: 0, minor: 0 },
      grammar: { gross: 0, minor: 0 },
      repeats: 0,
    };
    for (const e of errors) {
      if (opts.ignoreRepeats && e.repeat) { c.repeats++; continue; }
      c[e.type][e.severity]++;
    }
    const effective = x => (opts.minorPairs ? x.gross + Math.floor(x.minor / 2) : x.gross + x.minor);
    c.effSpelling = effective(c.spelling) + (opts.grammarAsSpelling ? effective(c.grammar) : 0);
    c.effPunct = effective(c.punctuation);
    return c;
  }

  function grade(counts, norms) {
    for (const g of [5, 4, 3, 2]) {
      const hit = combosFor(norms, g).find(([s, p]) => counts.effSpelling <= s && counts.effPunct <= p);
      if (hit) return { grade: g, combo: hit };
    }
    return { grade: 1, combo: null };
  }

  return { DEFAULT_NORMS, DEFAULT_OPTIONS, parse, combosFor, count, grade };
})();
