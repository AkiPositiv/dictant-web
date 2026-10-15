'use strict';

// Баллы и оценка.
// Максимум баллов работы делится между критериями. ИИ по каждому критерию
// указывает, что выполнено правильно и за какие ошибки сколько снять,
// а этот модуль пересчитывает арифметику и переводит процент в оценку 1–5.
const Grading = (() => {
  const CRITERIA = [
    { key: 'spelling', weight: 0.5 },
    { key: 'punctuation', weight: 0.3 },
    { key: 'grammar', weight: 0.2 },
  ];
  const DEFAULT_MAX = 100;
  // Минимальный процент от максимума для каждой оценки; меньше порога «2» — оценка «1»
  const DEFAULT_SCALE = { 5: 90, 4: 75, 3: 50, 2: 25 };
  // Ориентир для ИИ: доля максимума критерия, которую снимает одна ошибка
  const GROSS_SHARE = 0.1;
  const MINOR_SHARE = 0.05;

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

  // aiCriteria: [{ key, points, correct, deductions: [{ error, points, reason }] }]
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
        .filter(d => d.points > 0);
      // ИИ снизил баллы, но не расписал за что — показываем разницу одной строкой
      if (!deductions.length && Number.isFinite(ai.points) && ai.points < max) {
        deductions.push({ points: round1(max - clamp(ai.points, 0, max)), reason: '', error: null });
      }
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

  function gradeFor(percent, scale) {
    for (const g of [5, 4, 3, 2]) if (percent >= scale[g]) return g;
    return 1;
  }

  const validScale = s => [5, 4, 3, 2].every(g => Number.isFinite(s[g]) && s[g] >= 0 && s[g] <= 100)
    && s[5] > s[4] && s[4] > s[3] && s[3] > s[2];

  return { CRITERIA, DEFAULT_MAX, DEFAULT_SCALE, split, guide, score, gradeFor, validScale };
})();
