// Only mirror the QR image that the linked-device page is already displaying.
(() => {
  const canvas = document.querySelector('[data-ref] canvas, canvas[aria-label*="QR" i], canvas[aria-label*="scan" i], canvas[role="img"]');
  if (!canvas || canvas.width < 100 || canvas.width !== canvas.height) return '';
  return canvas.toDataURL('image/png');
})()
