import re
from playwright.sync_api import Playwright, sync_playwright, expect


def run(playwright: Playwright) -> None:
    browser = playwright.chromium.launch(headless=False)
    context = browser.new_context()
    page = context.new_page()
    page.goto("https://www.promedmail.org/")
    page.get_by_role("navigation").get_by_role("link", name="Login").click()
    page.get_by_role("textbox", name="Email address").click()
    page.get_by_role("textbox", name="Email address").fill("promedjs1A@gm.com")
    page.get_by_text("Password *").click()
    page.get_by_text("Password *").click()
    page.get_by_role("textbox", name="Password").fill("promedjs1A@gm.com")
    page.get_by_role("button", name="Continue").click()
    page.get_by_role("cell", name="MENINGITIS - SOUTH AFRICA: (").locator("div").click()

    # ---------------------
    context.close()
    browser.close()


with sync_playwright() as playwright:
    run(playwright)

