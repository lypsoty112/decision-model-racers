/*
 * The tournament scorecard shown beside the menu.
 *
 * `Scorecard` lists every entrant in `scorecard` order with their points from each round played (DNF
 * for a racer that did not finish, the place on hover), a dash for rounds still to come, and their
 * total. The header names the champion once every round is in, and the round to come until then.
 */
import { PLAYER_ID } from '../game/setup';
import { isComplete, pointsFor, scorecard, type Tournament } from '../game/tournament';
import { ordinal } from './format';

type ScorecardProps = { tournament: Tournament; onAbandon: () => void };

export function Scorecard({ tournament, onAbandon }: ScorecardProps) {
  const rows = scorecard(tournament);
  const complete = isComplete(tournament);
  return (
    <aside className="panel menu-results">
      <header className="menu-results-header">
        <h2>{complete ? `Champion: ${rows[0].name}` : `Tournament · round ${tournament.results.length + 1} of ${tournament.tracks.length}`}</h2>
        {!complete && (
          <button type="button" className="button secondary small" onClick={onAbandon}>
            Abandon
          </button>
        )}
      </header>
      {rows.length === 0 ? (
        <p className="hint">Scores appear after round 1.</p>
      ) : (
        <div className="scorecard-wrap">
          <table className="scorecard">
            <thead>
              <tr>
                <th />
                <th>Racer</th>
                {tournament.tracks.map((_, i) => (
                  <th key={i}>R{i + 1}</th>
                ))}
                <th>Pts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id} className={row.id === PLAYER_ID ? 'focused' : undefined}>
                  <td>{i + 1}</td>
                  <td className="scorecard-name">
                    <span className="swatch" style={{ background: row.color }} />
                    {row.name}
                  </td>
                  {tournament.tracks.map((_, round) => {
                    const place = row.places[round];
                    if (round >= tournament.results.length) return <td key={round} className="muted">–</td>;
                    return (
                      <td key={round} title={place === null ? 'Did not finish' : ordinal(place)}>
                        {place === null ? 'DNF' : pointsFor(place)}
                      </td>
                    );
                  })}
                  <td className="scorecard-total">{row.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </aside>
  );
}
