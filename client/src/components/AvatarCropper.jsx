import { useCallback, useEffect, useRef, useState } from 'react';

/** Exported avatar edge, in px. Square: every avatar slot renders it circular. */
const OUTPUT = 512;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

/**
 * Circular crop dialog. The image pans and zooms behind a fixed round window;
 * confirming renders the visible disc to a canvas and returns a Blob.
 */
export default function AvatarCropper({ file, onCancel, onConfirm }) {
  const [src, setSrc] = useState(null);
  const [natural, setNatural] = useState(null); // { w, h }
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const frameRef = useRef(null);
  const imgRef = useRef(null);
  const drag = useRef(null);

  // Object URL rather than a data URL — no base64 inflation for large photos.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const frameSize = () => frameRef.current?.clientWidth || 280;

  /** Smallest scale that still covers the circular frame. */
  const baseScale = useCallback(() => {
    if (!natural) return 1;
    return Math.max(frameSize() / natural.w, frameSize() / natural.h);
  }, [natural]);

  /** Keeps the image covering the frame, so no empty wedge can appear. */
  const clamp = useCallback(
    (next, z) => {
      if (!natural) return { x: 0, y: 0 };
      const k = baseScale() * z;
      const limitX = Math.max(0, (natural.w * k - frameSize()) / 2);
      const limitY = Math.max(0, (natural.h * k - frameSize()) / 2);
      return {
        x: Math.min(limitX, Math.max(-limitX, next.x)),
        y: Math.min(limitY, Math.max(-limitY, next.y)),
      };
    },
    [natural, baseScale]
  );

  useEffect(() => {
    setOffset((o) => clamp(o, zoom));
  }, [zoom, clamp]);

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, start: offset };
  }

  function onPointerMove(e) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    setOffset(clamp({ x: drag.current.start.x + dx, y: drag.current.start.y + dy }, zoom));
  }

  function onPointerUp(e) {
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  }

  function onWheel(e) {
    const next = zoom + (e.deltaY < 0 ? 0.15 : -0.15);
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));
  }

  async function confirm() {
    if (!natural || !imgRef.current) return;
    setBusy(true);
    setError('');

    try {
      const S = frameSize();
      const k = baseScale() * zoom;

      // Frame centre expressed in source-image pixels, then the square that
      // the frame covers at the current scale.
      const side = S / k;
      const sx = natural.w / 2 - offset.x / k - side / 2;
      const sy = natural.h / 2 - offset.y / k - side / 2;

      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const ctx = canvas.getContext('2d');

      // JPEG has no alpha; white keeps transparent source corners from going black.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, OUTPUT, OUTPUT);
      ctx.drawImage(imgRef.current, sx, sy, side, side, 0, 0, OUTPUT, OUTPUT);

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.9);
      });

      await onConfirm(blob);
    } catch {
      setError('Could not process that image.');
      setBusy(false);
    }
  }

  const k = natural ? baseScale() * zoom : 1;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Crop profile picture">
      <div className="modal-card">
        <div className="modal-head">
          <div className="section-title">Choose your picture</div>
          <div className="section-sub modal-sub">Drag to reposition, and zoom until the circle looks right.</div>
        </div>

        <div
          className="crop-frame"
          ref={frameRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {src && (
            <img
              ref={imgRef}
              src={src}
              alt=""
              draggable="false"
              className="crop-img"
              onLoad={(e) => setNatural({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
              style={
                natural
                  ? {
                      width: natural.w * k,
                      height: natural.h * k,
                      transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                    }
                  : { opacity: 0 }
              }
            />
          )}
          <div className="crop-mask" aria-hidden="true" />
        </div>

        <div className="crop-zoom">
          <span className="theme-color-title">Zoom</span>
          <input
            type="range"
            className="dim-slider"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step="0.01"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom"
          />
        </div>

        {error && <div className="dash-error modal-error" role="alert">{error}</div>}

        <div className="modal-actions">
          <button className="ghost-btn" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="save-btn" type="button" onClick={confirm} disabled={busy || !natural}>
            {busy ? 'Saving…' : 'Use this picture'}
          </button>
        </div>
      </div>
    </div>
  );
}
