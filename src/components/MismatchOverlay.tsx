import type { MatchResult } from '../domain/matching';

interface MismatchOverlayProps {
  result: MatchResult;
  onRescan: () => void;
  onFlag: () => void;
}

export function MismatchOverlay({ result, onRescan, onFlag }: MismatchOverlayProps) {
  return (
    <div className="mismatch-overlay">
      <div className="mismatch-icon">✕</div>
      <div className="mismatch-title">MISMATCH</div>
      <div className="mismatch-subtitle">DO NOT use these labels. Check what differs below.</div>

      <table className="mismatch-table">
        <thead>
          <tr>
            <th></th>
            <th>Printed label</th>
            <th>Log sheet</th>
          </tr>
        </thead>
        <tbody>
          {result.comparisons.map((c) => (
            <tr key={c.field} className={c.ok ? 'row-ok' : 'row-bad'}>
              <td className="mismatch-field">
                {c.ok ? '✓' : '✕'} {c.field}
              </td>
              <td>{c.labelValue}</td>
              <td>{c.sheetValue}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mismatch-actions">
        <button className="btn btn-big btn-rescan" onClick={onRescan}>
          RE-SCAN (or just scan again)
        </button>
        <button className="btn btn-big btn-flag" onClick={onFlag}>
          FLAG FOR SUPERVISOR
        </button>
      </div>
    </div>
  );
}
