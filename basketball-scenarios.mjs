import { buildBasketballReport } from './basketball-model.mjs';
import { basketballTotalLines } from './public/basketball-scenario-options.js';

// Optional exploratory lines reuse one fit. Defaults and sealed protocols are unchanged.
export function buildBasketballScenarios(options, selection = {}) {
  const period = selection.period || 'ft';
  if (!['ft', 'q1', 'ht'].includes(period)) throw new Error('Periodo de la linea no valido.');
  const custom = selection.line == null || selection.line === '' ? null : Number(selection.line);
  if (custom !== null && (!Number.isFinite(custom) || custom <= 0 || custom >= 500 || custom % 1 !== .5))
    throw new Error('Usa una linea de puntos terminada en .5, entre 0.5 y 499.5. Una linea entera puede tener devolucion.');
  return buildBasketballReport({ ...options,
    totalLines: basketballTotalLines(options.league, 'ft', period === 'ft' ? custom : null),
    quarterLines: basketballTotalLines(options.league, 'q1', period === 'q1' ? custom : null),
    halfLines: basketballTotalLines(options.league, 'ht', period === 'ht' ? custom : null) });
}
