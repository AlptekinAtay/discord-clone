import { WebSocketServer } from "ws";
import * as mediasoupTypes from "mediasoup/node/lib/types.js";
import { createWorker } from "mediasoup";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-discord-clone-key-123";

// --- Whitelist Management ---
async function loadWhitelist() {
  try {
    const file = Bun.file("./users.json");
    if (await file.exists()) {
      return JSON.parse(await file.text());
    }
  } catch (e) {
    console.error("Error loading users.json:", e);
  }
  return [];
}

// --- Auth REST API ---
Bun.serve({
  port: Number(process.env.PORT) || 3000,
  async fetch(req) {
    const url = new URL(req.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Content-Type": "application/json"
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Static file serving for uploads
    if (url.pathname.startsWith("/uploads/")) {
      const fileName = url.pathname.replace("/uploads/", "");
      const file = Bun.file(`./uploads/${fileName}`);
      if (await file.exists()) {
        return new Response(file);
      }
      return new Response("File not found", { status: 404 });
    }

    // File upload endpoint
    if (url.pathname === "/api/upload" && req.method === "POST") {
      try {
        const formData = await req.formData();
        const file = formData.get("file") as File;
        if (!file) {
          return new Response(JSON.stringify({ error: "No file uploaded" }), { status: 400, headers: corsHeaders });
        }

        const fileName = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
        await Bun.write(`./uploads/${fileName}`, file);

        return new Response(JSON.stringify({
          url: `${process.env.PUBLIC_URL}/uploads/${fileName}`,
          type: file.type
        }), { status: 200, headers: corsHeaders });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname === "/api/register" && req.method === "POST") {
      return new Response(JSON.stringify({ error: "Registration is disabled for this private server" }), { status: 403, headers: corsHeaders });
    }

    if (url.pathname === "/api/login" && req.method === "POST") {
      try {
        const { email, password } = await req.json();
        
        // 1. Check Whitelist (users.json)
        const whitelist = await loadWhitelist();
        const whiteUser = whitelist.find((u: any) => u.email === email);
        
        if (!whiteUser) {
          return new Response(JSON.stringify({ error: "Access denied: You are not in the whitelist" }), { status: 403, headers: corsHeaders });
        }

        // 2. Verify Password (Plain-text or Bcrypt)
        let isValid = false;
        if (whiteUser.password === password) {
          isValid = true;
        } else {
          try {
            isValid = await bcrypt.compare(password, whiteUser.password);
          } catch (e) {
            isValid = false;
          }
        }

        if (!isValid) {
          return new Response(JSON.stringify({ error: "Invalid password" }), { status: 400, headers: corsHeaders });
        }

        // 3. Sync with Prisma DB for system compatibility
        const user = await prisma.user.upsert({
          where: { email: whiteUser.email },
          update: { username: whiteUser.username },
          create: {
            id: whiteUser.id || crypto.randomUUID(),
            email: whiteUser.email,
            username: whiteUser.username,
            password: whiteUser.password.startsWith("$2") ? whiteUser.password : await bcrypt.hash(whiteUser.password, 10)
          }
        });

        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

        return new Response(JSON.stringify({
          token,
          user: { id: user.id, username: user.username, email: user.email, avatarUrl: user.avatarUrl }
        }), { status: 200, headers: corsHeaders });

      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname === "/api/me" && req.method === "GET") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }

      const token = authHeader.split(" ")[1];
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        const user = await prisma.user.findUnique({ where: { id: decoded.id } });
        if (!user) {
          return new Response(JSON.stringify({ error: "User not found" }), { status: 404, headers: corsHeaders });
        }

        return new Response(JSON.stringify({
          user: { id: user.id, username: user.username, email: user.email, avatarUrl: user.avatarUrl }
        }), { status: 200, headers: corsHeaders });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: corsHeaders });
      }
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  }
});
console.log(`Auth REST API running on ${process.env.PUBLIC_URL}`);
// ----------------------

