/*
 * Start-up check. If the app hasn't appeared within 12 seconds (a blocked or failed script,
 * or bad saved data), replace the endless splash with what went wrong and two ways out.
 * A separate file because the page's security policy doesn't allow inline scripts.
 */
(function () {
  var errors = [];
  window.addEventListener('error', function (e) {
    var t = e.target && (e.target.src || e.target.href);
    errors.push(t ? 'Could not load ' + t : (e.message || 'Script error'));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    errors.push(String((e.reason && e.reason.message) || e.reason));
  });
  setTimeout(function () {
    if (window.__grantedReady) return;
    var sp = document.getElementById('splash');
    if (!sp) return;
    var box = document.createElement('div');
    box.setAttribute('role', 'alert');
    box.style.cssText = 'max-width:420px;margin:0 20px;background:#fff;color:#16202B;border-radius:14px;padding:18px;font:15px/1.5 system-ui,sans-serif';
    var h = document.createElement('b'); h.textContent = 'Granted didn’t finish loading.'; box.appendChild(h);
    var p = document.createElement('p'); p.style.margin = '8px 0';
    p.textContent = 'This is usually a browser extension, a company web filter, or old data saved by this browser. Try again, or reset this device’s demo data.';
    box.appendChild(p);
    var row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    function btn(label, fn) { var b = document.createElement('button'); b.textContent = label; b.style.cssText = 'min-height:44px;padding:8px 14px;border-radius:10px;border:1px solid #0133A2;background:#0133A2;color:#fff;font:600 14px system-ui,sans-serif;cursor:pointer'; b.addEventListener('click', fn); row.appendChild(b); return b; }
    btn('Try again', function () { location.reload(); });
    btn('Reset demo data', function () { location.href = location.pathname + '?reset'; }).style.background = '#5F6B78';
    box.appendChild(row);
    var d = document.createElement('pre');
    d.style.cssText = 'white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace;color:#5F6B78;margin:12px 0 0';
    d.textContent = 'Details for support:\n' + (errors.length ? errors.slice(0, 5).join('\n') : 'No error reported; the app is still starting.') + '\n' + navigator.userAgent;
    box.appendChild(d);
    var bar = sp.querySelector('.bar'); if (bar) bar.remove();
    sp.appendChild(box);
  }, 12000);
})();
