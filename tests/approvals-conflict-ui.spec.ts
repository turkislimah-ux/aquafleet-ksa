import { test, expect, type Page } from "@playwright/test";
const URL = "http://localhost:3002/approvals-verify";

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

test("status cell: ACTION only, green on approved, no voter email, no count", async ({ page }) => {
  await page.goto(URL);
  await page.getByTestId("btn-approved").click();
  const cell = page.locator("td", { hasText: "Pending" }).first();
  await expect(cell.getByText("Approved")).toHaveCSS("color", "rgb(5, 150, 105)");
  await expect(cell).not.toContainText("b@x.com");   // email dropped
  await expect(cell).not.toContainText("of 2");      // count dropped
});

test("status cell: red on rejected, still no email", async ({ page }) => {
  await page.goto(URL);
  await page.getByTestId("btn-rejected").click();
  const cell = page.locator("td", { hasText: "Pending" }).first();
  await expect(cell.getByText("Rejected")).toHaveCSS("color", "rgb(225, 29, 72)");
  await expect(cell).not.toContainText("b@x.com");
});

test("expanded box GREEN when standing vote approved", async ({ page }) => {
  await page.goto(URL);
  await page.getByTestId("btn-approved").click();
  await page.getByRole("button", { name: "Expand" }).first().click();
  expect(await boxBg(page)).toBe("rgba(16, 185, 129, 0.1)");
});

test("expanded box RED when standing vote rejected", async ({ page }) => {
  await page.goto(URL);
  await page.getByTestId("btn-rejected").click();
  await page.getByRole("button", { name: "Expand" }).first().click();
  expect(await boxBg(page)).toBe("rgba(244, 63, 94, 0.1)");
});

test("conflicting APPROVE opens a POPUP, nothing inline in the row", async ({ page }) => {
  await page.goto(URL);
  await page.getByTestId("btn-rejected").click();
  const rowH = (await page.locator("tbody tr").first().boundingBox())!.height;

  await page.getByRole("button", { name: /^Approve$/ }).first().click();
  await expect(page.getByText("Vote not recorded")).toBeVisible();
  await expect(page.getByText(/Conflict — b@x\.com already rejected this/)).toBeVisible();

  // the row did not grow to carry the message
  const rowH2 = (await page.locator("tbody tr").first().boundingBox())!.height;
  expect(rowH2).toBe(rowH);

  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByText("Vote not recorded")).toHaveCount(0);
});

test("conflicting REJECT still shows BELOW the reason box, popup stays open", async ({ page }) => {
  await page.goto(URL);
  await page.getByTestId("btn-approved").click();
  await page.getByRole("button", { name: /^Reject$/ }).first().click();
  await page.locator("textarea").fill("disagree with this");
  await page.getByRole("button", { name: "Record rejection" }).click();

  const msg = page.getByText(/Conflict — b@x\.com already approved this/);
  await expect(msg).toBeVisible();
  await expect(page.getByText("Vote not recorded")).toHaveCount(0); // not the approve popup
  await expect(page.locator("textarea")).toHaveValue("disagree with this");

  const ta = await page.locator("textarea").boundingBox();
  expect((await msg.boundingBox())!.y).toBeGreaterThan(ta!.y);
});

test("a MATCHING vote raises no conflict popup", async ({ page }) => {
  await page.goto(URL);
  await page.getByTestId("btn-approved").click();
  await page.getByRole("button", { name: /^Approve$/ }).first().click();
  await expect(page.getByText(/Conflict —/)).toHaveCount(0);
});
