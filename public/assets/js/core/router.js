// History-API router. Routes are "/path/:param" patterns mapped to page
// modules exporting render(ctx) -> Node (and optionally a cleanup function).
export function createRouter({ routes, outlet, onChange, notFound }) {
  const compiled = routes.map((route) => {
    const keys = [];
    const pattern = new RegExp("^" + route.path.replace(/\/:(\w+)/g, (_, key) => { keys.push(key); return "/([^/]+)"; }) + "/?$");
    return { ...route, keys, pattern };
  });
  let cleanup = null;
  let token = 0;

  async function render() {
    const current = ++token;
    const url = new URL(location.href);
    let match = null, params = {};
    for (const route of compiled) {
      const m = route.pattern.exec(url.pathname);
      if (m) {
        match = route;
        route.keys.forEach((key, i) => { params[key] = decodeURIComponent(m[i + 1]); });
        break;
      }
    }
    if (typeof cleanup === "function") { try { cleanup(); } catch { /* ignore */ } }
    cleanup = null;
    const route = match || notFound;
    const ctx = { params, query: Object.fromEntries(url.searchParams), url, navigate };
    onChange?.(route, ctx);
    let mod;
    try { mod = await route.load(); } catch (err) { console.error(err); }
    if (current !== token) return;
    const result = await mod?.render(ctx);
    if (current !== token) { if (typeof result?.cleanup === "function") result.cleanup(); return; }
    outlet.replaceChildren(result?.node || result || document.createTextNode(""));
    cleanup = result?.cleanup || null;
    if (!url.hash) window.scrollTo({ top: 0 });
  }

  function navigate(to, { replace = false } = {}) {
    const target = new URL(to, location.href);
    if (target.origin !== location.origin) { location.href = to; return; }
    if (target.href === location.href && !replace) return render();
    history[replace ? "replaceState" : "pushState"]({}, "", target.pathname + target.search + target.hash);
    return render();
  }

  // Intercept same-origin links without target/download.
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const a = event.target.closest?.("a[href]");
    if (!a || a.target || a.hasAttribute("download") || a.dataset.native !== undefined) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/")) return;
    const isAdmin = url.pathname === "/admin" || url.pathname.startsWith("/admin/");
    if (isAdmin !== (location.pathname === "/admin" || location.pathname.startsWith("/admin/"))) return;
    event.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  });
  window.addEventListener("popstate", render);

  return { render, navigate };
}
