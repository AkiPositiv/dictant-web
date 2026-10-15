'use strict';

// Баллы и оценка.
// Максимум баллов работы делится между критериями. ИИ по каждому критерию
// указывает, что выполнено правильно и за какие ошибки сколько снять,
// а этот модуль пересчитывает арифметику, переводит процент в оценку 1–5
// и ограничивает её школьными нормами по числу ошибок.
// Учитель может отменить ошибку ИИ (removed) или добавить свою (byTeacher) —
// тогда evaluate() пересчитывает всё заново.
const Grading = (() => {
  const CRITERIA = [
    { key: 'spelling', weight: 0.5 },
    { key: 'punctuation', weight: 0.3 },
    { key: 'grammar', weight: 0.2 },
  ];
  const DEFAULT_MAX = 100;
  // Минимальный процент от максимума для каждой оценки; меньше порога «2» — оценка «1»
  const DEFAULT_SCALE = { 5: 90, 4: 75, 3: 50, 2: 25 };
  // Ориентир: доля максимума критерия, которую снимает одна ошибка
  const GROSS_SHARE = 0.1;
  const MINOR_SHARE = 0.05;
  // Школьные нормы для диктанта: допустимые сочетания «орфографические + пунктуационные»
  const NORMS = {
    5: [[0, 0]],
    4: [[2, 2], [1, 3], [0, 4]],
    3: [[4, 4], [3, 5], [0, 7]],
    2: [[7, 7], [6, 8], [5, 9], [8, 6]],
  };

  const round1 = n => Math.round(n * 10) / 10;
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  // 100 -> { spelling: 50, punctuation: 30, grammar: 20 }; остаток от округления — первым критериям
  function split(maxPoints) {
    const out = {};
    let used = 0;
    for (const c of CRITERIA) {
      out[c.key] = Math.floor(maxPoints * c.weight);
      used += out[c.key];
    }
    for (let i = 0; used < maxPoints; i = (i + 1) % CRITERIA.length, used++) out[CRITERIA[i].key]++;
    return out;
  }

  function guide(max) {
    return { gross: round1(max * GROSS_SHARE), minor: round1(max * MINOR_SHARE) };
  }

  // aiCriteria: [{ key, points, correct, deductions: [{ error (1-based), points, reason }] }]
  function score(aiCriteria, errors, maxPoints) {
    const maxima = split(maxPoints);
    const criteria = [];
    for (const { key } of CRITERIA) {
      const max = maxima[key];
      if (!max) continue;
      const ai = (aiCriteria || []).find(c => c.key === key) || {};
      const deductions = (ai.deductions || [])
        .map(d => ({
          points: round1(Math.max(0, Number(d.points) || 0)),
          reason: String(d.reason || ''),
          error: Number.isInteger(d.error) && d.error >= 1 && d.error <= errors.length ? d.error - 1 : null,
        }))
        .filter(d => d.points > 0 && !(d.error !== null && errors[d.error].removed));
      // ИИ снизил баллы, но не расписал за что — показываем разницу одной строкой
      if (!(ai.deductions || []).length && Number.isFinite(ai.points) && ai.points < max) {
        deductions.push({ points: round1(max - clamp(ai.points, 0, max)), reason: '', error: null });
      }
      errors.forEach((e, i) => {
        if (e.byTeacher && !e.removed && e.type === key && e.points > 0) {
          deductions.push({ points: round1(e.points), reason: e.rule, error: i, byTeacher: true });
        }
      });
      const lost = round1(deductions.reduce((s, d) => s + d.points, 0));
      criteria.push({
        key,
        max,
        points: round1(clamp(max - lost, 0, max)),
        lost: Math.min(lost, max),
        correct: String(ai.correct || ''),
        deductions,
      });
    }
    const total = round1(criteria.reduce((s, c) => s + c.points, 0));
    return { maxPoints, maxima, total, percent: Math.round((total / maxPoints) * 100), criteria };
  }

  // Подсчёт ошибок для норм: две негрубые = одна грубая, повторные не считаются,
  // грамматические идут вместе с орфографическими
  function count(errors) {
    const c = {
      spelling: { gross: 0, minor: 0 },
      punctuation: { gross: 0, minor: 0 },
      grammar: { gross: 0, minor: 0 },
      repeats: 0,
    };
    for (const e of errors) {
      if (e.removed) continue;
      if (e.repeat) { c.repeats++; continue; }
      c[e.type][e.severity]++;
    }
    const eff = x => x.gross + Math.floor(x.minor / 2);
    c.effSpelling = eff(c.spelling) + eff(c.grammar);
    c.effPunct = eff(c.punctuation);
    return c;
  }

  function normsCap(counts) {
    for (const g of [5, 4, 3, 2]) {
      const hit = NORMS[g].find(([s, p]) => counts.effSpelling <= s && counts.effPunct <= p);
      if (hit) return { grade: g, combo: hit };
    }
    return { grade: 1, combo: null };
  }

  function gradeFor(percent, scale) {
    for (const g of [5, 4, 3, 2]) if (percent >= scale[g]) return g;
    return 1;
  }

  // Полный расчёт результата: баллы, оценка по шкале, ограничение нормами, итог
  function evaluate({ aiCriteria, errors, maxPoints, scale, capByNorms }) {
    const sc = score(aiCriteria, errors, maxPoints);
    const counts = count(errors);
    const scaleGrade = gradeFor(sc.percent, scale);
    const cap = normsCap(counts);
    const grade = capByNorms ? Math.min(scaleGrade, cap.grade) : scaleGrade;
    return { score: sc, counts, scaleGrade, cap, grade };
  }

  // Для результатов, сохранённых до появления ручной правки: восстанавливаем ответ ИИ из баллов
  function aiCriteriaFrom(score) {
    return score.criteria.map(c => ({
      key: c.key,
      points: c.points,
      correct: c.correct,
      deductions: c.deductions.filter(d => !d.byTeacher)
        .map(d => ({ error: d.error === null ? null : d.error + 1, points: d.points, reason: d.reason })),
    }));
  }

  const validScale = s => [5, 4, 3, 2].every(g => Number.isFinite(s[g]) && s[g] >= 0 && s[g] <= 100)
    && s[5] > s[4] && s[4] > s[3] && s[3] > s[2];

  return {
    CRITERIA, DEFAULT_MAX, DEFAULT_SCALE, NORMS,
    split, guide, score, count, normsCap, gradeFor, evaluate, aiCriteriaFrom, validScale,
  };
})();