// --- Mediasoup & WebSocket Server ---
// In-memory Database (Mock)
const wss = new WebSocketServer({ port: Number(process.env.WS_PORT) || 8080 });

// State
let worker: mediasoupTypes.Worker;
const routers = new Map<string, mediasoupTypes.Router>();

// --- Database Simulation (In-Memory) ---
export interface User {
  id: string;
  username: string;
  avatarUrl: string;
}

const dbUsers = new Map<string, User>();
// NOTE: dbMessages replaced by Prisma - see send-message and get-messages handlers
// -------------------------------------

// Seed default channels into DB on startup
async function seedChannels() {
  const defaults = [
    { id: "1", name: "general", type: "text" },
    { id: "2", name: "voice-lounge", type: "voice" },
    { id: "3", name: "gaming", type: "voice" }
  ];
  for (const ch of defaults) {
    await prisma.channel.upsert({
      where: { id: ch.id },
      update: {},
      create: ch
    });
  }
}
seedChannels();
// -------------------------------------

interface Peer {
  id: string;
  ws: WebSocket;
  transports: Map<string, mediasoupTypes.WebRtcTransport>;
  producers: Map<string, mediasoupTypes.Producer>;
  consumers: Map<string, mediasoupTypes.Consumer>;
  currentChannelId: string | null;
  micMuted: boolean;
  deafened: boolean;
}

const peers = new Map<string, Peer>();
const roomPeers = new Map<string, Set<string>>(); // channelId -> Set of Peer IDs

const mediaCodecs: mediasoupTypes.RtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000
    }
  },
  {
    kind: "video",
    mimeType: "video/H264",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42e01f",
      "level-asymmetry-allowed": 1
    }
  }
];

async function initMediasoupWorker() {
  worker = await createWorker({
    logLevel: "warn",
    logTags: ["info", "ice", "dtls", "rtp", "srtp", "rtcp"],
    rtcMinPort: Number(process.env.RTC_MIN_PORT) || 40000,
    rtcMaxPort: Number(process.env.RTC_MAX_PORT) || 40100,
  });

  console.log(`Mediasoup worker created [pid:${worker.pid}]`);
  worker.on("died", () => {
    console.error("mediasoup worker died, exiting in 2 seconds... [pid:%d]", worker.pid);
    setTimeout(() => process.exit(1), 2000);
  });
}

async function getOrCreateRouter(channelId: string) {
  if (routers.has(channelId)) {
    return routers.get(channelId)!;
  }
  const router = await worker.createRouter({ mediaCodecs });
  routers.set(channelId, router);
  roomPeers.set(channelId, new Set());
  return router;
}

function broadcastChannelState() {
  const state: Record<string, string[]> = {};
  roomPeers.forEach((peersSet, channelId) => {
    state[channelId] = Array.from(peersSet);
  });

  const livePeers: string[] = [];
  const usersRecord: Record<string, any> = {};

  peers.forEach((p, pid) => {
    const isLive = Array.from(p.producers.values()).some(prod => prod.kind === 'video');
    if (isLive) {
      livePeers.push(pid);
    }

    if (dbUsers.has(pid)) {
      const user = dbUsers.get(pid);
      usersRecord[pid] = {
        ...user,
        micMuted: p.micMuted,
        deafened: p.deafened
      };
    }
  });

  const msg = JSON.stringify({
    type: "channel-state",
    payload: {
      channels: state,
      livePeers,
      users: usersRecord,
      globalOnlineUsers: Object.values(usersRecord)  // all connected users, room-independent
    }
  });

  peers.forEach(p => {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(msg);
    }
  });
}

function broadcast(msgObj: any) {
  const msg = JSON.stringify(msgObj);
  peers.forEach(p => {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(msg);
    }
  });
}

function clearPeerTransports(peer: Peer) {
  peer.transports.forEach(t => t.close());
  peer.transports.clear();
  peer.producers.clear();
  peer.consumers.clear();
}

