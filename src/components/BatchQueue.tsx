import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useAppData } from '../data/AppDataContext';
import { groupBatchesIntoFamilies, splitSuffix, type BatchFamilyGroup } from '../domain/batchFamily';
import { normalizeId } from '../domain/normalize';
import {
  familyOrderTotal,
  formatOrderTotal,
  formatRunQty,
  formatSplitQty,
} from '../domain/batchDisplay';
import type { FamilyCheckoutPhase } from '../domain/familyCheckout';
import { sortFamilies } from '../domain/queueSort';
import type { Batch, BatchStatus } from '../domain/types';
import { useSheetPage } from '../data/SheetPageContext';
import { useSession } from '../session/SessionContext';
import { D365UploadPanel } from './D365UploadPanel';

function formatTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const STATUS_LABEL: Record<BatchStatus, string> = {
  pending: 'WAITING',
  verified: 'VERIFIED',
  flagged: 'FLAGGED',
};

function familyStatusLabel(members: Batch[]): string {
  if (members.some((m) => m.status === 'flagged')) return STATUS_LABEL.flagged;
  if (members.every((m) => m.status === 'verified')) return STATUS_LABEL.verified;
  const done = members.filter((m) => m.status === 'verified').length;
  return `${done}/${members.length} done`;
}

function familyStatusClass(members: Batch[]): BatchStatus {
  if (members.some((m) => m.status === 'flagged')) return 'flagged';
  if (members.every((m) => m.status === 'verified')) return 'verified';
  return 'pending';
}

const ORDER_PHASE_PILL: Record<FamilyCheckoutPhase, string> = {
  scanning: 'OPEN',
  complete: 'BADGE TO FINISH',
};

/**
 * Operators know the batch number they were handed, and the run is long enough
 * that scrolling is the slow path. Batch number is matched on the normalized
 * form so `BO636845`, `bo 636845` and `636845` all land on the same row;
 * everything else is a plain case-insensitive contains.
 */
function familyMatchesSearch(family: BatchFamilyGroup, query: string): boolean {
  const plain = query.trim().toLowerCase();
  if (!plain) return true;
  const normalized = normalizeId(query);

  return family.members.some((m) => {
    if (normalized && m.batchNumberNorm.includes(normalized)) return true;
    if (m.productName?.toLowerCase().includes(plain)) return true;
    if (m.itemNumber?.toLowerCase().includes(plain)) return true;
    if (m.labelCode?.toLowerCase().includes(plain)) return true;
    return false;
  });
}

function rollPill(batch: Batch, isParentRow: boolean) {
  const suffix = splitSuffix(batch.batchNumber);
  if (isParentRow && !suffix) {
    return <span className="roll-pill roll-parent">PARENT</span>;
  }
  if (suffix) {
    return <span className="roll-pill roll-split">-{suffix}</span>;
  }
  return null;
}

interface BatchQueueProps {
  selectedBatchId: string | null;
  activeFamilyParentId: string | null;
  activeMemberBatchId: string | null;
  orderPhase: FamilyCheckoutPhase | null;
  onSelectFamily: (family: BatchFamilyGroup) => void;
  onOpenTestLabels?: () => void;
}

