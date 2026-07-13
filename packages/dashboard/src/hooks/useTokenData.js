import { useState, useEffect } from 'react';

// Near-real-time: re-fetch tokens.json on an interval so the dashboard reflects
// the ingest watcher's latest write without a manual refresh. Cache-busting
// query param defeats any intermediary caching of the static file.
const POLL_MS = 8000;

export function useTokenData() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${import.meta.env.BASE_URL}tokens.json?t=${Date.now()}`)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then(d => {
          if (!alive) return;
          setData(d);
          setError(null);
        })
        .catch(e => {
          // Keep showing the last good data on a transient poll failure;
          // only surface an error if we never loaded anything.
          if (alive && !data) setError(e);
        });

    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, error };
}
