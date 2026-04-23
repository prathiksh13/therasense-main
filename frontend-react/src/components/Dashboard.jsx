function StatCard({ icon, title, value, subtext }) {
  return (
    <article className="dashboard-card dashboard-stat-card glass">
      <div className="dashboard-stat-card__icon">{icon}</div>
      <p className="dashboard-stat-card__title">{title}</p>
      <p className="dashboard-stat-card__value">{value}</p>
      <p className="dashboard-stat-card__subtext">{subtext}</p>
    </article>
  )
}

function ActivityItem({ title, description, time }) {
  return (
    <li className="dashboard-activity__item">
      <div>
        <p className="dashboard-activity__title">{title}</p>
        <p className="dashboard-activity__description">{description}</p>
      </div>
      <span className="dashboard-activity__time">{time}</span>
    </li>
  )
}

export default function Dashboard({ upcomingSession, stats = [], activities = [] }) {
  return (
    <section className="dashboard-page">
      <div className="dashboard-page__hero glass">
        <div>
          <p className="dashboard-page__eyebrow">Dashboard</p>
          <h1 className="dashboard-page__title">Modern teleconsultation workspace</h1>
          <p className="dashboard-page__subtitle">
            Track upcoming sessions, mood trends, and recent activity in a clean SaaS-style interface.
          </p>
        </div>
        {upcomingSession ? (
          <div className="dashboard-upcoming glass">
            <p className="dashboard-upcoming__label">Upcoming session</p>
            <div className="dashboard-upcoming__meta">
              <span>{upcomingSession.date}</span>
              <span>{upcomingSession.time}</span>
            </div>
          </div>
        ) : null}
      </div>

      <section className="dashboard-stats">
        {stats.map((item) => (
          <StatCard key={item.title} {...item} />
        ))}
      </section>

      <section className="dashboard-grid">
        <div className="dashboard-panel glass">
          <div className="dashboard-panel__header">
            <div>
              <p className="dashboard-panel__eyebrow">Recent activity</p>
              <h2 className="dashboard-panel__title">Latest updates</h2>
            </div>
          </div>
          <ul className="dashboard-activity">
            {activities.length ? (
              activities.map((item) => (
                <ActivityItem key={`${item.title}-${item.time}`} {...item} />
              ))
            ) : (
              <li className="dashboard-activity__item">
                <div>
                  <p className="dashboard-activity__title">No recent activity yet</p>
                  <p className="dashboard-activity__description">Book a session to see it appear here instantly.</p>
                </div>
              </li>
            )}
          </ul>
        </div>
      </section>
    </section>
  )
}
