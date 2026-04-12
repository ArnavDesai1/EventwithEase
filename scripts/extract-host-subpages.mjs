/**
 * Move Organise + Check-in blocks from home into workspace subpage return.
 * Run: node scripts/extract-host-subpages.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.join(__dirname, "../client/src/App.jsx");
let s = fs.readFileSync(appPath, "utf8");

const organiseStart = "        {user && profileMode === \"organiser\" && (\n          <section id=\"ewe-organise\"";
const organiseEnd =
  "          </section>\n        )}\n        {user && (profileMode === \"organiser\" || profileMode === \"checkin\") && (";

const o0 = s.indexOf(organiseStart);
const o1 = s.indexOf(organiseEnd);
if (o0 === -1 || o1 === -1 || o1 <= o0) {
  console.error("Organise block not found", { o0, o1 });
  process.exit(1);
}
let organiseInner = s.slice(o0, o1);
organiseInner = organiseInner
  .replace(
    "        {user && profileMode === \"organiser\" && (\n          <section id=\"ewe-organise\"",
    "<section id=\"ewe-organise\""
  )
  .replace(/\n        \)\}$/, "");
s = s.slice(0, o0) + s.slice(o1);

const checkinStart = "        {user && (profileMode === \"organiser\" || profileMode === \"checkin\") && (\n          <>";
const checkinClose = "          </>\n        )}\n";
const c0 = s.indexOf(checkinStart);
const c1 = c0 === -1 ? -1 : s.indexOf(checkinClose, c0);
if (c0 === -1 || c1 === -1) {
  console.error("Check-in fragment not found", { c0, c1 });
  process.exit(1);
}
const cEnd = c1 + checkinClose.length;
let checkinInner = s.slice(c0, cEnd);
checkinInner = checkinInner
  .replace(
    "        {user && (profileMode === \"organiser\" || profileMode === \"checkin\") && (\n          <>",
    "<>"
  )
  .replace(/\n        \)\}\n$/, "");
s = s.slice(0, c0) + s.slice(cEnd);

const subpageCond = "if (eventIdInPath || ticketsPath || wishlistPath) {";
const subpageCondNew = "if (eventIdInPath || ticketsPath || wishlistPath || organisePath || checkinPath) {";
if (!s.includes(subpageCond)) {
  console.error("Subpage condition not found");
  process.exit(1);
}
s = s.replace(subpageCond, subpageCondNew);

const insertBefore = "            </main>\n          </div>\n        </div>\n        <SiteFooter />\n      </div>\n    );\n  }\n\n  return (";
const idx = s.indexOf(insertBefore);
if (idx === -1) {
  console.error("Insert anchor not found");
  process.exit(1);
}

const organiseBlock = `
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
                    __ORG__
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
                  ) : !isOrganiser ? (
                    <div className="panel span-two full-width">
                      <p className="auth-note">
                        Check-in tools are for event hosts. Door staff: ask your host to invite your account — then open this page to select
                        your gate under Door staff assignments.
                      </p>
                    </div>
                  ) : (
                    __CHK__
                  )}
                </>
              ) : null}
`;

const piece = organiseBlock.replace("__ORG__", organiseInner.trim()).replace("__CHK__", checkinInner.trim());

s = s.slice(0, idx) + piece + "\n" + s.slice(idx);

fs.writeFileSync(appPath, s);
console.log("extract-host-subpages: OK");
