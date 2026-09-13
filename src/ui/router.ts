export type Cleanup = () => void;

export interface Route {
  path: string;
  label: string;
  mount: (root: HTMLElement) => Cleanup | void;
}

export function startRouter(routes: Route[], outlet: HTMLElement, onChange: (route: Route) => void): void {
  let cleanup: Cleanup | void;

  const render = () => {
    const path = location.hash.replace(/^#\/?/, '') || routes[0].path;
    const route = routes.find((r) => r.path === path) ?? routes[0];
    if (cleanup) cleanup();
    outlet.replaceChildren();
    outlet.scrollTop = 0;
    cleanup = route.mount(outlet);
    document.title = `${route.label} · Partial`;
    onChange(route);
  };

  window.addEventListener('hashchange', render);
  render();
}
