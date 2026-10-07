import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseGameBanDaysFromHtml,
  parseVacBanFromHtml,
} from "./profile-html.js";

test("parseVacBanFromHtml detects VAC on record", () => {
  const html =
    '<div class="profile_ban_status">2 VAC bans on record<br>120 day(s) since last ban</div>';
  const r = parseVacBanFromHtml(html);
  assert.ok(r);
  assert.equal(r!.vacBanned, true);
  assert.equal(r!.vacCount, 2);
  assert.equal(r!.daysSinceLastBan, 120);
});

test("parseVacBanFromHtml returns clean when no VAC", () => {
  const r = parseVacBanFromHtml("<html><body>No bans here</body></html>");
  assert.deepEqual(r, { vacBanned: false, vacCount: 0 });
});

test("parseGameBanDaysFromHtml extracts days", () => {
  const html = "1 game ban on record<br>45 day(s) since last ban";
  const r = parseGameBanDaysFromHtml(html);
  assert.ok(r);
  assert.equal(r!.gameBanDaysSinceLast, 45);
  assert.equal(parseGameBanDaysFromHtml("nothing"), null);
});
