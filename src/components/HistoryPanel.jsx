import { formatConfidence, statusMeta } from "../domain/status.js";

/**
 * HistoryPanel — the right sidebar showing the persistent detection log.
 *
 * Displays a scrollable table of detected plates (plate number, confidence,
 * timestamp), most recent first. Supports clearing the history.
 */
export default function HistoryPanel({
  history,
  clearHistory,
  frameCount,
  lastLatency,
  error,
}) {
  return (
    <aside className="results-pane" aria-live="polite">
      <div className="results-header">
        <div className="results-title">
          <h2>Detection Log</h2>
          <span className="count-badge">{history.length} found</span>
        </div>
        {history.length > 0 && (
          <span className="timestamp">
            Latest at{" "}
            {new Date(history[0].detectedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className="results-scroll-area">
        {error && (
          <div className="error-alert">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        )}

        {!error && history.length === 0 && (
          <div className="empty-state">
            <svg className="empty-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            <p>Waiting for plates…</p>
            <span>Detected plates will be saved here with timestamps. History persists across page refreshes.</span>
          </div>
        )}

        {history.length > 0 && (
          <div className="history-table-wrap">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Plate Number</th>
                  <th>OCR Confidence</th>
                  <th>Status</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry, index) => {
                  const meta = statusMeta(entry.status);

                  return (
                    <tr key={`${entry.detectedAt}-${index}`} className="history-row">
                      <td className="history-plate">{entry.plateNumber}</td>
                      <td className="history-conf">
                        {formatConfidence(entry.ocrConfidence ?? entry.confidence)}
                      </td>
                      <td className={`history-status history-status-${meta.tone}`}>
                        {entry.status ? meta.label : "—"}
                      </td>
                      <td className="history-time">
                        {new Date(entry.detectedAt).toLocaleTimeString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="results-footer">
        <div className="footer-stat">
          <span className="stat-value">{frameCount}</span>
          <span className="stat-label">Frames sent</span>
        </div>
        {lastLatency != null && (
          <div className="footer-stat">
            <span className="stat-value">{lastLatency}ms</span>
            <span className="stat-label">Request round trip</span>
          </div>
        )}
        {history.length > 0 && (
          <button className="btn-clear" onClick={clearHistory}>
            Clear log
          </button>
        )}
      </div>
    </aside>
  );
}