initMediasoupWorker();

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "", "http://localhost");
  const token = url.searchParams.get("token");

  if (!token) {
    ws.close(4001, "Unauthorized");
    return;
  }

  let userId = "";
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    userId = decoded.id;
  } catch (e) {
    ws.close(4001, "Invalid token");
    return;
  }

  const peerId = userId;
  const peer: Peer = {
    id: peerId,
    ws: ws as any,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
    currentChannelId: null,
    micMuted: false,
    deafened: false
  };
  peers.set(peerId, peer);

  prisma.user.findUnique({ where: { id: userId } }).then(user => {
    if (user) {
      dbUsers.set(peerId, {
        id: peerId,
        username: user.username,
        avatarUrl: user.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.username)}`
      });
      console.log(`Client connected: ${user.username}`);

      prisma.channel.findMany().then(dbChannels => {
        ws.send(JSON.stringify({
          type: "READY",
          payload: {
            peerId,
            channels: dbChannels
          }
        }));
      });
      // Broadcast after user is officially in dbUsers
      broadcastChannelState();
    }
  });

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message.toString());
      const { id, type, payload } = data;
      const peer = peers.get(peerId);
      if (!peer) return;

      switch (type) {
        case "update-status": {
          const { micMuted, deafened } = payload;
          peer.micMuted = !!micMuted;
          peer.deafened = !!deafened;
          broadcastChannelState();
          break;
        }

        case "request-presence": {
          broadcastChannelState();
          break;
        }

        case "create-channel": {
          const { name, type: channelType } = payload;
          if (name.toLowerCase() === "general" || name.toLowerCase() === "voice-lounge") {
            ws.send(JSON.stringify({ id, error: "Bu isimde bir kanal zaten mevcut" }));
            break;
          }

          const newChannel = await prisma.channel.create({
            data: {
              id: crypto.randomUUID(),
              name,
              type: channelType
            }
          });

          const allChannels = await prisma.channel.findMany();
          broadcast({
            type: "channels-updated",
            payload: { channels: allChannels }
          });

          ws.send(JSON.stringify({ id, type: "create-channel", payload: newChannel }));
          break;
        }

        case "delete-channel": {
          const { channelId } = payload;
          const channel = await prisma.channel.findUnique({ where: { id: channelId } });

          if (!channel) {
            ws.send(JSON.stringify({ id, error: "Channel not found" }));
            break;
          }

          if (channel.name === "general" || channel.name === "voice-lounge") {
            ws.send(JSON.stringify({ id, error: "Cannot delete default channels" }));
            break;
          }

          await prisma.channel.delete({ where: { id: channelId } });

          const allChannels = await prisma.channel.findMany();
          broadcast({
            type: "channels-updated",
            payload: { channels: allChannels }
          });

          ws.send(JSON.stringify({ id, type: "delete-channel", payload: { success: true } }));
          break;
        }

        // --- CHAT LOGIC ---
        case "send-message": {
          const { channelId, content, fileUrl, fileType } = payload;

          // Save to Prisma DB
          const saved = await prisma.message.create({
            data: { content, channelId, authorId: peerId, fileUrl, fileType },
            include: { author: true }
          });

          const msgOut = {
            id: saved.id,
            channelId: saved.channelId,
            authorId: saved.authorId,
            content: saved.content,
            fileUrl: saved.fileUrl,
            fileType: saved.fileType,
            createdAt: saved.createdAt.toISOString(),
          };
          const authorOut = {
            id: saved.author.id,
            username: saved.author.username,
            avatarUrl: saved.author.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(saved.author.username)}`
          };

          const msgPayload = JSON.stringify({
            type: "new-message",
            payload: { message: msgOut, author: authorOut }
          });

          peers.forEach(p => {
            if (p.ws.readyState === WebSocket.OPEN) p.ws.send(msgPayload);
          });

          if (id) ws.send(JSON.stringify({ id, type: "message-sent" }));
          break;
        }

        case "get-messages": {
          const { channelId } = payload;
          // Fetch last 50 messages from DB, oldest first
          const dbMsgs = await prisma.message.findMany({
            where: { channelId },
            orderBy: { createdAt: "asc" },
            take: 50,
            include: { author: true }
          });
          const msgsWithAuthors = dbMsgs.map(m => ({
            id: m.id,
            channelId: m.channelId,
            authorId: m.authorId,
            content: m.content,
            fileUrl: m.fileUrl,
            fileType: m.fileType,
            createdAt: m.createdAt.toISOString(),
            author: {
              id: m.author.id,
              username: m.author.username,
              avatarUrl: m.author.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(m.author.username)}`
            }
          }));

          ws.send(JSON.stringify({
            id,
            type: "channel-messages",
            payload: { channelId, messages: msgsWithAuthors }
          }));
          break;
        }
        // ------------------

        case "join-room": {
          const { channelId } = payload;

          // Leave old room if in one
          if (peer.currentChannelId) {
            roomPeers.get(peer.currentChannelId)?.delete(peerId);
            clearPeerTransports(peer);
          }

          const router = await getOrCreateRouter(channelId);
          roomPeers.get(channelId)!.add(peerId);
          peer.currentChannelId = channelId;

          ws.send(JSON.stringify({
            id,
            type: "room-joined",
            payload: { routerRtpCapabilities: router.rtpCapabilities }
          }));

          // Notify this new peer about EXISTING producers in the NEW room
          const others = Array.from(roomPeers.get(channelId) || []).filter(pid => pid !== peerId);
          others.forEach(otherId => {
            const otherPeer = peers.get(otherId);
            if (otherPeer) {
              otherPeer.producers.forEach((producer) => {
                ws.send(JSON.stringify({
                  type: "new-producer",
                  payload: { producerId: producer.id, peerId: otherId, kind: producer.kind }
                }));
              });
            }
          });

          broadcastChannelState();
          break;
        }

        case "leave-room": {
          if (peer.currentChannelId) {
            // Close all transports
            clearPeerTransports(peer);

            const oldChannelId = peer.currentChannelId;
            roomPeers.get(oldChannelId)?.delete(peerId);
            peer.currentChannelId = null;

            // Broadcast peer-left to others in the old channel
            const others = Array.from(roomPeers.get(oldChannelId) || []);
            others.forEach(otherId => {
              peers.get(otherId)?.ws.send(JSON.stringify({
                type: "peer-left",
                payload: { peerId }
              }));
            });

            broadcastChannelState();
          }
          if (id) ws.send(JSON.stringify({ id, type: "room-left" }));
          break;
        }

        case "create-transport": {
          console.log(`--> [${peer.username}] Transport isteği geldi, oluşturuluyor...`);
          const { channelId } = payload;
          const router = routers.get(channelId);
          if (!router) throw new Error("Router not found");

          const transport = await router.createWebRtcTransport({
            listenIps: [{ 
              ip: process.env.LISTEN_IP || "0.0.0.0", 
              announcedIp: process.env.ANNOUNCED_IP as string 
            }],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
          });
          console.log("-->Transport başarıyla oluşturuldu ID:", transport.id);
          transport.on("dtlsstatechange", dtlsState => {
            if (dtlsState === "closed") transport.close();
          });

          peer.transports.set(transport.id, transport);

          ws.send(JSON.stringify({
            id,
            type: "transport-created",
            payload: {
              id: transport.id,
              iceParameters: transport.iceParameters,
              iceCandidates: transport.iceCandidates,
              dtlsParameters: transport.dtlsParameters,
            }
          }));
          break;
        }

        case "connect-transport": {
          const { transportId, dtlsParameters } = payload;
          const transport = peer.transports.get(transportId);
          if (!transport) throw new Error("Transport not found");

          await transport.connect({ dtlsParameters });
          ws.send(JSON.stringify({ id, type: "transport-connected" }));
          break;
        }

        case "produce": {
          const { transportId, kind, rtpParameters, channelId } = payload;
          const transport = peer.transports.get(transportId);
          if (!transport) throw new Error("Transport not found");

          const producer = await transport.produce({ kind, rtpParameters });
          peer.producers.set(producer.id, producer);

          ws.send(JSON.stringify({
            id,
            type: "produced",
            payload: { id: producer.id }
          }));

          // Notify others in the room
          const others = Array.from(roomPeers.get(channelId) || []).filter(pid => pid !== peerId);
          others.forEach(otherId => {
            peers.get(otherId)?.ws.send(JSON.stringify({
              type: "new-producer",
              payload: { producerId: producer.id, peerId, kind: producer.kind }
            }));
          });
          break;
        }

        case "stop-producer": {
          const { producerId } = payload;
          const producer = peer.producers.get(producerId);
          if (producer) {
            producer.close();
            peer.producers.delete(producerId);

            if (producer.kind === 'video') {
              const others = Array.from(roomPeers.get(peer.currentChannelId || "") || []).filter(pid => pid !== peerId);
              others.forEach(otherId => {
                peers.get(otherId)?.ws.send(JSON.stringify({
                  type: "peer-stopped-video",
                  payload: { peerId }
                }));
              });
            }
          }
          ws.send(JSON.stringify({ id, type: "producer-stopped", payload: { ok: true } }));
          break;
        }

        case "consume": {
          const { producerId, rtpCapabilities, channelId, transportId } = payload;
          const router = routers.get(channelId);
          const transport = peer.transports.get(transportId);
          if (!router || !transport) throw new Error("Router or Transport not found");

          try {
            if (!router.canConsume({ producerId, rtpCapabilities })) {
              console.warn(`Cannot consume producer ${producerId}`);
              ws.send(JSON.stringify({ id, error: "Cannot consume" }));
              return;
            }

            const consumer = await transport.consume({
              producerId,
              rtpCapabilities,
              paused: true,
            });

            peer.consumers.set(consumer.id, consumer);

            consumer.on("transportclose", () => consumer.close());
            consumer.on("producerclose", () => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "producer-closed", payload: { consumerId: consumer.id } }));
              }
            });

            ws.send(JSON.stringify({
              id,
              type: "consumed",
              payload: {
                id: consumer.id,
                producerId: consumer.producerId,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
              }
            }));
          } catch (err) {
            console.error("Consume error:", err);
            ws.send(JSON.stringify({ id, error: "Consume error" }));
          }
          break;
        }

        case "resume-consumer": {
          const { consumerId } = payload;
          const consumer = peer.consumers.get(consumerId);
          if (consumer) {
            await consumer.resume();
          }
          ws.send(JSON.stringify({ id, type: "consumer-resumed", payload: { ok: true } }));
          break;
        }

        case "close-consumer": {
          const { consumerId } = payload;
          const consumer = peer.consumers.get(consumerId);
          if (consumer) {
            consumer.close();
            peer.consumers.delete(consumerId);
          }
          ws.send(JSON.stringify({ id, type: "consumer-closed", payload: { ok: true } }));
          break;
        }
      }
    } catch (err) {
      console.error("Message error:", err);
    }
  });

  ws.on("close", () => {
    const peer = peers.get(peerId);
    if (peer && peer.currentChannelId) {
      const oldChannelId = peer.currentChannelId;
      roomPeers.get(oldChannelId)?.delete(peerId);

      const others = Array.from(roomPeers.get(oldChannelId) || []);
      others.forEach(otherId => {
        peers.get(otherId)?.ws.send(JSON.stringify({
          type: "peer-left",
          payload: { peerId }
        }));
      });
      broadcastChannelState();
    }
    peers.delete(peerId);
    dbUsers.delete(peerId);
    console.log(`Client disconnected: ${peerId}`);
  });
});

console.log(`🚀 Signaling server & SFU running on ws://${process.env.ANNOUNCED_IP}:${process.env.WS_PORT || 8080}`);
