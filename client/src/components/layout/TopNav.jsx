import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

export default function TopNav({
  user,
  isOrganiser,
  profileMode,
  onGoDiscover,
  onGoBook,
  onGoTickets,
  onGoWishlist,
  onGoOrganise,
  onGoCheckIn,
  onGoStats,
  showStatsLink = false,
  onOpenAccount,
  onLogout,
  notificationUnread = 0,
  onNotificationsToggle,
  notificationsOpen = false,
  navActiveKey = "discover",
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
              className={`site-nav-link${navActiveKey === "discover" ? " is-active" : ""}`}
              onClick={wrapNav(onGoDiscover)}
            >
              Discover
            </button>
            <button type="button" className={`site-nav-link${navActiveKey === "book" ? " is-active" : ""}`} onClick={wrapNav(onGoBook)}>
              Book
            </button>
            <Link
              className={`site-nav-link${navActiveKey === "tickets" ? " is-active" : ""}`}
              to="/tickets"
              onClick={() => {
                setMenuOpen(false);
                onGoTickets();
              }}
            >
              My tickets
            </Link>
            {typeof onGoWishlist === "function" ? (
              <Link
                className={`site-nav-link${navActiveKey === "wishlist" ? " is-active" : ""}`}
                to="/wishlist"
                onClick={() => {
                  setMenuOpen(false);
                  onGoWishlist();
                }}
              >
                Wishlist
              </Link>
            ) : null}
            <Link
              className={`site-nav-link${navActiveKey === "organise" ? " is-active" : ""}`}
              to="/organise"
              onClick={() => {
                setMenuOpen(false);
                onGoOrganise();
              }}
            >
              Organise
            </Link>
            <Link
              className={`site-nav-link${navActiveKey === "checkin" ? " is-active" : ""}`}
              to="/check-in"
              onClick={() => {
                setMenuOpen(false);
                onGoCheckIn();
              }}
            >
              Check-in
            </Link>
            {showStatsLink && typeof onGoStats === "function" ? (
              <Link
                className={`site-nav-link${navActiveKey === "stats" ? " is-active" : ""}`}
                to="/stats"
                onClick={() => {
                  setMenuOpen(false);
                  onGoStats();
                }}
              >
                Stats
              </Link>
            ) : null}
          </nav>

          <div className="site-header-actions site-header-actions--drawer">
            {user && typeof onNotificationsToggle === "function" ? (
              <button
                type="button"
                className={`site-header-ghost site-notif-trigger${notificationsOpen ? " is-active" : ""}${
                  notificationUnread > 0 ? " has-unread" : ""
                }`}
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
              className={`site-header-ghost site-notif-trigger${notificationsOpen ? " is-active" : ""}${
                notificationUnread > 0 ? " has-unread" : ""
              }`}
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
