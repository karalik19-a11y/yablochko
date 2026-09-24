import { useEffect, useState } from 'react';

/** Минимальный hash-роутер: '#/overview'. */
export function useHashRoute(): [string, (route: string) => void] {
  const read = () => {
    const h = window.location.hash.replace(/^#\/?/, '');
    return h === '' ? 'overview' : h;
  };
  const [route, setRoute] = useState<string>(read);

  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = (r: string) => {
    window.location.hash = `/${r}`;
  };

  return [route, navigate];
}
