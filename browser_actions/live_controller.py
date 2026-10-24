#!/usr/bin/env python3
"""Bushin private GitHub Actions command bridge for the live Chromium window.

Only commands from this private repository, scoped to the active Actions run.
Never accepts Discord passwords, login codes, Discord API tokens or chat posting.
Do not store screenshots/cookies in GitHub.
"""
import asyncio
import base64
import datetime
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid
from urllib.parse import urlsplit

REPO = "hp0592553-cyber/naruto-rpg-ia"
COMMAND_FILE = "browser_actions/live_command.json"
RESULT_FILE = "browser_actions/live_result.json"
GUILD_ID = "1515877468299595919"

def validate_url(url):
    if not isinstance(url, str) or len(url) > 1200:
        raise ValueError("Invalid HTTPS URL")
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in ("discord.com", "www.discord.com"):
        raise ValueError("Navigation restricted to discord.com")
    if parsed.username or parsed.password or parsed.fragment:
        raise ValueError("URL credentials and fragments not allowed")
    path = parsed.path
    if path not in ("/login", "/app", "/channels/@me") and not (
        path == "/channels/" + GUILD_ID or path.startswith("/channels/" + GUILD_ID + "/")
    ):
        raise ValueError("Navigation restricted to Discord login and the Naruto Project RP server")
    if parsed.query and path != "/login":
        raise ValueError("Unexpected query string")
    if len(parsed.query) > 160:
        raise ValueError("Query string too long")
    return url

def validate_gallery_urls(urls):
    """Permit only 2-4 distinct text channels of the user's Naruto RP guild."""
    if not isinstance(urls, list) or not 2 <= len(urls) <= 4:
        raise ValueError("Gallery requires 2-4 authorized Naruto RP channel URLs")
    normalized = []
    for url in urls:
        validate_url(url)
        path = urlsplit(url).path
        if not re.fullmatch(r"/channels/" + re.escape(GUILD_ID) + r"/[0-9]{15,22}", path):
            raise ValueError("Gallery accepts only channels within Naruto Project RP")
        if url in normalized:
            raise ValueError("Duplicate gallery channel")
        normalized.append(url)
    return normalized

def validate_scout_urls(urls):
    """Scan one to four distinct channel IDs inside the authorized RP server."""
    if not isinstance(urls, list) or not 1 <= len(urls) <= 4:
        raise ValueError("RPG scout requires 1-4 authorized Naruto RP channels")
    checked = []
    for url in urls:
        validate_url(url)
        if not re.fullmatch(r"/channels/" + re.escape(GUILD_ID) + r"/[0-9]{15,22}", urlsplit(url).path):
            raise ValueError("RPG scout accepts only Naruto Project RP text channels")
        if url in checked:
            raise ValueError("Duplicate RPG scout channel")
        checked.append(url)
    return checked

