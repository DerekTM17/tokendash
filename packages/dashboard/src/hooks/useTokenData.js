import { useState, useEffect } from 'react';

export function useTokenData() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/token-dashboard/tokens.json')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch(setError);
  }, []);

  return { data, error };
}
