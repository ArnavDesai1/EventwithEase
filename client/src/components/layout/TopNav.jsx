import { useEffect, useState } from "react";

export default function TopNav({
  user,
  isOrganiser,
  profileMode,
  onGoDiscover,
  onGoBook,
  onGoTickets,
  onGoOrganise,
  onGoCheckIn,
  onOpenAccount,
  onLogout,
  notificationUnread = 0,
  onNotificationsToggle,
  notificationsOpen = false,
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return () => {};
    function onKey(event) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  useEffect(() => {
    document.body.classList.toggle("nav-drawer-open", menuOpen);
    return () => document.body.classList.remove("nav-drawer-open");
  }, [menuOpen]);

  function wrapNav(action) {
    return () => {
      setMenuOpen(false);
      action();
    };
  }

  return (
    <header className="site-header" role="banner">
      <div className="site-header-inner">
        <button type="button" className="site-brand-block" onClick={wrapNav(onGoDiscover)} aria-label="EventwithEase home">
          <span className="site-logo-mark" aria-hidden />
          <span className="site-brand-text">
            <span className="site-logo-type">EventwithEase</span>
            <span className="site-logo-sub">Events · Tickets · Check-in</span>
          </span>
        </button>

        <button
          type="button"
          className="site-nav-toggle"
          aria-expanded={menuOpen}
          aria-controls="primary-site-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="site-nav-toggle-bars" aria-hidden />
          <span className="site-nav-toggle-label">{menuOpen ? "Close" : "Menu"}</span>
        </button>

        {menuOpen ? (
          <button type="button" className="site-nav-backdrop" tabIndex={-1} aria-label="Close menu" onClick={() => setMenuOpen(false)} />
        ) : null}

        <div className={`site-nav-shell${menuOpen ? " is-open" : ""}`}>
          <nav id="primary-site-nav" className="site-nav" aria-label="Workspace">
            <button
              type="button"
              className={`site-nav-link${profileMode === "attendee" ? " is-active" : ""}`}
              onClick={wrapNav(onGoDiscover)}
            >
              Discover
            </button>
            <button type="button" className="site-nav-link" onClick={wrapNav(onGoBook)}>
              Book
            </button>
            <button type="button" className="site-nav-link" onClick={wrapNav(onGoTickets)}>
              My tickets
            </button>
            <button
              type="button"
              className={`site-nav-link${profileMode === "organiser" ? " is-active" : ""}`}
              onClick={wrapNav(onGoOrganise)}
            >
              Organise
            </button>
            <button
              type="button"
              className={`site-nav-link${profileMode === "checkin" ? " is-active" : ""}`}
              onClick={wrapNav(onGoCheckIn)}
            >
              Check-in
            </button>
          </nav>

          <div className="site-header-actions site-header-actions--drawer">
            {user && typeof onNotificationsToggle === "function" ? (
              <button
                type="button"
                className={`site-header-ghost site-notif-trigger${notificationsOpen ? " is-active" : ""}`}
                aria-label={`Notifications${notificationUnread > 0 ? `, ${notificationUnread} unread` : ""}`}
                onClick={wrapNav(onNotificationsToggle)}
              >
                <span className="site-notif-bell" aria-hidden />
                {notificationUnread > 0 ? (
                  <span className="site-notif-badge">{notificationUnread > 9 ? "9+" : notificationUnread}</span>
                ) : null}
              </button>
            ) : null}
            {user ? (
              <>
                <span className="site-user-pill" title={user.email}>
                  <span className="site-user-name">{user.name?.split(" ")[0] || "Account"}</span>
                  {isOrganiser ? <span className="site-user-badge">Host</span> : null}
                </span>
                <button type="button" className="site-header-ghost" onClick={wrapNav(onOpenAccount)}>
                  Account
                </button>
                <button type="button" className="site-header-ghost" onClick={wrapNav(onLogout)}>
                  Log out
                </button>
              </>
            ) : (
              <button type="button" className="site-header-primary" onClick={wrapNav(onOpenAccount)}>
                Sign in
              </button>
            )}
          </div>
        </div>

        <div className="site-header-actions site-header-actions--desktop">
          {user && typeof onNotificationsToggle === "function" ? (
            <button
              type="button"
              className={`site-header-ghost site-notif-trigger${notificationsOpen ? " is-active" : ""}`}
              aria-label={`Notifications${notificationUnread > 0 ? `, ${notificationUnread} unread` : ""}`}
              onClick={onNotificationsToggle}
            >
              <span className="site-notif-bell" aria-hidden />
              {notificationUnread > 0 ? (
                <span className="site-notif-badge">{notificationUnread > 9 ? "9+" : notificationUnread}</span>
              ) : null}
            </button>
          ) : null}
          {user ? (
            <>
              <span className="site-user-pill" title={user.email}>
                <span className="site-user-name">{user.name?.split(" ")[0] || "Account"}</span>
                {isOrganiser ? <span className="site-user-badge">Host</span> : null}
              </span>
              <button type="button" className="site-header-ghost" onClick={onOpenAccount}>
                Account
              </button>
              <button type="button" className="site-header-ghost" onClick={onLogout}>
                Log out
              </button>
            </>
          ) : (
            <button type="button" className="site-header-primary" onClick={onOpenAccount}>
              Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
