import assert from "node:assert/strict";
import { test } from "node:test";
import { FriendshipGraph } from "./graph.js";

test("FriendshipGraph stores profiles and undirected edges", () => {
  const g = new FriendshipGraph();
  g.addProfile("1", {
    steamId64: "1",
    steamId: "STEAM_1:0:0",
    personaName: "A",
    profileUrl: null,
    friendsPageUrl: null,
    avatar: null,
    createdAt: null,
    ban: null,
  });
  g.addFriendship("1", "2");
  g.addFriendship("2", "3");

  const json = g.toJSON();
  assert.ok(json.profiles["1"]);
  assert.deepEqual([...json.adjacency["1"]].sort(), ["2"]);
  assert.deepEqual([...json.adjacency["2"]].sort(), ["1", "3"]);
});
