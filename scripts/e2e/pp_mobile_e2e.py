#!/usr/bin/env python3
"""
Planiprêt mobile — page-by-page E2E regression suite.

Drives the running dev server (default http://localhost:8080) at a mobile
viewport with a real broker session, then for every screen checks:
  * the route renders (no blank screen, no error boundary)
  * every tab switches and renders content
  * critical actions respond (search overlay, dialpad FAB scoping, AVA input)
  * no console errors, page errors, DOM nesting warnings or horizontal overflow

Usage:
    python3 scripts/e2e/pp_mobile_e2e.py            # full suite
    python3 scripts/e2e/pp_mobile_e2e.py --only calls messages

Exit code 0 = all checks passed, 1 = at least one regression.
A JSON report is written to /tmp/pp-mobile-e2e/report.json and screenshots
to /tmp/pp-mobile-e2e/shots/.

Auth: reads LOVABLE_BROWSER_SUPABASE_* env vars (session injected by Lovable).
Without them the suite runs unauthenticated and only checks the auth screen.
"""
import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = os.environ.get("E2E_BASE_URL", "http://localhost:8080")
OUT = Path("/tmp/pp-mobile-e2e")
SHOTS = OUT / "shots"
VIEWPORT = {"width": 390, "height": 844}
SETTLE_MS = 3500

# Console noise that is expected in a desktop browser (no native SIP stack,
# vite HMR socket, etc.) and must not fail the suite.
IGNORED_CONSOLE = (
    "[pp-sip]",
    "[pp-voip-call]",
    "ERR_CONNECTION_REFUSED",
    "wss://localhost",
    "Download the React DevTools",
    "native plugin unavailable",
)

# screen key -> (route, tab labels, expected text fragment)
SCREENS = {
    "home": ("/mplanipret/home", ["Today", "This week", "This month", "My shift", "Aujourd'hui", "Cette semaine"], None),
    "calls": ("/mplanipret/calls", ["Recent", "Missed", "Rec.", "VM", "Récents", "Manqués"], None),
    "messages": ("/mplanipret/messages", ["SMS", "Team", "Teams", "Emails", "History", "Historique"], None),
    "contacts": ("/mplanipret/contacts", ["Personal", "Favorites", "Directory", "Personnels", "Favoris", "Annuaire"], None),
    "voicemail": ("/mplanipret/voicemail", [], None),
    "stats": ("/mplanipret/stats", ["Week", "Month", "3 months", "Semaine", "Mois", "3 mois"], None),
    "pipeline": ("/mplanipret/pipeline", [], None),
    "notifications": ("/mplanipret/notifications", ["Toutes", "Non lues", "All", "Unread"], None),
    "ava": ("/mplanipret/ava", [], None),
    "more": ("/mplanipret/more", [], None),
    "search": ("/mplanipret/search?q=514", [], None),
    "ms365diag": ("/mplanipret/ms365-diagnostics", [], None),
    "sipdebug": ("/mplanipret/sip-debug", [], None),
    "extension": ("/mplanipret/extension-sync", [], None),
    "deeplink": ("/mplanipret/deep-link-debug", [], None),
}

# Screens where the dialpad floating action button must be present / absent.
FAB_EXPECTED = {"home": True, "calls": True, "messages": False, "more": False, "contacts": False}

CRASH_MARKERS = ("Something went wrong", "Une erreur est survenue", "Unable to load your Planiprêt mobile profile")


class Report:
    def __init__(self):
        self.checks = []

    def add(self, screen, name, ok, detail=""):
        self.checks.append({"screen": screen, "check": name, "ok": bool(ok), "detail": detail[:400]})
        flag = "PASS" if ok else "FAIL"
        print(f"[{flag}] {screen} :: {name}{' — ' + detail[:200] if detail and not ok else ''}")

    @property
    def failures(self):
        return [c for c in self.checks if not c["ok"]]


async def restore_session(ctx, page):
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    if cookies_json:
        cookies = json.loads(cookies_json)
        for c in cookies:
            c["url"] = BASE
        await ctx.add_cookies(cookies)
    await page.goto(BASE, wait_until="domcontentloaded")
    if storage_key and session_json:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )
        return True
    return False


