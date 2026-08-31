/**
 * Blank rows that pad a paginated table out to a constant height, so a short
 * last page — or an empty/loading state — does not shrink the panel.
 *
 * `tall` matches tables whose rows carry an avatar block, which stand taller
 * than a plain text row.
 */
export default function FillerRows({ count, colSpan, tall = false, variant = '' }) {
  const cls = ['filler-row', tall && 'tall', variant].filter(Boolean).join(' ');
  return Array.from({ length: Math.max(0, count) }, (_, i) => (
    <tr key={`filler-${i}`} className={cls} aria-hidden="true">
      <td colSpan={colSpan} />
    </tr>
  ));
}

/**
 * How many blanks a page needs. The empty and loading states render a single
 * message row, so they pad to the same height as a full page.
 */
export const fillerCount = (pageSize, shown) => Math.max(0, pageSize - Math.max(1, shown));
