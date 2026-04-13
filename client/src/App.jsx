import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import api from "./api";
import { formatCurrency, formatDate, effectiveTicketPrice } from "./utils/format.js";
import PrimaryButton from "./components/ui/PrimaryButton.jsx";
import EmptyState from "./components/ui/EmptyState.jsx";
import LoadingSpinner from "./components/ui/LoadingSpinner.jsx";
import AnimatedNumber from "./components/ui/AnimatedNumber.jsx";
import TopNav from "./components/layout/TopNav.jsx";
import SiteFooter from "./components/layout/SiteFooter.jsx";
import QrScannerPanel from "./components/QrScannerPanel.jsx";
import EventDashboardAnalytics from "./components/EventDashboardAnalytics.jsx";
import { useEventNotifications, formatMsAsCountdown } from "./hooks/useEventNotifications.js";
import { ogEventUrl } from "./utils/shareUrls.js";
import { isNotifSoundEnabled, setNotifSoundEnabled } from "./utils/notifSound.js";
import "./App.css";

/** INR thresholds for patron bar + spend-tier XP (currency matches `formatCurrency`). */
const PATRON_SPEND_TIERS = Object.freeze([0, 500, 2500, 10000, 25000]);
const PATRON_TIER_NAMES = Object.freeze([
  "Explorer",
  "Bronze supporter",
  "Silver supporter",
  "Gold supporter",
  "Platinum supporter",
]);
const PATRON_BAR_MAX = PATRON_SPEND_TIERS[PATRON_SPEND_TIERS.length - 1];

const emptyEventForm = {
  title: "",
  description: "",
  location: "",
  city: "",
  venueType: "physical",
  category: "Tech",
  date: "",
  coverImage: "",
  venueMapUrl: "",
  agenda: [],
  speakers: [],
  faq: [],
  sessions: [],
  discountCodes: [],
  ticketTypes: [
    { name: "General", price: "499", quantity: "50", earlyBirdPrice: "", earlyBirdEndsAt: "" },
    { name: "VIP", price: "999", quantity: "20", earlyBirdPrice: "", earlyBirdEndsAt: "" },
  ],
  bookingPromo: {
    active: false,
    headline: "",
    subtext: "",
    badge: "Pre-book offer",
    endsAt: "",
  },
};

const emptyAuthForm = { name: "", email: "", password: "", role: "attendee" };

/** Matches server `EWE_CANCEL_DEADLINE_HOURS` (hours before start that cancel stays open). */
const CANCEL_DEADLINE_HOURS_BEFORE = 10;

const DISCOVER_PROMO_DISMISS_STORAGE_KEY = "eventwithease-discover-promos-dismissed";
const GAMIFY_BAR_DISMISS_STORAGE_KEY = "eventwithease-gamify-bar-dismissed";

/** Populated `{ _id, name }` or raw ObjectId string from older responses. */
function eventOrganiserRefId(event) {
  const o = event?.organiserId;
  if (o == null || o === "") return null;
  if (typeof o === "string") return o;
  const id = o._id ?? o.id;
  return id != null ? String(id) : null;
}

function eventOrganiserDisplayName(event) {
  const o = event?.organiserId;
  if (o && typeof o === "object" && typeof o.name === "string" && o.name.trim()) return o.name.trim();
  return null;
}

function eventOrganiserTagline(event) {
  const o = event?.organiserId;
  if (o && typeof o === "object" && typeof o.hostTagline === "string" && o.hostTagline.trim()) return o.hostTagline.trim();
  return "";
}

