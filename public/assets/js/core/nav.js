// Programmatic navigation for components that don't receive a page context.
let router = null;
export const setRouter = (r) => { router = r; };
export const navigate = (to, opts) => (router ? router.navigate(to, opts) : (location.href = to));
