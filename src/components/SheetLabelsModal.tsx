import { rollDisplayLabel } from '../domain/batchFamily';
import { useSheetPage } from '../data/SheetPageContext';

interface SheetLabelsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SheetLabelsModal({ open, onClose }: SheetLabelsModalProps) {
  const { activePage, sheetPhotoUrl } = useSheetPage();
  const batchNumbers = activePage.labels.map((l) => l.batchNumber);

  if (!open) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide">
        <div className="modal-header">
          <h2>
            {activePage.referenceNumber} — {activePage.title}
          </h2>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          {sheetPhotoUrl ? (
            <div className="sheet-photo-block">
              <div className="sheet-photo-title">Physical log sheet</div>
              <img
                className="sheet-photo-img"
                src={sheetPhotoUrl}
                alt={`Log sheet ${activePage.referenceNumber}`}
              />
            </div>
          ) : (
            <div className="sheet-photo-empty">
              No sheet photo yet — use <strong>Upload sheet photo</strong> to add a picture of the
              paper form.
            </div>
          )}

          <div className="sheet-rows-title">
            {activePage.labels.length} batch row{activePage.labels.length === 1 ? '' : 's'} — scan
            the parent (P) or each split (-02, -03…)
          </div>

          <table className="sheet-rows-table">
            <thead>
              <tr>
                <th>Roll</th>
                <th>Batch</th>
                <th>Product</th>
                <th>Item #</th>
                <th>Label code</th>
                <th>Qty</th>
                <th>DOM</th>
                <th>DOE</th>
              </tr>
            </thead>
            <tbody>
              {activePage.labels.map((label) => {
                const roll = rollDisplayLabel(label.batchNumber, batchNumbers);
                return (
                  <tr key={label.id}>
                    <td>
                      {roll === 'PARENT' ? (
                        <span className="roll-pill roll-parent">PARENT</span>
                      ) : roll ? (
                        <span className="roll-pill roll-split">{roll}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="sheet-card-batch">{label.batchNumber}</td>
                    <td>{label.productName}</td>
                    <td>{label.itemNumber}</td>
                    <td>{label.labelCode}</td>
                    <td>{label.quantity ?? '—'}</td>
                    <td>{label.dom ?? '—'}</td>
                    <td>{label.doe ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="sheet-card-hint">
            Each row will eventually get a QR:
            <code>FMIB001|1|batch|item|labelCode|qty|DOM|DOE</code>
            <br />
            Parent batch = no suffix (e.g. <strong>BO122232</strong>). Splits = dash + number (
            <strong>BO122232-02</strong>).
          </div>
        </div>
      </div>
    </div>
  );
}