function NotificationsPanel({
  open,
  onClose,
  notifications,
  markRead,
  markAllRead,
  dismissNotif,
  navigate,
  flash,
  desktopSupported,
  desktopPermission,
  requestDesktopPermission,
  pushEssentialEnabled,
  setPushEssentialEnabled,
  ticketPreview = [],
  followingHosts = [],
  formatMsAsCountdown: fmtCountdown,
  formatDate: fmtDate,
}) {
  const [soundOn, setSoundOn] = useState(() => isNotifSoundEnabled());

  if (!open) return null;

  function refundProgressForNotif(n) {
    if (!n || n.kind !== "refund") return null;
    if (n.refundStatus && n.refundStatus !== "pending") return { pct: 100, note: "Resolved" };
    const now = Date.now();
    const autoAt = n.refundAutoApproveAt ? new Date(n.refundAutoApproveAt).getTime() : NaN;
    if (!Number.isFinite(autoAt)) return null;
    const createdAt = n.refundCreatedAt ? new Date(n.refundCreatedAt).getTime() : NaN;
    const start = Number.isFinite(createdAt) ? createdAt : autoAt - 24 * 60 * 60 * 1000;
    const span = Math.max(1, autoAt - start);
    const pct = Math.max(0, Math.min(100, ((now - start) / span) * 100));
    const left = Math.max(0, autoAt - now);
    return { pct, note: left > 0 ? `Auto-approves in ${fmtCountdown(left, { withSeconds: false })}` : "Auto-approve window reached" };
  }

  function goEventFromPanel(eid) {
    onClose();
    navigate(`/event/${eid}`);
  }

  return (
    <>
      <button type="button" className="notif-backdrop" aria-label="Close notifications" onClick={onClose} />
      <div className="notif-panel" role="dialog" aria-label="Notifications">
        <div className="notif-panel-head">
          <h2>Notifications</h2>
          <div className="notif-panel-actions">
            {notifications.length > 0 ? (
              <button type="button" className="ghost-button compact-button" onClick={markAllRead}>
                Mark all read
              </button>
            ) : null}
            {desktopSupported && desktopPermission !== "granted" ? (
              <button
                type="button"
                className="ghost-button compact-button"
                onClick={() =>
                  requestDesktopPermission().then((p) => {
                    if (p === "granted") flash("Browser notifications allowed — essentials can show in the system tray when enabled below.");
                    else if (p === "denied") flash("Notifications blocked in browser settings.", true);
                  })
                }
              >
                Allow browser notifications
              </button>
            ) : null}
            {desktopSupported && desktopPermission === "granted" ? (
              <button
                type="button"
                className="ghost-button compact-button"
                onClick={() => {
                  const next = !pushEssentialEnabled;
                  setPushEssentialEnabled(next);
                  flash(
                    next
                      ? "System banners on for essentials (cancel, doors, refunds, etc.)."
                      : "System banners off — alerts stay in-app only."
                  );
                }}
              >
                {pushEssentialEnabled ? "System: essentials on" : "System: essentials off"}
              </button>
            ) : null}
            <button
              type="button"
              className="ghost-button compact-button"
              onClick={() => {
                const next = !soundOn;
                setNotifSoundEnabled(next);
                setSoundOn(next);
                flash(next ? "Milestone sounds on." : "Milestone sounds muted.");
              }}
            >
              {soundOn ? "Mute sounds" : "Unmute sounds"}
            </button>
            <button type="button" className="ghost-button compact-button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <p className="notif-panel-hint">
          Milestones refresh about every 10s while the app is open. Booked events between ~1 and 30 days out also get at most one &quot;Your
          ticket · coming up&quot; reminder per local day. New alerts play a short chime (unless muted). Use <strong>Remove</strong> to clear an
          item: routine reminders stay gone; <strong>essentials</strong> (cancel, doors soon, refunds…) can come back after ~45 minutes if the
          situation still applies. Allow browser notifications + keep &quot;System: essentials on&quot; to mirror those urgent items to your
          desktop or phone tray (where the OS supports it).
        </p>

        {ticketPreview.length > 0 ? (
          <div className="notif-section">
            <h3 className="notif-section-title">Your ticketed events</h3>
            <ul className="notif-preview-list">
              {ticketPreview.map((row) => (
                <li key={row.eid} className="notif-preview-item">
                  <button type="button" className="notif-preview-main" onClick={() => goEventFromPanel(row.eid)}>
                    <strong>{row.title}</strong>
                    {row.cancelled ? (
                      <span className="notif-preview-sub notif-preview-warn">Cancelled — check refunds or email.</span>
                    ) : (
                      <>
                        <span className="notif-preview-sub">
                          Starts {fmtDate(row.startsAt)} ·{" "}
                          <em className="notif-live-countdown">
                            {fmtCountdown(row.leftMs)}
                          </em>{" "}
                          from now
                        </span>
                        <span className="notif-preview-sub notif-preview-muted">
                          Paid cancellations: tiered fee (minimal if within 5h of booking), auto-approved ~24h, until 10h before doors.
                        </span>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="notif-section">
          <h3 className="notif-section-title">Hosts you follow</h3>
          {followingHosts.length > 0 ? (
            <p className="notif-follow-summary">
              Following <strong>{followingHosts.length}</strong> host{followingHosts.length === 1 ? "" : "s"}:{" "}
              {followingHosts.map((h) => h.name).join(", ")}. New upcoming events from them appear as alerts here.
            </p>
          ) : (
            <p className="auth-note notif-follow-empty">
              Open any event, click the host name, then <strong>Follow</strong>. When they publish a new date, you will get an in-app alert
              (first time you load after it appears).
            </p>
          )}
        </div>

        <h3 className="notif-section-title notif-alerts-heading">Milestone alerts</h3>
        <ul className="notif-list">
          {notifications.length === 0 && ticketPreview.length === 0 ? (
            <li className="auth-note notif-empty">
              No fired reminders yet. After you book, you will see week-of and day-before alerts when those windows arrive — plus early-bird
              nudges for wishlisted events.
            </li>
          ) : null}
          {notifications.length === 0 && ticketPreview.length > 0 ? (
            <li className="auth-note notif-empty">No milestone alerts in your inbox yet — your countdowns are in the list above.</li>
          ) : null}
          {notifications.map((n) => {
            const essential = n.importance === "essential";
            const locked =
              n.id?.startsWith("dailybook:") ||
              n.id?.startsWith("w7:") ||
              n.id?.startsWith("d1:") ||
              n.id?.startsWith("h1:") ||
              n.id?.startsWith("m15:") ||
              n.id?.startsWith("start:") ||
              n.id?.startsWith("cancel:") ||
              n.id?.startsWith("texp:");
            const refundProg = refundProgressForNotif(n);
            return (
              <li key={n.id} className={`notif-item${n.read ? " is-read" : ""}${essential ? " notif-item--essential" : ""}`}>
                <div className="notif-item-row">
                  <button
                    type="button"
                    className="notif-item-main"
                    onClick={() => {
                      markRead(n.id);
                      onClose();
                      if (n.link) navigate(n.link);
                    }}
                  >
                    {essential ? <span className="notif-item-pill">Essential</span> : null}
                    <strong>{n.title}</strong>
                    <span>{n.body}</span>
                    {refundProg ? (
                      <div className="refund-progress">
                        <div className="mini-progress mini-progress--refund" aria-label="Refund progress">
                          <div className="mini-progress-fill" style={{ width: `${refundProg.pct}%` }} />
                        </div>
                        {refundProg.note ? <p className="refund-progress-note">{refundProg.note}</p> : null}
                      </div>
                    ) : null}
                    <span className="notif-item-time">{new Date(n.at).toLocaleString()}</span>
                  </button>
                  {!locked ? (
                    <button
                      type="button"
                      className="notif-item-remove"
                      title={essential ? "Remove for now — may return if still relevant" : "Remove permanently"}
                      aria-label={essential ? "Remove essential alert for now" : "Remove alert permanently"}
                      onClick={(e) => {
                        e.stopPropagation();
                        dismissNotif(n.id);
                        flash(
                          essential
                            ? "Removed — essentials can reappear later if still relevant."
                            : "Removed — this reminder will not be shown again."
                        );
                      }}
                    >
                      ×
                    </button>
                  ) : (
                    <span className="notif-item-locked" title="Ticket timing/status alerts cannot be removed">
                      Locked
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState(emptyAuthForm);
  const [eventForm, setEventForm] = useState(emptyEventForm);
  const [events, setEvents] = useState([]);
  const [eventsError, setEventsError] = useState(null);
  const [eventsReloading, setEventsReloading] = useState(false);
  const [myEvents, setMyEvents] = useState([]);
  const [myTickets, setMyTickets] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [promoOverlayDismissed, setPromoOverlayDismissed] = useState(false);
  const [ticketCart, setTicketCart] = useState({});
  const [discountCode, setDiscountCode] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [checkInCode, setCheckInCode] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [checkInNotice, setCheckInNotice] = useState(null);
  const [hostPage, setHostPage] = useState(null);
  const [hostPageLoading, setHostPageLoading] = useState(false);
  const [hostPageError, setHostPageError] = useState(null);
  const [hostAuthModalOpen, setHostAuthModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [priceFilter, setPriceFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("");
  const [descriptionOutline, setDescriptionOutline] = useState("");
  const [wishlist, setWishlist] = useState(() => JSON.parse(localStorage.getItem("eventwithease-wishlist") || "[]"));
  const [notifOpen, setNotifOpen] = useState(false);
  const [followingHosts, setFollowingHosts] = useState([]);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [profileMode, setProfileMode] = useState("attendee");
  const [bookingMessage, setBookingMessage] = useState("");
  const [paymentMessage, setPaymentMessage] = useState("");
  const [lastBookingErrorCode, setLastBookingErrorCode] = useState(null);
  const [checkInVerifyOnly, setCheckInVerifyOnly] = useState(false);
  const [eventWaitlist, setEventWaitlist] = useState([]);
  const [staffMyEvents, setStaffMyEvents] = useState([]);
  const [checkInGateEvent, setCheckInGateEvent] = useState(null);
  const [dashboardStaff, setDashboardStaff] = useState([]);
  const [staffInviteEmail, setStaffInviteEmail] = useState("");
  const [adminEvents, setAdminEvents] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminSnapshotLoaded, setAdminSnapshotLoaded] = useState(false);
  const [statsOverview, setStatsOverview] = useState(null);
  const [statsLoadError, setStatsLoadError] = useState(null);
  const [resetToken, setResetToken] = useState("");
  const [refunds, setRefunds] = useState([]);
  const [hostRefunds, setHostRefunds] = useState([]);
  const [refundRequests, setRefundRequests] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [feedbackEntries, setFeedbackEntries] = useState([]);
  const [reviewForm, setReviewForm] = useState({ rating: 5, comment: "" });
  const [feedbackForm, setFeedbackForm] = useState({ rating: 5, feedback: "" });
  const [networkingList, setNetworkingList] = useState([]);
  const [profileForm, setProfileForm] = useState({
    linkedinUrl: "",
    networkingOptIn: false,
    hostTagline: "",
    hostBio: "",
    twitterUrl: "",
    instagramUrl: "",
    websiteUrl: "",
  });
  const [googleReady, setGoogleReady] = useState(false);
  const [dismissedPromoIds, setDismissedPromoIds] = useState(() => {
    try {
      const raw = localStorage.getItem(DISCOVER_PROMO_DISMISS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  });
  const [gamifyBarDismissed, setGamifyBarDismissed] = useState(() => {
    try {
      return localStorage.getItem(GAMIFY_BAR_DISMISS_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const detailsRef = useRef(null);
  const browseRef = useRef(null);
  const organiserRef = useRef(null);
  const checkinRef = useRef(null);
  const checkinFormRef = useRef(null);
  const ticketsRef = useRef(null);
  const authRef = useRef(null);
  const googleButtonRef = useRef(null);
  const authRoleRef = useRef(authForm.role);
  const lastOpenedEventIdRef = useRef("");
  const pageViewPostedRef = useRef({ path: "", at: 0 });

  const refreshFollowing = useCallback(async () => {
    if (!user) {
      setFollowingHosts([]);
      return;
    }
    try {
      const { data } = await api.get("/organisers/following");
      setFollowingHosts(Array.isArray(data) ? data : []);
    } catch {
      setFollowingHosts([]);
    }
  }, [user]);

  const {
    notifications,
    unreadCount,
    markRead,
    markAllRead,
    dismissNotif,
    requestDesktopPermission,
    desktopSupported,
    desktopPermission,
    pushEssentialEnabled,
    setPushEssentialEnabled,
  } = useEventNotifications({
    user,
    myTickets,
    events,
    wishlist,
    followingList: followingHosts,
    attendeeRefunds: refunds,
    hostRefunds,
  });

  const statsPath = useMemo(() => /^\/stats\/?$/.test(location.pathname), [location.pathname]);

  useEffect(() => {
    const id = setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (loading) return;
    const p = location.pathname || "/";
    const now = Date.now();
    if (pageViewPostedRef.current.path === p && now - pageViewPostedRef.current.at < 22000) return;
    pageViewPostedRef.current = { path: p, at: now };
    api.post("/app/hit", { path: p }).catch(() => {});
  }, [loading, location.pathname]);

  useEffect(() => {
    refreshFollowing();
  }, [refreshFollowing, user?.id]);

  useEffect(() => {
    if (user) {
      void loadStaffMyEvents();
    } else {
      setStaffMyEvents([]);
      setCheckInGateEvent(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadStaffMyEvents closes over latest user
  }, [user?.id]);

  useEffect(() => {
    if (user && notifOpen) refreshFollowing();
  }, [user, notifOpen, refreshFollowing]);

  const userRoles = user?.roles?.length ? user.roles : user?.role ? [user.role] : [];
  const isOrganiser = userRoles.includes("organiser") || userRoles.includes("admin");
  const isAdminUser = Boolean(user && userRoles.includes("admin"));

  const fanProgress = useMemo(() => {
    if (!user) return null;
    const activeTickets = myTickets.filter((t) => t.status !== "refunded" && t.status !== "expired");
    const ticketCount = activeTickets.length;
    const totalSpend = activeTickets.reduce((sum, t) => sum + Math.max(0, Number(t.price) || 0), 0);
    const wl = wishlist.length;
    const fol = followingHosts.length;

    let volumeXp = 0;
    if (ticketCount >= 2) volumeXp += 25;
    if (ticketCount >= 3) volumeXp += 34;
    if (ticketCount >= 5) volumeXp += 52;
    if (ticketCount >= 10) volumeXp += 100;
    if (ticketCount >= 20) volumeXp += 160;

    const spendDripXp = Math.min(340, Math.floor(totalSpend / 100));
    let patronTierXp = 0;
    if (totalSpend >= PATRON_SPEND_TIERS[1]) patronTierXp += 30;
    if (totalSpend >= PATRON_SPEND_TIERS[2]) patronTierXp += 48;
    if (totalSpend >= PATRON_SPEND_TIERS[3]) patronTierXp += 72;
    if (totalSpend >= PATRON_SPEND_TIERS[4]) patronTierXp += 110;

    const score = ticketCount * 45 + wl * 12 + fol * 20 + volumeXp + spendDripXp + patronTierXp;
    const level = Math.min(99, Math.floor(score / 150) + 1);
    const levelStart = (level - 1) * 150;
    const levelEnd = level * 150;
    const span = Math.max(levelEnd - levelStart, 1);
    const pct = Math.min(100, ((score - levelStart) / span) * 100);

    let patronTierIdx = 0;
    for (let i = PATRON_SPEND_TIERS.length - 1; i >= 0; i -= 1) {
      if (totalSpend >= PATRON_SPEND_TIERS[i]) {
        patronTierIdx = i;
        break;
      }
    }
    const patronLabel = PATRON_TIER_NAMES[patronTierIdx];
    const nextTierAmt = PATRON_SPEND_TIERS[patronTierIdx + 1];
    let patronNextHint = "";
    if (nextTierAmt == null) {
      patronNextHint = "Top patron tier — thanks for backing so many events.";
    } else {
      const gap = Math.max(0, nextTierAmt - totalSpend);
      patronNextHint =
        gap > 0
          ? `${formatCurrency(gap)} more on active tickets to reach ${PATRON_TIER_NAMES[patronTierIdx + 1]}`
          : "";
    }

    const patronBarPct = Math.min(100, (totalSpend / PATRON_BAR_MAX) * 100);
    const patronTicks = PATRON_SPEND_TIERS.slice(1, -1).map((amt) => ({
      amt,
      leftPct: Math.min(100, (amt / PATRON_BAR_MAX) * 100),
    }));

    const perkChips = [];
    if (ticketCount >= 3) perkChips.push({ key: "t3", label: "3+ ticket stack" });
    if (ticketCount >= 5) perkChips.push({ key: "t5", label: "5+ ticket stack" });
    if (ticketCount >= 10) perkChips.push({ key: "t10", label: "10+ hall pass" });
    if (ticketCount >= 20) perkChips.push({ key: "t20", label: "20+ megafan" });
    if (totalSpend >= PATRON_SPEND_TIERS[1]) perkChips.push({ key: "s1", label: "Bronze spend tier" });
    if (totalSpend >= PATRON_SPEND_TIERS[2]) perkChips.push({ key: "s2", label: "Silver spend tier" });
    if (totalSpend >= PATRON_SPEND_TIERS[3]) perkChips.push({ key: "s3", label: "Gold spend tier" });
    if (totalSpend >= PATRON_SPEND_TIERS[4]) perkChips.push({ key: "s4", label: "Platinum spend tier" });

    return {
      score,
      level,
      levelEnd,
      pct,
      tickets: ticketCount,
      wl,
      fol,
      totalSpend,
      patronLabel,
      patronNextHint,
      patronBarPct,
      patronTicks,
      perkChips,
    };
  }, [user, myTickets, wishlist, followingHosts]);

  useEffect(() => {
    if (!statsPath || !isAdminUser) return;
    let cancelled = false;
    setStatsLoadError(null);
    void (async () => {
      try {
        const { data } = await api.get("/app/stats");
        if (!cancelled) setStatsOverview(data);
      } catch (e) {
        if (!cancelled) {
          setStatsOverview(null);
          setStatsLoadError(e.response?.data?.message || "Could not load stats.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [statsPath, isAdminUser, user?.id]);

  const filteredEvents = useMemo(() => {
    const cityNeedle = cityFilter.trim().toLowerCase();
    return events.filter((event) => {
      const eventText = `${event.title} ${event.category} ${event.location} ${event.city || ""}`.toLowerCase();
      const lowestPrice = Math.min(...event.ticketTypes.map((ticket) => effectiveTicketPrice(ticket)));
      const eventDate = new Date(event.date);
      const today = new Date();
      const nextWeek = new Date();
      nextWeek.setDate(today.getDate() + 7);
      const nextMonth = new Date();
      nextMonth.setMonth(today.getMonth() + 1);

      const matchesSearch = !search.trim() || eventText.includes(search.toLowerCase());
      const matchesCategory = categoryFilter === "all" || event.category === categoryFilter;
      const matchesCity =
        !cityNeedle ||
        (event.city || "").toLowerCase().includes(cityNeedle) ||
        (event.location || "").toLowerCase().includes(cityNeedle);
      const matchesPrice = priceFilter === "all" || (priceFilter === "free" ? lowestPrice === 0 : lowestPrice > 0);
      const matchesDate =
        dateFilter === "all" ||
        (dateFilter === "week" && eventDate <= nextWeek && eventDate >= today) ||
        (dateFilter === "month" && eventDate <= nextMonth && eventDate >= today);

      return matchesSearch && matchesCategory && matchesCity && matchesPrice && matchesDate;
    });
  }, [categoryFilter, cityFilter, dateFilter, events, priceFilter, search]);

  const nextBookedEventCountdown = useMemo(() => {
    const now = countdownNow;
    let best = null;
    for (const t of myTickets) {
      const eid = String(t.eventId?._id || t.eventId || "");
      if (!eid) continue;
      const ev = events.find((e) => String(e._id) === eid);
      const d = ev?.date || t.eventId?.date;
      const title = ev?.title || t.eventId?.title;
      if (!d) continue;
      const start = new Date(d).getTime();
      if (Number.isNaN(start) || start <= now) continue;
      if (ev?.cancelledAt || t.eventId?.cancelledAt) continue;
      if (!best || start < best.start) best = { start, title, eid };
    }
    if (!best) return null;
    const left = best.start - now;
    return { ...best, left };
  }, [myTickets, events, countdownNow]);

  const ticketNotificationsPreview = useMemo(() => {
    if (!user || !myTickets.length) return [];
    const seen = new Set();
    const rows = [];
    const now = countdownNow;
    for (const t of myTickets) {
      const eid = String(t.eventId?._id || t.eventId || "");
      if (!eid || seen.has(eid)) continue;
      seen.add(eid);
      const ev = events.find((e) => String(e._id) === eid) || t.eventId;
      if (!ev?.date) continue;
      const start = new Date(ev.date).getTime();
      if (Number.isNaN(start) || start <= now) continue;
      rows.push({
        eid,
        title: ev.title || "Event",
        startsAt: ev.date,
        leftMs: start - now,
        cancelled: Boolean(ev.cancelledAt || t.eventId?.cancelledAt),
      });
    }
    return rows.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()).slice(0, 12);
  }, [user, myTickets, events, countdownNow]);

  const hasSelectedBooking = useMemo(() => {
    if (!selectedEvent) return false;
    return myTickets.some(
      (ticket) =>
        String(ticket.eventId?._id || ticket.eventId) === String(selectedEvent._id) &&
        ticket.status !== "refunded"
    );
  }, [myTickets, selectedEvent]);

  const selectedEventEnded = useMemo(() => {
    if (!selectedEvent?.date) return false;
    return new Date(selectedEvent.date) < new Date();
  }, [selectedEvent]);

  const selectedEventCancelled = useMemo(() => Boolean(selectedEvent?.cancelledAt), [selectedEvent?.cancelledAt]);

  const bookingPromoLive = useMemo(() => {
    const p = selectedEvent?.bookingPromo;
    if (!p?.active || !String(p.headline || "").trim()) return null;
    if (selectedEventCancelled) return null;
    if (p.endsAt) {
      const t = new Date(p.endsAt).getTime();
      if (Number.isFinite(t) && t <= Date.now()) return null;
    }
    return p;
  }, [selectedEvent?.bookingPromo, selectedEventCancelled]);

  const discoverPromoStripItems = useMemo(() => {
    const now = Date.now();
    const dismissed = new Set(dismissedPromoIds);
    const fromEvents = events
      .filter((e) => {
        if (e.cancelledAt || dismissed.has(String(e._id))) return false;
        if (new Date(e.date).getTime() <= now) return false;
        const p = e.bookingPromo;
        if (!p?.active || !String(p.headline || "").trim()) return false;
        if (p.endsAt) {
          const t = new Date(p.endsAt).getTime();
          if (Number.isFinite(t) && t <= now) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 4)
      .map((event) => ({ kind: "event", id: String(event._id), event }));
    if (fromEvents.length > 0) return fromEvents;
    if (!dismissed.has("static-prebook")) {
      return [{ kind: "static", id: "static-prebook" }];
    }
    return [];
  }, [events, dismissedPromoIds]);

  const dismissDiscoverPromo = useCallback((id) => {
    setDismissedPromoIds((prev) => {
      const s = String(id);
      if (prev.includes(s)) return prev;
      const next = [...prev, s];
      localStorage.setItem(DISCOVER_PROMO_DISMISS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const dismissGamifyBar = useCallback(() => {
    setGamifyBarDismissed(true);
    try {
      localStorage.setItem(GAMIFY_BAR_DISMISS_STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

  const openGamifyBar = useCallback(() => {
    setGamifyBarDismissed(false);
    try {
      localStorage.removeItem(GAMIFY_BAR_DISMISS_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const gamifyFloatingDock = useMemo(() => {
    if (!user || !fanProgress) return null;
    return (
      <div className="gamify-floating-dock" aria-label="Your event explorer progress">
        {!gamifyBarDismissed ? (
          <div className="gamify-floating-panel fan-progress-card fan-progress-card--floating">
            <button type="button" className="gamify-floating-dismiss" aria-label="Hide progress bar" onClick={dismissGamifyBar}>
              ×
            </button>
            <div className="fan-progress-head">
              <span className="fan-level-badge">Lv {fanProgress.level}</span>
              <span className="fan-progress-title">Event explorer</span>
              <span className="fan-progress-xp">{fanProgress.score} XP</span>
            </div>
            <div className="fan-progress-track" title={`Next level at ${fanProgress.levelEnd} XP`}>
              <div className="fan-progress-fill" style={{ width: `${fanProgress.pct}%` }} />
            </div>
            <div className="fan-patron-block" aria-label="Patron progress from ticket spend">
              <div className="fan-patron-head">
                <span className="fan-patron-title">Patron power</span>
                <span className="fan-patron-rank">{fanProgress.patronLabel}</span>
                <span className="fan-patron-spend">{formatCurrency(fanProgress.totalSpend)} on active tickets</span>
              </div>
              <div className="fan-patron-track-wrap">
                <div className="fan-patron-track" role="presentation">
                  <div className="fan-patron-track-fill" style={{ width: `${fanProgress.patronBarPct}%` }} />
                  {fanProgress.patronTicks.map((tk) => (
                    <span
                      key={tk.amt}
                      className="fan-patron-tick"
                      style={{ left: `${tk.leftPct}%` }}
                      title={formatCurrency(tk.amt)}
                    />
                  ))}
                </div>
                <div className="fan-patron-scale" aria-hidden>
                  <span>0</span>
                  <span>{formatCurrency(PATRON_SPEND_TIERS[4])}</span>
                </div>
              </div>
              {fanProgress.patronNextHint ? <p className="fan-patron-next">{fanProgress.patronNextHint}</p> : null}
              {fanProgress.perkChips.length ? (
                <ul className="fan-perk-chips">
                  {fanProgress.perkChips.map((p) => (
                    <li key={p.key} className="fan-perk-chip">
                      {p.label}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <p className="auth-note fan-progress-hint">
              Level XP: +45 per active ticket · +12 wishlist saves · +20 per host you follow · bonus stacks at 2 / 3 /
              5 / 10 / 20 tickets · +1 XP per ₹100 spent (cap 340) · extra bursts at ₹500 / ₹2.5k / ₹10k / ₹25k.
            </p>
          </div>
        ) : (
          <button type="button" className="gamify-floating-reopen" onClick={openGamifyBar} aria-label="Show progress and patron power">
            <span className="gamify-floating-reopen-level">Lv {fanProgress.level}</span>
            <span className="gamify-floating-reopen-xp">{fanProgress.score} XP</span>
          </button>
        )}
      </div>
    );
  }, [user, fanProgress, gamifyBarDismissed, dismissGamifyBar, openGamifyBar]);

  const wishlistSet = useMemo(() => new Set(wishlist.map(String)), [wishlist]);

  const wishlistedEvents = useMemo(
    () => events.filter((event) => wishlistSet.has(String(event._id))),
    [events, wishlistSet]
  );

  const wishlistReminders = useMemo(() => {
    const now = Date.now();
    const horizon = now + 72 * 60 * 60 * 1000;
    return wishlistedEvents.filter((event) => {
      const t = new Date(event.date).getTime();
      return t > now && t <= horizon;
    });
  }, [wishlistedEvents]);

  const recommendedEvents = useMemo(() => {
    if (!events.length) return [];

    const scoreByCategory = new Map();
    const addCategoryScore = (category, weight) => {
      if (!category) return;
      scoreByCategory.set(category, (scoreByCategory.get(category) || 0) + weight);
    };

    myTickets.forEach((ticket) => addCategoryScore(ticket.eventId?.category, 3));
    wishlistedEvents.forEach((event) => addCategoryScore(event.category, 2));

    return [...events]
      .filter((event) => !wishlistSet.has(String(event._id)))
      .map((event) => ({
        event,
        score: (scoreByCategory.get(event.category) || 0) + (new Date(event.date) > new Date() ? 1 : 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((entry) => entry.event);
  }, [events, myTickets, wishlistedEvents, wishlistSet]);

  const refundsByBooking = useMemo(() => {
    return refunds.reduce((acc, refund) => {
      acc[String(refund.bookingId)] = refund;
      return acc;
    }, {});
  }, [refunds]);

  useEffect(() => {
    if (user) return;
    localStorage.setItem("eventwithease-wishlist", JSON.stringify(wishlist));
  }, [wishlist, user]);

  useEffect(() => {
    authRoleRef.current = authForm.role;
  }, [authForm.role]);

  useEffect(() => {
    if (!user) return;
    setProfileForm({
      linkedinUrl: user.linkedinUrl || "",
      networkingOptIn: Boolean(user.networkingOptIn),
      hostTagline: user.hostTagline || "",
      hostBio: user.hostBio || "",
      twitterUrl: user.twitterUrl || "",
      instagramUrl: user.instagramUrl || "",
      websiteUrl: user.websiteUrl || "",
    });
  }, [user]);

  useEffect(() => {
    hydrateSession();
    handleAuthLink();
  }, []);

  const eventIdInPath = useMemo(() => {
    const match = location.pathname.match(/^\/event\/([a-fA-F0-9]{24})\/?$/);
    return match ? match[1] : null;
  }, [location.pathname]);

  const hostIdInPath = useMemo(() => {
    const match = location.pathname.match(/^\/host\/([a-fA-F0-9]{24})\/?$/);
    return match ? match[1] : null;
  }, [location.pathname]);

  const ticketsPath = useMemo(() => /^\/tickets\/?$/.test(location.pathname), [location.pathname]);
  const wishlistPath = useMemo(() => /^\/wishlist\/?$/.test(location.pathname), [location.pathname]);
  const organisePath = useMemo(() => /^\/organise\/?$/.test(location.pathname), [location.pathname]);
  const checkinPath = useMemo(() => /^\/check-in\/?$/.test(location.pathname), [location.pathname]);

  const navActiveKey = useMemo(() => {
    if (statsPath) return "stats";
    if (eventIdInPath) return "book";
    if (ticketsPath) return "tickets";
    if (wishlistPath) return "wishlist";
    if (organisePath) return "organise";
    if (checkinPath) return "checkin";
    if (profileMode === "organiser") return "organise";
    if (profileMode === "checkin") return "checkin";
    return "discover";
  }, [statsPath, eventIdInPath, ticketsPath, wishlistPath, organisePath, checkinPath, profileMode]);

  useEffect(() => {
    if (loading) return;
    if (
      eventIdInPath ||
      hostIdInPath ||
      statsPath ||
      ticketsPath ||
      wishlistPath ||
      organisePath ||
      checkinPath
    )
      return;
    const norm = (location.pathname || "/").replace(/\/$/, "") || "/";
    if (norm === "/") {
      lastOpenedEventIdRef.current = "";
      setSelectedEvent(null);
    }
  }, [loading, location.pathname, eventIdInPath, hostIdInPath, statsPath, ticketsPath, wishlistPath, organisePath, checkinPath]);

  useEffect(() => {
    if (organisePath && user && isOrganiser) {
      setProfileMode("organiser");
      return;
    }
    if (checkinPath && user && (isOrganiser || staffMyEvents.length > 0)) {
      setProfileMode("checkin");
      return;
    }
    if (eventIdInPath || ticketsPath || wishlistPath) setProfileMode("attendee");
  }, [organisePath, checkinPath, eventIdInPath, ticketsPath, wishlistPath, user, isOrganiser, staffMyEvents.length]);

  useEffect(() => {
    const baseTitle = "EventwithEase — Events, tickets & check-in";
    const onEventPage =
      Boolean(eventIdInPath) &&
      selectedEvent?._id &&
      String(selectedEvent._id) === String(eventIdInPath);
    if (onEventPage && selectedEvent?.title) {
      document.title = `${selectedEvent.title} · EventwithEase`;
      const plain = (selectedEvent.description || "").replace(/\s+/g, " ").trim();
      const desc = plain.slice(0, 160);
      let meta = document.querySelector('meta[name="description"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "description");
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", desc || `${selectedEvent.title} on EventwithEase — tickets and check-in.`);
    } else {
      document.title = baseTitle;
    }
  }, [eventIdInPath, selectedEvent?._id, selectedEvent?.title, selectedEvent?.description]);

  const hostNextCountdown = useMemo(() => {
    if (!hostIdInPath || !hostPage?.events?.length) return null;
    const now = countdownNow;
    let best = null;
    for (const e of hostPage.events) {
      const t = new Date(e.date).getTime();
      if (Number.isNaN(t) || t <= now) continue;
      if (e.cancelledAt) continue;
      if (!best || t < best.t) best = { t, title: e.title, id: e._id };
    }
    if (!best) return null;
    return { ...best, left: best.t - now };
  }, [hostIdInPath, hostPage?.events, countdownNow]);

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) return;
    if (window.google) {
      setGoogleReady(true);
      return;
    }
    if (document.getElementById("google-identity-script")) return;

    const script = document.createElement("script");
    script.id = "google-identity-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => setGoogleReady(true);
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId || !googleReady || user || !googleButtonRef.current || !window.google || authMode === "forgot" || authMode === "reset") return;

    const slot = googleButtonRef.current;
    let retryTimer = null;
    let retryCount = 0;

    const renderGoogleButton = () => {
      if (!slot.isConnected) return;
      slot.innerHTML = "";
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCredential,
      });
      const slotWidth = Math.floor(slot.getBoundingClientRect().width || 0);
      if (slotWidth < 180 && retryCount < 8) {
        retryCount += 1;
        retryTimer = window.setTimeout(renderGoogleButton, 140);
        return;
      }
      const targetWidth = slotWidth > 0 ? slotWidth - 8 : 280;
      const googleWidth = Math.max(220, Math.min(360, targetWidth));
      window.google.accounts.id.renderButton(slot, {
        theme: "outline",
        size: "large",
        text: authMode === "signup" ? "signup_with" : "signin_with",
        width: googleWidth,
      });

      // Occasionally GIS races initial paint; retry a few times until an iframe/button is present.
      if (!slot.querySelector("iframe, div[role='button']") && retryCount < 8) {
        retryCount += 1;
        retryTimer = window.setTimeout(renderGoogleButton, 140);
      }
    };

    requestAnimationFrame(renderGoogleButton);
    return () => {
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [authMode, user, googleReady, authForm.role, hostAuthModalOpen]);

  useEffect(() => {
    const targetMap = {
      organiser: organiserRef.current || authRef.current,
      attendee: browseRef.current || detailsRef.current || ticketsRef.current,
      checkin: checkinRef.current || organiserRef.current || authRef.current,
    };

    const target = targetMap[profileMode];
    if (!target) return;

    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [profileMode]);

  function flash(message, isError = false) {
    setStatusMessage("");
    setErrorMessage("");
    if (isError) setErrorMessage(message);
    else setStatusMessage(message);
    setTimeout(() => {
      setStatusMessage("");
      setErrorMessage("");
    }, 5000);
  }

  const qrScanUiRef = useRef({});
  qrScanUiRef.current = { flash, setCheckInNotice, setCheckInCode, setScannerOpen };

  const onQrDecoded = useCallback((code) => {
    const { flash: f, setCheckInNotice: sn, setCheckInCode: sc, setScannerOpen: so } = qrScanUiRef.current;
    sn(null);
    sc(code);
    so(false);
    f("Ticket code captured from QR.");
  }, []);

  const onQrCameraError = useCallback((msg) => {
    const { flash: f, setScannerOpen: so } = qrScanUiRef.current;
    f(msg || "Camera unavailable.", true);
    so(false);
  }, []);

  async function mergeWishlistAfterLogin() {
    try {
      const raw = JSON.parse(localStorage.getItem("eventwithease-wishlist") || "[]");
      const local = Array.isArray(raw) ? raw.map(String) : [];
      if (local.length) {
        await api.post("/wishlist/sync", { eventIds: local });
        localStorage.removeItem("eventwithease-wishlist");
      }
      const { data } = await api.get("/wishlist");
      setWishlist((data.eventIds || []).map(String));
    } catch {
      try {
        const { data } = await api.get("/wishlist");
        setWishlist((data.eventIds || []).map(String));
      } catch {
        const fallback = JSON.parse(localStorage.getItem("eventwithease-wishlist") || "[]");
        setWishlist(Array.isArray(fallback) ? fallback.map(String) : []);
      }
    }
  }

  async function hydrateSession() {
    const token = localStorage.getItem("eventwithease-token");

    try {
      if (token) {
        try {
          const response = await api.get("/auth/me");
          setUser(response.data.user);
          await Promise.all([loadMyTickets(), loadMyEvents(), loadRefunds(), loadHostRefunds(), mergeWishlistAfterLogin()]);
        } catch {
          localStorage.removeItem("eventwithease-token");
          setUser(null);
        }
      }
      await loadEvents();
    } finally {
      setLoading(false);
    }
  }

  async function loadEvents() {
    setEventsError(null);
    try {
      const response = await api.get("/events");
      setEvents(response.data);
      return true;
    } catch (error) {
      const message =
        error.response?.data?.message ||
        error.message ||
        "We could not reach the server. Check your connection and API URL.";
      setEventsError(message);
      setEvents([]);
      return false;
    }
  }

  async function retryLoadEvents() {
    setEventsReloading(true);
    try {
      const ok = await loadEvents();
      if (ok) flash("Events refreshed.");
    } finally {
      setEventsReloading(false);
    }
  }


  async function handleAuthLink() {
    const params = new URLSearchParams(window.location.search);
    const verifyToken = params.get("verifyToken");
    const nextResetToken = params.get("resetToken");
    const stripeSuccess = params.get("stripeSuccess");
    const stripeCancel = params.get("stripeCancel");

    if (stripeCancel) {
      localStorage.removeItem("eventwithease-pending-payment");
      flash("Stripe checkout cancelled.", true);
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    if (stripeSuccess) {
      const eventIdFromBookingPayload = (payload) => {
        const b = payload?.booking;
        if (!b?.eventId) return null;
        const e = b.eventId;
        return typeof e === "object" && e?._id ? String(e._id) : String(e);
      };

      const sessionId = params.get("session_id");
      const pending = localStorage.getItem("eventwithease-pending-payment");
      if (sessionId) {
        try {
          const { data } = await api.post("/bookings", { stripeCheckoutSessionId: sessionId });
          localStorage.removeItem("eventwithease-pending-payment");
          await Promise.all([loadEvents(), loadMyTickets(), loadMyEvents(), loadRefunds(), loadHostRefunds()]);
          const evtId = eventIdFromBookingPayload(data);
          if (evtId) await loadNetworking(evtId);
          flash("Stripe payment confirmed. Tickets generated.");
        } catch (error) {
          flash(error.response?.data?.message || "Stripe payment confirmed but tickets could not be created.", true);
        }
      } else if (pending) {
        try {
          const parsed = JSON.parse(pending);
          const { data } = await api.post("/bookings", {
            eventId: parsed.eventId,
            items: parsed.items,
            discountCode: parsed.discountCode,
          });
          localStorage.removeItem("eventwithease-pending-payment");
          await Promise.all([loadEvents(), loadMyTickets(), loadMyEvents(), loadRefunds(), loadHostRefunds()]);
          const evtId = eventIdFromBookingPayload(data) || (parsed.eventId ? String(parsed.eventId) : null);
          if (evtId) await loadNetworking(evtId);
          flash("Stripe payment confirmed. Tickets generated.");
        } catch (error) {
          flash(error.response?.data?.message || "Stripe payment confirmed but tickets could not be created.", true);
        }
      }
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    if (nextResetToken) {
      setResetToken(nextResetToken);
      setAuthMode("reset");
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    if (!verifyToken) return;

    try {
      const response = await api.post("/auth/verify-email", { token: verifyToken });
      localStorage.setItem("eventwithease-token", response.data.token);
      setUser(response.data.user);
      await Promise.all([loadEvents(), loadMyTickets(), loadMyEvents(), loadRefunds(), loadHostRefunds(), mergeWishlistAfterLogin()]);
      flash(response.data.message || "Email verified.");
    } catch (error) {
      flash(error.response?.data?.message || "Unable to verify email.", true);
    } finally {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }
  async function loadMyTickets() {
    try {
      const response = await api.get("/bookings/mine");
      setMyTickets(response.data);
    } catch {
      setMyTickets([]);
    }
  }

  async function loadMyEvents() {
    try {
      const qs = userRoles.includes("admin") ? "?all=1" : "";
      const response = await api.get(`/events/my-events${qs}`);
      setMyEvents(response.data);
    } catch {
      setMyEvents([]);
    }
  }

  async function loadStaffMyEvents() {
    if (!user) {
      setStaffMyEvents([]);
      return;
    }
    try {
      const { data } = await api.get("/event-staff/mine");
      setStaffMyEvents(Array.isArray(data) ? data : []);
    } catch {
      setStaffMyEvents([]);
    }
  }

  async function loadAdminSnapshot() {
    if (!userRoles.includes("admin")) return;
    try {
      const [ev, us] = await Promise.all([api.get("/admin/events"), api.get("/admin/users")]);
      setAdminEvents(Array.isArray(ev.data) ? ev.data : []);
      setAdminUsers(Array.isArray(us.data) ? us.data : []);
      setAdminSnapshotLoaded(true);
    } catch (e) {
      flash(e.response?.data?.message || "Could not load admin data.", true);
    }
  }

  async function loadRefunds() {
    try {
      const response = await api.get("/refunds/mine");
      setRefunds(response.data);
    } catch {
      setRefunds([]);
    }
  }

  const loadHostRefunds = useCallback(async () => {
    if (!user) {
      setHostRefunds([]);
      return;
    }
    const roles = user.roles?.length ? user.roles : user.role ? [user.role] : [];
    if (!roles.includes("organiser") && !roles.includes("admin")) {
      setHostRefunds([]);
      return;
    }
    try {
      const { data } = await api.get("/refunds/my-events");
      setHostRefunds(Array.isArray(data) ? data : []);
    } catch {
      setHostRefunds([]);
    }
  }, [user]);

  useEffect(() => {
    loadHostRefunds();
    const id = setInterval(loadHostRefunds, 60_000);
    return () => clearInterval(id);
  }, [loadHostRefunds]);

  async function loadReviews(eventId) {
    try {
      const response = await api.get(`/reviews/event/${eventId}`);
      setReviews(response.data);
    } catch {
      setReviews([]);
    }
  }

  async function loadNetworking(eventId) {
    if (!user) return;
    try {
      const response = await api.get(`/events/${eventId}/networking`);
      setNetworkingList(response.data);
    } catch {
      setNetworkingList([]);
    }
  }

  const updateAuthField = (key, value) => setAuthForm((current) => ({ ...current, [key]: value }));

  const updateBookingPromo = (key, value) =>
    setEventForm((current) => ({
      ...current,
      bookingPromo: { ...current.bookingPromo, [key]: value },
    }));

  function userHasBookingForEvent(eventId) {
    if (!user || !eventId) return false;
    return myTickets.some(
      (t) =>
        String(t.eventId?._id || t.eventId) === String(eventId) &&
        t.status !== "refunded" &&
        t.status !== "expired"
    );
  }

  /** Shared between #ewe-account and the host-profile auth modal (same ref for Google button). */
  function renderGuestAuthFormFields() {
    return (
      <>
        {(authMode === "login" || authMode === "signup") && (
          <>
            {authMode === "signup" && (
              <input
                placeholder="Full name"
                value={authForm.name}
                onChange={(e) => updateAuthField("name", e.target.value)}
              />
            )}
            <input
              type="email"
              placeholder="Email address"
              value={authForm.email}
              onChange={(e) => updateAuthField("email", e.target.value)}
            />
            <input
              type="password"
              placeholder="Password"
              value={authForm.password}
              onChange={(e) => updateAuthField("password", e.target.value)}
            />
            <div className="oauth-wrap">
              <p className="oauth-label">{authMode === "signup" ? "Or sign up with Google" : "Or sign in with Google"}</p>
              {import.meta.env.VITE_GOOGLE_CLIENT_ID ? (
                <div ref={googleButtonRef} className="google-button-slot" />
              ) : (
                <button className="google-disabled" type="button" disabled>
                  {authMode === "signup" ? "Google sign-up not configured" : "Google sign-in not configured"}
                </button>
              )}
            </div>
          </>
        )}

        {authMode === "forgot" && (
          <input
            type="email"
            placeholder="Account email"
            value={authForm.email}
            onChange={(e) => updateAuthField("email", e.target.value)}
          />
        )}

        {authMode === "reset" && (
          <input
            type="password"
            placeholder="New password"
            value={authForm.password}
            onChange={(e) => updateAuthField("password", e.target.value)}
          />
        )}
      </>
    );
  }

  const updateEventField = (key, value) => setEventForm((current) => ({ ...current, [key]: value }));

  const updateTicketType = (index, key, value) =>
    setEventForm((current) => ({
      ...current,
      ticketTypes: current.ticketTypes.map((ticket, ticketIndex) =>
        ticketIndex === index ? { ...ticket, [key]: value } : ticket
      ),
    }));

  const addTicketType = () =>
    setEventForm((current) => ({
      ...current,
      ticketTypes: [...current.ticketTypes, { name: "", price: "0", quantity: "10", earlyBirdPrice: "", earlyBirdEndsAt: "" }],
    }));

  const removeTicketType = (index) =>
    setEventForm((current) => ({
      ...current,
      ticketTypes: current.ticketTypes.filter((_, ticketIndex) => ticketIndex !== index),
    }));

  const updateDiscountCode = (index, key, value) =>
    setEventForm((current) => ({
      ...current,
      discountCodes: current.discountCodes.map((code, codeIndex) =>
        codeIndex == index ? { ...code, [key]: value } : code
      ),
    }));

  const addDiscountCode = () =>
    setEventForm((current) => ({
      ...current,
      discountCodes: [...current.discountCodes, { code: "", type: "percent", value: "10", expiresAt: "" }],
    }));

  const removeDiscountCode = (index) =>
    setEventForm((current) => ({
      ...current,
      discountCodes: current.discountCodes.filter((_, codeIndex) => codeIndex !== index),
    }));

  const updateFaq = (index, key, value) =>
    setEventForm((current) => ({
      ...current,
      faq: current.faq.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item
      ),
    }));

  const addFaq = () =>
    setEventForm((current) => ({
      ...current,
      faq: [...current.faq, { question: "", answer: "" }],
    }));

  const removeFaq = (index) =>
    setEventForm((current) => ({
      ...current,
      faq: current.faq.filter((_, itemIndex) => itemIndex !== index),
    }));

  async function handleAuthSubmit(event) {
    event.preventDefault();
    try {
      if (authMode === "forgot") {
        const response = await api.post("/auth/forgot-password", { email: authForm.email });
        flash(response.data.message || "Password reset email sent.");
        return;
      }

      if (authMode === "reset") {
        const response = await api.post("/auth/reset-password", { token: resetToken, password: authForm.password });
        setAuthForm(emptyAuthForm);
        setResetToken("");
        setAuthMode("login");
        flash(response.data.message || "Password updated. Login now.");
        return;
      }

      const endpoint = authMode === "login" ? "/auth/login" : "/auth/signup";
      const payload = authMode === "login" ? { email: authForm.email, password: authForm.password } : authForm;
      const response = await api.post(endpoint, payload);

      if (!response.data.token) {
        setAuthMode("login");
        flash(response.data.message || "Check your email to continue.");
        return;
      }

      localStorage.setItem("eventwithease-token", response.data.token);
      setUser(response.data.user);
      setAuthForm(emptyAuthForm);
      setHostAuthModalOpen(false);
      await Promise.all([loadEvents(), loadMyTickets(), loadMyEvents(), loadRefunds(), loadHostRefunds(), mergeWishlistAfterLogin()]);
      flash(authMode === "login" ? "Welcome back." : "Account created.");
    } catch (error) {
      flash(error.response?.data?.message || "Authentication failed.", true);
    }
  }

  async function handleGoogleCredential(response) {
    try {
      const googleResponse = await api.post("/auth/google", {
        credential: response.credential,
        role: authRoleRef.current,
        intent: authMode,
      });
      localStorage.setItem("eventwithease-token", googleResponse.data.token);
      setUser(googleResponse.data.user);
      setHostAuthModalOpen(false);
      await Promise.all([loadEvents(), loadMyTickets(), loadMyEvents(), loadRefunds(), loadHostRefunds(), mergeWishlistAfterLogin()]);
      flash("Signed in with Google.");
    } catch (error) {
      flash(error.response?.data?.message || "Google sign-in failed.", true);
    }
  }

  async function resendVerification() {
    try {
      const response = await api.post("/auth/resend-verification", { email: authForm.email });
      flash(response.data.message || "Verification email sent.");
    } catch (error) {
      flash(error.response?.data?.message || "Unable to resend verification.", true);
    }
  }

  async function handleSelectEvent(id, { updateUrl = true } = {}) {
    try {
      const response = await api.get(`/events/${id}`);
      const data = response.data;
      lastOpenedEventIdRef.current = String(id);
      setSelectedEvent(data);
      setTicketCart(Object.fromEntries(data.ticketTypes.map((ticket, index) => [ticket._id, index === 0 ? 1 : 0])));
      setReviewForm({ rating: 5, comment: "" });
      setFeedbackForm({ rating: 5, feedback: "" });
      if (updateUrl) {
        navigate(`/event/${id}`, { replace: false });
      }
      await loadReviews(id);
      if (userHasBookingForEvent(id)) {
        await loadNetworking(id);
      } else {
        setNetworkingList([]);
      }
      setProfileMode("attendee");
      flash(
        data.cancelledAt
          ? `${data.title} is cancelled — new tickets are not on sale.`
          : `Loaded ${data.title}. Choose your ticket below.`
      );
    } catch (error) {
      flash(error.response?.data?.message || "Unable to load event.", true);
      if (!updateUrl) {
        navigate("/", { replace: true });
      }
    }
  }

  useEffect(() => {
    setPromoOverlayDismissed(false);
  }, [selectedEvent?._id]);

  useEffect(() => {
    if (!eventIdInPath) {
      lastOpenedEventIdRef.current = "";
      return;
    }
    if (loading) return;
    if (lastOpenedEventIdRef.current === eventIdInPath) return;
    if (selectedEvent && String(selectedEvent._id) === eventIdInPath) {
      lastOpenedEventIdRef.current = eventIdInPath;
      return;
    }
    handleSelectEvent(eventIdInPath, { updateUrl: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- URL-driven load only
  }, [loading, eventIdInPath, selectedEvent?._id]);

  useEffect(() => {
    if (!hostIdInPath) {
      setHostPage(null);
      setHostPageError(null);
      setHostPageLoading(false);
      setHostAuthModalOpen(false);
      return undefined;
    }
    if (loading) return undefined;

    let cancelled = false;
    setHostPageLoading(true);
    setHostPageError(null);

    (async () => {
      try {
        const { data } = await api.get(`/organisers/${hostIdInPath}/profile`);
        if (!cancelled) {
          setHostPage(data);
          setHostPageError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setHostPage(null);
          setHostPageError(e.response?.data?.message || "Could not load this host.");
        }
      } finally {
        if (!cancelled) setHostPageLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, hostIdInPath, user?.id]);

  /** After navigating from /host/… to home, scroll to a section or account (see openAccount / nav handlers). */
  useEffect(() => {
    if (loading || hostIdInPath) return;
    const scrollTo = location.state?.scrollTo;
    const focusAccount = location.state?.focusAccount;
    if (!scrollTo && !focusAccount) return;
    const path = `${location.pathname}${location.search || ""}`;
    navigate(path, { replace: true, state: {} });
    requestAnimationFrame(() => {
      if (scrollTo) document.getElementById(String(scrollTo))?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (focusAccount) authRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [loading, hostIdInPath, location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    if (!hostAuthModalOpen) return;
    function onKey(event) {
      if (event.key === "Escape") setHostAuthModalOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hostAuthModalOpen]);

  useEffect(() => {
    if (!hostAuthModalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [hostAuthModalOpen]);

  async function handleCreateEvent(event) {
    event.preventDefault();
    try {
      await api.post("/events", eventForm);
      setEventForm(emptyEventForm);
      await Promise.all([loadEvents(), loadMyEvents()]);
      flash("Event created and published.");
    } catch (error) {
      flash(error.response?.data?.message || "Unable to create event.", true);
    }
  }


  function updateTicketCart(ticketTypeId, quantity) {
    setTicketCart((current) => ({
      ...current,
      [ticketTypeId]: Math.max(0, Number(quantity) || 0),
    }));
  }

  function checkoutItems() {
    return Object.entries(ticketCart)
      .map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity: Number(quantity) }))
      .filter((item) => item.quantity > 0);
  }

  function getTicketEffectivePrice(ticket) {
    return effectiveTicketPrice(ticket);
  }

  function checkoutSubtotal() {
    if (!selectedEvent) return 0;
    return checkoutItems().reduce((sum, item) => {
      const ticket = selectedEvent.ticketTypes.find((ticketType) => ticketType._id === item.ticketTypeId);
      return sum + getTicketEffectivePrice(ticket) * item.quantity;
    }, 0);
  }

  function getActiveDiscount() {
    if (!selectedEvent || !discountCode.trim()) return null;
    const normalizedCode = discountCode.trim().toUpperCase();
    return selectedEvent.discountCodes?.find((code) => {
      if (!code?.code) return false;
      const isMatch = code.code.toUpperCase() === normalizedCode;
      const expiresAt = code.expiresAt ? new Date(code.expiresAt) : null;
      const isActive = !expiresAt || expiresAt > new Date();
      return isMatch && isActive;
    }) || null;
  }

  function checkoutDiscountAmount(subtotal) {
    const discount = getActiveDiscount();
    if (!discount) return 0;
    const value = Number(discount.value) || 0;
    if (discount.type === "percent") {
      return Math.max(0, Math.min(subtotal, (subtotal * value) / 100));
    }
    return Math.max(0, Math.min(subtotal, value));
  }

  function checkoutTotal() {
    const subtotal = checkoutSubtotal();
    const discountAmount = checkoutDiscountAmount(subtotal);
    return Math.max(0, subtotal - discountAmount);
  }
  async function handleStripeCheckout() {
    setPaymentMessage("");
    const items = checkoutItems();
    if (!selectedEvent || !items.length) {
      setPaymentMessage("Select at least one ticket quantity first.");
      return;
    }
    if (!user) {
      setPaymentMessage("Login before paying.");
      authRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (selectedEvent.cancelledAt) {
      setPaymentMessage("This event is cancelled — checkout is closed.");
      return;
    }

    try {
      localStorage.setItem(
        "eventwithease-pending-payment",
        JSON.stringify({ eventId: selectedEvent._id, items, discountCode })
      );
      const response = await api.post("/payments/stripe/checkout", {
        eventId: selectedEvent._id,
        items,
        discountCode: discountCode.trim() || undefined,
      });

      if (response.data.mode === "stripe" && response.data.checkoutUrl) {
        window.location.href = response.data.checkoutUrl;
        return;
      }

      setPaymentMessage(
        `${response.data.message || "Stripe sandbox simulated."}${
          response.data.summary
            ? ` — Order: ${(response.data.summary.lineItems || [])
                .map((line) => `${line.quantity}× ${line.name}`)
                .join(", ")}. Total ${formatCurrency(response.data.summary.total)}.`
            : ""
        }`
      );
      await handleBookTickets(new Event("submit"));
    } catch (error) {
      setPaymentMessage(error.response?.data?.message || "Unable to start Stripe checkout.");
    }
  }

  async function handleRazorpayCheckout() {
    setPaymentMessage("");
    const items = checkoutItems();
    if (!selectedEvent || !items.length) {
      setPaymentMessage("Select at least one ticket quantity first.");
      return;
    }
    if (!user) {
      setPaymentMessage("Login before paying.");
      authRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (selectedEvent.cancelledAt) {
      setPaymentMessage("This event is cancelled — checkout is closed.");
      return;
    }

    try {
      const response = await api.post("/payments/razorpay/order", {
        eventId: selectedEvent._id,
        items,
        discountCode: discountCode.trim() || undefined,
      });
      setPaymentMessage(
        `${response.data.message || "Razorpay sandbox simulated."}${
          response.data.summary
            ? ` — Order: ${(response.data.summary.lineItems || [])
                .map((line) => `${line.quantity}× ${line.name}`)
                .join(", ")}. Total ${formatCurrency(response.data.summary.total)}.`
            : ""
        }`
      );
      await handleBookTickets(new Event("submit"));
    } catch (error) {
      setPaymentMessage(error.response?.data?.message || "Unable to start Razorpay checkout.");
    }
  }

  async function handleBookTickets(event) {
    event.preventDefault();
    setBookingMessage("");
    const items = checkoutItems();

    if (profileMode !== "attendee") {
      setBookingMessage("Switch to Attendee mode to book tickets.");
      return;
    }

    if (!selectedEvent || !items.length) {
      setBookingMessage("Select at least one ticket quantity first.");
      return;
    }

    if (selectedEvent.cancelledAt) {
      setBookingMessage("This event is cancelled — new tickets are not available.");
      flash("This event is cancelled.", true);
      return;
    }

    if (!user) {
      const message = "Login or use Google sign-in before booking.";
      setBookingMessage(message);
      flash(message, true);
      authRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    try {
      const trimmedCode = discountCode.trim();
      const response = await api.post("/bookings", {
        eventId: selectedEvent._id,
        items,
        discountCode: trimmedCode || undefined,
      });
      setLastBookingErrorCode(null);
      await Promise.all([loadEvents(), loadMyTickets()]);
      await loadNetworking(selectedEvent._id);
      setTicketCart(Object.fromEntries(selectedEvent.ticketTypes.map((ticket) => [ticket._id, 0])));
      setDiscountCode("");
      setBookingMessage(`${response.data.tickets.length} QR ticket(s) generated. Open My tickets for your QR codes.`);
      flash("Booking confirmed. Your QR ticket is ready below.");
      requestAnimationFrame(() => {
        ticketsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (error) {
      const message = error.response?.data?.message || "Unable to complete booking.";
      const code = error.response?.data?.code ?? null;
      setLastBookingErrorCode(code);
      setBookingMessage(message);
      flash(message, true);
    }
  }

  async function joinEventWaitlistForSelection() {
    if (!selectedEvent || !user) return;
    const items = checkoutItems();
    const first = items.find((row) => row.quantity > 0);
    const ticketTypeId = first?.ticketTypeId || null;
    try {
      await api.post("/waitlist", { eventId: selectedEvent._id, ticketTypeId: ticketTypeId || undefined });
      flash("You are on the waitlist. We will notify you if capacity opens.");
    } catch (err) {
      flash(err.response?.data?.message || "Could not join waitlist.", true);
    }
  }

  function downloadTicketQr(ticketId, ticketCode) {
    const svgElement = document.getElementById(`qr-${ticketId}`);
    if (!svgElement) return;

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgElement);
    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const image = new Image();

    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      URL.revokeObjectURL(url);

      const pngUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = pngUrl;
      link.download = `EventwithEase-${ticketCode}.png`;
      link.click();
    };

    image.src = url;
  }

  async function cancelBooking(bookingId) {
    try {
      const response = await api.post(`/bookings/${bookingId}/cancel`, {});
      if (response.data.kind === "refund_requested" && response.data.refund) {
        setRefunds((current) => [response.data.refund, ...current]);
      }
      flash(response.data.message || "Booking updated.");
      await Promise.all([loadMyTickets(), loadRefunds(), loadHostRefunds()]);
    } catch (error) {
      flash(error.response?.data?.message || "Unable to cancel booking.", true);
    }
  }

  async function submitReview() {
    if (!selectedEvent) return;
    try {
      const response = await api.post("/reviews", {
        eventId: selectedEvent._id,
        rating: reviewForm.rating,
        comment: reviewForm.comment,
      });
      setReviews((current) => [response.data, ...current.filter((item) => item._id !== response.data._id)]);
      flash("Review submitted.");
    } catch (error) {
      flash(error.response?.data?.message || "Unable to submit review.", true);
    }
  }

  async function submitFeedback() {
    if (!selectedEvent) return;
    try {
      await api.post("/feedback", {
        eventId: selectedEvent._id,
        rating: feedbackForm.rating,
        feedback: feedbackForm.feedback,
      });
      flash("Feedback submitted.");
    } catch (error) {
      flash(error.response?.data?.message || "Unable to submit feedback.", true);
    }
  }

  async function saveProfile() {
    try {
      const body = {};
      if (isOrganiser) {
        body.linkedinUrl = profileForm.linkedinUrl;
        body.networkingOptIn = profileForm.networkingOptIn;
        body.hostTagline = profileForm.hostTagline;
        body.hostBio = profileForm.hostBio;
        body.twitterUrl = profileForm.twitterUrl;
        body.instagramUrl = profileForm.instagramUrl;
        body.websiteUrl = profileForm.websiteUrl;
      }
      const response = await api.post("/auth/profile", body);
      setUser(response.data.user);
      flash("Profile updated.");
    } catch (error) {
      flash(error.response?.data?.message || "Unable to update profile.", true);
    }
  }


  async function addStaffMember() {
    if (!dashboard?.event?._id || !staffInviteEmail.trim()) return;
    try {
      await api.post(`/event-staff/event/${dashboard.event._id}`, { email: staffInviteEmail.trim().toLowerCase() });
      setStaffInviteEmail("");
      flash("Door staff added.");
      await openDashboard(dashboard.event._id);
    } catch (error) {
      flash(error.response?.data?.message || "Could not add staff.", true);
    }
  }

  async function removeStaffMember(staffRowId) {
    try {
      await api.delete(`/event-staff/${staffRowId}`);
      flash("Staff removed.");
      if (dashboard?.event?._id) await openDashboard(dashboard.event._id);
    } catch (error) {
      flash(error.response?.data?.message || "Could not remove staff.", true);
    }
  }

  async function adminCancelEvent(eventId) {
    if (!window.confirm("Cancel this event for all attendees? This sends cancellation emails when SMTP is on.")) return;
    try {
      await api.post(`/admin/events/${eventId}/cancel`);
      flash("Event cancelled.");
      await Promise.all([loadEvents(), loadAdminSnapshot()]);
    } catch (error) {
      flash(error.response?.data?.message || "Cancel failed.", true);
    }
  }

  async function openDashboard(id) {
    try {
      setCheckInGateEvent(null);
      setEventWaitlist([]);
      const response = await api.get(`/events/${id}/dashboard`);
      setDashboard(response.data);
      try {
        const refundsResponse = await api.get(`/refunds/event/${id}`);
        setRefundRequests(refundsResponse.data);
      } catch {
        setRefundRequests([]);
      }
      try {
        const waitlistResponse = await api.get(`/waitlist/event/${id}`);
        setEventWaitlist(Array.isArray(waitlistResponse.data) ? waitlistResponse.data : []);
      } catch {
        setEventWaitlist([]);
      }
      try {
        const staffRes = await api.get(`/event-staff/event/${id}`);
        setDashboardStaff(Array.isArray(staffRes.data) ? staffRes.data : []);
      } catch {
        setDashboardStaff([]);
      }
      await loadHostRefunds();
      try {
        const feedbackResponse = await api.get(`/feedback/event/${id}`);
        setFeedbackEntries(feedbackResponse.data);
      } catch {
        setFeedbackEntries([]);
      }
    } catch (error) {
      flash(error.response?.data?.message || "Unable to load dashboard.", true);
    }
  }

  function normalizeTicketCodeInput(raw) {
    const s = String(raw ?? "").trim();
    const embedded = s.match(/EWE-[A-F0-9]{8}/i);
    return embedded ? embedded[0].toUpperCase() : s.replace(/\s+/g, "").toUpperCase();
  }

  async function handleCheckIn(event) {
    event.preventDefault();
    setCheckInNotice(null);
    const code = normalizeTicketCodeInput(checkInCode);
    if (!code) {
      const msg = "Enter or scan a ticket code (format EWE-XXXXXXXX).";
      setCheckInNotice({ ok: false, text: msg });
      flash(msg, true);
      checkinFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const gateEventId = checkInGateEvent?._id || dashboard?.event?._id;
    if (!userRoles.includes("admin") && !gateEventId) {
      const msg =
        "Select your event (Managed events or your staff assignment), then scan — check-in applies to that gate only.";
      setCheckInNotice({ ok: false, text: msg });
      flash(msg, true);
      checkinFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    try {
      const body = { ticketCode: code, verifyOnly: checkInVerifyOnly };
      if (gateEventId) {
        body.eventId = gateEventId;
      }
      const response = await api.post("/checkin", body);
      const name = response.data.ticket?.userId?.name || "Attendee";
      const msg = response.data.verifyOnly
        ? `${name} — ticket verified (not checked in).`
        : `${name} checked in successfully.`;
      setCheckInNotice({ ok: true, text: msg });
      flash(msg);
      setCheckInCode("");
      if (gateEventId && !response.data.verifyOnly) {
        await openDashboard(String(gateEventId));
      }
      checkinFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
      const data = error.response?.data;
      const msg =
        data?.message ||
        (error.response?.status === 409
          ? "This ticket was already scanned — each QR works once."
          : error.message) ||
        "Unable to check in ticket.";
      setCheckInNotice({ ok: false, text: msg });
      flash(msg, true);
      checkinFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }


  async function toggleWishlist(eventId) {
    const id = String(eventId);
    if (user) {
      const on = wishlistSet.has(id);
      try {
        if (on) {
          const { data } = await api.delete(`/wishlist/${id}`);
          setWishlist((data.eventIds || []).map(String));
        } else {
          const { data } = await api.post(`/wishlist/${id}`);
          setWishlist((data.eventIds || []).map(String));
        }
      } catch (error) {
        flash(error.response?.data?.message || "Could not update wishlist.", true);
      }
      return;
    }
    setWishlist((current) => {
      const cur = current.map(String);
      return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    });
  }

  function generateEventAgenda(event) {
    return event.agenda?.length
      ? event.agenda
      : ["Doors open and attendee check-in", `${event.category} keynote or opening act`, "Networking and closing notes"];
  }

  function generateEventSpeakers(event) {
    return event.speakers?.length ? event.speakers : [eventOrganiserDisplayName(event) || "Event organiser", "Guest mentor"];
  }

  function addSession() {
    setEventForm((current) => ({
      ...current,
      sessions: [...current.sessions, { title: "", speaker: "", duration: "30", preferredSlot: "Morning" }],
    }));
  }

  function updateSession(index, key, value) {
    setEventForm((current) => ({
      ...current,
      sessions: current.sessions.map((session, sessionIndex) =>
        sessionIndex === index ? { ...session, [key]: value } : session
      ),
    }));
  }

  function removeSession(index) {
    setEventForm((current) => ({
      ...current,
      sessions: current.sessions.filter((_, sessionIndex) => sessionIndex !== index),
    }));
  }

  function formatTimeShort(value) {
    return new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  }

  function buildSmartSchedule() {
    const sessions = eventForm.sessions.filter((session) => session.title.trim());
    if (!sessions.length) {
      flash("Add at least one session to build a schedule.", true);
      return;
    }

    const slotOrder = { Morning: 0, Afternoon: 1, Evening: 2, Anytime: 3 };
    const sorted = [...sessions].sort(
      (a, b) => (slotOrder[a.preferredSlot] ?? 3) - (slotOrder[b.preferredSlot] ?? 3)
    );

    for (let i = 1; i < sorted.length; i += 1) {
      const prevSpeaker = (sorted[i - 1].speaker || "").trim().toLowerCase();
      const currSpeaker = (sorted[i].speaker || "").trim().toLowerCase();
      if (!currSpeaker || currSpeaker !== prevSpeaker) continue;

      const swapIndex = sorted.findIndex(
        (session, index) =>
          index > i && (session.speaker || "").trim().toLowerCase() !== currSpeaker
      );

      if (swapIndex > -1) {
        const temp = sorted[i];
        sorted[i] = sorted[swapIndex];
        sorted[swapIndex] = temp;
      }
    }

    const start = eventForm.date ? new Date(eventForm.date) : new Date();
    let cursor = new Date(start);

    const agenda = sorted.map((session) => {
      const duration = Number(session.duration) || 30;
      const startTime = new Date(cursor);
      const endTime = new Date(cursor.getTime() + duration * 60000);
      cursor = endTime;

      const label = `${formatTimeShort(startTime)} – ${formatTimeShort(endTime)} · ${session.title}`;
      return session.speaker ? `${label} (${session.speaker})` : label;
    });

    const speakers = sorted.map((session) => session.speaker).filter(Boolean);

    setEventForm((current) => ({
      ...current,
      agenda,
      speakers,
    }));

    flash("Smart schedule generated.");
  }

  function downloadDashboardCsv() {
    if (!dashboard?.attendees?.length) {
      flash("No attendees to export yet.", true);
      return;
    }

    const rows = [
      ["Name", "Email", "Ticket type", "Ticket code", "Checked in at", "Status"],
      ...dashboard.attendees.map((ticket) => [
        ticket.userId?.name || "",
        ticket.userId?.email || "",
        ticket.ticketTypeName || "",
        ticket.ticketCode,
        ticket.status === "checked-in" && ticket.checkedInAt ? new Date(ticket.checkedInAt).toISOString() : "",
        ticket.status,
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${dashboard.event.title.replace(/\s+/g, "-").toLowerCase()}-attendees.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function generateDescriptionDraft() {
    const ticketNames = eventForm.ticketTypes.map((ticket) => ticket.name).filter(Boolean).join(", ") || "curated passes";
    const title = eventForm.title || "this event";
    const category = eventForm.category || "community";
    const location = eventForm.location || "a memorable venue";
    const city = eventForm.city ? `${eventForm.city} — ` : "";
    const bullets = descriptionOutline
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const highlights = bullets.length
      ? `Highlights include ${bullets.slice(0, 4).join("; ")}${bullets.length > 4 ? "; and more" : ""}.`
      : "Highlights will be announced closer to the date.";

    updateEventField(
      "description",
      `${title} brings together ${category.toLowerCase()} enthusiasts for a focused, high-energy experience at ${city}${location}. ${highlights} Expect a smooth check-in flow, thoughtful programming, and ticket options including ${ticketNames}. Whether attendees are joining to learn, network, or celebrate, this event is designed to feel polished from booking to entry.`
    );
  }

  function focusProfileMode(mode) {
    setProfileMode(mode);

    const targetMap = {
      organiser: organiserRef.current || authRef.current,
      attendee: browseRef.current || detailsRef.current || ticketsRef.current,
      checkin: checkinRef.current || organiserRef.current || authRef.current,
    };

    requestAnimationFrame(() => {
      targetMap[mode]?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function panelClass(base, modes) {
    return `${base}${modes.includes(profileMode) ? " panel-spotlight" : " panel-muted"}`;
  }
  function logout() {
    localStorage.removeItem("eventwithease-token");
    setUser(null);
    setMyTickets([]);
    setMyEvents([]);
    setDashboard(null);
    setCheckInGateEvent(null);
    setDashboardStaff([]);
    setAdminEvents([]);
    setAdminUsers([]);
    setAdminSnapshotLoaded(false);
    setSelectedEvent(null);
    const saved = JSON.parse(localStorage.getItem("eventwithease-wishlist") || "[]");
    setWishlist(Array.isArray(saved) ? saved.map(String) : []);
    flash("Logged out.");
  }

  function scrollToRef(ref) {
    requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function goDiscover() {
    lastOpenedEventIdRef.current = "";
    navigate("/");
    setSelectedEvent(null);
    setProfileMode("attendee");
    scrollToRef(browseRef);
  }

  function goStats() {
    navigate("/stats");
  }

  function goWishlist() {
    if (hostIdInPath) {
      navigate("/wishlist");
      setProfileMode("attendee");
      return;
    }
    setProfileMode("attendee");
    navigate("/wishlist");
  }

  function getSelectedEventShareUrl() {
    if (!selectedEvent?._id) return "";
    return `${window.location.origin}/event/${selectedEvent._id}`;
  }

  function copySelectedEventLink() {
    const url = getSelectedEventShareUrl();
    if (!url) return;
    navigator.clipboard.writeText(url).then(
      () => flash("Event link copied to clipboard."),
      () => flash("Could not copy link.", true)
    );
  }

  function copyOgPreviewLink() {
    if (!selectedEvent?._id) return;
    const url = ogEventUrl(selectedEvent._id);
    navigator.clipboard.writeText(url).then(
      () => flash("Preview link copied — use this in LinkedIn/Facebook for rich cards."),
      () => flash("Could not copy link.", true)
    );
  }

  function shareSelectedEventNative() {
    const url = getSelectedEventShareUrl();
    if (!url || !selectedEvent) return;
    const title = selectedEvent.title || "Event";
    const text = `Check out ${title} on EventwithEase`;
    if (navigator.share) {
      navigator.share({ title, text, url }).catch(() => {});
    } else {
      copySelectedEventLink();
    }
  }

  function openShareWindow(href) {
    window.open(href, "_blank", "noopener,noreferrer");
  }

  function shareWhatsApp() {
    const url = getSelectedEventShareUrl();
    if (!url || !selectedEvent) return;
    const text = encodeURIComponent(`${selectedEvent.title}\n${url}`);
    openShareWindow(`https://wa.me/?text=${text}`);
  }

  function shareTelegram() {
    const url = getSelectedEventShareUrl();
    if (!url || !selectedEvent) return;
    const text = encodeURIComponent(selectedEvent.title);
    const u = encodeURIComponent(url);
    openShareWindow(`https://t.me/share/url?url=${u}&text=${text}`);
  }

  function shareTwitter() {
    const url = getSelectedEventShareUrl();
    if (!url || !selectedEvent) return;
    const text = encodeURIComponent(`${selectedEvent.title}`);
    const u = encodeURIComponent(url);
    openShareWindow(`https://twitter.com/intent/tweet?text=${text}&url=${u}`);
  }

  function shareLinkedIn() {
    if (!selectedEvent?._id) return;
    const preview = ogEventUrl(selectedEvent._id);
    openShareWindow(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(preview)}`);
  }

  function shareFacebook() {
    if (!selectedEvent?._id) return;
    const preview = ogEventUrl(selectedEvent._id);
    openShareWindow(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(preview)}`);
  }

  function shareInstagramHint() {
    copySelectedEventLink();
    flash("Link copied — paste it in your Instagram story, bio, or DM.");
  }

  function shareEmail() {
    const url = getSelectedEventShareUrl();
    if (!url || !selectedEvent) return;
    const subject = encodeURIComponent(`Join me: ${selectedEvent.title}`);
    const body = encodeURIComponent(`${selectedEvent.title}\n\n${url}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  function goBook() {
    setProfileMode("attendee");
    if (hostIdInPath) {
      navigate(selectedEvent?._id ? `/event/${selectedEvent._id}` : "/", { state: selectedEvent?._id ? undefined : { scrollTo: "ewe-discover" } });
      return;
    }
    if (selectedEvent?._id) {
      navigate(`/event/${selectedEvent._id}`);
      return;
    }
    navigate("/", { state: { scrollTo: "ewe-discover" } });
  }

  function goTickets() {
    if (hostIdInPath && !user) {
      flash("Sign in to see My tickets.", true);
      setHostAuthModalOpen(true);
      setAuthMode("login");
      return;
    }
    setProfileMode("attendee");
    navigate("/tickets");
  }

  function goOrganise() {
    if (!user) {
      flash("Sign in with an organiser account to create and manage events.", true);
      if (hostIdInPath) {
        setHostAuthModalOpen(true);
        setAuthMode("login");
        return;
      }
      navigate("/organise");
      return;
    }
    if (!isOrganiser) {
      flash("This account cannot publish events. Use an organiser profile.", true);
      if (hostIdInPath) {
        navigate("/", { state: { scrollTo: "ewe-account" } });
        return;
      }
      navigate("/organise");
      return;
    }
    setProfileMode("organiser");
    navigate("/organise");
  }

  function goCheckIn() {
    if (!user) {
      flash("Sign in to use the check-in panel.", true);
      if (hostIdInPath) {
        setHostAuthModalOpen(true);
        setAuthMode("login");
        return;
      }
      navigate("/check-in");
      return;
    }
    if (!isOrganiser && staffMyEvents.length === 0) {
      flash("Check-in is available to hosts and invited door staff.", true);
      if (hostIdInPath) {
        navigate("/", { state: { scrollTo: "ewe-account" } });
        return;
      }
      navigate("/check-in");
      return;
    }
    setProfileMode("checkin");
    navigate("/check-in");
  }

  function openAccount() {
    // Always open the auth modal from header/menu actions (better UX on mobile vs scrolling).
    if (!user) {
      setHostAuthModalOpen(true);
      setAuthMode("login");
      return;
    }
    // Signed-in users: keep current behavior (scroll to account panel when on home).
    if (!hostIdInPath) scrollToRef(authRef);
  }

  function goHostProfile(organiserId) {
    if (!organiserId) return;
    navigate(`/host/${organiserId}`);
  }

  async function shareHostProfile() {
    if (!hostPage?.host?.name) return;
    const path = `/host/${hostPage.host._id}`;
    const url = `${window.location.origin}${path}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${hostPage.host.name} on EventwithEase`,
          text: "See their events, reviews, and trust score.",
          url,
        });
        flash("Share sheet opened.");
      } else {
        await navigator.clipboard.writeText(url);
        flash("Host profile link copied.");
      }
    } catch (e) {
      if (e?.name !== "AbortError") flash("Could not share link.", true);
    }
  }

  async function shareHostEvent(event) {
    if (!event?._id) return;
    const url = `${window.location.origin}/event/${event._id}`;
    const hostLabel = hostPage?.host?.name || "this host";
    try {
      if (navigator.share) {
        await navigator.share({
          title: event.title,
          text: `Hosted by ${hostLabel} on EventwithEase — pricing and booking on the link.`,
          url,
        });
        flash("Share sheet opened.");
      } else {
        await navigator.clipboard.writeText(url);
        flash("Event link copied — send it anywhere.");
      }
    } catch (e) {
      if (e?.name !== "AbortError") flash("Could not share event.", true);
    }
  }

  function renderHostProfileEventCard(event, index, { past = false } = {}) {
    const tix = Array.isArray(event.ticketTypes) ? event.ticketTypes : [];
    const canBook = !past && !event.cancelledAt;
    return (
      <article className="event-card host-profile-event-card" key={event._id} style={{ animationDelay: `${index * 0.05}s` }}>
        <div
          className="event-cover"
          style={{
            backgroundImage: event.coverImage
              ? `linear-gradient(180deg,rgba(13,15,20,0.2),rgba(13,15,20,0.85)),url(${event.coverImage})`
              : "linear-gradient(135deg,#0d4a46,#0a1a2e)",
          }}
        >
          <span className="pill">{event.category}</span>
          {event.cancelledAt ? (
            <span className="pill pill--warn" style={{ marginLeft: 6 }}>
              Cancelled
            </span>
          ) : null}
        </div>
        <div className="event-content">
          <p className="card-label">{past ? "Past event" : "Hosted event"}</p>
          <h3>{event.title}</h3>
          <p>{event.description}</p>
          <div className="meta-list">
            <span>{formatDate(event.date)}</span>
            {event.city ? <span>{event.city}</span> : null}
            <span>{event.location}</span>
          </div>
          {tix.length ? (
            <div className="host-ticket-block">
              <h4 className="host-ticket-block-title">Ticket pricing</h4>
              <ul className="host-ticket-mini-list">
                {tix.map((t) => {
                  const eff = effectiveTicketPrice(t);
                  const list = Number(t.price) || 0;
                  const showWas = t.earlyBirdEndsAt && eff !== list;
                  return (
                    <li key={t._id || t.name}>
                      <span className="host-ticket-name">{t.name}</span>
                      <span className="host-ticket-price">
                        {formatCurrency(eff)}
                        {showWas ? <span className="host-ticket-was"> list {formatCurrency(list)}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="auth-note host-ticket-block-title">Ticket types will appear here when loaded.</p>
          )}
          <div className="host-event-actions-row">
            <button type="button" className="ghost-button compact-button" onClick={() => shareHostEvent(event)}>
              Share event
            </button>
            {canBook ? (
              <PrimaryButton type="button" onClick={() => handleSelectEvent(event._id)}>
                Book tickets
              </PrimaryButton>
            ) : (
              <PrimaryButton type="button" onClick={() => handleSelectEvent(event._id)}>
                {past ? "View event" : "View listing"}
              </PrimaryButton>
            )}
          </div>
          {canBook ? (
            <p className="auth-note host-book-hint">Booking opens on the event page — you stay in the app (not the home feed).</p>
          ) : null}
        </div>
      </article>
    );
  }

  async function toggleFollowHost(organiserId) {
    if (!organiserId || !hostPage?.host) return;
    if (!user) {
      flash("Sign in to follow hosts.", true);
      if (hostIdInPath) {
        setHostAuthModalOpen(true);
        setAuthMode("login");
      } else {
        navigate("/");
      }
      return;
    }
    if (String(user.id) === String(organiserId)) return;
    try {
      if (hostPage.following) {
        const { data } = await api.delete(`/organisers/${organiserId}/follow`);
        setHostPage((p) => (p ? { ...p, following: false, followerCount: data.followerCount } : p));
        flash("Unfollowed host.");
        await refreshFollowing();
      } else {
        const { data } = await api.post(`/organisers/${organiserId}/follow`);
        setHostPage((p) => (p ? { ...p, following: true, followerCount: data.followerCount } : p));
        flash("You follow this host — their events stay easy to find on Discover.");
        await refreshFollowing();
      }
    } catch (e) {
      flash(e.response?.data?.message || "Could not update follow.", true);
    }
  }

  if (loading) {
    return (
      <div className="screen-center">
        <div className="loading-wrap">
          <LoadingSpinner />
          <span className="loading-label">EventwithEase</span>
        </div>
      </div>
    );
  }

  if (statsPath) {
    const pvRows = statsOverview?.pageviewsByDay || [];
    const maxPvDay = Math.max(1, ...pvRows.map((d) => d.count));
    const tpRows = statsOverview?.topPaths || [];
    const maxPath = Math.max(1, ...tpRows.map((p) => p.count));
    const catRows = statsOverview?.ticketsByCategory || [];
    const maxCat = Math.max(1, ...catRows.map((c) => c.count));
    const t = statsOverview?.totals;

    return (
      <div className="app-root">
        <a className="skip-link" href="#stats-main">
          Skip to stats
        </a>
        <TopNav
          user={user}
          isOrganiser={isOrganiser}
          profileMode={profileMode}
          onGoDiscover={goDiscover}
          onGoBook={goBook}
          onGoTickets={goTickets}
          onGoWishlist={goWishlist}
          onGoOrganise={goOrganise}
          onGoCheckIn={goCheckIn}
          onGoStats={goStats}
          showStatsLink={isAdminUser}
          onOpenAccount={openAccount}
          onLogout={logout}
          notificationUnread={user ? unreadCount : 0}
          onNotificationsToggle={() => setNotifOpen((o) => !o)}
          notificationsOpen={notifOpen}
          navActiveKey={navActiveKey}
        />
        {user && nextBookedEventCountdown ? (
          <div className="countdown-strip" role="status">
            <button
              type="button"
              className="countdown-strip__btn"
              onClick={() => {
                setNotifOpen(false);
                handleSelectEvent(nextBookedEventCountdown.eid);
              }}
            >
              <span className="countdown-strip__label">Next ticketed event</span>
              <span className="countdown-strip__title">{nextBookedEventCountdown.title}</span>
              <span className="countdown-strip__time">{formatMsAsCountdown(nextBookedEventCountdown.left)}</span>
            </button>
          </div>
        ) : null}
        <NotificationsPanel
          open={notifOpen}
          onClose={() => setNotifOpen(false)}
          notifications={notifications}
          markRead={markRead}
          markAllRead={markAllRead}
          dismissNotif={dismissNotif}
          navigate={navigate}
          flash={flash}
          desktopSupported={desktopSupported}
          desktopPermission={desktopPermission}
          requestDesktopPermission={requestDesktopPermission}
          pushEssentialEnabled={pushEssentialEnabled}
          setPushEssentialEnabled={setPushEssentialEnabled}
          ticketPreview={ticketNotificationsPreview}
          followingHosts={followingHosts}
          formatMsAsCountdown={formatMsAsCountdown}
          formatDate={formatDate}
        />
        <div className="app-flow">
          <main id="stats-main" className="stats-page app-shell">
            {statusMessage ? <div className="banner success">{statusMessage}</div> : null}
            {errorMessage ? <div className="banner error">{errorMessage}</div> : null}
            <div className="section-head">
              <h1 className="stats-page-title">Site stats</h1>
              <p className="section-note">Page views from this app, ticket volume, and revenue totals (admin).</p>
            </div>
            {!isAdminUser ? (
              <div className="panel stats-gate-panel">
                <h2>Admin only</h2>
                <p className="auth-note">Analytics are visible to administrator accounts. Sign in with an admin user to see graphs.</p>
                {!user ? (
                  <PrimaryButton type="button" onClick={openAccount}>
                    Sign in
                  </PrimaryButton>
                ) : null}
              </div>
            ) : statsLoadError ? (
              <p className="banner error">{statsLoadError}</p>
            ) : !statsOverview ? (
              <div className="host-page-loading">
                <LoadingSpinner />
                <span className="loading-label">Loading analytics…</span>
              </div>
            ) : (
              <>
                <div className="stats-kpi-grid">
                  <div className="stat-card stats-kpi-card">
                    <strong>{t?.users ?? "—"}</strong>
                    <span>Users</span>
                  </div>
                  <div className="stat-card stats-kpi-card">
                    <strong>{t?.events ?? "—"}</strong>
                    <span>Events</span>
                  </div>
                  <div className="stat-card stats-kpi-card">
                    <strong>{t?.tickets ?? "—"}</strong>
                    <span>Tickets issued</span>
                  </div>
                  <div className="stat-card stats-kpi-card">
                    <strong>{formatCurrency(t?.revenue ?? 0)}</strong>
                    <span>Booking revenue (gross)</span>
                  </div>
                  <div className="stat-card stats-kpi-card">
                    <strong>{t?.bookings ?? "—"}</strong>
                    <span>Bookings</span>
                  </div>
                </div>
                <div className="panel stats-chart-panel">
                  <h2 className="stats-chart-title">Page views (14 days)</h2>
                  {pvRows.length === 0 ? (
                    <p className="auth-note">No page views recorded yet — browse the app to populate this chart.</p>
                  ) : (
                    <ul className="stats-bar-list" aria-label="Page views by day">
                      {pvRows.map((row) => (
                        <li key={row.day} className="stats-bar-row">
                          <span className="stats-bar-label">{row.day}</span>
                          <div className="stats-bar-track">
                            <div className="stats-bar-fill stats-bar-fill--teal" style={{ width: `${(row.count / maxPvDay) * 100}%` }} />
                          </div>
                          <span className="stats-bar-count">{row.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="stats-two-col">
                  <div className="panel stats-chart-panel">
                    <h2 className="stats-chart-title">Top paths (30 days)</h2>
                    {tpRows.length === 0 ? (
                      <p className="auth-note">No data yet.</p>
                    ) : (
                      <ul className="stats-bar-list">
                        {tpRows.map((row) => (
                          <li key={row.path} className="stats-bar-row">
                            <span className="stats-bar-label stats-bar-label--path">{row.path}</span>
                            <div className="stats-bar-track">
                              <div className="stats-bar-fill stats-bar-fill--amber" style={{ width: `${(row.count / maxPath) * 100}%` }} />
                            </div>
                            <span className="stats-bar-count">{row.count}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="panel stats-chart-panel">
                    <h2 className="stats-chart-title">Tickets by event category</h2>
                    {catRows.length === 0 ? (
                      <p className="auth-note">No tickets yet.</p>
                    ) : (
                      <ul className="stats-bar-list">
                        {catRows.map((row) => (
                          <li key={row.category} className="stats-bar-row">
                            <span className="stats-bar-label">{row.category}</span>
                            <div className="stats-bar-track">
                              <div
                                className="stats-bar-fill stats-bar-fill--violet"
                                style={{ width: `${(row.count / maxCat) * 100}%` }}
                              />
                            </div>
                            <span className="stats-bar-count">{row.count}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            )}
          </main>
        </div>
        {hostAuthModalOpen
          ? createPortal(
              <div className="auth-modal-root" role="presentation">
                <button
                  type="button"
                  className="auth-modal-backdrop"
                  aria-label="Close sign in"
                  onClick={() => setHostAuthModalOpen(false)}
                />
                <div
                  className="auth-modal-panel"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="host-auth-modal-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="auth-modal-head">
                    <h2 id="host-auth-modal-title" className="auth-modal-title">
                      {authMode === "forgot"
                        ? "Reset password"
                        : authMode === "reset"
                          ? "New password"
                          : authMode === "signup"
                            ? "Create account"
                            : "Sign in"}
                    </h2>
                    <button type="button" className="ghost-button compact-button" onClick={() => setHostAuthModalOpen(false)}>
                      Close
                    </button>
                  </div>
                  {authMode === "forgot" || authMode === "reset" ? (
                    <button className="ghost-button compact-button" type="button" onClick={() => setAuthMode("login")}>
                      Back to login
                    </button>
                  ) : (
                    <div className="switch-row auth-modal-tabs">
                      <button
                        className={`tab${authMode === "login" ? " active" : ""}`}
                        type="button"
                        onClick={() => setAuthMode("login")}
                      >
                        Login
                      </button>
                      <button
                        className={`tab${authMode === "signup" ? " active" : ""}`}
                        type="button"
                        onClick={() => setAuthMode("signup")}
                      >
                        Signup
                      </button>
                    </div>
                  )}
                  <form className="stack-form auth-form host-auth-modal-form" onSubmit={handleAuthSubmit}>
                    {renderGuestAuthFormFields()}
                    <PrimaryButton type="submit" style={{ width: "100%", marginTop: "2px" }}>
                      {authMode === "login"
                        ? "Login"
                        : authMode === "signup"
                          ? "Create account"
                          : authMode === "forgot"
                            ? "Send reset mail"
                            : "Update password"}
                    </PrimaryButton>
                    {authMode === "login" && (
                      <div className="auth-links">
                        <button type="button" onClick={() => setAuthMode("forgot")}>
                          Forgot password?
                        </button>
                        <button type="button" onClick={resendVerification}>
                          Resend verify email
                        </button>
                      </div>
                    )}
                    {authMode === "signup" && <p className="auth-note">We will email a verification link before login is enabled.</p>}
                    {authMode === "forgot" && <p className="auth-note">Enter your account email and we will send a reset link.</p>}
                    {authMode === "reset" && <p className="auth-note">Set a fresh password from the secure reset link.</p>}
                  </form>
                </div>
              </div>,
              document.body
            )
          : null}
        {gamifyFloatingDock}
        <SiteFooter />
      </div>
    );
  }

  if (hostIdInPath) {
    return (
      <div className="app-root">
        <a className="skip-link" href="#ewe-host">
          Skip to host profile
        </a>
        <TopNav
          user={user}
          isOrganiser={isOrganiser}
          profileMode={profileMode}
          onGoDiscover={goDiscover}
          onGoBook={goBook}
          onGoTickets={goTickets}
          onGoWishlist={goWishlist}
          onGoOrganise={goOrganise}
          onGoCheckIn={goCheckIn}
          onGoStats={goStats}
          showStatsLink={isAdminUser}
          onOpenAccount={openAccount}
          onLogout={logout}
          notificationUnread={user ? unreadCount : 0}
          onNotificationsToggle={() => setNotifOpen((o) => !o)}
          notificationsOpen={notifOpen}
          navActiveKey={navActiveKey}
        />
        {user && nextBookedEventCountdown ? (
          <div className="countdown-strip" role="status">
            <button
              type="button"
              className="countdown-strip__btn"
              onClick={() => {
                setNotifOpen(false);
                handleSelectEvent(nextBookedEventCountdown.eid);
              }}
            >
              <span className="countdown-strip__label">Next ticketed event</span>
              <span className="countdown-strip__title">{nextBookedEventCountdown.title}</span>
              <span className="countdown-strip__time">{formatMsAsCountdown(nextBookedEventCountdown.left)}</span>
            </button>
          </div>
        ) : null}
        <NotificationsPanel
          open={notifOpen}
          onClose={() => setNotifOpen(false)}
          notifications={notifications}
          markRead={markRead}
          markAllRead={markAllRead}
          dismissNotif={dismissNotif}
          navigate={navigate}
          flash={flash}
          desktopSupported={desktopSupported}
          desktopPermission={desktopPermission}
          requestDesktopPermission={requestDesktopPermission}
          pushEssentialEnabled={pushEssentialEnabled}
          setPushEssentialEnabled={setPushEssentialEnabled}
          ticketPreview={ticketNotificationsPreview}
          followingHosts={followingHosts}
          formatMsAsCountdown={formatMsAsCountdown}
          formatDate={formatDate}
        />
        <div className="app-flow">
          <div className="app-shell host-profile-page" id="ewe-host">
            {statusMessage ? <div className="banner success">{statusMessage}</div> : null}
            {errorMessage ? <div className="banner error">{errorMessage}</div> : null}
            <button type="button" className="ghost-button host-back-btn" onClick={() => navigate("/")}>
              ← All events
            </button>
            {hostPageLoading ? (
              <div className="host-page-loading">
                <LoadingSpinner />
                <span className="loading-label">Loading host…</span>
              </div>
            ) : null}
            {!hostPageLoading && hostPageError ? (
              <div className="panel">
                <p className="auth-note">{hostPageError}</p>
              </div>
            ) : null}
            {!hostPageLoading && hostPage ? (
              <section className="panel host-profile-panel">
                <div className="host-profile-head">
                  <div>
                    <p className="card-label">Host</p>
                    <h2>{hostPage.host.name}</h2>
                    {hostPage.host.hostTagline ? <p className="host-tagline">{hostPage.host.hostTagline}</p> : null}
                  </div>
                  <div className="host-profile-actions">
                    <span className="pill">{hostPage.followerCount} followers</span>
                    <button type="button" className="ghost-button compact-button" onClick={() => shareHostProfile()}>
                      Share host profile
                    </button>
                    {user && String(user.id) !== String(hostPage.host._id) ? (
                      <button
                        type="button"
                        className={hostPage.following ? "ghost-button" : "primary-button"}
                        onClick={() => toggleFollowHost(hostPage.host._id)}
                      >
                        {hostPage.following ? "Following" : "Follow"}
                      </button>
                    ) : null}
                  </div>
                </div>
                {hostPage.host.hostBio ? <p className="host-bio">{hostPage.host.hostBio}</p> : null}
                <div className="host-social-row">
                  {[
                    ["LinkedIn", hostPage.host.linkedinUrl],
                    ["X", hostPage.host.twitterUrl],
                    ["Instagram", hostPage.host.instagramUrl],
                    ["Website", hostPage.host.websiteUrl],
                  ].map(([label, url]) =>
                    url ? (
                      <a key={label} className="ghost-button compact-button" href={url} target="_blank" rel="noreferrer">
                        {label}
                      </a>
                    ) : null
                  )}
                </div>
                {hostNextCountdown ? (
                  <div className="host-next-countdown" role="status">
                    <span className="host-next-countdown__label">Next from this host</span>
                    <button type="button" className="host-next-countdown__btn" onClick={() => handleSelectEvent(hostNextCountdown.id)}>
                      <strong>{hostNextCountdown.title}</strong>
                      <span className="host-next-countdown__time">{formatMsAsCountdown(hostNextCountdown.left)}</span>
                    </button>
                  </div>
                ) : null}
                {hostPage.trustScore?.reviewCount > 0 ? (
                  <div className="host-trust-card">
                    <div className="host-trust-ring" aria-hidden>
                      {hostPage.trustScore.averageRating != null ? Number(hostPage.trustScore.averageRating).toFixed(1) : "—"}
                    </div>
                    <div>
                      <strong>Trust score</strong>
                      <p className="auth-note">
                        From {hostPage.trustScore.reviewCount} public reviews across {hostPage.trustScore.eventsReviewed || 0}{" "}
                        event{(hostPage.trustScore.eventsReviewed || 0) === 1 ? "" : "s"}.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="host-trust-card host-trust-card--muted">
                    <div>
                      <strong>Trust score</strong>
                      <p className="auth-note">Reviews from past events will build this host’s public rating.</p>
                    </div>
                  </div>
                )}
                {hostPage.recentReviews?.length ? (
                  <div className="host-reviews-block">
                    <h3 className="host-events-title">Reviews on their events</h3>
                    <ul className="host-review-list">
                      {hostPage.recentReviews.map((r) => (
                        <li key={r._id} className="host-review-item">
                          <div className="host-review-top">
                            <span className="pill">{r.rating}★</span>
                            <span className="host-review-meta">
                              {r.attendeeName} · {r.eventTitle}
                            </span>
                          </div>
                          {r.comment ? <p className="host-review-comment">{r.comment}</p> : null}
                          <button type="button" className="link-like-button" onClick={() => r.eventId && handleSelectEvent(r.eventId)}>
                            View event
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <h3 className="host-events-title">Upcoming events</h3>
                {(
                  hostPage.upcomingEvents ??
                  hostPage.events?.filter((e) => new Date(e.date) >= new Date()) ??
                  []
                ).length ? (
                  <div className="card-grid">
                    {(hostPage.upcomingEvents ??
                      hostPage.events?.filter((e) => new Date(e.date) >= new Date()) ??
                      []
                    ).map((event, index) => renderHostProfileEventCard(event, index, { past: false }))}
                  </div>
                ) : (
                  <p className="auth-note host-events-empty">No upcoming dates listed.</p>
                )}
                <h3 className="host-events-title">Past events</h3>
                {(
                  hostPage.pastEvents ??
                  hostPage.events?.filter((e) => new Date(e.date) < new Date()) ??
                  []
                ).length ? (
                  <div className="card-grid">
                    {(hostPage.pastEvents ??
                      hostPage.events?.filter((e) => new Date(e.date) < new Date()) ??
                      []
                    ).map((event, index) => renderHostProfileEventCard(event, index, { past: true }))}
                  </div>
                ) : (
                  <p className="auth-note host-events-empty">No past events in this profile yet.</p>
                )}
              </section>
            ) : null}
          </div>
        </div>
        {hostAuthModalOpen
          ? createPortal(
              <div className="auth-modal-root" role="presentation">
                <button
                  type="button"
                  className="auth-modal-backdrop"
                  aria-label="Close sign in"
                  onClick={() => setHostAuthModalOpen(false)}
                />
                <div
                  className="auth-modal-panel"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="host-auth-modal-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="auth-modal-head">
                    <h2 id="host-auth-modal-title" className="auth-modal-title">
                      {authMode === "forgot"
                        ? "Reset password"
                        : authMode === "reset"
                          ? "New password"
                          : authMode === "signup"
                            ? "Create account"
                            : "Sign in"}
                    </h2>
                    <button type="button" className="ghost-button compact-button" onClick={() => setHostAuthModalOpen(false)}>
                      Close
                    </button>
                  </div>
                  {authMode === "forgot" || authMode === "reset" ? (
                    <button className="ghost-button compact-button" type="button" onClick={() => setAuthMode("login")}>
                      Back to login
                    </button>
                  ) : (
                    <div className="switch-row auth-modal-tabs">
                      <button className={`tab${authMode === "login" ? " active" : ""}`} type="button" onClick={() => setAuthMode("login")}>
                        Login
                      </button>
                      <button className={`tab${authMode === "signup" ? " active" : ""}`} type="button" onClick={() => setAuthMode("signup")}>
                        Signup
                      </button>
                    </div>
                  )}
                  <form className="stack-form auth-form host-auth-modal-form" onSubmit={handleAuthSubmit}>
                    {renderGuestAuthFormFields()}
                    <PrimaryButton type="submit" style={{ width: "100%", marginTop: "2px" }}>
                      {authMode === "login"
                        ? "Login"
                        : authMode === "signup"
                          ? "Create account"
                          : authMode === "forgot"
                            ? "Send reset mail"
                            : "Update password"}
                    </PrimaryButton>
                    {authMode === "login" && (
                      <div className="auth-links">
                        <button type="button" onClick={() => setAuthMode("forgot")}>
                          Forgot password?
                        </button>
                        <button type="button" onClick={resendVerification}>
                          Resend verify email
                        </button>
                      </div>
                    )}
                    {authMode === "signup" && <p className="auth-note">We will email a verification link before login is enabled.</p>}
                    {authMode === "forgot" && <p className="auth-note">Enter your account email and we will send a reset link.</p>}
                    {authMode === "reset" && <p className="auth-note">Set a fresh password from the secure reset link.</p>}
                  </form>
                </div>
              </div>,
              document.body
            )
          : null}
        {gamifyFloatingDock}
        <SiteFooter />
      </div>
    );
  }

  
  if (eventIdInPath || ticketsPath || wishlistPath || organisePath || checkinPath) {
    return (
      <div className="app-root">
        <a className="skip-link" href="#ewe-subpage">
          Skip to content
        </a>
        <TopNav
          user={user}
          isOrganiser={isOrganiser}
          profileMode={profileMode}
          onGoDiscover={goDiscover}
          onGoBook={goBook}
          onGoTickets={goTickets}
          onGoWishlist={goWishlist}
          onGoOrganise={goOrganise}
          onGoCheckIn={goCheckIn}
          onGoStats={goStats}
          showStatsLink={isAdminUser}
          onOpenAccount={openAccount}
          onLogout={logout}
          notificationUnread={user ? unreadCount : 0}
          onNotificationsToggle={() => setNotifOpen((o) => !o)}
          notificationsOpen={notifOpen}
          navActiveKey={navActiveKey}
        />
        {user && nextBookedEventCountdown ? (
          <div className="countdown-strip" role="status">
            <button
              type="button"
              className="countdown-strip__btn"
              onClick={() => {
                setNotifOpen(false);
                handleSelectEvent(nextBookedEventCountdown.eid);
              }}
            >
              <span className="countdown-strip__label">Next ticketed event</span>
              <span className="countdown-strip__title">{nextBookedEventCountdown.title}</span>
              <span className="countdown-strip__time">{formatMsAsCountdown(nextBookedEventCountdown.left)}</span>
            </button>
          </div>
        ) : null}
        <NotificationsPanel
          open={notifOpen}
          onClose={() => setNotifOpen(false)}
          notifications={notifications}
          markRead={markRead}
          markAllRead={markAllRead}
          dismissNotif={dismissNotif}
          navigate={navigate}
          flash={flash}
          desktopSupported={desktopSupported}
          desktopPermission={desktopPermission}
          requestDesktopPermission={requestDesktopPermission}
          pushEssentialEnabled={pushEssentialEnabled}
          setPushEssentialEnabled={setPushEssentialEnabled}
          ticketPreview={ticketNotificationsPreview}
          followingHosts={followingHosts}
          formatMsAsCountdown={formatMsAsCountdown}
          formatDate={formatDate}
        />
        <div className="app-flow">
          <div className="app-shell app-shell--subpage">
            {statusMessage && <div className="banner success">{statusMessage}</div>}
            {errorMessage && <div className="banner error">{errorMessage}</div>}
            <main id="ewe-subpage" className="grid-layout subpage-workspace">
              {eventIdInPath ? (
                <>
                  <div className="subpage-toolbar span-two full-width">
                    <button type="button" className="ghost-button compact-button" onClick={goDiscover}>
                      ← Discover
                    </button>
                  </div>
                  {String(selectedEvent?._id) !== String(eventIdInPath) ? (
                    <div className="panel span-two full-width subpage-loading-row">
                      <LoadingSpinner />
                      <span className="auth-note">Loading event…</span>
                    </div>
                  ) : null}
                  {String(selectedEvent?._id) === String(eventIdInPath) ? (
                    <section id="ewe-book" className={panelClass("panel span-two full-width", ["attendee"])}>
          <div className="section-head section-head--split section-head--wrap">
            <h2>Book tickets</h2>
            {selectedEvent ? (
              <div className="share-actions-bar" role="group" aria-label="Share this event">
                <button type="button" className="ghost-button compact-button" onClick={shareSelectedEventNative}>
                  Share
                </button>
                <button type="button" className="ghost-button compact-button" onClick={copySelectedEventLink}>
                  Copy link
                </button>
                <button type="button" className="ghost-button compact-button" onClick={copyOgPreviewLink}>
                  Copy OG preview
                </button>
                <button type="button" className="ghost-button compact-button" onClick={shareWhatsApp}>
                  WhatsApp
                </button>
                <button type="button" className="ghost-button compact-button" onClick={shareTelegram}>
                  Telegram
                </button>
                <button type="button" className="ghost-button compact-button" onClick={shareTwitter}>
                  X
                </button>
                <button type="button" className="ghost-button compact-button" onClick={shareLinkedIn}>
                  LinkedIn
                </button>
                <button type="button" className="ghost-button compact-button" onClick={shareFacebook}>
                  Facebook
                </button>
                <button type="button" className="ghost-button compact-button" onClick={shareInstagramHint}>
                  Instagram
                </button>
                <button type="button" className="ghost-button compact-button" onClick={shareEmail}>
                  Email
                </button>
              </div>
            ) : null}
          </div>

          {selectedEvent ? (
            <div className="details-card">
              {bookingPromoLive && !promoOverlayDismissed ? (
                <div className="event-promo-banner" role="region" aria-label="Booking offer">
                  <button
                    type="button"
                    className="event-promo-banner__close"
                    onClick={() => setPromoOverlayDismissed(true)}
                    aria-label="Dismiss offer"
                  >
                    ×
                  </button>
                  <span className="event-promo-banner__badge">{bookingPromoLive.badge || "Offer"}</span>
                  <p className="event-promo-banner__headline">{bookingPromoLive.headline}</p>
                  {bookingPromoLive.subtext ? <p className="event-promo-banner__sub">{bookingPromoLive.subtext}</p> : null}
                </div>
              ) : null}
              <div
                className="details-cover"
                style={{
                  backgroundImage: selectedEvent.coverImage
                    ? `linear-gradient(180deg,rgba(13,15,20,0.12),rgba(13,15,20,0.82)),url(${selectedEvent.coverImage})`
                    : "linear-gradient(135deg,#0d4a46,#0a1a2e)",
                }}
              >
                <span className="pill">{selectedEvent.category}</span>
                {selectedEventCancelled ? <span className="pill pill--warn">Cancelled</span> : null}
              </div>
              <p className="card-label">Selected event</p>
              <h3>{selectedEvent.title}</h3>
              <p>{selectedEvent.description}</p>
              {selectedEventCancelled ? (
                <div className="cancel-banner" role="alert">
                  <strong>Cancelled.</strong> New tickets are not on sale. If you already hold a ticket, check <em>My tickets</em> or
                  request a refund where applicable.
                </div>
              ) : null}
              <div className="meta-list">
                <span>{formatDate(selectedEvent.date)}</span>
                {selectedEvent.city ? <span>{selectedEvent.city}</span> : null}
                <span>{selectedEvent.location}</span>
              </div>
              {eventOrganiserRefId(selectedEvent) ? (
                <p className="auth-note host-line-detail">
                  Host:{" "}
                  <button type="button" className="link-like-button" onClick={() => goHostProfile(eventOrganiserRefId(selectedEvent))}>
                    {eventOrganiserDisplayName(selectedEvent) || "View profile"}
                  </button>
                  {" · "}
                  Follow them for their lineup of events.
                </p>
              ) : null}
              {eventOrganiserTagline(selectedEvent) ? (
                <p className="auth-note host-tagline-detail">{eventOrganiserTagline(selectedEvent)}</p>
              ) : null}
              <div className="details-grid">
                <div className="detail-block">
                  <h4>Agenda</h4>
                  <ul>
                    {generateEventAgenda(selectedEvent).map((item, index) => (
                      <li key={`${selectedEvent._id}-agenda-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="detail-block">
                  <h4>Speakers</h4>
                  <ul>
                    {generateEventSpeakers(selectedEvent).map((speaker, index) => (
                      <li key={`${selectedEvent._id}-speaker-${index}`}>{speaker}</li>
                    ))}
                  </ul>
                </div>
                <div className="detail-block">
                  <h4>FAQ</h4>
                  <ul>
                    {(selectedEvent.faq?.length
                      ? selectedEvent.faq.map((item) => `${item.question}: ${item.answer}`)
                      : ["Refunds are available up to 24 hours before the event.", "Bring a valid ID at check-in."]
                    ).map((item, index) => (
                      <li key={`${selectedEvent._id}-faq-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="detail-block">
                  <h4>{selectedEvent.venueType === "online" ? "Online link" : "Venue map"}</h4>
                  {selectedEvent.venueMapUrl ? (
                    <a className="map-link" href={selectedEvent.venueMapUrl} target="_blank" rel="noreferrer">
                      {selectedEvent.venueType === "online" ? "Join link" : "Open map"}
                    </a>
                  ) : (
                    <p className="auth-note">{selectedEvent.venueType === "online" ? "Online link will be shared after booking." : "Venue map will be shared after booking."}</p>
                  )}
                </div>
              </div>
              <div className="details-actions">
                {hasSelectedBooking ? (
                  <div className="detail-block">
                    <h4>Host &amp; organiser LinkedIn</h4>
                    {networkingList.length ? (
                      <ul>
                        {networkingList.map((person) => (
                          <li key={person._id}>
                            {person.name}{" "}
                            <a className="map-link" href={person.linkedinUrl} target="_blank" rel="noreferrer">
                              LinkedIn
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="auth-note">No hosts or organisers on this guest list have shared LinkedIn yet.</p>
                    )}
                  </div>
                ) : (
                  <div className="detail-block">
                    <h4>Host &amp; organiser LinkedIn</h4>
                    <p className="auth-note">Book a ticket to see LinkedIn links that hosts and organisers choose to share.</p>
                  </div>
                )}
              </div>

              <div className="detail-block review-block">
                <div className="review-head">
                  <h4>Public reviews</h4>
                  {reviews.length > 0 ? (
                    <div className="review-summary">
                      <span className="review-average" title="Average star rating from all reviews">
                        Avg.{" "}
                        {(Math.round((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length) * 10) / 10).toFixed(1)}
                        /5 stars
                      </span>
                      <span className="review-count">
                        {reviews.length} {reviews.length === 1 ? "review" : "reviews"}
                      </span>
                    </div>
                  ) : null}
                </div>
                <p className="auth-note review-explainer">
                  {hasSelectedBooking && selectedEventEnded
                    ? "Below: public star review (everyone sees it) and private feedback (only the organiser sees it)."
                    : hasSelectedBooking
                      ? "After the scheduled start time, you can post a public review and private feedback here (same page — scroll to the forms below)."
                      : "Book a ticket first. After the event starts, return here for a public review and optional private note to the organiser."}
                </p>
                {reviews.length ? (
                  <div className="review-rail" role="region" aria-label={`${reviews.length} public reviews`}>
                    {reviews.map((review) => (
                      <div key={review._id} className="review-card">
                        <div className="review-meta">
                          <strong>{review.attendeeId?.name || "Attendee"}</strong>
                          <span aria-label={`${review.rating} out of 5`}>
                            {"★".repeat(review.rating)}
                            {"☆".repeat(5 - review.rating)}
                          </span>
                        </div>
                        <p>{review.comment || "(no comment)"}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="auth-note">No reviews yet.</p>
                )}
              </div>

              {hasSelectedBooking && selectedEventEnded && (
                <div className="detail-block">
                  <h4>Leave a review</h4>
                  <div className="review-form">
                    <select value={reviewForm.rating} onChange={(e) => setReviewForm((current) => ({ ...current, rating: Number(e.target.value) }))}>
                      {[5,4,3,2,1].map((value) => (
                        <option key={value} value={value}>{value} star{value > 1 ? "s" : ""}</option>
                      ))}
                    </select>
                    <input
                      placeholder="Share your experience"
                      value={reviewForm.comment}
                      onChange={(e) => setReviewForm((current) => ({ ...current, comment: e.target.value }))}
                    />
                    <button className="ghost-button" type="button" onClick={submitReview}>
                      Submit review
                    </button>
                  </div>
                </div>
              )}

              {hasSelectedBooking && selectedEventEnded && (
                <div className="detail-block">
                  <h4>Private feedback</h4>
                  <p className="auth-note">Only the organiser reads this (not shown on the public review wall).</p>
                  <div className="review-form">
                    <select value={feedbackForm.rating} onChange={(e) => setFeedbackForm((current) => ({ ...current, rating: Number(e.target.value) }))}>
                      {[5,4,3,2,1].map((value) => (
                        <option key={value} value={value}>{value} star{value > 1 ? "s" : ""}</option>
                      ))}
                    </select>
                    <textarea
                      rows={4}
                      placeholder="Private feedback for the organiser"
                      value={feedbackForm.feedback}
                      onChange={(e) => setFeedbackForm((current) => ({ ...current, feedback: e.target.value }))}
                      className="feedback-textarea"
                    />
                    <button className="ghost-button" type="button" onClick={submitFeedback}>
                      Submit feedback
                    </button>
                  </div>
                </div>
              )}
              {selectedEventCancelled ? (
                <p className="booking-message">Ticketing is closed for this cancelled event.</p>
              ) : (
                <>
                  <div className="ticket-type-list">
                    {selectedEvent.ticketTypes.map((ticket) => (
                      <label key={ticket._id} className={`ticket-option${ticketCart[ticket._id] > 0 ? " active" : ""}`}>
                        <span className="ticket-option-name">{ticket.name}</span>
                        <strong>{formatCurrency(getTicketEffectivePrice(ticket))}</strong>
                        {ticket.earlyBirdEndsAt && getTicketEffectivePrice(ticket) !== Number(ticket.price) && (
                          <span className="early-bird-note">Early bird ends {formatDate(ticket.earlyBirdEndsAt)}</span>
                        )}
                        <input
                          className="ticket-quantity-input"
                          type="number"
                          min="0"
                          inputMode="numeric"
                          aria-label={`Quantity for ${ticket.name}`}
                          value={ticketCart[ticket._id] || 0}
                          onChange={(e) => updateTicketCart(ticket._id, e.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="checkout-summary">
                    <span>Subtotal</span>
                    <strong>{formatCurrency(checkoutSubtotal())}</strong>
                  </div>
                  <div className="checkout-discount">
                    <input
                      className="discount-input"
                      placeholder="Discount code (optional)"
                      value={discountCode}
                      onChange={(e) => setDiscountCode(e.target.value)}
                    />
                    <div className="discount-total">
                      <span>Discount</span>
                      <strong>-{formatCurrency(checkoutDiscountAmount(checkoutSubtotal()))}</strong>
                    </div>
                  </div>
                  <div className="checkout-summary checkout-total">
                    <span>Total</span>
                    <strong>{formatCurrency(checkoutTotal())}</strong>
                  </div>
                  <div className="payment-buttons">
                    <PrimaryButton type="button" onClick={handleStripeCheckout}>
                      Pay with Stripe (test)
                    </PrimaryButton>
                    <button className="ghost-button" type="button" onClick={handleRazorpayCheckout}>
                      Pay with Razorpay (test)
                    </button>
                    <button className="ghost-button" type="button" onClick={handleBookTickets}>
                      Simulate payment
                    </button>
                  </div>
                  {paymentMessage && <p className="booking-message">{paymentMessage}</p>}
                  {bookingMessage && <p className="booking-message">{bookingMessage}</p>}
                  {lastBookingErrorCode === "SOLD_OUT" && user ? (
                    <div className="waitlist-cta">
                      <p className="auth-note">Sold out for that selection — join the waitlist and we will prioritize you if capacity changes.</p>
                      <button type="button" className="ghost-button" onClick={joinEventWaitlistForSelection}>
                        Join waitlist
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : (
            <EmptyState label="Select an event to book tickets" />
          )}
        </section>
                  ) : null}
                </>
              ) : null}
              {ticketsPath ? (
              <section id="ewe-tickets" className={panelClass("panel span-two full-width", ["attendee"])}>
          <div className="section-head">
            <h2>Your QR tickets</h2>
            <p className="section-note">
              Live countdown and cancel window show here once events are loaded. After entry, the host scans your QR once — your status
              here becomes <strong>Checked in</strong> (refresh if needed). Same login can both host and hold tickets; use <strong>My tickets</strong>{" "}
              as the attendee view and <strong>Check-in</strong> as the door view.
            </p>
          </div>
          <div className="ticket-stack">
            {myTickets.length ? (
              myTickets.map((ticket, index) => {
                const eid = String(ticket.eventId?._id || ticket.eventId || "");
                const evMerged = (eid && events.find((e) => String(e._id) === eid)) || ticket.eventId;
                const eventDateVal = evMerged?.date;
                const isLeadTicket =
                  myTickets.findIndex((t) => String(t.bookingId) === String(ticket.bookingId)) === index;
                const eventNotStarted = eventDateVal && new Date(eventDateVal) > new Date();
                const startMs = eventDateVal ? new Date(eventDateVal).getTime() : NaN;
                const untilStart = Number.isFinite(startMs) ? Math.max(0, startMs - countdownNow) : null;
                const bid = String(ticket.bookingId);
                const minMsBeforeStart = CANCEL_DEADLINE_HOURS_BEFORE * 3600000;
                const insideCancelWindow = untilStart != null && untilStart >= minMsBeforeStart;
                const canCancelBooking =
                  isLeadTicket &&
                  eventNotStarted &&
                  ticket.status === "booked" &&
                  !refundsByBooking[bid] &&
                  !evMerged?.cancelledAt &&
                  insideCancelWindow;
                const showCancelClosed =
                  isLeadTicket &&
                  eventNotStarted &&
                  ticket.status === "booked" &&
                  !refundsByBooking[bid] &&
                  !evMerged?.cancelledAt &&
                  !insideCancelWindow &&
                  untilStart != null &&
                  untilStart < minMsBeforeStart;

                return (
                <article className="ticket-card" key={ticket._id} style={{ animationDelay: `${index * 0.08}s` }}>
                  <div>
                    <p className="card-label">Ticket ready</p>
                    <h3>{evMerged?.title || ticket.eventId?.title}</h3>
                    <p>{ticket.ticketTypeName}</p>
                    {eventNotStarted && untilStart != null ? (
                      <>
                        <p className="ticket-countdown-line" role="status">
                          <strong>{formatMsAsCountdown(untilStart)}</strong> until doors · {formatDate(eventDateVal)}
                        </p>
                        <div className="ticket-time-progress" aria-label="Time to doors">
                          {(() => {
                            const windowMs = 7 * 24 * 60 * 60 * 1000;
                            const pct = Math.max(0, Math.min(100, (1 - Math.min(windowMs, untilStart) / windowMs) * 100));
                            return (
                              <div className="mini-progress" role="presentation">
                                <div className="mini-progress-fill" style={{ width: `${pct}%` }} />
                              </div>
                            );
                          })()}
                        </div>
                      </>
                    ) : null}
                    {canCancelBooking ? (
                      <p className="auth-note ticket-cancel-hint">
                        Cancellation: until <strong>{CANCEL_DEADLINE_HOURS_BEFORE}h</strong> before start. Within <strong>5h</strong> of
                        booking = minimal fee; after that a higher fee applies. Paid refunds <strong>auto-approve ~24h</strong> after you
                        cancel.
                      </p>
                    ) : null}
                    {showCancelClosed ? (
                      <p className="auth-note ticket-cancel-hint ticket-cancel-hint--warn">
                        Cancellation is closed (inside {CANCEL_DEADLINE_HOURS_BEFORE}h of start).
                      </p>
                    ) : null}
                    <div className="meta-list ticket-meta-list">
                      <span className="ticket-code">{ticket.ticketCode}</span>
                      <span
                        className={`ticket-status ${
                          ticket.status === "checked-in" ? "is-checked-in" : ticket.status === "expired" ? "is-expired" : ""
                        }`}
                      >
                        {ticket.status === "checked-in" ? "Checked in" : ticket.status === "expired" ? "Expired" : ticket.status}
                      </span>
                      {refundsByBooking[bid] && (
                        <span className={`ticket-status ${refundsByBooking[bid].status === "approved" ? "is-checked-in" : ""}`}>
                          Refund {refundsByBooking[bid].status}
                        </span>
                      )}
                    </div>
                    {canCancelBooking && (
                      <button className="ghost-button" type="button" onClick={() => cancelBooking(ticket.bookingId)}>
                        Cancel booking
                      </button>
                    )}
                    {eventDateVal && new Date(eventDateVal) < new Date() && (evMerged?._id || eid) ? (
                      <div className="ticket-feedback-hint">
                        <p className="auth-note">
                          After the event: leave a <strong>public review</strong> and <strong>private feedback</strong> for the organiser on the
                          event page (Book tickets → same event).
                        </p>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => handleSelectEvent(evMerged?._id || eid)}
                        >
                          Open event — review & feedback
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="ticket-actions">
                    <QRCodeSVG id={`qr-${ticket._id}`} value={ticket.ticketCode} size={96} bgColor="#ffffff" fgColor="#0d0f14" />
                    <button className="ghost-button" type="button" onClick={() => downloadTicketQr(ticket._id, ticket.ticketCode)}>
                      Download QR
                    </button>
                  </div>
                </article>
                );
              })
            ) : (
              <EmptyState
                label="Your booked tickets will appear here"
                hint="After you attend an event, open it again from Browse to leave a public review and private organiser feedback."
              />
            )}
          </div>
        </section>
              ) : null}
              {wishlistPath ? (
                <>
                  {wishlistReminders.length > 0 && (
          <section id="ewe-reminders" className={panelClass("panel full-width", ["attendee"])}>
            <div className="section-head">
              <h2>Upcoming reminders</h2>
              <p className="section-note">Wishlisted events starting in the next 72 hours (in-app + email when SMTP is configured).</p>
            </div>
            <div className="stack-list">
              {wishlistReminders.map((event) => (
                <button key={event._id} className="list-button" type="button" onClick={() => handleSelectEvent(event._id)}>
                  <span>{event.title}</span>
                  <small>{formatDate(event.date)}</small>
                </button>
              ))}
            </div>
          </section>
        )}
                  <section id="ewe-wishlist" className={panelClass("panel span-two full-width", ["attendee"])}>
          <div className="section-head">
            <h2>Wishlist</h2>
          </div>
          <div className="stack-list">
            {wishlistedEvents.length ? (
              wishlistedEvents.map((event) => (
                <div key={event._id} className="wishlist-item">
                  <button className="list-button wishlist-main" type="button" onClick={() => handleSelectEvent(event._id)}>
                    <span>{event.title}</span>
                    <small>Reminder set for {formatDate(event.date)}</small>
                  </button>
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    aria-label={`Remove ${event.title} from wishlist`}
                    onClick={() => toggleWishlist(event._id)}
                  >
                    Remove
                  </button>
                </div>
              ))
            ) : (
              <EmptyState label="Save events to get reminder notes here" />
            )}
          </div>
        </section>
                </>
              ) : null}

              {organisePath ? (
                <>
                  <div className="subpage-toolbar span-two full-width">
                    <button type="button" className="ghost-button compact-button" onClick={goDiscover}>
                      ← Discover
                    </button>
                    <button type="button" className="ghost-button compact-button" onClick={() => navigate("/check-in")}>
                      Check-in & dashboards →
                    </button>
                  </div>
                  {!user ? (
                    <div className="panel span-two full-width">
                      <EmptyState
                        label="Sign in to publish events"
                        hint="Use an organiser or admin account to create ticketed events."
                      />
                      <PrimaryButton type="button" style={{ marginTop: 12 }} onClick={openAccount}>
                        Sign in
                      </PrimaryButton>
                    </div>
                  ) : !isOrganiser ? (
                    <div className="panel span-two full-width">
                      <p className="auth-note">This account cannot publish events. Sign in with an organiser profile.</p>
                    </div>
                  ) : (
                    <>
                    <section className={`${panelClass("panel span-two full-width", ["organiser"])} host-profile-card`}>
                      <p className="card-label">Host profile, socials & LinkedIn</p>
                      <p className="auth-note">
                        Your public <strong>/host/…</strong> page. The LinkedIn toggle applies on event pages for <strong>hosts &amp; organisers</strong> on
                        the guest list — plain attendees do not edit LinkedIn here.
                      </p>
                      <label className="networking-toggle">
                        <input
                          type="checkbox"
                          checked={profileForm.networkingOptIn}
                          onChange={(e) => setProfileForm((current) => ({ ...current, networkingOptIn: e.target.checked }))}
                        />
                        Share my LinkedIn on event pages (hosts &amp; organisers on the guest list)
                      </label>
                      <input
                        placeholder="LinkedIn URL"
                        value={profileForm.linkedinUrl}
                        onChange={(e) => setProfileForm((current) => ({ ...current, linkedinUrl: e.target.value }))}
                      />
                      <input
                        placeholder="Short tagline (e.g. Indie gigs · Mumbai)"
                        value={profileForm.hostTagline}
                        onChange={(e) => setProfileForm((current) => ({ ...current, hostTagline: e.target.value }))}
                      />
                      <textarea
                        placeholder="Bio — who you are, what events you run"
                        rows={4}
                        value={profileForm.hostBio}
                        onChange={(e) => setProfileForm((current) => ({ ...current, hostBio: e.target.value }))}
                        className="host-bio-textarea"
                      />
                      <input
                        placeholder="Website URL"
                        value={profileForm.websiteUrl}
                        onChange={(e) => setProfileForm((current) => ({ ...current, websiteUrl: e.target.value }))}
                      />
                      <input
                        placeholder="X (Twitter) URL"
                        value={profileForm.twitterUrl}
                        onChange={(e) => setProfileForm((current) => ({ ...current, twitterUrl: e.target.value }))}
                      />
                      <input
                        placeholder="Instagram URL"
                        value={profileForm.instagramUrl}
                        onChange={(e) => setProfileForm((current) => ({ ...current, instagramUrl: e.target.value }))}
                      />
                      <button className="ghost-button" type="button" onClick={saveProfile}>
                        Save profile
                      </button>
                    </section>
                    <section id="ewe-organise" className={panelClass("panel span-two full-width", ["organiser"])} ref={organiserRef}>
            <div className="section-head">
              <h2>Create event</h2>
            </div>
            <form className="stack-form" onSubmit={handleCreateEvent}>
              <div className="two-column">
                <input placeholder="Event title" value={eventForm.title} onChange={(e) => updateEventField("title", e.target.value)} />
                <input type="datetime-local" value={eventForm.date} onChange={(e) => updateEventField("date", e.target.value)} />
              </div>
              <div className="two-column">
                <input placeholder="Location" value={eventForm.location} onChange={(e) => updateEventField("location", e.target.value)} />
                <input placeholder="City (for filters)" value={eventForm.city} onChange={(e) => updateEventField("city", e.target.value)} />
              </div>
              <div className="two-column">
                <select value={eventForm.venueType} onChange={(e) => updateEventField("venueType", e.target.value)}>
                  <option value="physical">Physical venue</option>
                  <option value="online">Online event</option>
                </select>
                <select value={eventForm.category} onChange={(e) => updateEventField("category", e.target.value)}>
                  <option value="Tech">Tech</option>
                  <option value="Music">Music</option>
                  <option value="Business">Business</option>
                  <option value="Workshop">Workshop</option>
                  <option value="Sports">Sports</option>
                  <option value="Art">Art</option>
                  <option value="Community">Community</option>
                </select>
              </div>
              <input
                placeholder="Cover image URL (optional)"
                value={eventForm.coverImage}
                onChange={(e) => updateEventField("coverImage", e.target.value)}
              />
              <input
                placeholder="Venue map URL (optional)"
                value={eventForm.venueMapUrl}
                onChange={(e) => updateEventField("venueMapUrl", e.target.value)}
              />
              <textarea
                rows="3"
                placeholder="Bullet points for the AI-style description (one per line)"
                value={descriptionOutline}
                onChange={(e) => setDescriptionOutline(e.target.value)}
              />
              <button type="button" className="ghost-button" onClick={generateDescriptionDraft}>
                Generate AI-style description from bullets
              </button>

              <textarea
                rows="4"
                placeholder="Describe the event..."
                value={eventForm.description}
                onChange={(e) => updateEventField("description", e.target.value)}
              />
              <div className="session-builder">
                <div className="session-head">
                  <div>
                    <p className="card-label">Sessions (Smart schedule)</p>
                    <p className="auth-note">Add sessions and generate an ordered agenda.</p>
                  </div>
                  <button type="button" className="ghost-button" onClick={buildSmartSchedule}>
                    Generate schedule
                  </button>
                </div>
                {eventForm.sessions.length ? (
                  <div className="session-grid">
                    {eventForm.sessions.map((session, index) => (
                      <div key={index} className="session-row">
                        <input
                          placeholder="Session title"
                          value={session.title}
                          onChange={(e) => updateSession(index, "title", e.target.value)}
                        />
                        <input
                          placeholder="Speaker"
                          value={session.speaker}
                          onChange={(e) => updateSession(index, "speaker", e.target.value)}
                        />
                        <input
                          type="number"
                          min="15"
                          placeholder="Minutes"
                          value={session.duration}
                          onChange={(e) => updateSession(index, "duration", e.target.value)}
                        />
                        <select value={session.preferredSlot} onChange={(e) => updateSession(index, "preferredSlot", e.target.value)}>
                          <option value="Morning">Morning</option>
                          <option value="Afternoon">Afternoon</option>
                          <option value="Evening">Evening</option>
                          <option value="Anytime">Anytime</option>
                        </select>
                        <button type="button" className="ghost-button" onClick={() => removeSession(index)}>
                          X
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="auth-note">No sessions added yet.</p>
                )}
                <button type="button" className="ghost-button" onClick={addSession}>
                  + Add session
                </button>
              </div>

              <div className="discount-builder">
                <p className="card-label">Discount codes</p>
                {eventForm.discountCodes.length ? (
                  <div className="discount-grid">
                    {eventForm.discountCodes.map((code, index) => (
                      <div key={index} className="discount-row">
                        <input
                          placeholder="CODE10"
                          value={code.code}
                          onChange={(e) => updateDiscountCode(index, "code", e.target.value.toUpperCase())}
                        />
                        <select value={code.type} onChange={(e) => updateDiscountCode(index, "type", e.target.value)}>
                          <option value="percent">% off</option>
                          <option value="amount">Flat off</option>
                        </select>
                        <input
                          type="number"
                          min="0"
                          placeholder="Value"
                          value={code.value}
                          onChange={(e) => updateDiscountCode(index, "value", e.target.value)}
                        />
                        <input
                          type="date"
                          value={code.expiresAt}
                          onChange={(e) => updateDiscountCode(index, "expiresAt", e.target.value)}
                        />
                        <button type="button" className="ghost-button" onClick={() => removeDiscountCode(index)}>
                          X
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="auth-note">No discount codes yet.</p>
                )}
                <button type="button" className="ghost-button" onClick={addDiscountCode}>
                  + Add discount code
                </button>
              </div>

              <div className="promo-builder">
                <p className="card-label">Pre-book / flash offer banner</p>
                <p className="auth-note">
                  Shown at the top of your public event page while active. Pair with discount codes or early-bird ticket prices. Set an end
                  date to auto-hide the banner.
                </p>
                <label className="promo-builder-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(eventForm.bookingPromo?.active)}
                    onChange={(e) => updateBookingPromo("active", e.target.checked)}
                  />
                  Show offer banner on event page
                </label>
                <input
                  placeholder="Badge (e.g. 20% off · First 50)"
                  value={eventForm.bookingPromo?.badge || ""}
                  onChange={(e) => updateBookingPromo("badge", e.target.value)}
                />
                <input
                  placeholder="Headline (required to show banner)"
                  value={eventForm.bookingPromo?.headline || ""}
                  onChange={(e) => updateBookingPromo("headline", e.target.value)}
                />
                <textarea
                  rows="2"
                  placeholder="Subtext (optional — e.g. Use code EARLY at checkout)"
                  value={eventForm.bookingPromo?.subtext || ""}
                  onChange={(e) => updateBookingPromo("subtext", e.target.value)}
                />
                <label className="auth-note">
                  Offer ends (optional, local time)
                  <input
                    type="datetime-local"
                    style={{ display: "block", marginTop: 6, width: "100%", maxWidth: 320 }}
                    value={eventForm.bookingPromo?.endsAt || ""}
                    onChange={(e) => updateBookingPromo("endsAt", e.target.value)}
                  />
                </label>
              </div>

              <div className="two-column">
                <textarea
                  rows="3"
                  placeholder="Agenda (one item per line)"
                  value={eventForm.agenda.join("\n")}
                  onChange={(e) => updateEventField("agenda", e.target.value.split("\n").filter(Boolean))}
                />
                <textarea
                  rows="3"
                  placeholder="Speakers (one per line)"
                  value={eventForm.speakers.join("\n")}
                  onChange={(e) => updateEventField("speakers", e.target.value.split("\n").filter(Boolean))}
                />
              </div>
              <div className="faq-builder">
                <p className="card-label">FAQ</p>
                {eventForm.faq.length ? (
                  <div className="faq-grid">
                    {eventForm.faq.map((item, index) => (
                      <div key={index} className="faq-row">
                        <input
                          placeholder="Question"
                          value={item.question}
                          onChange={(e) => updateFaq(index, "question", e.target.value)}
                        />
                        <input
                          placeholder="Answer"
                          value={item.answer}
                          onChange={(e) => updateFaq(index, "answer", e.target.value)}
                        />
                        <button type="button" className="ghost-button" onClick={() => removeFaq(index)}>
                          X
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="auth-note">No FAQ items yet.</p>
                )}
                <button type="button" className="ghost-button" onClick={addFaq}>
                  + Add FAQ
                </button>
              </div>

              <div className="ticket-builder">
                {eventForm.ticketTypes.map((ticket, index) => (
                  <div key={index} className="ticket-builder-row">
                    <input placeholder="Ticket name" value={ticket.name} onChange={(e) => updateTicketType(index, "name", e.target.value)} />
                    <input
                      type="number"
                      min="0"
                      placeholder="Price INR"
                      value={ticket.price}
                      onChange={(e) => updateTicketType(index, "price", e.target.value)}
                    />
                    <input
                      type="number"
                      min="0"
                      placeholder="Early bird price"
                      value={ticket.earlyBirdPrice}
                      onChange={(e) => updateTicketType(index, "earlyBirdPrice", e.target.value)}
                    />
                    <input
                      type="date"
                      placeholder="Early bird ends"
                      value={ticket.earlyBirdEndsAt}
                      onChange={(e) => updateTicketType(index, "earlyBirdEndsAt", e.target.value)}
                    />
                    <input
                      type="number"
                      min="1"
                      placeholder="Qty"
                      value={ticket.quantity}
                      onChange={(e) => updateTicketType(index, "quantity", e.target.value)}
                    />
                    <button type="button" className="ghost-button" onClick={() => removeTicketType(index)}>
                      X
                    </button>
                  </div>
                ))}
                <button type="button" className="ghost-button ticket-builder-add" onClick={addTicketType}>
                  + Add ticket type
                </button>
              </div>
              <PrimaryButton type="submit" style={{ justifySelf: "start", minWidth: "180px" }}>
                Publish event
              </PrimaryButton>
            </form>
          </section>
                    </>
                  )}
                </>
              ) : null}
              {checkinPath ? (
                <>
                  <div className="subpage-toolbar span-two full-width">
                    <button type="button" className="ghost-button compact-button" onClick={goDiscover}>
                      ← Discover
                    </button>
                    <button type="button" className="ghost-button compact-button" onClick={() => navigate("/organise")}>
                      ← Create event
                    </button>
                  </div>
                  {!user ? (
                    <div className="panel span-two full-width">
                      <EmptyState
                        label="Sign in for check-in"
                        hint="Hosts scan tickets here; door staff pick an assignment below after the host adds them."
                      />
                      <PrimaryButton type="button" style={{ marginTop: 12 }} onClick={openAccount}>
                        Sign in
                      </PrimaryButton>
                    </div>
                  ) : !(isOrganiser || staffMyEvents.length > 0) ? (
                    <div className="panel span-two full-width">
                      <p className="auth-note">
                        Check-in tools are for event hosts. Door staff: ask your host to invite your account — then open this page to select
                        your gate under Door staff assignments.
                      </p>
                    </div>
                  ) : (
                    <>
            <section className={panelClass("panel", ["organiser", "checkin"])}>
              <div className="section-head">
                <h2>Managed events</h2>
              </div>
              {myEvents.length ? (
                <div className="stack-list">
                  {myEvents.map((event) => (
                    <button key={event._id} className="list-button" onClick={() => openDashboard(event._id)}>
                      <span>{event.title}</span>
                      <small>{formatDate(event.date)}</small>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState label="No events yet" hint="Publish a new event from Organise (/organise), then return here for dashboards and check-in." />
              )}
            </section>

            {staffMyEvents.length > 0 ? (
              <section className={panelClass("panel", ["organiser", "checkin"])}>
                <div className="section-head">
                  <h2>Door staff assignments</h2>
                  <p className="section-note">
                    The host added you as check-in only for these events. Pick the gate you are working so scans apply to the right event.
                    If you also manage the event as host, open it under <strong>Managed events</strong> for the full dashboard — that clears
                    this gate override.
                  </p>
                  {checkInGateEvent ? (
                    <button type="button" className="ghost-button compact-button" onClick={() => setCheckInGateEvent(null)}>
                      Clear staff gate (use managed-event dashboard only)
                    </button>
                  ) : null}
                </div>
                <div className="stack-list">
                  {staffMyEvents.map((ev) => (
                    <button
                      key={ev._id}
                      type="button"
                      className={`list-button${checkInGateEvent?._id === ev._id ? " is-active" : ""}`}
                      onClick={() => setCheckInGateEvent(ev)}
                    >
                      <span>{ev.title}</span>
                      <small>{formatDate(ev.date)}</small>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <section
              id="ewe-checkin"
              className={panelClass("panel span-two full-width", ["checkin", "organiser"])}
              ref={checkinRef}
            >
              <div className="section-head section-head--checkin">
                <div className="section-head-checkin-title-row">
                  <h2>Check-in dashboard</h2>
                  {dashboard ? (
                    <button className="ghost-button compact-button" type="button" onClick={downloadDashboardCsv}>
                      Download CSV
                    </button>
                  ) : null}
                </div>
                <p className="section-note checkin-dashboard-lede">
                  <strong>Who scans:</strong> the host (organiser) or door staff the host invited. Pick the event under{" "}
                  <strong>Managed events</strong> or <strong>Door staff assignments</strong>, then paste or scan each code. One scan per
                  ticket; duplicates are rejected. Attendees see <strong>Checked in</strong> on <em>My tickets</em> after sync — refresh if
                  needed.
                </p>
              </div>
              <div className="checkin-form-wrap" ref={checkinFormRef}>
                <form className="dashboard-checkin-form checkin-form-stacked" onSubmit={handleCheckIn}>
                  <input
                    className="checkin-code-input"
                    placeholder="Paste ticket code (e.g. EWE-XXXXXXXX)…"
                    value={checkInCode}
                    onChange={(e) => {
                      setCheckInCode(e.target.value);
                      setCheckInNotice(null);
                    }}
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <label className="checkin-verify-toggle">
                    <input
                      type="checkbox"
                      checked={checkInVerifyOnly}
                      onChange={(e) => setCheckInVerifyOnly(e.target.checked)}
                    />
                    Verify only (do not mark attended)
                  </label>
                  <div className="checkin-form-actions">
                    <PrimaryButton type="submit" className="checkin-submit-btn">
                      {checkInVerifyOnly ? "Verify ticket" : "Mark attended"}
                    </PrimaryButton>
                    <button type="button" className="ghost-button dashboard-scan-btn" onClick={() => setScannerOpen((open) => !open)}>
                      {scannerOpen ? "Stop camera" : "Scan QR with camera"}
                    </button>
                  </div>
                </form>
                {checkInNotice ? (
                  <p className={`checkin-notice${checkInNotice.ok ? " checkin-notice--ok" : " checkin-notice--err"}`} role="status">
                    {checkInNotice.text}
                  </p>
                ) : null}
              </div>
              {scannerOpen ? <QrScannerPanel onScan={onQrDecoded} onCameraError={onQrCameraError} /> : null}

              {dashboard ? (
                <div className="dashboard">
                  <div className="stats-grid">
                    <div className="stat-card">
                      <strong>
                        <AnimatedNumber value={dashboard.stats.registrations} />
                      </strong>
                      <span>Registrations</span>
                    </div>
                    <div className="stat-card">
                      <strong className="stat-card-revenue">{formatCurrency(dashboard.stats.revenue)}</strong>
                      <span>Revenue</span>
                    </div>
                    <div className="stat-card">
                      <strong>
                        <AnimatedNumber value={dashboard.stats.checkedInCount} />
                      </strong>
                      <span>Checked in</span>
                    </div>
                    <div className="stat-card">
                      <strong className="stat-card-revenue">{formatCurrency(dashboard.stats.refundedAmount || 0)}</strong>
                      <span>Refunded (net)</span>
                    </div>
                    <div className="stat-card">
                      <strong>
                        <AnimatedNumber value={dashboard.stats.pendingRefunds ?? 0} />
                      </strong>
                      <span>Pending refunds</span>
                    </div>
                    <div className="stat-card">
                      <strong className="stat-card-revenue">{formatCurrency(dashboard.stats.payoutEstimate || 0)}</strong>
                      <span>Payout</span>
                    </div>
                  </div>
                  <EventDashboardAnalytics
                    analytics={dashboard.analytics}
                    eventTitle={dashboard.event?.title}
                  />
                  <p className="analytics-table-heading">Everyone with a ticket (scan time when checked in)</p>
                  <div className="attendee-table">
                    {dashboard.attendees.map((ticket, index) => (
                      <div key={ticket._id} className="attendee-row" style={{ animationDelay: `${index * 0.04}s` }}>
                        <div className="attendee-row-main">
                          <span className="attendee-name">{ticket.userId?.name}</span>
                          <span className="attendee-email">{ticket.userId?.email}</span>
                        </div>
                        <div className="attendee-row-meta">
                          <span className="attendee-link">
                            {ticket.userId?.networkingOptIn && ticket.userId?.linkedinUrl ? "LinkedIn shared" : "—"}
                          </span>
                          <span className="ticket-code" title="Ticket QR code">
                            {ticket.ticketCode}
                          </span>
                          <span className="attendee-checkin-at" title="When this pass was scanned at the door">
                            {ticket.status === "checked-in" && ticket.checkedInAt
                              ? new Date(ticket.checkedInAt).toLocaleString()
                              : "—"}
                          </span>
                          <span
                            className={`attendee-status ${
                              ticket.status === "checked-in" ? "is-checked-in" : ticket.status === "expired" ? "is-expired" : ""
                            }`}
                          >
                            {ticket.status === "expired" ? "expired" : ticket.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyState label="Select one of your managed events to see live stats" />
              )}
              {dashboard && eventWaitlist.length > 0 ? (
                <div className="waitlist-host-block">
                  <h3 className="analytics-table-heading">Waitlist ({eventWaitlist.length})</h3>
                  <p className="auth-note">People who asked to be notified if tickets free up.</p>
                  <ul className="waitlist-host-list">
                    {eventWaitlist.map((row) => (
                      <li key={row._id}>
                        <span className="waitlist-host-position" title="Queue position (FIFO for this event)">
                          #{row.position ?? "—"}
                        </span>
                        <strong>{row.userId?.name || "Attendee"}</strong>
                        <span className="waitlist-host-email">{row.userId?.email || ""}</span>
                        <span className="auth-note">
                          {" "}
                          ·{" "}
                          {row.ticketTypeId
                            ? dashboard.event?.ticketTypes?.find((t) => String(t._id) === String(row.ticketTypeId))
                                ?.name || "Ticket type"
                            : "Any ticket type"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {dashboard?.event?._id && isOrganiser ? (
                <div className="staff-host-block">
                  <h3 className="analytics-table-heading">Door staff</h3>
                  <p className="auth-note">
                    Invite another signed-up account to scan tickets for this event only. They will see it under Door staff assignments.
                  </p>
                  <div className="inline-form staff-invite-form">
                    <input
                      type="email"
                      placeholder="Staff email (must already have an account)"
                      value={staffInviteEmail}
                      onChange={(e) => setStaffInviteEmail(e.target.value)}
                      autoComplete="email"
                    />
                    <button type="button" className="ghost-button" onClick={() => void addStaffMember()}>
                      Add staff
                    </button>
                  </div>
                  {dashboardStaff.length ? (
                    <ul className="staff-host-list">
                      {dashboardStaff.map((row) => (
                        <li key={row._id}>
                          <div>
                            <strong>{row.userId?.name || "User"}</strong>
                            <span className="waitlist-host-email">{row.userId?.email || ""}</span>
                          </div>
                          <button type="button" className="ghost-button compact-button" onClick={() => removeStaffMember(row._id)}>
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="auth-note">No extra door staff yet.</p>
                  )}
                </div>
              ) : null}
            </section>

            <section className={panelClass("panel", ["organiser", "checkin"])}>
              <div className="section-head">
                <h2>Refund requests</h2>
                <p className="section-note">
                  View-only summary. Paid cancellations use tiered fees and <strong>auto-approve ~24h</strong> after the attendee submits;
                  you will see counts above and bell alerts for new and finalized refunds.
                </p>
              </div>
              {refundRequests.length ? (
                <div className="stack-list">
                  {refundRequests.map((refund) => (
                    <div key={refund._id} className="refund-row refund-row--detail">
                      <div>
                        <strong>{refund.attendeeId?.name || "Attendee"}</strong>
                        <p className="auth-note">{refund.reason || "No reason shared"}</p>
                        <p className="auth-note refund-row-meta">
                          {[
                            refund.policyBand === "grace"
                              ? "Grace fee tier"
                              : refund.policyBand === "standard"
                                ? "Standard fee tier"
                                : "",
                            refund.bookingTotalAmount != null ? `Booking ${formatCurrency(refund.bookingTotalAmount)}` : "",
                            refund.cancellationFeeAmount != null ? `Fee ${formatCurrency(refund.cancellationFeeAmount)}` : "",
                            refund.refundNetAmount != null ? `Net refund ${formatCurrency(refund.refundNetAmount)}` : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {refund.status === "pending" && refund.autoApproveAt ? (
                          <>
                            <p className="auth-note">Auto-approve by {formatDate(refund.autoApproveAt)}</p>
                            <div className="refund-progress" aria-label="Refund auto-approval progress">
                              {(() => {
                                const now = Date.now();
                                const autoAt = new Date(refund.autoApproveAt).getTime();
                                const createdAt = refund.createdAt ? new Date(refund.createdAt).getTime() : autoAt - 24 * 60 * 60 * 1000;
                                const span = Math.max(1, autoAt - createdAt);
                                const pct = Math.max(0, Math.min(100, ((now - createdAt) / span) * 100));
                                const left = Math.max(0, autoAt - now);
                                return (
                                  <>
                                    <div className="mini-progress mini-progress--refund">
                                      <div className="mini-progress-fill" style={{ width: `${pct}%` }} />
                                    </div>
                                    <p className="refund-progress-note">
                                      {left > 0 ? `Auto-approves in ${formatMsAsCountdown(left, { withSeconds: false })}` : "Auto-approve window reached"}
                                    </p>
                                  </>
                                );
                              })()}
                            </div>
                          </>
                        ) : null}
                        {refund.resolvedAt ? <p className="auth-note">Resolved {formatDate(refund.resolvedAt)}</p> : null}
                      </div>
                      <div className="refund-actions">
                        <span className="pill">{refund.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState label="No refund requests yet" />
              )}
            </section>

            <section className={panelClass("panel", ["organiser", "checkin"])}>
              <div className="section-head">
                <h2>Post-event feedback</h2>
              </div>
              {feedbackEntries.length ? (
                <div className="stack-list">
                  {feedbackEntries.map((entry) => (
                    <div key={entry._id} className="refund-row">
                      <div>
                        <strong>{entry.attendeeId?.name || "Attendee"}</strong>
                        <p className="auth-note">{entry.feedback || "(no feedback text)"}</p>
                      </div>
                      <div className="refund-actions">
                        <span className="pill">{entry.rating}/5</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState label="No feedback yet" />
              )}
            </section>
                    </>
                  )}
                </>
              ) : null}

            </main>
          </div>
        </div>
        {hostAuthModalOpen
          ? createPortal(
              <div className="auth-modal-root" role="presentation">
                <button
                  type="button"
                  className="auth-modal-backdrop"
                  aria-label="Close sign in"
                  onClick={() => setHostAuthModalOpen(false)}
                />
                <div
                  className="auth-modal-panel"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="host-auth-modal-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="auth-modal-head">
                    <h2 id="host-auth-modal-title" className="auth-modal-title">
                      {authMode === "forgot"
                        ? "Reset password"
                        : authMode === "reset"
                          ? "New password"
                          : authMode === "signup"
                            ? "Create account"
                            : "Sign in"}
                    </h2>
                    <button type="button" className="ghost-button compact-button" onClick={() => setHostAuthModalOpen(false)}>
                      Close
                    </button>
                  </div>
                  {authMode === "forgot" || authMode === "reset" ? (
                    <button className="ghost-button compact-button" type="button" onClick={() => setAuthMode("login")}>
                      Back to login
                    </button>
                  ) : (
                    <div className="switch-row auth-modal-tabs">
                      <button
                        className={`tab${authMode === "login" ? " active" : ""}`}
                        type="button"
                        onClick={() => setAuthMode("login")}
                      >
                        Login
                      </button>
                      <button
                        className={`tab${authMode === "signup" ? " active" : ""}`}
                        type="button"
                        onClick={() => setAuthMode("signup")}
                      >
                        Signup
                      </button>
                    </div>
                  )}
                  <form className="stack-form auth-form host-auth-modal-form" onSubmit={handleAuthSubmit}>
                    {renderGuestAuthFormFields()}
                    <PrimaryButton type="submit" style={{ width: "100%", marginTop: "2px" }}>
                      {authMode === "login"
                        ? "Login"
                        : authMode === "signup"
                          ? "Create account"
                          : authMode === "forgot"
                            ? "Send reset mail"
                            : "Update password"}
                    </PrimaryButton>
                    {authMode === "login" && (
                      <div className="auth-links">
                        <button type="button" onClick={() => setAuthMode("forgot")}>
                          Forgot password?
                        </button>
                        <button type="button" onClick={resendVerification}>
                          Resend verify email
                        </button>
                      </div>
                    )}
                    {authMode === "signup" && <p className="auth-note">We will email a verification link before login is enabled.</p>}
                    {authMode === "forgot" && <p className="auth-note">Enter your account email and we will send a reset link.</p>}
                    {authMode === "reset" && <p className="auth-note">Set a fresh password from the secure reset link.</p>}
                  </form>
                </div>
              </div>,
              document.body
            )
          : null}
        {gamifyFloatingDock}
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="app-root">
      <a className="skip-link" href="#ewe-main">
        Skip to workspace
      </a>
      <TopNav
        user={user}
        isOrganiser={isOrganiser}
        profileMode={profileMode}
        onGoDiscover={goDiscover}
        onGoBook={goBook}
        onGoTickets={goTickets}
        onGoWishlist={goWishlist}
        onGoOrganise={goOrganise}
        onGoCheckIn={goCheckIn}
        onGoStats={goStats}
        showStatsLink={isAdminUser}
        onOpenAccount={openAccount}
        onLogout={logout}
        notificationUnread={user ? unreadCount : 0}
        onNotificationsToggle={() => setNotifOpen((o) => !o)}
        notificationsOpen={notifOpen}
        navActiveKey={navActiveKey}
      />
      {user && nextBookedEventCountdown ? (
        <div className="countdown-strip" role="status">
          <button
            type="button"
            className="countdown-strip__btn"
            onClick={() => {
              setNotifOpen(false);
              handleSelectEvent(nextBookedEventCountdown.eid);
            }}
          >
            <span className="countdown-strip__label">Next ticketed event</span>
            <span className="countdown-strip__title">{nextBookedEventCountdown.title}</span>
            <span className="countdown-strip__time">{formatMsAsCountdown(nextBookedEventCountdown.left)}</span>
          </button>
        </div>
      ) : null}
      <NotificationsPanel
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        notifications={notifications}
        markRead={markRead}
        markAllRead={markAllRead}
        dismissNotif={dismissNotif}
        navigate={navigate}
        flash={flash}
        desktopSupported={desktopSupported}
        desktopPermission={desktopPermission}
        requestDesktopPermission={requestDesktopPermission}
        pushEssentialEnabled={pushEssentialEnabled}
        setPushEssentialEnabled={setPushEssentialEnabled}
        ticketPreview={ticketNotificationsPreview}
        followingHosts={followingHosts}
        formatMsAsCountdown={formatMsAsCountdown}
        formatDate={formatDate}
      />
      <div className="app-flow">
        <div className="app-shell">
          <header className="hero-panel">
        <div className="hero-copy-block">
          <p className="eyebrow">EventwithEase</p>
          <p className="hero-kicker">Event publishing · Ticketing · Check-in</p>
          <h1>
            <span>Make your next</span>
            <span className="hero-accent">event feel bigger</span>
            <span>before it even starts.</span>
          </h1>
          <p className="hero-copy">
            Organisers launch events, sell ticket types, and track turnout live. Attendees browse, book, carry a QR
            pass, and walk in with a single scan.
          </p>
          <div className="hero-cta-row">
            <PrimaryButton type="button" onClick={goDiscover}>
              Browse events
            </PrimaryButton>
            <button type="button" className="hero-cta-secondary" onClick={goOrganise}>
              Host an event
            </button>
          </div>
          <p className="hero-trust">Sandbox payments · Per-ticket QR · CSV export · Refund workflow</p>
          <div className="hero-strip">
            {[
              { mode: "organiser", label: "Organiser", sub: "Create events · Monitor revenue" },
              { mode: "attendee", label: "Attendee", sub: "Book tickets · QR entry" },
              { mode: "checkin", label: "Check-in", sub: "Mark attendance in seconds" },
            ].map(({ mode, label, sub }) => (
              <button
                type="button"
                className={`hero-chip hero-chip-button${profileMode === mode ? " is-active" : ""}`}
                key={label}
                onClick={() => {
                  if (mode === "organiser") {
                    setProfileMode("organiser");
                    navigate("/organise");
                    return;
                  }
                  if (mode === "checkin") {
                    setProfileMode("checkin");
                    navigate("/check-in");
                    return;
                  }
                  focusProfileMode("attendee");
                }}
              >
                <strong>{label}</strong>
                <span>{sub}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="hero-stats">
          {[
            { value: events.length, label: "Live events" },
            { value: myTickets.length, label: "Your tickets" },
            { value: myEvents.length, label: "Managed events" },
          ].map(({ value, label }) => (
            <div className="hero-stat-card" key={label}>
              <strong>
                <AnimatedNumber value={value} />
              </strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </header>

      {discoverPromoStripItems.length > 0 ? (
        <aside className="discover-promo-strip" aria-label="Spotlight offers">
          <div className="discover-promo-strip-inner">
            {discoverPromoStripItems.map((item) =>
              item.kind === "event" ? (
                <div key={item.id} className="discover-promo-card discover-promo-card--animated">
                  <button
                    type="button"
                    className="discover-promo-dismiss"
                    aria-label="Dismiss offer"
                    onClick={() => dismissDiscoverPromo(item.id)}
                  >
                    ×
                  </button>
                  <span className="discover-promo-badge">{item.event.bookingPromo?.badge || "Offer"}</span>
                  <p className="discover-promo-headline">{item.event.bookingPromo.headline}</p>
                  {item.event.bookingPromo?.subtext ? (
                    <p className="discover-promo-sub">{item.event.bookingPromo.subtext}</p>
                  ) : null}
                  <p className="discover-promo-event-title">{item.event.title}</p>
                  <button type="button" className="discover-promo-cta" onClick={() => handleSelectEvent(item.event._id)}>
                    View &amp; pre-book
                  </button>
                </div>
              ) : (
                <div key={item.id} className="discover-promo-card discover-promo-card--animated discover-promo-card--static">
                  <button
                    type="button"
                    className="discover-promo-dismiss"
                    aria-label="Dismiss"
                    onClick={() => dismissDiscoverPromo(item.id)}
                  >
                    ×
                  </button>
                  <span className="discover-promo-badge">Spotlight</span>
                  <p className="discover-promo-headline">Exclusive pre-book drops &amp; host promos</p>
                  <p className="discover-promo-sub">
                    Watch for gold banners on event pages — hosts can run limited windows before doors. Browse now and save your spot early.
                  </p>
                  <button type="button" className="discover-promo-cta" onClick={() => scrollToRef(browseRef)}>
                    Browse events
                  </button>
                </div>
              )
            )}
          </div>
        </aside>
      ) : null}

      {statusMessage && <div className="banner success">{statusMessage}</div>}
      {errorMessage && <div className="banner error">{errorMessage}</div>}

      <main id="ewe-main" className="grid-layout">
        <section
          id="ewe-account"
          className={panelClass("panel auth-panel full-width", ["attendee", "organiser", "checkin"])}
          ref={authRef}
        >
          <div className="section-head auth-head">
            <h2>
              {user
                ? `Hello, ${user.name.split(" ")[0]}`
                : authMode === "forgot"
                  ? "Reset password"
                  : authMode === "reset"
                    ? "New password"
                    : authMode === "signup"
                      ? "Create account"
                      : "Sign in"}
            </h2>
            {user ? (
              <button className="ghost-button" onClick={logout}>
                Logout
              </button>
            ) : authMode === "forgot" || authMode === "reset" ? (
              <button className="ghost-button compact-button" type="button" onClick={() => setAuthMode("login")}>
                Back
              </button>
            ) : (
              <div className="switch-row">
                <button className={`tab${authMode === "login" ? " active" : ""}`} type="button" onClick={() => setAuthMode("login")}>
                  Login
                </button>
                <button className={`tab${authMode === "signup" ? " active" : ""}`} type="button" onClick={() => setAuthMode("signup")}>
                  Signup
                </button>
              </div>
            )}
          </div>

          {user ? (
            <div className="user-card">
              <p className="card-label">Signed in as</p>
              <p className="user-email">{user.email}</p>
              <span className="pill">{userRoles.join(" + ")}</span>
              <p className="auth-note gamify-floating-hint">
                Event explorer level and patron power stay in the floating panel (bottom-right) on every page — hide or restore it anytime.
              </p>
              <div className="profile-switch">
                <button
                  className={`tab${profileMode === "attendee" ? " active" : ""}`}
                  type="button"
                  onClick={() => focusProfileMode("attendee")}
                >
                  Attendee
                </button>
                <button
                  className={`tab${profileMode === "organiser" ? " active" : ""}`}
                  type="button"
                  onClick={() => focusProfileMode("organiser")}
                >
                  Organiser
                </button>
                <button
                  className={`tab${profileMode === "checkin" ? " active" : ""}`}
                  type="button"
                  onClick={() => {
                    setProfileMode("checkin");
                    navigate("/check-in");
                  }}
                >
                  Check-in
                </button>
              </div>
              {isOrganiser && profileMode === "organiser" ? (
                <div className="host-profile-card">
                  <p className="card-label">Host profile, socials & LinkedIn</p>
                  <p className="auth-note">
                    Updates your public <strong>/host/…</strong> page. <strong>LinkedIn</strong> and the toggle below also control whether you
                    appear in the guest-list LinkedIn section on events where you hold a ticket — only <strong>hosts and organisers</strong> can
                    share there, not general attendees.
                  </p>
                  <label className="networking-toggle">
                    <input
                      type="checkbox"
                      checked={profileForm.networkingOptIn}
                      onChange={(e) => setProfileForm((current) => ({ ...current, networkingOptIn: e.target.checked }))}
                    />
                    Share my LinkedIn on event pages (hosts &amp; organisers on the guest list)
                  </label>
                  <input
                    placeholder="LinkedIn URL"
                    value={profileForm.linkedinUrl}
                    onChange={(e) => setProfileForm((current) => ({ ...current, linkedinUrl: e.target.value }))}
                  />
                  <input
                    placeholder="Short tagline (e.g. Indie gigs · Mumbai)"
                    value={profileForm.hostTagline}
                    onChange={(e) => setProfileForm((current) => ({ ...current, hostTagline: e.target.value }))}
                  />
                  <textarea
                    placeholder="Bio — who you are, what events you run"
                    rows={4}
                    value={profileForm.hostBio}
                    onChange={(e) => setProfileForm((current) => ({ ...current, hostBio: e.target.value }))}
                    className="host-bio-textarea"
                  />
                  <input
                    placeholder="Website URL"
                    value={profileForm.websiteUrl}
                    onChange={(e) => setProfileForm((current) => ({ ...current, websiteUrl: e.target.value }))}
                  />
                  <input
                    placeholder="X (Twitter) URL"
                    value={profileForm.twitterUrl}
                    onChange={(e) => setProfileForm((current) => ({ ...current, twitterUrl: e.target.value }))}
                  />
                  <input
                    placeholder="Instagram URL"
                    value={profileForm.instagramUrl}
                    onChange={(e) => setProfileForm((current) => ({ ...current, instagramUrl: e.target.value }))}
                  />
                  <button className="ghost-button" type="button" onClick={saveProfile}>
                    Save profile
                  </button>
                </div>
              ) : null}
              {userRoles.includes("admin") ? (
                <div className="admin-console-card">
                  <p className="card-label">Admin directory</p>
                  <p className="auth-note">
                    List any event or user account. Force-cancel sends attendee cancellation emails when SMTP is enabled.
                  </p>
                  <button type="button" className="ghost-button" onClick={() => void loadAdminSnapshot()}>
                    Load / refresh directory
                  </button>
                  {adminSnapshotLoaded ? (
                    <>
                      <h3 className="analytics-table-heading admin-console-subhead">Events (latest 200)</h3>
                      <ul className="admin-dir-list">
                        {adminEvents.map((ev) => (
                          <li key={ev._id} className="admin-dir-row">
                            <div>
                              <strong>{ev.title}</strong>
                              <p className="auth-note">
                                {formatDate(ev.date)}
                                {ev.city ? ` · ${ev.city}` : ""} · host {ev.organiserId?.email || "—"}
                                {ev.cancelledAt ? " · cancelled" : ""}
                              </p>
                            </div>
                            {!ev.cancelledAt ? (
                              <button type="button" className="ghost-button compact-button" onClick={() => adminCancelEvent(ev._id)}>
                                Cancel event
                              </button>
                            ) : (
                              <span className="pill pill--warn">Cancelled</span>
                            )}
                          </li>
                        ))}
                      </ul>
                      <h3 className="analytics-table-heading admin-console-subhead">Users (latest 150)</h3>
                      <ul className="admin-dir-list admin-dir-list--users">
                        {adminUsers.map((u) => (
                          <li key={u._id} className="admin-dir-row">
                            <div>
                              <strong>{u.name || "—"}</strong>
                              <p className="auth-note">
                                {u.email} · {(u.roles?.length ? u.roles : u.role ? [u.role] : []).join(", ") || "—"}
                                {u.emailVerified ? " · verified" : ""}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <form className="stack-form auth-form" onSubmit={handleAuthSubmit}>
              {renderGuestAuthFormFields()}

              <PrimaryButton type="submit" style={{ width: "100%", marginTop: "2px" }}>
                {authMode === "login"
                  ? "Login"
                  : authMode === "signup"
                    ? "Create account"
                    : authMode === "forgot"
                      ? "Send reset mail"
                      : "Update password"}
              </PrimaryButton>

              {authMode === "login" && (
                <div className="auth-links">
                  <button type="button" onClick={() => setAuthMode("forgot")}>
                    Forgot password?
                  </button>
                  <button type="button" onClick={resendVerification}>
                    Resend verify email
                  </button>
                </div>
              )}

              {authMode === "signup" && <p className="auth-note">We will email a verification link before login is enabled.</p>}
              {authMode === "forgot" && <p className="auth-note">Enter your account email and we will send a reset link.</p>}
              {authMode === "reset" && <p className="auth-note">Set a fresh password from the secure reset link.</p>}
            </form>
          )}
        </section>

        {profileMode === "attendee" && recommendedEvents.length > 0 && (
        <section id="ewe-recommended" className={panelClass("panel span-two full-width", ["attendee"])}>
          <div className="section-head">
            <h2>Recommended for you</h2>
            <p className="section-note">Based on your past tickets and saved events.</p>
          </div>
          <div className="card-grid">
            {recommendedEvents.map((event, index) => (
              <article className="event-card" key={event._id} style={{ animationDelay: `${index * 0.07}s` }}>
                <div
                  className="event-cover"
                  style={{
                    backgroundImage: event.coverImage
                      ? `linear-gradient(180deg,rgba(13,15,20,0.2),rgba(13,15,20,0.85)),url(${event.coverImage})`
                      : "linear-gradient(135deg,#0d4a46,#0a1a2e)",
                  }}
                >
                  <span className="pill">{event.category}</span>
                  {event.cancelledAt ? (
                    <span className="pill pill--warn" style={{ marginLeft: 6 }}>
                      Cancelled
                    </span>
                  ) : null}
                </div>
                <div className="event-content">
                  <p className="card-label">Recommended</p>
                  <h3>{event.title}</h3>
                  <p>{event.description}</p>
                    <div className="meta-list">
                      <span>{formatDate(event.date)}</span>
                      {event.city ? <span>{event.city}</span> : null}
                      <span>{event.location}</span>
                      {eventOrganiserRefId(event) ? (
                        <span className="meta-host-line">
                          by{" "}
                          <button type="button" className="link-like-button" onClick={() => goHostProfile(eventOrganiserRefId(event))}>
                            {eventOrganiserDisplayName(event) || "Host"}
                          </button>
                        </span>
                      ) : null}
                    </div>
                  {eventOrganiserTagline(event) ? (
                    <p className="meta-host-tagline">{eventOrganiserTagline(event)}</p>
                  ) : null}
                  <div className="event-actions">
                    <PrimaryButton onClick={() => handleSelectEvent(event._id)}>View details</PrimaryButton>
                    <button className="ghost-button" type="button" onClick={() => toggleWishlist(event._id)}>
                      {wishlistSet.has(String(event._id)) ? "Saved" : "Wishlist"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
        )}

{profileMode === "attendee" && (
        <section id="ewe-discover" className={panelClass("panel span-two full-width", ["attendee"])} ref={browseRef}>
          <div className="section-head event-browser-head">
            <h2>Browse events</h2>
            <div className="filter-bar">
              <input
                className="search-input"
                placeholder="Search by name, city, category..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="all">All categories</option>
                <option value="Tech">Tech</option>
                <option value="Music">Music</option>
                <option value="Business">Business</option>
                <option value="Workshop">Workshop</option>
                <option value="Sports">Sports</option>
                <option value="Art">Art</option>
                <option value="Community">Community</option>
              </select>
              <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
                <option value="all">Any date</option>
                <option value="week">Next 7 days</option>
                <option value="month">Next month</option>
              </select>
              <input
                className="search-input"
                placeholder="City"
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
              />
              <select value={priceFilter} onChange={(e) => setPriceFilter(e.target.value)}>
                <option value="all">Any price</option>
                <option value="free">Free</option>
                <option value="paid">Paid</option>
              </select>
            </div>
          </div>

          {eventsError ? (
            <div className="api-error-banner" role="alert">
              <div className="api-error-copy">
                <strong>We could not load events</strong>
                <p>{eventsError}</p>
                <p className="api-error-hint">
                  Confirm <code className="api-error-code">VITE_API_URL</code> on Vercel matches your Render web
                  service URL plus <code className="api-error-code">/api</code> — use the hostname exactly as shown in
                  Render (a typo or extra hyphen often returns 404).
                </p>
              </div>
              <button type="button" className="api-error-retry" onClick={retryLoadEvents} disabled={eventsReloading}>
                {eventsReloading ? "Retrying…" : "Try again"}
              </button>
            </div>
          ) : null}

          {!eventsError && filteredEvents.length === 0 ? (
            <EmptyState
              label="No events match these filters"
              hint="Try clearing search, city, or date filters to see more listings."
            />
          ) : eventsError ? null : (
            <div className="card-grid">
              {filteredEvents.map((event, index) => (
                <article className="event-card" key={event._id} style={{ animationDelay: `${index * 0.07}s` }}>
                  <div
                    className="event-cover"
                    style={{
                      backgroundImage: event.coverImage
                        ? `linear-gradient(180deg,rgba(13,15,20,0.2),rgba(13,15,20,0.85)),url(${event.coverImage})`
                        : "linear-gradient(135deg,#0d4a46,#0a1a2e)",
                    }}
                  >
                    <span className="pill">{event.category}</span>
                    {event.cancelledAt ? (
                      <span className="pill pill--warn" style={{ marginLeft: 6 }}>
                        Cancelled
                      </span>
                    ) : null}
                  </div>
                  <div className="event-content">
                    <p className="card-label">Featured event</p>
                    <h3>{event.title}</h3>
                    <p>{event.description}</p>
                    <div className="meta-list">
                      <span>{formatDate(event.date)}</span>
                      {event.city ? <span>{event.city}</span> : null}
                      <span>{event.location}</span>
                      <span className="meta-host-line">
                        by{" "}
                        {eventOrganiserRefId(event) ? (
                          <button type="button" className="link-like-button" onClick={() => goHostProfile(eventOrganiserRefId(event))}>
                            {eventOrganiserDisplayName(event) || "Organiser"}
                          </button>
                        ) : (
                          "Organiser"
                        )}
                      </span>
                    </div>
                    {eventOrganiserTagline(event) ? (
                      <p className="meta-host-tagline">{eventOrganiserTagline(event)}</p>
                    ) : null}
                    <div className="event-actions">
                      <PrimaryButton onClick={() => handleSelectEvent(event._id)}>View details</PrimaryButton>
                      <button className="ghost-button" type="button" onClick={() => toggleWishlist(event._id)}>
                        {wishlistSet.has(String(event._id)) ? "Saved" : "Wishlist"}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        )}
      </main>
    </div>
  </div>
  {hostAuthModalOpen
    ? createPortal(
        <div className="auth-modal-root" role="presentation">
          <button
            type="button"
            className="auth-modal-backdrop"
            aria-label="Close sign in"
            onClick={() => setHostAuthModalOpen(false)}
          />
          <div
            className="auth-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="host-auth-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="auth-modal-head">
              <h2 id="host-auth-modal-title" className="auth-modal-title">
                {authMode === "forgot"
                  ? "Reset password"
                  : authMode === "reset"
                    ? "New password"
                    : authMode === "signup"
                      ? "Create account"
                      : "Sign in"}
              </h2>
              <button type="button" className="ghost-button compact-button" onClick={() => setHostAuthModalOpen(false)}>
                Close
              </button>
            </div>
            {authMode === "forgot" || authMode === "reset" ? (
              <button className="ghost-button compact-button" type="button" onClick={() => setAuthMode("login")}>
                Back to login
              </button>
            ) : (
              <div className="switch-row auth-modal-tabs">
                <button className={`tab${authMode === "login" ? " active" : ""}`} type="button" onClick={() => setAuthMode("login")}>
                  Login
                </button>
                <button className={`tab${authMode === "signup" ? " active" : ""}`} type="button" onClick={() => setAuthMode("signup")}>
                  Signup
                </button>
              </div>
            )}
            <form className="stack-form auth-form host-auth-modal-form" onSubmit={handleAuthSubmit}>
              {renderGuestAuthFormFields()}
              <PrimaryButton type="submit" style={{ width: "100%", marginTop: "2px" }}>
                {authMode === "login"
                  ? "Login"
                  : authMode === "signup"
                    ? "Create account"
                    : authMode === "forgot"
                      ? "Send reset mail"
                      : "Update password"}
              </PrimaryButton>
              {authMode === "login" && (
                <div className="auth-links">
                  <button type="button" onClick={() => setAuthMode("forgot")}>
                    Forgot password?
                  </button>
                  <button type="button" onClick={resendVerification}>
                    Resend verify email
                  </button>
                </div>
              )}
              {authMode === "signup" && <p className="auth-note">We will email a verification link before login is enabled.</p>}
              {authMode === "forgot" && <p className="auth-note">Enter your account email and we will send a reset link.</p>}
              {authMode === "reset" && <p className="auth-note">Set a fresh password from the secure reset link.</p>}
            </form>
          </div>
        </div>,
        document.body
      )
    : null}
  {gamifyFloatingDock}
  <SiteFooter />
</div>
  );
}