export function BatchQueue({
  selectedBatchId,
  activeFamilyParentId,
  activeMemberBatchId,
  orderPhase,
  onSelectFamily,
  onOpenTestLabels,
}: BatchQueueProps) {
  const { isAdmin } = useSession();
  const { importSessionsById } = useAppData();
  const { pageBatches, loading } = useSheetPage();
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const allFamilies = useMemo(() => {
    const grouped = groupBatchesIntoFamilies(pageBatches);
    return sortFamilies(grouped, 'delivery', importSessionsById);
  }, [pageBatches, importSessionsById]);

  const families = useMemo(
    () => (search.trim() ? allFamilies.filter((f) => familyMatchesSearch(f, search)) : allFamilies),
    [allFamilies, search],
  );

  // A scanner burst is just fast typing. If focus were still in the search box
  // when the operator scans the first label, the payload would land there
  // instead of the wedge input, so opening an order takes focus back.
  useEffect(() => {
    if (orderPhase) searchRef.current?.blur();
  }, [orderPhase]);

  const clearSearch = () => {
    setSearch('');
    searchRef.current?.blur();
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      clearSearch();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // Unambiguous hit — open it, so the common case is type-then-scan.
      if (families.length === 1) {
        onSelectFamily(families[0]);
        searchRef.current?.blur();
      }
    }
  };

  const verifiedCount = pageBatches.filter((b) => b.status === 'verified').length;
  const flaggedCount = pageBatches.filter((b) => b.status === 'flagged').length;
  const searching = search.trim().length > 0;

  const toggleFamily = (parentId: string) => {
    setExpandedFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  };

  const pct =
    pageBatches.length > 0 ? Math.round((verifiedCount / pageBatches.length) * 100) : 0;
  const totalLabels = pageBatches.length;

  const renderBatchRow = (
    batch: Batch,
    opts: {
      isParentHeader?: boolean;
      isChild?: boolean;
      hasChildren?: boolean;
      familyMembers?: Batch[];
      expanded?: boolean;
      familyTotal?: number | null;
      family?: BatchFamilyGroup;
      deliverySource?: Batch;
    },
  ) => {
    const {
      isParentHeader = false,
      isChild = false,
      hasChildren = false,
      familyMembers = [],
      expanded = false,
      familyTotal = null,
      family,
      deliverySource,
    } = opts;

    const sourceBatch = deliverySource ?? batch;
    const deliveryDisplay = isChild ? '' : (sourceBatch.deliveryDate ?? '');

    const memberCount = familyMembers.length || 1;
    const isSelected = batch.id === selectedBatchId;
    const isFamilyActive = !!family && family.parent.id === activeFamilyParentId;
    const isCurrentMember = batch.id === activeMemberBatchId;

    const statusClass = isParentHeader ? familyStatusClass(familyMembers) : batch.status;
    const statusText = isParentHeader
      ? hasChildren
        ? familyStatusLabel(familyMembers)
        : STATUS_LABEL[batch.status]
      : STATUS_LABEL[batch.status];

    const rowClass = [
      'queue-row',
      `queue-row-${statusClass}`,
      isChild ? 'queue-row-child' : '',
      isParentHeader && hasChildren ? 'queue-row-expandable' : '',
      isParentHeader && expanded ? 'queue-row-expanded' : '',
      isSelected ? 'queue-row-selected' : '',
      isFamilyActive ? 'queue-row-family-active' : '',
      isFamilyActive && orderPhase ? `queue-row-order-${orderPhase}` : '',
      isCurrentMember ? 'queue-row-member-active' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const handleRowClick = () => {
      if (isChild || !family) return;
      onSelectFamily(family);
    };

    return (
      <tr
        key={batch.id}
        className={rowClass}
        onClick={handleRowClick}
        aria-selected={isSelected || isCurrentMember}
      >
        <td>
          <span className={`status-indicator status-${isChild ? batch.status : statusClass}`}>
            <span className="status-lamp" aria-hidden />
            {isChild ? STATUS_LABEL[batch.status] : statusText}
          </span>
        </td>
        <td className={`queue-batch${isChild ? ' queue-batch-child' : ''}`}>
          {isParentHeader && hasChildren && (
            <button
              type="button"
              className="queue-expand-btn"
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse child batches' : 'Expand child batches'}
              onClick={(e) => {
                e.stopPropagation();
                toggleFamily(batch.id);
              }}
            >
              {expanded ? '▼' : '▶'}
            </button>
          )}
          {isChild && <span className="queue-indent" aria-hidden />}
          {rollPill(batch, isParentHeader && hasChildren)}
          <span className="queue-batch-number">{batch.batchNumber}</span>
          {isParentHeader && isFamilyActive && orderPhase && (
            <span className={`queue-order-pill queue-order-pill-${orderPhase}`}>
              {ORDER_PHASE_PILL[orderPhase]}
            </span>
          )}
          {isParentHeader && hasChildren && (
            <span className="queue-family-count">{familyMembers.length} labels</span>
          )}
        </td>
        <td className="queue-product">{batch.productName ?? ''}</td>
        <td>{batch.itemNumber ?? ''}</td>
        <td>{batch.labelCode ?? ''}</td>
        <td className="queue-qty-run">{formatRunQty(batch)}</td>
        <td className="queue-qty-split">{formatSplitQty(batch, memberCount)}</td>
        <td className="queue-qty-total">{formatOrderTotal(familyTotal)}</td>
        <td className="queue-delivery">{deliveryDisplay}</td>
        {isAdmin && (
          <td className="queue-verified">
            {batch.verifiedByName && (
              <>
                {batch.verifiedByName} · {formatTime(batch.verifiedAt)}
              </>
            )}
          </td>
        )}
      </tr>
    );
  };

  return (
    <section className="queue zone-panel main-floor-queue">
      <header className="queue-header">
        <div className="queue-header-left">
          <span className="zone-tag">Batch log</span>
          <h2 className="zone-title">Today&rsquo;s orders</h2>
          <div className="queue-search">
            <span className="queue-search-icon" aria-hidden>
              🔍
            </span>
            <input
              ref={searchRef}
              type="text"
              className="queue-search-input"
              placeholder="Search batch, product, item or label"
              aria-label="Search today's orders"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKeyDown}
            />
            {searching && (
              <button
                type="button"
                className="queue-search-clear"
                onClick={clearSearch}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        <div className="queue-header-right">
          <div className="queue-progress-summary">
            <div
              className="progress-ring-wrap"
              title={`${verifiedCount} of ${totalLabels} labels checked today`}
            >
              <svg className="progress-ring" viewBox="0 0 36 36">
                <path
                  className="progress-ring-bg"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="progress-ring-fill"
                  strokeDasharray={`${pct}, 100`}
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <span className="progress-ring-label">
                {verifiedCount}/{totalLabels || 0}
              </span>
            </div>
            <p className="queue-progress-text">
              <strong>{verifiedCount}</strong> of <strong>{totalLabels}</strong> labels checked
            </p>
          </div>
          {flaggedCount > 0 && (
            <span className="stat-chip stat-flagged">{flaggedCount} flagged</span>
          )}
        </div>
      </header>

      {isAdmin && (
        <div className="upload-zone">
          <D365UploadPanel onOpenTestLabels={onOpenTestLabels} />
        </div>
      )}

      <div className="table-zone">
        {loading ? (
          <div className="queue-empty">Loading…</div>
        ) : families.length === 0 ? (
          <div className="queue-empty">
            {searching ? (
              <>
                Nothing matches &ldquo;{search.trim()}&rdquo;.
                <button className="btn btn-ghost btn-sm" onClick={clearSearch}>
                  Clear search
                </button>
              </>
            ) : isAdmin ? (
              'Load the sample export or choose a D365 file to start.'
            ) : (
              'Waiting for an admin to load today\u2019s batches.'
            )}
          </div>
        ) : (
          <table
            className={`queue-table queue-table-families${isAdmin ? '' : ' queue-table-operator'}`}
          >
            <thead>
              <tr>
                <th>Status</th>
                <th>Batch</th>
                <th>Product</th>
                <th>Item #</th>
                <th>Label</th>
                <th title="Quantity for this label / production run">Run</th>
                <th title="Per-run split size from D365">Split</th>
                <th title="Total order quantity across all runs">Total</th>
                <th title="Scheduled delivery from D365">Delivery</th>
                {isAdmin && <th>Verified</th>}
              </tr>
            </thead>
            <tbody>
              {families.map((family) => {
                const hasChildren = family.children.length > 0;
                const expanded = expandedFamilies.has(family.parent.id);
                const familyTotal = familyOrderTotal(family.members);

                return (
                  <Fragment key={family.parent.id}>
                    {renderBatchRow(family.parent, {
                      isParentHeader: true,
                      hasChildren,
                      familyMembers: family.members,
                      expanded,
                      familyTotal,
                      family,
                      deliverySource: family.parent,
                    })}
                    {expanded &&
                      family.children.map((child) =>
                        renderBatchRow(child, {
                          isChild: true,
                          familyMembers: family.members,
                          familyTotal,
                          family,
                          deliverySource: family.parent,
                        }),
                      )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
