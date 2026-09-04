/**
 * What a reader has to be told before trusting the split between factors.
 *
 * `decompose()` shows sequential (chained) attribution and computes LMDI
 * alongside as an oracle. Two different things can go wrong with that, and they
 * must not look the same on screen:
 *
 *   - `orderSensitive` — the oracle RAN and disagreed. The split is indicative.
 *   - `oracleSkipped`  — the oracle never ran, because LMDI needs every factor
 *     and both totals strictly positive. Nothing was cross-checked.
 *
 * Before this component existed only `orderSensitive` was rendered, so a
 * skipped check and a passed one displayed identically: silence. In a layer
 * whose whole thesis is "no statistic the data cannot support", presenting an
 * unchecked check as a clean one is the exact failure mode it exists to
 * prevent, so the skipped case gets its own note in its own tone.
 *
 * Shared by DriverDecomposition and InterventionPanel, which both decompose.
 */
export default function AttributionNotes({ orderSensitive, oracleSkipped }) {
  if (!orderSensitive && !oracleSkipped) return null;

  const base = {
    fontFamily: 'var(--f-body)', fontSize: 11.5, borderRadius: 8,
    padding: '10px 12px', marginBottom: 14, lineHeight: 1.5,
  };

  return (
    <>
      {orderSensitive && (
        <div style={{ ...base, color: 'var(--hot)', background: 'rgba(255,106,0,0.08)', border: '1px solid rgba(255,106,0,0.25)' }}>
          These periods differ too much for the attribution order to be ignored:
          a different factor order would tell a different story. Treat the split
          between factors as indicative, not exact — the total is still right.
        </div>
      )}
      {oracleSkipped && (
        <div style={{ ...base, color: 'var(--color-text-muted)', background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
          The order-independence check could not run here: it needs every factor
          and both totals above zero, and at least one of them was zero. So the
          split between factors has not been cross-checked at all — which is not
          the same as having checked it and found it sound. The total is still
          right.
        </div>
      )}
    </>
  );
}
