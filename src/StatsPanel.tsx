import type { AnsweredStats } from '../shared/types';
import { DIFFICULTY_COLORS, DIFFICULTY_ORDER, donutGradient, percentOf, totalAnswered } from './statsLogic';

export function StatsPanel({ stats }: { stats: AnsweredStats }) {
  const total = totalAnswered(stats);
  return (
    <section className="stats-panel" aria-label="Questions answered">
      <h2>Questions answered</h2>
      <div className="stats-body">
        <div className="donut" style={{ background: donutGradient(stats) }} role="img"
          aria-label={`${total} questions answered: ${DIFFICULTY_ORDER.map((difficulty) => `${stats[difficulty]} ${difficulty}`).join(', ')}`}>
          <div><b>{total}</b><small>{total === 1 ? 'question' : 'questions'}</small></div>
        </div>
        <ul className="difficulty-bars">
          {DIFFICULTY_ORDER.map((difficulty) => (
            <li key={difficulty} style={{ '--tone': DIFFICULTY_COLORS[difficulty] } as React.CSSProperties}>
              <span>{difficulty}</span><b>{stats[difficulty]}</b>
              <div className="bar"><i style={{ width: `${percentOf(stats, difficulty)}%` }} /></div>
            </li>
          ))}
        </ul>
      </div>
      {total === 0 && <p className="stats-empty">Answer a few questions and your history shows up here.</p>}
    </section>
  );
}
