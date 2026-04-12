export default function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer" role="contentinfo">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <span className="site-logo-type">EventwithEase</span>
          <p className="site-footer-tagline">
            Publish events, sell multi-tier tickets, run sandbox payments, and check in guests with QR codes — built for
            hackathon demos and portfolios.
          </p>
        </div>
        <div className="site-footer-col">
          <h3 className="site-footer-heading">Attendees</h3>
          <ul className="site-footer-list">
            <li>Browse and filter events</li>
            <li>Multi-ticket checkout</li>
            <li>Wishlist and recommendations</li>
            <li>Networking opt-in per event</li>
          </ul>
        </div>
        <div className="site-footer-col">
          <h3 className="site-footer-heading">Organisers</h3>
          <ul className="site-footer-list">
            <li>Dashboard with revenue and CSV</li>
            <li>Discount codes and early bird</li>
            <li>Refund approvals</li>
            <li>Post-event feedback</li>
          </ul>
        </div>
        <div className="site-footer-col">
          <h3 className="site-footer-heading">Stack</h3>
          <ul className="site-footer-list">
            <li>React · Vite</li>
            <li>Express · MongoDB</li>
            <li>Stripe / Razorpay test modes</li>
          </ul>
        </div>
      </div>
      <div className="site-footer-bar">
        <span>© {year} EventwithEase</span>
        <span className="site-footer-note">Configure API URL and payment keys for production.</span>
      </div>
    </footer>
  );
}
