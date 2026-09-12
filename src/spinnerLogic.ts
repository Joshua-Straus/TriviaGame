export interface SpinnerTeams {
  one: string[];
  two: string[];
}

export function teamForAssignment(index: number): 'one' | 'two' {
  return index % 2 === 0 ? 'one' : 'two';
}

export function assignInAlternatingOrder(names: string[]): SpinnerTeams {
  return names.reduce<SpinnerTeams>((teams, name, index) => {
    teams[teamForAssignment(index)].push(name);
    return teams;
  }, { one: [], two: [] });
}
