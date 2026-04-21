const { nowIso } = require('./utils');

class ExploreHub {
  constructor() {
    this.clients = new Set();
  }

  add(client) {
    this.clients.add(client);
  }

  remove(client) {
    this.clients.delete(client);
  }

  broadcast(payload) {
    const message = JSON.stringify({
      ...payload,
      serverTime: nowIso(),
    });

    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  }
}

class PlayersHub {
  constructor() {
    this.rooms = new Map();
  }

  ensureRoom(roomId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        clients: new Set(),
        players: new Map(),
      });
    }

    return this.rooms.get(roomId);
  }

  join(roomId, playerId, client) {
    const room = this.ensureRoom(roomId);
    room.clients.add(client);
    client.meta = { playerId, roomId };

    this.send(client, {
      ps: Array.from(room.players.values()).filter(
        player => player.pid !== playerId,
      ),
      rid: roomId,
      t: 's',
      ts: Date.now(),
    });
    this.send(client, {
      pid: playerId,
      rid: roomId,
      t: 'a',
      ts: Date.now(),
    });
  }

  leave(client) {
    const meta = client.meta;
    if (!meta) {
      return;
    }

    const room = this.rooms.get(meta.roomId);
    if (!room) {
      return;
    }

    room.clients.delete(client);
    room.players.delete(meta.playerId);
    this.broadcast(meta.roomId, {
      pid: meta.playerId,
      rid: meta.roomId,
      t: 'l',
      ts: Date.now(),
    });

    if (room.clients.size === 0) {
      this.rooms.delete(meta.roomId);
    }
  }

  update(client, payload) {
    const meta = client.meta;
    if (!meta) {
      return;
    }

    const room = this.ensureRoom(meta.roomId);
    const normalized = {
      ...payload,
      pid: meta.playerId,
      rid: meta.roomId,
      t: 'p',
      ts: Number(payload.ts) || Date.now(),
    };

    room.players.set(meta.playerId, normalized);
    for (const peer of room.clients) {
      if (peer !== client && peer.readyState === 1) {
        peer.send(JSON.stringify(normalized));
      }
    }
  }

  broadcast(roomId, payload) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    const message = JSON.stringify(payload);
    for (const client of room.clients) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  }

  send(client, payload) {
    if (client.readyState === 1) {
      client.send(JSON.stringify(payload));
    }
  }
}

class MessagesHub {
  constructor() {
    this.clients = new Map(); // userId -> Set<client>
  }

  join(userId, client) {
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId).add(client);
    client._messagesUserId = userId;
  }

  leave(userId, client) {
    const set = this.clients.get(userId);
    if (set) {
      set.delete(client);
      if (set.size === 0) this.clients.delete(userId);
    }
  }

  handleMessage(senderId, payload) {
    if (!payload || !payload.toUserId) return;
    const event = { ...payload, fromUserId: senderId, serverTime: nowIso(), type: 'message' };
    const targets = this.clients.get(payload.toUserId);
    if (targets) {
      const msg = JSON.stringify(event);
      for (const c of targets) {
        if (c.readyState === 1) c.send(msg);
      }
    }
  }

  sendToUser(userId, payload) {
    const set = this.clients.get(userId);
    if (!set) return;
    const msg = JSON.stringify(payload);
    for (const c of set) {
      if (c.readyState === 1) c.send(msg);
    }
  }
}

class NotificationsHub {
  constructor() {
    this.clients = new Map(); // userId -> Set<client>
  }

  join(userId, client) {
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId).add(client);
    client._notificationsUserId = userId;
  }

  leave(userId, client) {
    const set = this.clients.get(userId);
    if (set) {
      set.delete(client);
      if (set.size === 0) {
        this.clients.delete(userId);
      }
    }
  }

  sendToUser(userId, payload) {
    const set = this.clients.get(userId);
    if (!set) {
      return;
    }
    const message = JSON.stringify(payload);
    for (const client of set) {
      if (client.readyState === 1) {
        client.send(message);
      }
    }
  }
}

module.exports = {
  ExploreHub,
  MessagesHub,
  NotificationsHub,
  PlayersHub,
};
