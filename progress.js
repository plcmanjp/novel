/* Browser-only reading history. No requests, cookies, accounts, or cross-device synchronization. */
(function (root) {
  "use strict";
  var PREFIX = "plcmanjp-novel-progress-v1:";
  var MAX_EPISODES = 10000;
  var MAX_BYTES = 300000;
  var MAX_PARAGRAPH = 100000;

  function validId(id) { return typeof id === "string" && /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(id); }
  function validEpisode(n) { return Number.isSafeInteger(n) && n > 0; }
  function validTime(n) { return Number.isSafeInteger(n) && n >= 0 && n < Number.MAX_SAFE_INTEGER; }
  function epochTime(epoch) {
    if (epoch === "0") return 0;
    if (typeof epoch !== "string") return null;
    var parts = /^([a-z0-9]{1,11})-([a-z0-9]{1,12})-([a-z0-9]{1,20})$/.exec(epoch);
    if (!parts) return null;
    var time = parseInt(parts[1], 36);
    return validTime(time) && time.toString(36) === parts[1] ? time : null;
  }
  function compareEpoch(a, b) {
    if (a === b) return 0;
    if (a === "0") return -1;
    if (b === "0") return 1;
    var difference = epochTime(a) - epochTime(b);
    return difference || (a < b ? -1 : 1);
  }
  function validStamp(stamp) { return stamp && validTime(stamp.at) && typeof stamp.id === "string" && /^[a-z0-9_-]{1,80}$/i.test(stamp.id); }
  function compareLast(a, b) {
    if (a.openedAt !== b.openedAt) return a.openedAt - b.openedAt;
    if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? -1 : 1;
    return a.updatedAt - b.updatedAt;
  }
  function validPosition(p) {
    return p && typeof p === "object" && Number.isInteger(p.paragraph) && p.paragraph >= 0 && p.paragraph <= MAX_PARAGRAPH &&
      typeof p.offset === "number" && Number.isFinite(p.offset) && p.offset >= 0 && p.offset <= 1 &&
      typeof p.ratio === "number" && Number.isFinite(p.ratio) && p.ratio >= 0 && p.ratio <= 1;
  }
  function positionCopy(p) { return { paragraph: p.paragraph, offset: p.offset, ratio: p.ratio }; }
  function blank(epoch) { return { version: 1, epoch: epoch || "0", last: null, completed: [] }; }
  function copy(record) {
    return { version: 1, epoch: record.epoch, last: record.last ? {
      episode: record.last.episode, position: positionCopy(record.last.position), updatedAt: record.last.updatedAt,
      openedAt: record.last.openedAt, sessionId: record.last.sessionId
    } : null, completed: record.completed.slice() };
  }
  function parse(raw) {
    if (typeof raw !== "string" || raw.length > MAX_BYTES) return null;
    var value;
    try { value = JSON.parse(raw); } catch (error) { return null; }
    if (!value || typeof value !== "object" || value.version !== 1 || typeof value.epoch !== "string" ||
        epochTime(value.epoch) === null || !Array.isArray(value.completed) || value.completed.length > MAX_EPISODES) return null;
    if (!value.completed.every(validEpisode)) return null;
    if (value.last !== null && (!value.last || typeof value.last !== "object" || !validEpisode(value.last.episode) ||
        !validPosition(value.last.position) || !validTime(value.last.updatedAt) ||
        !validStamp({ at: value.last.openedAt, id: value.last.sessionId }))) return null;
    var result = blank(value.epoch);
    result.completed = Array.from(new Set(value.completed)).sort(function (a, b) { return a - b; });
    if (value.last) result.last = { episode: value.last.episode, position: positionCopy(value.last.position), updatedAt: value.last.updatedAt, openedAt: value.last.openedAt, sessionId: value.last.sessionId };
    return result;
  }
  function merge(a, b) {
    if (a.epoch !== b.epoch) return copy(b);
    var result = copy(b);
    result.completed = Array.from(new Set(a.completed.concat(b.completed))).sort(function (x, y) { return x - y; }).slice(0, MAX_EPISODES);
    if (a.last && (!b.last || compareLast(a.last, b.last) > 0)) result.last = copy(a).last;
    return result;
  }
  function keyFor(id) { return validId(id) ? PREFIX + id : null; }
  function idForKey(key) {
    if (typeof key !== "string" || key.indexOf(PREFIX) !== 0) return null;
    var id = key.slice(PREFIX.length);
    return validId(id) ? id : null;
  }

  function create(options) {
    options = options || {};
    var cache = Object.create(null);
    var sequence = 0;
    var now = typeof options.now === "function" ? options.now : Date.now;
    function storage() { return Object.prototype.hasOwnProperty.call(options, "storage") ? options.storage : root.localStorage; }
    function entry(id) {
      if (!cache[id]) cache[id] = { record: blank(), status: "saved", dirty: false, rawSeen: null, pendingResetFrom: null, readAllowed: false };
      return cache[id];
    }
    function read(id) {
      var state = entry(id), raw;
      try {
        var target = storage();
        if (!target) throw new Error("Storage unavailable");
        raw = target.getItem(keyFor(id));
      } catch (error) { state.status = "memory"; state.readAllowed = false; return state; }
      state.readAllowed = true;
      // Keep an unsaved in-memory update while disk still contains the bytes it
      // was based on. A changed epoch from another tab always wins over it.
      if (state.dirty && raw === state.rawSeen) return state;
      if (raw === null) {
        state.record = blank(); state.dirty = false; state.rawSeen = null; state.pendingResetFrom = null;
        state.status = "saved";
        return state;
      }
      var incoming = parse(raw);
      if (!incoming) { state.status = "corrupt"; state.rawSeen = raw; return state; }
      // An old process may finish writing bytes it read before a reset. Reset
      // epochs are monotonic; never let those bytes resurrect cleared history.
      if (compareEpoch(incoming.epoch, state.record.epoch) < 0) {
        state.rawSeen = raw; state.dirty = true; state.status = "memory"; return state;
      }
      var sameEpoch = incoming.epoch === state.record.epoch;
      state.record = sameEpoch ? merge(state.record, incoming) : incoming;
      state.dirty = sameEpoch && JSON.stringify(state.record) !== JSON.stringify(incoming);
      if (!sameEpoch) state.pendingResetFrom = null;
      state.rawSeen = raw;
      state.status = state.dirty ? "memory" : "saved";
      return state;
    }
    function snapshot(id, published) {
      var state = read(id);
      var result = copy(state.record), allowed = null;
      if (Array.isArray(published)) allowed = new Set(published.filter(validEpisode));
      if (allowed) {
        result.completed = result.completed.filter(function (ep) { return allowed.has(ep); });
        if (result.last && !allowed.has(result.last.episode)) result.last = null;
      }
      return { last: result.last, completed: result.completed, epoch: result.epoch, status: state.status };
    }
    function changed(id) {
      if (typeof options.onChange === "function") {
        try { options.onChange(id, snapshot(id)); } catch (error) { /* UI callbacks must not interrupt reading. */ }
      }
    }
    function write(id, record, allowCorrupt) {
      var state = entry(id);
      var blocked = state.status === "corrupt" && !allowCorrupt;
      state.record = record;
      state.dirty = true;
      if (blocked || (!state.readAllowed && !allowCorrupt)) { changed(id); return true; }
      try {
        var target = storage();
        if (!target) throw new Error("Storage unavailable");
        var serialized = JSON.stringify(record);
        target.setItem(keyFor(id), serialized);
        state.rawSeen = serialized;
        state.dirty = false;
        state.pendingResetFrom = null;
        state.status = "saved";
      } catch (error) { state.status = "memory"; }
      changed(id);
      return true;
    }
    function mutation(id, expectedEpoch, change) {
      if (!validId(id)) return false;
      var state = read(id);
      if (expectedEpoch !== undefined && expectedEpoch !== state.record.epoch) return false;
      var record = copy(state.record);
      if (change(record) === false) return false;
      return write(id, record, false);
    }
    return {
      keyFor: keyFor,
      ownsKey: function (key) { return idForKey(key) !== null; },
      idForKey: idForKey,
      get: function (id, published) { return validId(id) ? snapshot(id, published) : { last: null, completed: [], epoch: "0", status: "memory" }; },
      updateLast: function (id, ep, position, expectedEpoch, openStamp) {
        if (!validEpisode(ep) || !validPosition(position) || (openStamp !== undefined && !validStamp(openStamp))) return false;
        return mutation(id, expectedEpoch, function (record) {
          var timestamp = now();
          if (!validTime(timestamp)) return false;
          var stamp = openStamp || { at: timestamp, id: "default" };
          var candidate = { episode: ep, position: positionCopy(position), updatedAt: Math.min(Number.MAX_SAFE_INTEGER - 1, Math.max(timestamp, record.last ? record.last.updatedAt + 1 : 0)), openedAt: stamp.at, sessionId: stamp.id };
          if (record.last && (compareLast(candidate, record.last) < 0 ||
              (stamp.at === record.last.openedAt && stamp.id === record.last.sessionId && ep !== record.last.episode))) return false;
          record.last = candidate;
        });
      },
      complete: function (id, ep, expectedEpoch) {
        if (!validEpisode(ep)) return false;
        return mutation(id, expectedEpoch, function (record) {
          if (record.completed.indexOf(ep) < 0) {
            if (record.completed.length >= MAX_EPISODES) return false;
            record.completed.push(ep); record.completed.sort(function (a, b) { return a - b; });
          }
        });
      },
      clear: function (id) {
        if (!validId(id)) return false;
        // This is called only after the app's deliberate per-work confirmation.
        var timestamp = now();
        if (!validTime(timestamp)) return false;
        var state = read(id); state.pendingResetFrom = state.record.epoch;
        timestamp = Math.max(timestamp, epochTime(state.record.epoch) + 1);
        if (!validTime(timestamp)) return false;
        var epoch = timestamp.toString(36) + "-" + (++sequence).toString(36) + "-" + (Math.random().toString(36).slice(2, 14) || "0");
        return write(id, blank(epoch), true);
      },
      reload: function (id, observedRaw) {
        if (!validId(id)) return null;
        // storage events carry the written bytes, not a promise that disk still
        // contains them. Remember a validated newer reset even if its writer
        // closes before a stale process overwrites the shared key.
        if (typeof observedRaw === "string") {
          var observed = parse(observedRaw), cached = entry(id);
          if (observed && compareEpoch(observed.epoch, cached.record.epoch) >= 0) {
            cached.record = observed.epoch === cached.record.epoch ? merge(cached.record, observed) : observed;
            cached.dirty = JSON.stringify(cached.record) !== JSON.stringify(observed);
            cached.rawSeen = observedRaw; cached.pendingResetFrom = null;
          }
        }
        var state = read(id);
        if (state.dirty && state.status !== "corrupt") write(id, copy(state.record), false);
        else changed(id);
        return snapshot(id);
      },
      status: function (id) { return validId(id) ? read(id).status : "memory"; }
    };
  }
  root.NovelProgress = { create: create, keyFor: keyFor, idForKey: idForKey, prefix: PREFIX };
})(typeof window !== "undefined" ? window : this);
