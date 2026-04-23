export default function SessionList({
  title,
  sessions = [],
  emptyText = 'No sessions',
  actionLabel = 'Join',
  onAction,
  onDelete,
  hideSubtitle = false,
}) {
  return (
    <section className="workspace-panel glass p-4 dashboard-card-hover">
      <p className="dashboard-panel__eyebrow">Sessions</p>
      <h2 className="section-heading">{title}</h2>
      <ul className="mt-4 space-y-3">
        {sessions.length === 0 ? (
          <li className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-400">{emptyText}</li>
        ) : (
          sessions.map((session) => (
            <li
              key={session.id}
              className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200 md:flex-row md:items-center md:justify-between"
            >
              <div>
                <p className="font-semibold text-slate-100">{session.title}</p>
                {!hideSubtitle ? <p className="mt-1 text-xs text-slate-400">{session.subtitle}</p> : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onAction?.(session)}
                  className="workspace-button workspace-button--primary rounded-lg px-3 py-1.5 text-xs font-semibold"
                >
                  {actionLabel}
                </button>
                {onDelete ? (
                  <button
                    type="button"
                    onClick={() => onDelete(session)}
                    className="workspace-button settings-logout rounded-lg px-2 py-1.5 text-xs font-semibold"
                    aria-label="Delete session"
                    title="Delete session"
                  >
                    X
                  </button>
                ) : null}
              </div>
            </li>
          ))
        )}
      </ul>
    </section>
  )
}
