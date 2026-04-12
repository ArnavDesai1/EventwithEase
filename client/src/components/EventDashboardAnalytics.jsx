/**
 * Lightweight SVG + CSS analytics for organiser event dashboard (no chart library).
 */
export default function EventDashboardAnalytics({ analytics, eventTitle }) {
  if (!analytics) return null;

  const {
    ticketStatusBreakdown = {},
    registrationsByDay = [],
    checkInByDay = [],
    checkInRate,
    reviewAverage,
    reviewCount,
  } = analytics;

  const totalTickets =
    (ticketStatusBreakdown.booked || 0) +
    (ticketStatusBreakdown.checkedIn || 0) +
    (ticketStatusBreakdown.refunded || 0) +
    (ticketStatusBreakdown.expired || 0);

  const funnel = [
    { key: "checkedIn", label: "Checked in", count: ticketStatusBreakdown.checkedIn || 0, color: "var(--teal)" },
    { key: "booked", label: "Not yet in", count: ticketStatusBreakdown.booked || 0, color: "rgba(62, 207, 184, 0.35)" },
    { key: "refunded", label: "Refunded", count: ticketStatusBreakdown.refunded || 0, color: "rgba(232, 168, 87, 0.45)" },
    { key: "expired", label: "Expired", count: ticketStatusBreakdown.expired || 0, color: "rgba(150, 150, 160, 0.5)" },
  ];

  function barChartData(rows, label) {
    if (!rows.length) return { max: 0, rows: [], label };
    const max = Math.max(...rows.map((r) => r.count), 1);
    return { max, rows, label };
  }

  const regChart = barChartData(registrationsByDay, "Tickets issued by day");
  const inChart = barChartData(checkInByDay, "Check-ins by day");

  function MiniBars({ chart, variant = "reg" }) {
    if (!chart.rows.length) {
      return <p className="analytics-empty">No data yet for this view.</p>;
    }
    const w = 320;
    const h = 72;
    const pad = 4;
    const barW = Math.max(4, (w - pad * 2) / chart.rows.length - 2);
    return (
      <svg
        className={`analytics-svg analytics-svg--${variant}`}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {chart.rows.map((row, i) => {
          const bh = (row.count / chart.max) * (h - 18);
          const x = pad + i * (barW + 2);
          const y = h - 14 - bh;
          return (
            <g key={row.date}>
              <title>{`${row.date}: ${row.count}`}</title>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(bh, row.count > 0 ? 2 : 0)}
                rx={2}
                fill="currentColor"
                className="analytics-bar"
              />
            </g>
          );
        })}
      </svg>
    );
  }

  return (
    <div className="event-dashboard-analytics">
      <h3 className="analytics-title">Performance · {eventTitle || "Event"}</h3>
      <div className="analytics-summary-row">
        {checkInRate != null ? (
          <div className="analytics-pill">
            <strong>{checkInRate}%</strong>
            <span>check-in rate</span>
          </div>
        ) : null}
        {reviewCount > 0 ? (
          <div className="analytics-pill">
            <strong>{reviewAverage}★</strong>
            <span>
              {reviewCount} public review{reviewCount === 1 ? "" : "s"}
            </span>
          </div>
        ) : (
          <div className="analytics-pill analytics-pill--muted">
            <span>No public reviews yet</span>
          </div>
        )}
      </div>

      <div className="analytics-funnel" role="img" aria-label="Ticket status breakdown">
        <p className="analytics-chart-label">Ticket status</p>
        <div className="analytics-funnel-bars">
          {funnel.map((f) => {
            const pct = totalTickets > 0 ? Math.round((f.count / totalTickets) * 1000) / 10 : 0;
            return (
              <div key={f.key} className="analytics-funnel-row">
                <span className="analytics-funnel-label">{f.label}</span>
                <div className="analytics-funnel-track">
                  <div className="analytics-funnel-fill" style={{ width: `${pct}%`, background: f.color }} />
                </div>
                <span className="analytics-funnel-count">
                  {f.count} ({pct}%)
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="analytics-charts-grid">
        <div className="analytics-chart-block">
          <p className="analytics-chart-label">{regChart.label}</p>
          <MiniBars chart={regChart} variant="reg" />
          {regChart.rows.length > 0 ? (
            <div className="analytics-x-labels">
              {regChart.rows.map((r) => (
                <span key={r.date} title={r.date}>
                  {r.date.slice(5)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="analytics-chart-block">
          <p className="analytics-chart-label">{inChart.label}</p>
          <MiniBars chart={inChart} variant="in" />
          {inChart.rows.length > 0 ? (
            <div className="analytics-x-labels">
              {inChart.rows.map((r) => (
                <span key={r.date} title={r.date}>
                  {r.date.slice(5)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
