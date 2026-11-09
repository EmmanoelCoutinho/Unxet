// Escala da nota da pesquisa de satisfação (cada empresa escolhe, ex.: 1 a 5
// ou 0 a 10). Os relatórios já chegam convertidos para a escala atual.

export type SurveyScale = { min: number; max: number };

export const DEFAULT_SURVEY_SCALE: SurveyScale = { min: 1, max: 5 };

const EPSILON = 1e-9;

/** Posição da nota na escala: 0 = mínima, 1 = máxima. */
export const scoreRatio = (score: number, scale: SurveyScale) =>
  scale.max > scale.min ? (score - scale.min) / (scale.max - scale.min) : 0;

/** Menor nota que conta como satisfeito (quarto de cima: 4 em 1 a 5, 8 em 1 a 10). */
export const satisfiedFrom = (scale: SurveyScale) =>
  Math.ceil(scale.min + 0.75 * (scale.max - scale.min) - EPSILON);

/** Maior nota que conta como baixa (quarto de baixo: 2 em 1 a 5, 3 em 1 a 10). */
export const lowUpTo = (scale: SurveyScale) =>
  Math.floor(scale.min + 0.25 * (scale.max - scale.min) + EPSILON);

/** "4 e 5", "8 a 10", "1" */
export const scoreRangeLabel = (from: number, to: number) =>
  from === to ? String(from) : to === from + 1 ? `${from} e ${to}` : `${from} a ${to}`;

export const scaleLabel = (scale: SurveyScale) => `${scale.min} a ${scale.max}`;

export const csatLabel = (scale: SurveyScale) =>
  `CSAT (notas ${scoreRangeLabel(satisfiedFrom(scale), scale.max)})`;

export const lowScoresLabel = (scale: SurveyScale) => {
  const to = lowUpTo(scale);
  return to === scale.min ? `Nota ${to}` : `Notas ${scoreRangeLabel(scale.min, to)}`;
};

// Vermelho (nota mínima) até verde (nota máxima)
const SCORE_STOPS = ["#EF4444", "#F97316", "#F59E0B", "#22C55E", "#00D374"];

export const scoreColor = (score: number, scale: SurveyScale) => {
  const ratio = Math.min(1, Math.max(0, scoreRatio(score, scale)));
  return SCORE_STOPS[Math.round(ratio * (SCORE_STOPS.length - 1))];
};

/** Nota de uma avaliação: "8" ou, se respondida em outra escala, "4/5". */
export const formatAnsweredScore = (
  score: number,
  answeredScale: SurveyScale,
  currentScale: SurveyScale,
) =>
  answeredScale.min === currentScale.min && answeredScale.max === currentScale.max
    ? String(score)
    : `${score}/${answeredScale.max}`;
