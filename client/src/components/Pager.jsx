import { useMemo } from 'react';

const WINDOW = 5;

/** Numbered pager matching the report/dashboard panels. */
export default function Pager({ page, pages, total, pageSize, onChange }) {
  const window = useMemo(() => {
    const start = Math.max(1, Math.min(page - Math.floor(WINDOW / 2), pages - WINDOW + 1));
    return Array.from({ length: Math.min(WINDOW, pages) }, (_, i) => start + i).filter((p) => p <= pages);
  }, [page, pages]);

  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const go = (target) => {
    if (target >= 1 && target <= pages && target !== page) onChange(target);
  };

  return (
    <div className="pagination">
      <div className="pagination-info">
        Showing {first}–{last} of {total} records
      </div>
      <div className="pagination-pages">
        <button className="page-btn" onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page">
          ‹
        </button>
        {window.map((p) => (
          <button
            key={p}
            className={`page-btn${p === page ? ' active' : ''}`}
            onClick={() => go(p)}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        ))}
        <button className="page-btn" onClick={() => go(page + 1)} disabled={page >= pages} aria-label="Next page">
          ›
        </button>
      </div>
    </div>
  );
}
