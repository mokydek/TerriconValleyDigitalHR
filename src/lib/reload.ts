/** Перезагрузить страницу так, чтобы получить свежую версию сайта, а не копию из кэша CDN (см. index.html) */
export function reloadFresh() {
  if (window.__janamenReload) window.__janamenReload()
  else window.location.reload()
}