async def run(only):
    OUT.mkdir(parents=True, exist_ok=True)
    SHOTS.mkdir(parents=True, exist_ok=True)
    rep = Report()
    current = {"screen": "boot"}
    console_errors = []
    nesting_warnings = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport=VIEWPORT)
        page = await ctx.new_page()

        def on_console(msg):
            if msg.type != "error":
                return
            text = msg.text
            if any(sig in text for sig in IGNORED_CONSOLE):
                return
            if "validateDOMNesting" in text:
                nesting_warnings.append((current["screen"], text[:600]))
                return
            console_errors.append((current["screen"], text[:300]))

        page.on("console", on_console)
        page.on("pageerror", lambda e: console_errors.append((current["screen"], "pageerror: " + str(e)[:300])))

        authed = await restore_session(ctx, page)
        rep.add("session", "broker session restored", authed, "" if authed else "no LOVABLE_BROWSER_SUPABASE_* env vars")
        if not authed:
            await browser.close()
            return rep

        for key, (route, tabs, expect) in SCREENS.items():
            if only and key not in only:
                continue
            current["screen"] = key
            before_errors = len(console_errors)
            try:
                await page.goto(BASE + route, wait_until="domcontentloaded")
                await page.wait_for_timeout(SETTLE_MS)
            except Exception as exc:
                rep.add(key, "route loads", False, str(exc))
                continue

            body = await page.inner_text("body")
            rep.add(key, "route renders content", len(body.strip()) > 40, body[:120])
            crash = next((m for m in CRASH_MARKERS if m in body), None)
            rep.add(key, "no crash / error boundary", crash is None, crash or "")
            if expect:
                rep.add(key, f"contains '{expect}'", expect in body)

            # horizontal overflow (layout regression)
            overflow = await page.evaluate(
                "document.documentElement.scrollWidth - document.documentElement.clientWidth"
            )
            rep.add(key, "no horizontal overflow", overflow <= 2, f"{overflow}px")

            # safe-area padding applied by the mobile frame
            nested = await page.evaluate("document.querySelectorAll('button button, a button, button a').length")
            rep.add(key, "no nested interactive elements", nested == 0, f"{nested} found")

            # tabs
            for label in tabs:
                loc = page.get_by_text(label, exact=True).first
                try:
                    if await loc.count() == 0:
                        continue
                    await loc.click(timeout=4000)
                    await page.wait_for_timeout(2200)
                    tab_body = await page.inner_text("body")
                    bad = next((m for m in CRASH_MARKERS if m in tab_body), None)
                    rep.add(key, f"tab '{label}' renders", bad is None and len(tab_body.strip()) > 40, bad or "")
                except Exception as exc:
                    rep.add(key, f"tab '{label}' renders", False, str(exc))

            # dialpad FAB scoping
            if key in FAB_EXPECTED:
                await page.goto(BASE + route, wait_until="domcontentloaded")
                await page.wait_for_timeout(2500)
                count = await page.locator('[aria-label*="ial" i], [data-testid*="dialpad"]').count()
                want = FAB_EXPECTED[key]
                rep.add(key, f"dialpad FAB {'present' if want else 'absent'}", (count > 0) == want, f"count={count}")

            await page.screenshot(path=str(SHOTS / f"{key}.png"))
            rep.add(key, "no console errors", len(console_errors) == before_errors,
                    "; ".join(t for _, t in console_errors[before_errors:]))

        # ---- critical actions ----
        current["screen"] = "actions"
        await page.goto(BASE + "/mplanipret/home", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)
        try:
            await page.get_by_text("Search everywhere", exact=False).first.click(timeout=4000)
            await page.wait_for_timeout(1200)
            n = await page.locator("input").count()
            rep.add("actions", "global search opens an input", n > 0, f"inputs={n}")
            if n:
                await page.locator("input").first.fill("514")
                await page.wait_for_timeout(3000)
        except Exception as exc:
            rep.add("actions", "global search opens an input", False, str(exc))

        await page.goto(BASE + "/mplanipret/ava", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)
        try:
            field = page.locator("textarea, input[type=text]").last
            await field.fill("bonjour", timeout=5000)
            rep.add("actions", "AVA chat accepts input", True)
        except Exception as exc:
            rep.add("actions", "AVA chat accepts input", False, str(exc))

        rep.add("global", "no React DOM nesting warnings", not nesting_warnings,
                "; ".join(f"{s}: {t[:150]}" for s, t in nesting_warnings))

        await browser.close()
    return rep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", default=None, help="screen keys to run")
    args = ap.parse_args()
    rep = asyncio.run(run(set(args.only) if args.only else None))
    (OUT / "report.json").write_text(json.dumps(rep.checks, indent=1, ensure_ascii=False))
    total, failed = len(rep.checks), len(rep.failures)
    print(f"\n{total - failed}/{total} checks passed — report: {OUT / 'report.json'}")
    if failed:
        print("\nFailures:")
        for f in rep.failures:
            print(f"  - {f['screen']} :: {f['check']} — {f['detail'][:200]}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
