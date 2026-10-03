// Search, filters and sort of the observation list. Pure, so it can be unit-tested (front/test).

export type ObservationSort = 'newest' | 'oldest' | 'due' | 'severity';
export type ObservationReviewFilter = 'pending' | 'validated' | 'rejected' | 'manual';
export type ObservationFilters = { q?: string; status?: string; severity?: string; lotId?: string; companyId?: string; review?: ObservationReviewFilter | ''; sort?: ObservationSort };

export type FilterableObservation = {
  title?: string | null; description?: string | null; reference?: string | null; requiredAction?: string | null;
  status: string; severity: string; dueDate?: string | null; createdAt?: string;
  reviewStatus?: string | null;
  lot?: { id: string; name: string } | null; company?: { id: string; name: string } | null;
};

// Value of the lot / company filters that selects observations with none.
export const NONE = 'none';
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
const REVIEW_STATUS: Record<string, string> = { pending: 'PENDING', validated: 'VALIDATED', rejected: 'REJECTED' };

// Case and accent insensitive.
export const normalize = (v?: string | null) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const time = (d?: string | null) => (d ? new Date(d).getTime() : 0);

export function filterObservations<T extends FilterableObservation>(rows: T[], f: ObservationFilters): T[] {
  const words = normalize(f.q).split(/\s+/).filter(Boolean);
  const out = rows.filter(o => {
    if (f.status && o.status !== f.status) return false;
    if (f.severity && o.severity !== f.severity) return false;
    if (f.lotId && (f.lotId === NONE ? Boolean(o.lot) : o.lot?.id !== f.lotId)) return false;
    if (f.companyId && (f.companyId === NONE ? Boolean(o.company) : o.company?.id !== f.companyId)) return false;
    if (f.review && (f.review === 'manual' ? Boolean(o.reviewStatus) : o.reviewStatus !== REVIEW_STATUS[f.review])) return false;
    if (!words.length) return true;
    // Every word typed must appear somewhere in the observation.
    const haystack = normalize([o.title, o.description, o.reference, o.requiredAction, o.lot?.name, o.company?.name].filter(Boolean).join(' '));
    return words.every(w => haystack.includes(w));
  });
  const newest = (a: T, b: T) => time(b.createdAt) - time(a.createdAt);
  const sort = f.sort || 'newest';
  return out.sort((a, b) => {
    if (sort === 'oldest') return -newest(a, b);
    // Observations without a due date go last.
    if (sort === 'due') return (a.dueDate ? time(a.dueDate) : Infinity) - (b.dueDate ? time(b.dueDate) : Infinity) || newest(a, b);
    if (sort === 'severity') return (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || newest(a, b);
    return newest(a, b);
  });
}

export const hasActiveFilters = (f: ObservationFilters) => Boolean(f.q?.trim() || f.status || f.severity || f.lotId || f.companyId || f.review);
