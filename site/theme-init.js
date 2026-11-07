// Aplica el tema elegido antes de pintar. Sin elección guardada manda el del sistema (CSS).
try {
  var saved = localStorage.getItem('compass-theme');
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.setAttribute('data-theme', saved);
  }
} catch (e) {
  // Almacenamiento bloqueado: la página funciona igual con el tema del sistema.
}
