import { useEffect, useMemo, useRef, useState } from 'react';
import { teamForAssignment } from './spinnerLogic';

interface Props {
  names: string[];
  onChange: (teams: { one: string[]; two: string[] }) => void;
}

const COLORS = ['#8b5cf6', '#06b6d4', '#f97316', '#ec4899', '#22c55e', '#eab308'];

function randomIndex(length: number): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % length;
}

export function TeamSpinner({ names, onChange }: Props) {
  const [remaining, setRemaining] = useState(names);
  const [teams, setTeams] = useState({ one: [] as string[], two: [] as string[] });
  const [running, setRunning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [target, setTarget] = useState<'one' | 'two'>('one');
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);
  useEffect(() => {
    if (!running) {
      setRemaining(names);
      setTeams({ one: [], two: [] });
      setTarget('one');
      onChange({ one: [], two: [] });
    }
  }, [names]); // eslint-disable-line react-hooks/exhaustive-deps

  const wheel = useMemo(() => {
    if (!remaining.length) return 'conic-gradient(#24234c 0deg 360deg)';
    const segment = 360 / remaining.length;
    return `conic-gradient(${remaining.map((_, index) => `${COLORS[index % COLORS.length]} ${index * segment}deg ${(index + 1) * segment}deg`).join(',')})`;
  }, [remaining]);

  const spinNext = (pool: string[], nextTeams: typeof teams) => {
    if (!pool.length) {
      setRunning(false);
      return;
    }
    const winnerIndex = randomIndex(pool.length);
    const nextTarget = teamForAssignment(nextTeams.one.length + nextTeams.two.length);
    const segment = 360 / pool.length;
    const destination = 360 - (winnerIndex * segment + segment / 2);
    setRotation((value) => {
      const currentPosition = ((value % 360) + 360) % 360;
      return value + 1080 + ((destination - currentPosition + 360) % 360);
    });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timerRef.current = window.setTimeout(() => {
      const winner = pool[winnerIndex];
      const newPool = pool.filter((_, index) => index !== winnerIndex);
      const newTeams = { ...nextTeams, [nextTarget]: [...nextTeams[nextTarget], winner] };
      const newTarget = teamForAssignment(nextTeams.one.length + nextTeams.two.length + 1);
      setRemaining(newPool);
      setTeams(newTeams);
      setTarget(newTarget);
      onChange(newTeams);
      timerRef.current = window.setTimeout(() => spinNext(newPool, newTeams), reduced ? 80 : 380);
    }, reduced ? 100 : 1250);
  };

  const start = () => {
    if (names.length < 2 || running) return;
    const resetTeams = { one: [] as string[], two: [] as string[] };
    setRemaining(names);
    setTeams(resetTeams);
    setTarget('one');
    setRunning(true);
    spinNext(names, resetTeams);
  };

  const reset = () => {
    window.clearTimeout(timerRef.current);
    setRunning(false);
    setRemaining(names);
    setTeams({ one: [], two: [] });
    setTarget('one');
    setRotation(0);
    onChange({ one: [], two: [] });
  };

  return (
    <section className="spinner-panel" aria-label="Team assignment spinner">
      <div className="wheel-wrap">
        <div className="wheel-pointer" aria-hidden="true" />
        <div className="wheel" style={{ background: wheel, transform: `rotate(${rotation}deg)` }}>
          {remaining.map((name, index) => {
            const angle = (360 / remaining.length) * index + 360 / remaining.length / 2;
            return <span key={name} style={{ transform: `rotate(${angle}deg) translateY(-39%)` }}>{name}</span>;
          })}
        </div>
        <div className="wheel-target">{remaining.length ? `Next: Team ${target === 'one' ? '1' : '2'}` : 'Done!'}</div>
      </div>
      <div className="spinner-actions">
        <button className="primary" onClick={start} disabled={running || names.length < 2}>Start spinner</button>
        <button className="ghost" onClick={reset} disabled={running && remaining.length > 0}>Reset</button>
      </div>
      <div className="rosters">
        <div><strong>Team 1</strong>{teams.one.map((name) => <span key={name}>{name}</span>)}</div>
        <div><strong>Team 2</strong>{teams.two.map((name) => <span key={name}>{name}</span>)}</div>
      </div>
    </section>
  );
}
