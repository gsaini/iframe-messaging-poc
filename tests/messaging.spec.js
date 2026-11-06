import { expect, test } from "@playwright/test";

const frameA = (page) => page.frameLocator('[data-testid="frame-A"]');
const frameB = (page) => page.frameLocator('[data-testid="frame-B"]');

async function open(page, mode, { evil = false } = {}) {
  await page.goto("/");
  if (mode !== "relay") await page.getByTestId("mode").selectOption(mode);
  if (evil) await page.getByTestId("evil").check();
  // Both frames have loaded and announced themselves.
  await expect(page.getByTestId("host-log")).toContainText("hello from A");
  await expect(page.getByTestId("host-log")).toContainText("hello from B");
}

async function say(frame, text, { enter = false } = {}) {
  await frame.getByTestId("text").fill(text);
  if (enter) await frame.getByTestId("text").press("Enter");
  else await frame.getByTestId("send").click();
}

test.describe("1 · relay through the parent", () => {
  test("A's message reaches B, and the parent sees it", async ({ page }) => {
    await open(page, "relay");
    await say(frameA(page), "hello from A");
    await expect(frameB(page).getByTestId("inbox")).toContainText("A: hello from A");
    await expect(page.getByTestId("host-log")).toContainText('relay A → B: chat "hello from A"');
  });

  test("B can answer A", async ({ page }) => {
    await open(page, "relay");
    await say(frameB(page), "and back", { enter: true });
    await expect(frameA(page).getByTestId("inbox")).toContainText("B: and back");
  });

  test("request/response round-trips through the parent", async ({ page }) => {
    await open(page, "relay");
    await frameA(page).getByTestId("ping").click();
    await expect(frameA(page).getByTestId("inbox")).toContainText("pong from B (http://localhost:5172)");
  });
});

test.describe("2 · direct MessageChannel", () => {
  test("A and B talk port-to-port and the parent never sees the chat", async ({ page }) => {
    await open(page, "channel");
    await expect(frameA(page).getByTestId("transport")).toHaveText("MessageChannel port to B");
    await expect(frameB(page).getByTestId("transport")).toHaveText("MessageChannel port to A");
    await say(frameA(page), "private line");
    await expect(frameB(page).getByTestId("inbox")).toContainText("A: private line");
    await frameB(page).getByTestId("ping").click();
    await expect(frameB(page).getByTestId("inbox")).toContainText("pong from A (http://localhost:5171)");
    const parentLog = await page.getByTestId("host-log").innerText();
    expect(parentLog).not.toContain("private line");
    expect(parentLog).not.toMatch(/relay [AB] →/); // the parent forwarded nothing
    expect(parentLog).not.toContain("unexpected"); // and received nothing but the two hellos
  });
});

test.describe("3 · BroadcastChannel", () => {
  test("works when both frames share an origin", async ({ page }) => {
    await open(page, "broadcast");
    await expect(frameB(page).locator("#origin")).toHaveText("http://localhost:5171");
    await say(frameA(page), "same origin");
    await expect(frameB(page).getByTestId("inbox")).toContainText("A: same origin");
    await frameA(page).getByTestId("ping").click();
    await expect(frameA(page).getByTestId("inbox")).toContainText("pong from B");
  });

  test("does not cross origins", async ({ page }) => {
    await open(page, "broadcast-cross");
    await say(frameA(page), "anyone there?");
    await frameA(page).getByTestId("ping").click();
    await expect(frameA(page).getByTestId("inbox")).toContainText("ping failed: no response");
    await expect(frameB(page).getByTestId("inbox")).not.toContainText("anyone there?");
  });
});

test.describe("security", () => {
  test("spoofed messages from an attacker frame are rejected by the parent and by the frames", async ({ page }) => {
    await open(page, "relay", { evil: true });
    const status = page.frameLocator('[data-testid="frame-evil"]').getByTestId("status");
    await expect(status).toContainText("Sent spoofed");
    await expect(status).toContainText("SecurityError"); // the browser blocks reading a sibling's DOM
    await expect(page.getByTestId("host-log")).toContainText("rejected: message from http://localhost:5173");
    await expect(frameA(page).getByTestId("rejected")).not.toHaveText("0");
    await expect(frameB(page).getByTestId("rejected")).not.toHaveText("0");
    for (const frame of [frameA(page), frameB(page)]) {
      await expect(frame.getByTestId("inbox")).not.toContainText("A: transfer all the money");
    }
    // The real channel still works alongside the attack.
    await say(frameA(page), "still fine");
    await expect(frameB(page).getByTestId("inbox")).toContainText("A: still fine");
  });

  test("frames may only be embedded by the host (CSP frame-ancestors)", async ({ request }) => {
    const frame = await request.get("http://localhost:5171/?name=A");
    expect(frame.headers()["content-security-policy"]).toBe("frame-ancestors http://localhost:5170");
    const host = await request.get("/");
    expect(host.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
  });

  test("a frame embedded by another origin can't be reached (the browser refuses to render it)", async ({ page }) => {
    // The attacker origin tries to embed frame A itself.
    await page.goto("http://localhost:5173/");
    await page.evaluate(() => {
      const el = document.createElement("iframe");
      el.src = "http://localhost:5171/?name=A";
      el.id = "stolen";
      document.body.append(el);
    });
    await page.waitForTimeout(1000);
    const rendered = page.frames().some((f) => f.url().startsWith("http://localhost:5171") && f.url() !== "about:blank");
    if (rendered) {
      // Some engines create the frame but leave it empty; either way, the frame's app never runs.
      const frame = page.frames().find((f) => f.url().startsWith("http://localhost:5171"));
      expect(await frame.locator("#name").count()).toBe(0);
    }
  });
});
