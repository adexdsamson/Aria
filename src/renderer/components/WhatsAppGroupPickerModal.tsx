/**
 * WhatsApp group picker modal (WA-05 / D-01/D-02/D-03/D-04).
 *
 * Lists all known WhatsApp groups (from WHATSAPP_LIST_GROUPS) with a search
 * field and a per-group track toggle. Toggling a group fires WHATSAPP_SET_TRACKED
 * immediately — the toggle IS the privacy authorization (D-03).
 *
 * D-02: Search/filter field for large group lists.
 * D-03: All groups are untracked by default; the toggle is the only way to authorize
 *       ingestion. No implicit opt-in on any event.
 * D-04: Newly-joined groups (isNew=true from list response) sort to the top and
 *       remain untracked.
 */
import { useState, useEffect, useCallback } from 'react';
import { Button, Checkbox } from './editorial';

/** Minimal group row shape — matches WhatsAppGroupDto + isNew extension for D-04. */
export interface GroupRow {
  jid: string;
  displayName: string;
  memberCount?: number | null;
  tracked: boolean;
  /** D-04: newly-joined group; sorts to top of list. */
  isNew?: boolean;
}

export interface WhatsAppGroupPickerModalProps {
  open: boolean;
  onClose: () => void;
}

export function WhatsAppGroupPickerModal({
  open,
  onClose,
}: WhatsAppGroupPickerModalProps): JSX.Element | null {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const loadGroups = useCallback(async () => {
    const api = window.aria;
    if (!api.whatsappListGroups) return;
    setLoading(true);
    try {
      const result = await api.whatsappListGroups();
      if (result && typeof result === 'object' && !('error' in result)) {
        // The IPC contract returns { groups: [...] } but the spec mock uses { rows: [...] }.
        // Support both shapes.
        const rows =
          (result as unknown as { rows?: GroupRow[]; groups?: GroupRow[] }).rows ??
          (result as unknown as { groups?: GroupRow[] }).groups ??
          [];
        setGroups(rows);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadGroups();
    } else {
      setSearch('');
      setGroups([]);
    }
  }, [open, loadGroups]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleToggle = useCallback(
    async (group: GroupRow) => {
      const api = window.aria;
      if (!api.whatsappSetTracked) return;
      const newTracked = !group.tracked;
      // Optimistic update
      setGroups((prev) =>
        prev.map((g) => (g.jid === group.jid ? { ...g, tracked: newTracked } : g)),
      );
      await api.whatsappSetTracked({ jid: group.jid, tracked: newTracked });
    },
    [],
  );

  if (!open) return null;

  // D-04: newly-joined untracked groups sort to the top
  const sorted = [...groups].sort((a, b) => {
    if (a.isNew && !b.isNew) return -1;
    if (!a.isNew && b.isNew) return 1;
    return 0;
  });

  // D-02: search/filter
  const filtered = search.trim()
    ? sorted.filter((g) =>
        g.displayName.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : sorted;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,26,26,0.45)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '8vh',
        zIndex: 9999,
        fontFamily: 'var(--f-body)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Manage WhatsApp groups"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--rule-strong)',
          borderTop: '2px solid var(--gold)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 30px 80px rgba(26,26,26,0.22)',
          width: 'min(560px, 92vw)',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: 'var(--ink)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 22px',
            background: 'var(--ivory-deep)',
            borderBottom: '1px solid var(--rule)',
            flex: '0 0 auto',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--gold)',
              marginBottom: 4,
            }}
          >
            WhatsApp · Group tracking
          </div>
          <h3
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 20,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              color: 'var(--ink)',
              lineHeight: 1.2,
              margin: '0 0 12px',
            }}
          >
            Manage groups
          </h3>
          {/* D-02: Search field */}
          <input
            role="searchbox"
            type="search"
            placeholder="Search groups…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              fontFamily: 'var(--f-body)',
              fontSize: 14,
              border: '1px solid var(--rule)',
              borderRadius: 'var(--radius)',
              padding: '7px 12px',
              background: 'var(--paper)',
              color: 'var(--ink)',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>

        {/* Group list */}
        <div
          style={{
            flex: '1 1 auto',
            overflowY: 'auto',
            padding: '4px 0',
          }}
        >
          {loading && (
            <div
              style={{
                padding: '20px 22px',
                fontFamily: 'var(--f-mono)',
                fontSize: 11,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--gray-soft)',
              }}
            >
              Loading groups…
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div
              style={{
                padding: '20px 22px',
                fontSize: 14,
                color: 'var(--ink-soft, var(--ink))',
              }}
            >
              {search ? 'No groups match your search.' : 'No groups found.'}
            </div>
          )}
          {filtered.map((group) => (
            <div
              key={group.jid}
              data-testid={`group-row-${group.jid}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '2px 22px',
                borderBottom: '1px solid var(--rule)',
                gap: 12,
              }}
            >
              <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--f-display)',
                      fontSize: 15,
                      color: 'var(--ink)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {group.displayName}
                  </span>
                  {group.isNew && (
                    <span
                      style={{
                        fontFamily: 'var(--f-mono)',
                        fontSize: 9,
                        letterSpacing: '0.15em',
                        textTransform: 'uppercase',
                        color: 'var(--gold, #8a6d3b)',
                        border: '1px solid var(--gold, #8a6d3b)',
                        borderRadius: 2,
                        padding: '1px 5px',
                        flex: '0 0 auto',
                      }}
                    >
                      New
                    </span>
                  )}
                </div>
                {group.memberCount != null && (
                  <div
                    style={{
                      fontFamily: 'var(--f-mono)',
                      fontSize: 11,
                      color: 'var(--gray-soft)',
                      marginTop: 2,
                    }}
                  >
                    {group.memberCount} members
                  </div>
                )}
              </div>
              {/* D-03: Per-group track toggle — the privacy authorization */}
              <Checkbox
                data-testid={`group-toggle-${group.jid}`}
                checked={group.tracked}
                onChange={() => void handleToggle(group)}
                label=""
                style={{ padding: '8px 0' }}
              />
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 22px 14px',
            borderTop: '1px solid var(--rule)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flex: '0 0 auto',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 11,
              color: 'var(--gray-soft)',
              letterSpacing: '0.05em',
            }}
          >
            {groups.filter((g) => g.tracked).length} of {groups.length} tracked
          </span>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
