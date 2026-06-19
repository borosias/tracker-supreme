if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const scope = import.meta.env.BASE_URL
    navigator.serviceWorker
      .register(`${scope}sw.js`, { scope })
      .catch((error) => {
        console.warn('Service worker registration failed', error)
      })
  })
}
