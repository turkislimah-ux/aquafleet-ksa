import { test, expect, type Page } from "@playwright/test";
const URL = "http://localhost:3002/approvals-verify";

// The coloured box is an ancestor of the text, so find the matching element
// that actually carries a background rather than guessing at nesting depth.
async function boxBg(page: Page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll("div")].filter(
      (n) => n.textContent?.includes("needs a matching second to decide"),
    );
    for (const n of els.reverse()) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
    }
    return "none";
  });
}

test("status cell shows the first user's action, green when approved", async ({ page }) => {
  await page.goto(URL);
  await page.getByTestId("btn-approved").click();
  const cell = page.locator("td", { hasText: "Pending" }).first();
  await expect(cell.getByText("Approved")).toBeVisible();
  await expect(cell.getByText("by b@x.com")).toBeVisible();
  await expect(cell.getByText("Approved")).toHaveCSS("color", "rgb(5, 150, 105)");
  await expect(page.getByText(/^\d+ of 2 votes$/)).toHaveCount(0); // old count gone
});

test("status cell action is red when the first user rejected", async ({ page }) => {
  await page.goto(URL);
  await page.getByTestId("btn-rejected").click();
  const cell = page.locator("td", { hasText: "Pending" }).first();
  await expect(cell.getByText("Rejected")).toHaveCSS("color", "rgb(225, 29, 72)");
});

test("expanded box GREEN when the standing vote is approved", async ({ page }) => {
  await page.goto(URL);
  await page.getByTestId("btn-approved").click();
  await page.getByRole("button", { name: "Expand" }).first().click();
  expect(await boxBg(page)).toBe("rgba(16, 185, 129, 0.1)");
});

test("expanded box RED when the standing vote is rejected", async ({ page }) => {
  await page.goto(URL);
  await page.getByTestId("btn-rejected").click();
  await page.getByRole("button", { name: "Expand" }).first().click();
  expect(await boxBg(page)).toBe("rgba(244, 63, 94, 0.1)");
});

test("conflicting REJECT: message BELOW the reason box, popup stays open, reason kept", async ({ page }) => {
  await page.goto(URL);
  await page.getByTestId("btn-approved").click(); // standing vote = approved
  await page.getByRole("button", { name: /^Reject$/ }).first().click();
  await page.locator("textarea").fill("disagree with this");
  await page.getByRole("button", { name: "Record rejection" }).click();

  const msg = page.getByText(/Conflict — b@x\.com already approved this/);
  await expect(msg).toBeVisible();
  await expect(page.locator("textarea")).toHaveValue("disagree with this");

  const ta = await page.locator("textarea").boundingBox();
  const mb = await msg.boundingBox();
  expect(mb!.y).toBeGreaterThan(ta!.y); // below the reason box
});

test("conflicting APPROVE: message in the ROW, not in a banner above the table", async ({ page }) => {
  await page.goto(URL);
  await page.getByTestId("btn-rejected").click(); // standing vote = rejected
  const table = await page.locator("table").first().boundingBox();
  await page.getByRole("button", { name: /^Approve$/ }).first().click();

  const msg = page.getByText(/Conflict — b@x\.com already rejected this/).first();
  await expect(msg).toBeVisible();
  const mb = await msg.boundingBox();
  expect(mb!.y).toBeGreaterThan(table!.y); // inside the row, below the table top
});

test("a MATCHING vote is not treated as a conflict", async ({ page }) => {
  await page.goto(URL);
  await page.getByTestId("btn-approved").click(); // standing vote = approved
  await page.getByRole("button", { name: /^Approve$/ }).first().click();
  await expect(page.getByText(/Conflict —/)).toHaveCount(0);
});
