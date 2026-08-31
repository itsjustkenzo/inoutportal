import sheet from '../assets/loading-cat.webp';

/**
 * The spinning-cat loading indicator.
 *
 * The artwork is a 4x2 sprite sheet, so two step animations run together: one
 * walks the columns, and a second at four times the duration flips the row
 * once the first four frames are done.
 *
 * `size` is the rendered frame width in px; the frame is 3:4, so the height
 * follows from it.
 */
export default function LoadingCat({ size = 96, label = 'Loading', className = '' }) {
  return (
    <span
      className={`loading-cat${className ? ` ${className}` : ''}`}
      style={{ '--cat-w': `${size}px`, backgroundImage: `url(${sheet})` }}
      role="img"
      aria-label={label}
    />
  );
}

/**
 * Full-panel cover for a section that is busy. Holds the layout still rather
 * than replacing the content, so nothing jumps when the work finishes.
 */
export function LoadingOverlay({ show, text = 'Loading…', size = 104 }) {
  if (!show) return null;
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-overlay-inner">
        <LoadingCat size={size} label={text} />
        <div className="loading-text">{text}</div>
      </div>
    </div>
  );
}