def validate_command(command, run_id):
    if not isinstance(command, dict):
        raise ValueError("Command must be a JSON object")
    if str(command.get("session_id", "")) != str(run_id):
        raise ValueError("Command must target the active GitHub Actions run")
    ident = command.get("id")
    if not isinstance(ident, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", ident):
        raise ValueError("Invalid command id")
    action = command.get("action")
    if action not in ("tabs", "status", "open_url", "read_page_text", "scroll", "click_navigation", "screenshot", "click", "press", "inspect_ui", "type_search", "capture_gallery", "rpg_scout", "rpg_view", "rpg_slash"):
        raise ValueError("Unsupported action: use status, RPG scout/view, gallery, and authorized navigation/reading")
    if action == "open_url":
        validate_url(command.get("url"))
    if action == "rpg_slash":
        validate_url(command.get("url"))
        if command.get("command") not in (
            "/perfil ver", "/missoes minhas", "/missoes ativas",
        ):
            raise ValueError("Only safe character and quest status slash commands are permitted")
    if action == "capture_gallery":
        validate_gallery_urls(command.get("urls"))
    if action == "rpg_scout":
        validate_scout_urls(command.get("urls"))
    if action == "scroll":
        if command.get("direction", "down") not in ("up", "down"):
            raise ValueError("Invalid scroll direction")
        amount = command.get("amount", 3)
        if type(amount) is not int or not 1 <= amount <= 8:
            raise ValueError("Scroll amount must be 1..8")
    if action == "click_navigation":
        url = command.get("url")
        validate_url(url)
        if "/channels/" + GUILD_ID not in url:
            raise ValueError("Navigation clicks limited to RP server channels")
    if action == "click":
        for axis, limit in (("x", 1365), ("y", 768)):
            pos = command.get(axis)
            if type(pos) is not int or pos < 0 or pos >= limit:
                raise ValueError("Click coordinates must be integers within the browser viewport")
    if action == "press":
        if command.get("key") not in (
            "Escape", "Tab", "Shift+Tab", "ArrowUp", "ArrowDown",
            "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"
        ):
            raise ValueError("Only non-submitting navigation keys are permitted")
    if action == "type_search":
        value = command.get("text")
        if not isinstance(value, str) or not 0 < len(value) <= 100 or any(c in value for c in ("\n", "\r")):
            raise ValueError("Search text must be 1-100 characters with no newline")
    return action

def assert_rp_channel(url):
    parsed = urlsplit(url)
    if parsed.hostname not in ("discord.com", "www.discord.com") or not parsed.path.startswith("/channels/" + GUILD_ID + "/"):
        raise ValueError("Mouse and keyboard control only allowed inside Naruto Project RP")


def assert_control_page(url):
    """Browser controls are permitted on RP channels and public Google search."""
    parsed = urlsplit(url)
    if parsed.hostname in ("discord.com", "www.discord.com"):
        return assert_rp_channel(url)
    if (parsed.scheme == "https" and parsed.hostname in ("google.com", "www.google.com")
            and parsed.path in ("/", "/search") and not parsed.username and not parsed.password):
        return
    raise ValueError("Controls restricted to Naruto RP and public Google search pages")

async def assert_no_credential_form(page):
    if await page.locator('input[type="password"]').count():
        raise ValueError("Controls disabled while a credential form is present")

def gh_get(path):
    proc = subprocess.run(
        ["gh", "api", "repos/" + REPO + "/contents/" + path],
        capture_output=True, text=True, timeout=24)
    if proc.returncode:
        raise RuntimeError("GitHub read failed (check actions contents permissions)")
    data = json.loads(proc.stdout)
    return json.loads(base64.b64decode(data["content"]).decode("utf-8")), data["sha"]

def gh_put(path, payload):
    raw = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    encoded = base64.b64encode(raw).decode("ascii")
    for attempt in range(3):
        _, sha = gh_get(path)
        params = {
            "message": "Bushin live command result " + str(payload.get("id", "unknown"))[:50],
            "branch": "main", "sha": sha, "content": encoded
        }
        proc = subprocess.run(
            ["gh", "api", "--method", "PUT", "repos/" + REPO + "/contents/" + path, "--input", "-"],
            input=json.dumps(params), text=True, capture_output=True, timeout=35)
        if proc.returncode == 0:
            return
        time.sleep(2)
    raise RuntimeError("Could not publish result to private GitHub repository")

async def get_page(browser):
    # Prefer the authorized Naruto RP tab, not the originally launched login tab.
    pages = [p for context in browser.contexts for p in context.pages]
    if not pages:
        raise RuntimeError("No open browser page")
    guild_path = "/channels/" + GUILD_ID
    for page in reversed(pages):
        parsed = urlsplit(page.url)
        if parsed.hostname in ("discord.com", "www.discord.com") and (
                parsed.path == guild_path or parsed.path.startswith(guild_path + "/")):
            return page
    # If the user navigated to other Discord tabs, display only a sanitized URL.
    for page in reversed(pages):
        parsed = urlsplit(page.url)
        if parsed.hostname in ("discord.com", "www.discord.com") and parsed.path != "/login":
            return page
    return pages[-1]

def redacted_page_url(url):
    parsed = urlsplit(url)
    if parsed.hostname not in ("discord.com", "www.discord.com"):
        return "outside discord.com"
    if parsed.path.startswith("/channels/@me"):
        return "https://discord.com/channels/@me/[private]"
    return parsed.scheme + "://" + parsed.hostname + parsed.path[:250]

async def publish_private_screenshot(page, run_id):
    """Capture only the approved Naruto RP page; publish no image into commits."""
    assert_control_page(page.url)
    # Never include account login / password overlays in a screenshot.
    password_boxes = await page.locator('input[type="password"]').count()
    if password_boxes:
        raise ValueError("Capture denied: a password field is visible")
    out_dir = Path("/tmp/bushin-snapshots")
    out_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(out_dir, 0o700)
    image_file = out_dir / ("capture-" + uuid.uuid4().hex + ".jpg")
    name = "bushin-snapshot-" + str(run_id) + "-" + uuid.uuid4().hex[:14]
    try:
        await page.screenshot(path=str(image_file), type="jpeg", quality=68, full_page=False, timeout=12000)
        proc = await asyncio.to_thread(
            subprocess.run,
            ["node", "browser_actions/snapshot_upload.cjs", str(image_file), name],
            capture_output=True, text=True, timeout=75)
        if proc.returncode:
            raise RuntimeError("Screenshot artifact upload failed; image was not committed")
        response = json.loads(proc.stdout.strip().splitlines()[-1])
        if not response.get("artifact_id"):
            raise RuntimeError("Screenshot uploader returned no artifact ID")
        return {
            "artifact_id": response["artifact_id"],
            "artifact_name": name,
            "retention_days": 1,
            "visible_page": redacted_page_url(page.url),
            "note": "Private Actions artifact only; request its download to show the JPEG in ChatGPT."
        }
    finally:
        image_file.unlink(missing_ok=True)

async def visible_ui_controls(page):
    """Expose coordinates of visible navigation affordances without exposing DOM/DMs."""
    assert_control_page(page.url)
    await assert_no_credential_form(page)
    return await page.evaluate("""() => {
      const selector = 'a,button,[role="link"],[role="button"]';
      return [...document.querySelectorAll(selector)]
        .map(el => {
          const r = el.getBoundingClientRect();
          const name = (el.getAttribute('aria-label') || el.getAttribute('title') ||
                        el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 64);
          return {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2),
                  label: name, kind: el.tagName.toLowerCase()};
        })
        .filter(it => it.x > 0 && it.x < innerWidth && it.y > 0 && it.y < innerHeight &&
                      it.label.length > 0)
        .slice(0, 35);
    }""")

async def safe_point_click(page, x, y):
    assert_control_page(page.url)
    await assert_no_credential_form(page)
    info = await page.evaluate("""([x,y]) => {
      const el = document.elementFromPoint(x,y);
      if (!el) return {allowed:false};
      const isInput = !!el.closest('input,textarea,select,[contenteditable="true"],[role="textbox"],form');
      const label = (el.closest('button,[role="button"]')?.getAttribute('aria-label') ||
                     el.closest('button,[role="button"]')?.getAttribute('title') ||
                     '').toLowerCase();
      const unsafe = /send|enviar|reply|responder|delete|excluir|invite|convidar|kick|ban|report|denunciar|attach|anexar|upload|comprar|purchase|gift/.test(label);
      return {allowed:!isInput && !unsafe, name:label.slice(0,50)};
    }""", [x,y])
    if not info.get("allowed"):
        raise ValueError("Clicked area is a form, message action, or sensitive control")
    await page.mouse.click(x, y, button="left", delay=60)
    await page.wait_for_timeout(350)
    return {"clicked": [x,y], "url": redacted_page_url(page.url)}

async def safe_type_search(page, value):
    assert_control_page(page.url)
    await assert_no_credential_form(page)
    search = page.locator(
        'textarea[name="q"], input[name="q"], input[type="search"], input[aria-label*="Search"], input[aria-label*="Buscar"], '
        'input[placeholder*="Search"], input[placeholder*="Buscar"], '
        '[role="searchbox"], [contenteditable="true"][aria-label*="Buscar"], '
        '[contenteditable="true"][aria-label*="Search"]')
    if await search.count() == 0:
        raise ValueError("No safe Discord search input found; chat composer is prohibited")
    box = search.first
    if not await box.is_visible():
        raise ValueError("Search input not visible")
    await box.fill(value, timeout=6500)
    return {"search_filled": True, "characters": len(value), "url": redacted_page_url(page.url)}


async def extract_rpg_view(page):
    """Read only rendered posts/messages inside the current authorized guild channel."""
    assert_rp_channel(page.url)
    if await page.locator('input[type="password"]').count():
        raise ValueError("RPG view denied while login/password form is present")
    # Restrict extraction to Discord channel messages and forum topics, avoiding
    # the sidebar (which can expose other guild names, DMs, and notifications).
    data = await page.evaluate(r"""() => {
      const clean = (value, max=400) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
      const seen = new Set();
      const rows = [...document.querySelectorAll('li[id^="chat-messages-"]')];
      const messages = rows.slice(-30).map(row => {
        const username = row.querySelector('[id^="message-username-"], h3 [class*="username"], h3');
        const contentNodes = [...row.querySelectorAll('[id^="message-content-"]')];
        const body = contentNodes.length
            ? contentNodes.map(el => clean(el.innerText, 420)).filter(Boolean).join(' ')
            : '';
        const timestamp = row.querySelector('time')?.getAttribute('datetime') || '';
        return {author: clean(username?.innerText, 90), text: clean(body, 420),
                timestamp: clean(timestamp, 45)};
      }).filter(row => row.text).slice(-10);
      const forumRoots = [...document.querySelectorAll(
        'main [role="link"], main a[href*="/channels/"], [class*="forum"] [role="link"]')];
      const topics = [];
      if (messages.length === 0) for (const node of forumRoots) {
        const title = clean(node.getAttribute('aria-label') || node.innerText, 150);
        if (title && !seen.has(title)) { seen.add(title); topics.push(title); }
        if (topics.length >= 12) break;
      }
      const main = document.querySelector('main, [role="main"]');
      const label = clean(main?.getAttribute('aria-label') || document.title, 160);
      return {label, messages, topics, rendered_only: true};
    }""")
    return {"url": redacted_page_url(page.url), **data}

async def scout_rpg_channels(page, urls):
    """Read a few requested channels and restore the user's original view."""
    assert_rp_channel(page.url)
    checked = validate_scout_urls(urls)
    original = page.url
    readings = []
    try:
        for destination in checked:
            await page.goto(destination, wait_until="domcontentloaded", timeout=22000)
            await page.wait_for_timeout(650)
            if urlsplit(page.url).path != urlsplit(destination).path:
                raise ValueError("Discord did not load the requested RP channel (login or redirect)")
            readings.append(await extract_rpg_view(page))
    finally:
        if (urlsplit(original).hostname in ("discord.com", "www.discord.com")
                and urlsplit(original).path.startswith("/channels/" + GUILD_ID + "/")):
            try:
                await page.goto(original, wait_until="domcontentloaded", timeout=18000)
            except Exception:
                pass
    return {"checked": len(readings), "channels": readings, "restored_to": redacted_page_url(original),
            "note": "Only rendered RP channel message bodies/forum topics; private GitHub result history. No posting."}

def desktop_display_health():
    """Return only non-sensitive X11 diagnostics, never raw desktop pixels."""
    detail = {"display": os.environ.get("DISPLAY", "(unset)")}
    try:
        proc = subprocess.run(
            ["xdotool", "search", "--onlyvisible", "--class", "Chromium"],
            capture_output=True, text=True, timeout=6)
        detail["chromium_visible_windows"] = len(
            [w for w in proc.stdout.splitlines() if w.strip().isdigit()])
    except (OSError, subprocess.TimeoutExpired):
        detail["chromium_visible_windows"] = None
    try:
        proc = subprocess.run(
            ["xdotool", "getactivewindow"],
            capture_output=True, text=True, timeout=6)
        detail["active_window_known"] = proc.returncode == 0 and proc.stdout.strip().isdigit()
    except (OSError, subprocess.TimeoutExpired):
        detail["active_window_known"] = False
    try:
        # Sample Xvfb's real framebuffer, not Chromium DevTools screenshot.
        # Return color statistics only: never transmit account images or credentials.
        from mss import mss
        with mss() as screen:
            grab = screen.grab(screen.monitors[1])
            raw = grab.bgra
            stride = max(1, len(raw) // (4 * 3500))
            colors = set()
            total = nonblack = root_blue = 0
            for index in range(0, len(raw) - 3, 4 * stride):
                b, g, r = raw[index], raw[index + 1], raw[index + 2]
                total += 1
                nonblack += max(r, g, b) > 28
                root_blue += 25 <= r <= 45 and 38 <= g <= 65 and 62 <= b <= 95
                colors.add((r // 16, g // 16, b // 16))
            detail["framebuffer"] = {
                "resolution": str(grab.width) + "x" + str(grab.height),
                "nonblack_percent": round(100 * nonblack / max(total, 1), 1),
                "root_background_percent": round(100 * root_blue / max(total, 1), 1),
                "color_groups": len(colors)
            }
    except Exception as exc:
        detail["framebuffer_error"] = type(exc).__name__
    return detail


async def run_readonly_rpg_slash(page, text):
    """Perform a narrowly allowlisted slash interaction in the visible Discord UI.

    Does not call Discord HTTP APIs. Refuses when there is a user's existing draft
    or Discord fails to show matching slash autocomplete suggestions.
    """
    assert_rp_channel(page.url)
    if text not in ("/perfil ver", "/missoes minhas", "/missoes ativas"):
        raise ValueError("RPG command not on readonly allowlist")
    root, subcommand = text[1:].split(" ", 1)
    editors = page.locator(
        'div[role="textbox"][contenteditable="true"], '
        '[data-slate-editor="true"][contenteditable="true"]'
    )
    editor = None
    for index in range(min(await editors.count(), 6)):
        element = editors.nth(index)
        if not await element.is_visible():
            continue
        attrs = await element.evaluate("""el => ({
            label: (el.getAttribute('aria-label') || '').toLowerCase(),
            region: !!el.closest('[role="main"], main, form')
        })""")
        if attrs.get("region") or "mensagem" in attrs.get("label") or "message" in attrs.get("label"):
            editor = element
            break
    if editor is None:
        return {"executed": False, "stage": "composer_missing",
                "note": "Discord chat input was not visibly found"}
    existing = (await editor.inner_text()).strip()
    if existing:
        return {"executed": False, "stage": "existing_draft",
                "note": "Refused to overwrite an existing user's draft"}

    async def menu_text():
        return await page.evaluate("""() => {
            const nodes = [...document.querySelectorAll('[class*="autocomplete"], [role="listbox"]')];
            return nodes.filter(el => {
                const r = el.getBoundingClientRect();
                return r.width>80 && r.height>15 && r.bottom>0;
            }).map(el => (el.innerText || '').slice(0,1000)).join(' ').slice(0,1500);
        }""")

    await editor.click()
    await page.keyboard.type("/" + root, delay=55)
    await page.wait_for_timeout(1100)
    menu_root = await menu_text()
    if root.lower() not in menu_root.lower():
        return {"executed": False, "stage": "root_autocomplete_missing",
                "note": "Did not find verified command in Discord slash suggestions",
                "autocomplete_preview": menu_root[:380]}
    await page.keyboard.press("Tab")
    await page.wait_for_timeout(400)
    await page.keyboard.type(subcommand, delay=65)
    await page.wait_for_timeout(850)
    menu_sub = await menu_text()
    if subcommand.lower() not in menu_sub.lower():
        return {"executed": False, "stage": "subcommand_autocomplete_missing",
                "autocomplete_preview": menu_sub[:380],
                "note": "Refused to submit an unverified subcommand"}
    await page.keyboard.press("Tab")
    await page.wait_for_timeout(350)
    state_before = await extract_rpg_view(page)
    # Submit exactly once through the user's Discord client UI. This is a
    # status-only slash action and can never end combat or spend inventory.
    await page.keyboard.press("Enter")
    await page.wait_for_timeout(2500)
    state_after = await extract_rpg_view(page)
    before_texts = [x.get("text","") for x in state_before.get("messages",[])]
    recent = state_after.get("messages", [])
    change = [x for x in recent if x.get("text","") not in before_texts]
    composer_after = (await editor.inner_text()).strip()[:120]
    return {
        "executed": bool(change) and not composer_after,
        "submitted_once": True,
        "command": text,
        "new_visible_messages": change[-4:],
        "composer_remaining": composer_after,
        "note": "Submitted once in Chromium; verify RPG bot response. An empty message diff does not prove slash execution."
    }


async def perform(action, command):
    from playwright.async_api import async_playwright
    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp("http://127.0.0.1:9222", timeout=9000)
        try:
            page = await get_page(browser)
            current_url = redacted_page_url(page.url)
            if action == "tabs":
                pages = [p for ctx in browser.contexts for p in ctx.pages]
                if command.get("path") == "new":
                    page = await browser.contexts[0].new_page()
                    await page.goto("https://www.google.com/search?q=Naruto+Project+RPG", wait_until="domcontentloaded", timeout=22000)
                    await page.bring_to_front()
                    return {"opened":True,"url":page.url,"title":await page.title()}
                index = command.get("tab_index")
                if index is not None:
                    if type(index) is not int or not 0 <= index < len(pages):
                        raise ValueError("Invalid tab index")
                    await pages[index].bring_to_front()
                return {"tabs":[{"index":i,"url":redacted_page_url(p.url)} for i,p in enumerate(pages)]}
            if action == "rpg_view":
                return await extract_rpg_view(page)
            if action == "rpg_slash":
                url = validate_url(command["url"])
                if page.url != url:
                    await page.goto(url, wait_until="domcontentloaded", timeout=22000)
                    await page.wait_for_timeout(1000)
                return await run_readonly_rpg_slash(page, command["command"])
            if action == "rpg_scout":
                return await scout_rpg_channels(page, command["urls"])
            if action == "inspect_ui":
                return {"controls": await visible_ui_controls(page), "url": redacted_page_url(page.url)}
            if action == "click":
                return await safe_point_click(page, command["x"], command["y"])
            if action == "press":
                assert_control_page(page.url)
                await assert_no_credential_form(page)
                if await page.locator(':focus').count():
                    focused = await page.evaluate("""() => {
                      const el = document.activeElement;
                      return !!el?.closest('input, textarea, [contenteditable="true"], [role="textbox"]');
                    }""")
                    if focused:
                        raise ValueError("Focus is in a text field; navigation key disabled to avoid editing chat")
                await page.keyboard.press(command["key"])
                return {"key": command["key"], "url": redacted_page_url(page.url)}
            if action == "type_search":
                return await safe_type_search(page, command["text"])
            if action == "screenshot":
                return await publish_private_screenshot(page, command["session_id"])
            if action == "capture_gallery":
                # Explicit, prevalidated channels only; credentials and DMs remain blocked.
                gallery_urls = validate_gallery_urls(command["urls"])
                original_url = page.url
                captured = []
                try:
                    for destination in gallery_urls:
                        await page.goto(destination, wait_until="domcontentloaded", timeout=22000)
                        await page.wait_for_timeout(550)
                        captured.append(await publish_private_screenshot(page, command["session_id"]))
                finally:
                    # Preserve the user's channel after the screenshots, even on errors.
                    parsed_original = urlsplit(original_url)
                    if (parsed_original.hostname in ("discord.com", "www.discord.com")
                            and parsed_original.path.startswith("/channels/" + GUILD_ID + "/")):
                        try:
                            await page.goto(original_url, wait_until="domcontentloaded", timeout=18000)
                        except Exception:
                            pass
                return {"captures": captured, "count": len(captured),
                        "note": "Private one-day GitHub artifacts; images must be downloaded and verified before display."}
            if action == "status":
                public_url_file = Path("/tmp/bushin-public-origin")
                public_url = public_url_file.read_text(encoding="utf-8").strip() if public_url_file.is_file() else ""
                if not re.fullmatch(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com/vnc\.html\?autoconnect=1&resize=scale", public_url):
                    public_url = ""
                return {"online": True, "url": current_url, "title": (await page.title())[:180], "public_entry_url": public_url, "x11": await asyncio.to_thread(desktop_display_health)}
            if action == "open_url":
                address = validate_url(command["url"])
                await page.goto(address, wait_until="domcontentloaded", timeout=22000)
                return {"url": redacted_page_url(page.url), "title": (await page.title())[:180]}
            if action == "scroll":
                pixels = int(command.get("amount", 3)) * 170
                if command.get("direction", "down") == "up":
                    pixels = -pixels
                await page.mouse.wheel(0, pixels)
                await page.wait_for_timeout(400)
                return {"scroll_pixels": pixels, "url": redacted_page_url(page.url)}
            if action == "read_page_text":
                url = page.url
                allowed = urlsplit(url).hostname in ("discord.com", "www.discord.com") and (
                    urlsplit(url).path.startswith("/channels/" + GUILD_ID + "/")
                )
                if not allowed:
                    raise ValueError("Reading only allowed inside the requested Naruto Project RP server")
                value = (await page.locator("body").inner_text(timeout=9000))[-3500:]
                return {"url": redacted_page_url(page.url), "text": value, "note":
                        "Only text presently rendered on page; results are written in private repository history."}
            if action == "click_navigation":
                address = validate_url(command["url"])
                # A URL-based navigation is safer than arbitrary mouse clicks on private accounts.
                await page.goto(address, wait_until="domcontentloaded", timeout=22000)
                return {"url": redacted_page_url(page.url), "title": (await page.title())[:180]}
            raise ValueError("Unsupported action")
        finally:
            # Disconnecting the CDP client must not shut down the user's Chromium window.
            pass

async def listen_commands():
    run_id = os.environ.get("GITHUB_RUN_ID")
    if not run_id or not os.environ.get("GH_TOKEN"):
        print("Bushin control disabled: Actions run or scoped token missing", flush=True)
        return
    try:
        previous, _ = await asyncio.to_thread(gh_get, RESULT_FILE)
        last_id = previous.get("id") if isinstance(previous, dict) else None
    except Exception:
        last_id = None
    screenshot_count = 0
    print("🍥 Bushin control ready: commands through private GitHub repository, run " + run_id, flush=True)
    while True:
        try:
            command, _ = await asyncio.to_thread(gh_get, COMMAND_FILE)
            current_id = command.get("id") if isinstance(command, dict) else None
            if (current_id and current_id != last_id
                    and str(command.get("session_id", "")) == str(run_id)):
                try:
                    action = validate_command(command, run_id)
                    requested = (len(command["urls"]) if action == "capture_gallery"
                                 else 1 if action == "screenshot" else 0)
                    if screenshot_count + requested > 12:
                        raise ValueError("Screenshot limit reached (12 per Linux session)")
                    screenshot_count += requested
                    value = await perform(action, command)
                    result = {"id": current_id, "session_id": run_id,
                              "action": action, "ok": True, "data": value}
                except Exception as exc:
                    result = {"id": current_id, "session_id": run_id,
                              "action": str(command.get("action", ""))[:30],
                              "ok": False, "error": str(exc)[:300]}
                result["finished_at_utc"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                await asyncio.to_thread(gh_put, RESULT_FILE, result)
                last_id = current_id
                print("🍥 Bushin command processed:", current_id, "ok", result["ok"], flush=True)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print("🍥 Bushin control transport temporarily unavailable:", type(exc).__name__, flush=True)
        await asyncio.sleep(8)

