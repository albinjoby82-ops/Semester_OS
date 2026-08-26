import { useCallback, useEffect, useState } from "react";

/**
 * Minimal history-based router.
 *
 * Three routes do not justify a routing library, and Workers static assets
 * already serve the SPA fallback so real paths work without hash URLs.
 */
export type Route =
  | { name: "today" }
  | { name: "module"; code: string }
  | { name: "assessments" }
  | { name: "settings" }
  | { name: "glance" }
  | { name: "library" }
  | { name: "share" };

export function parseRoute(pathname: string): Route {
  const moduleMatch = /^\/modules\/([A-Za-z0-9]+)\/?$/.exec(pathname);
  if (moduleMatch?.[1]) {
    return { name: "module", code: moduleMatch[1].toUpperCase() };
  }
  if (/^\/assessments\/?$/.test(pathname)) return { name: "assessments" };
  if (/^\/settings\/?$/.test(pathname)) return { name: "settings" };
  if (/^\/glance\/?$/.test(pathname)) return { name: "glance" };
  if (/^\/library\/?$/.test(pathname)) return { name: "library" };
  if (/^\/share\/?$/.test(pathname)) return { name: "share" };
  return { name: "today" };
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case "module":
      return `/modules/${route.code}`;
    case "assessments":
      return "/assessments";
    case "settings":
      return "/settings";
    case "glance":
      return "/glance";
    case "share":
      return "/share";
    case "library":
      return "/library";
    default:
      return "/";
  }
}

export function useRoute(): {
  route: Route;
  navigate: (route: Route) => void;
} {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(window.location.pathname),
  );

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next: Route) => {
    window.history.pushState(null, "", hrefFor(next));
    setRoute(next);
    window.scrollTo(0, 0);
  }, []);

  return { route, navigate };
}

/**
 * Click handler for in-app links. Keeps the anchor a real href so it can be
 * opened in a new tab, middle-clicked, and read by assistive tech.
 */
export function linkProps(
  route: Route,
  navigate: (route: Route) => void,
): { href: string; onClick: (event: React.MouseEvent) => void } {
  return {
    href: hrefFor(route),
    onClick: (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
        return;
      }
      event.preventDefault();
      navigate(route);
    },
  };
}
