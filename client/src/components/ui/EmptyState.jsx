export default function EmptyState({ label, hint }) {
  return (
    <div className="empty-state" role="status">
      <span className="empty-state-icon" aria-hidden />
      <p className="empty-state-title">{label}</p>
      {hint ? <p className="empty-state-hint">{hint}</p> : null}
    </div>
  );
}
