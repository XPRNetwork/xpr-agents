// Applies the saved theme before first paint so there is no flash.
// Stored value: "light" | "dark". Nothing stored = light (the site default).
//
// A file rather than an inline <script>: the Content-Security-Policy in next.config.js
// allows scripts from this origin only, with no 'unsafe-inline', so an injected inline
// script or event handler cannot run. Keeping this out of the HTML is what lets the
// policy stay that strict. It loads render-blocking in <head>, so it still runs first.
(function () {
  try {
    if (localStorage.getItem('theme') === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
