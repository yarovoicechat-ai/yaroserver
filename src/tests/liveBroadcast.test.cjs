const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const express = require("express");
const host = "507f1f77bcf86cd799439011";
const viewer = "507f1f77bcf86cd799439012";
const roomId = "507f1f77bcf86cd799439020";
let room, lastFilter, lastUpdate, tokenRole, createData;
const document = () => ({
  ...room,
  toObject() {
    return { ...room };
  },
});
const query = (value) => ({
  populate() {
    return this;
  },
  sort() {
    return this;
  },
  limit() {
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});
const model = {
  updateMany: async () => ({}),
  find: (filter) => {
    lastFilter = filter;
    return query(room ? [document()] : []);
  },
  findOne: (filter) => {
    lastFilter = filter;
    return query(room ? document() : null);
  },
  create: async (data) => {
    createData = data;
    return {
      ...data,
      _id: roomId,
      toObject() {
        return { ...data, _id: roomId };
      },
    };
  },
  updateOne: async (filter, update) => {
    lastFilter = filter;
    lastUpdate = update;
    return {};
  },
  findOneAndUpdate: async (filter, update) => {
    lastFilter = filter;
    lastUpdate = update;
    return filter.host && String(filter.host) !== host ? null : document();
  },
};
const original = Module._load;
Module._load = function (name, parent, isMain) {
  if (name.endsWith("/models/liveBroadcast.model"))
    return { __esModule: true, default: model };
  if (name.endsWith("/models/user.model")) return { User: {} };
  if (name.endsWith("/gift/gift.model")) return { GiftTransaction: {} };
  if (name.endsWith("/middlewares/authorize.middleware"))
    return {
      verifyToken: (req, res, next) => {
        if (!req.headers["x-user"])
          return res.status(401).json({ success: false });
        req.user = {
          id: req.headers["x-user"],
          role: req.headers["x-role"] || "user",
        };
        next();
      },
      checkPermission: () => (req, res, next) =>
        req.user.role === "owner"
          ? next()
          : res.status(403).json({ success: false }),
    };
  if (name.endsWith("/services/agora/agoraToken.service"))
    return {
      AgoraTokenService: {
        resolveProject: async () => ({
          project: { _id: "project", appId: "app" },
          certificate: "secret",
        }),
      },
    };
  if (name === "agora-token")
    return {
      RtcRole: { PUBLISHER: 1, SUBSCRIBER: 2 },
      RtcTokenBuilder: {
        buildTokenWithUid: (...args) => {
          tokenRole = args[4];
          return "rtc-token";
        },
      },
    };
  return original.call(this, name, parent, isMain);
};
const router = require("../routes/liveBroadcastRoutes").default;
Module._load = original;
let server, base;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/live", router);
  app.use((error, req, res, next) =>
    res.status(500).json({ message: error.message })
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/live`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));
test.beforeEach(() => {
  room = {
    _id: roomId,
    host,
    hostUid: 10,
    projectId: "project",
    title: "Live room",
    status: "live",
    heartbeatAt: new Date(),
    viewers: [
      { user: viewer, heartbeatAt: new Date() },
      { user: "stale", heartbeatAt: new Date(Date.now() - 120000) },
    ],
  };
  lastFilter = lastUpdate = createData = tokenRole = null;
});
const request = (
  path,
  user = viewer,
  body = {},
  role = "user",
  method = "POST"
) =>
  fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { "x-user": user } : {}),
      "x-role": role,
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });

test("requires authentication for discovery and token issuance", async () => {
  assert.equal((await request("/rooms", "", {}, "user", "GET")).status, 401);
  assert.equal((await request(`/rooms/${roomId}/join`, "")).status, 401);
});
test("viewer cannot request broadcaster privileges via client data", async () => {
  const response = await request(`/rooms/${roomId}/join`, viewer, {
    isHost: true,
    hostUid: 999,
  });
  const { data } = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.rtc.isHost, false);
  assert.equal(tokenRole, 2);
  assert.equal(data.rtc.hostUid, 10);
  assert.equal(data.room.viewerCount, 1);
  assert.equal(data.room.projectId, undefined);
  assert.equal(data.room.viewers, undefined);
});
test("only the actual room host receives publisher token", async () => {
  const response = await request(`/rooms/${roomId}/join`, host);
  assert.equal((await response.json()).data.rtc.isHost, true);
  assert.equal(tokenRole, 1);
});
test("rejects invalid IDs and ended rooms without issuing credentials", async () => {
  assert.equal((await request("/rooms/invalid/join")).status, 400);
  room = null;
  assert.equal((await request(`/rooms/${roomId}/join`)).status, 404);
  assert.equal(tokenRole, null);
});
test("host ownership is part of the atomic end query", async () => {
  assert.equal((await request(`/rooms/${roomId}/end`, viewer)).status, 404);
  assert.equal(lastFilter.host, viewer);
  assert.equal(lastFilter.status, "live");
  assert.equal((await request(`/rooms/${roomId}/end`, host)).status, 200);
  assert.equal(lastUpdate.$set.status, "ended");
});
test("moderation requires panel permission, including pin actions", async () => {
  assert.equal((await request(`/admin/rooms/${roomId}/end`)).status, 403);
  assert.equal(
    (await request(`/admin/rooms/${roomId}/pin`, viewer, { isPinned: true }))
      .status,
    403
  );
  assert.equal(
    (
      await request(
        `/admin/rooms/${roomId}/pin`,
        viewer,
        { isPinned: true },
        "owner"
      )
    ).status,
    200
  );
  assert.equal(lastUpdate.$set.isPinned, true);
});
test("validates metadata and takes host identity from authenticated account", async () => {
  assert.equal(
    (await request("/rooms", host, { title: "", category: "Live" })).status,
    400
  );
  assert.equal(
    (await request("/rooms", host, { title: "Hello", category: "fake" }))
      .status,
    400
  );
  assert.equal(
    (
      await request("/rooms", host, {
        title: "Hello",
        coverImage: "javascript:bad",
      })
    ).status,
    400
  );
  assert.equal(
    (
      await request("/rooms", host, {
        title: " Hello ",
        category: "Beauty",
        host: viewer,
      })
    ).status,
    201
  );
  assert.equal(createData.host, host);
  assert.equal(createData.title, "Hello");
});
test("viewer heartbeat is atomic and cannot extend the host lease", async () => {
  assert.equal((await request(`/rooms/${roomId}/heartbeat`)).status, 200);
  assert.ok(Array.isArray(lastUpdate));
  assert.ok(lastUpdate[0].$set.viewers.$concatArrays);
  assert.equal(lastUpdate[0].$set.heartbeatAt, undefined);
  assert.ok(lastFilter.heartbeatAt.$gt instanceof Date);
});
test("host heartbeat extends only an active host lease", async () => {
  assert.equal((await request(`/rooms/${roomId}/heartbeat`, host)).status, 200);
  assert.ok(lastUpdate.$set.heartbeatAt instanceof Date);
  room = null;
  assert.equal((await request(`/rooms/${roomId}/heartbeat`, host)).status, 410);
});
