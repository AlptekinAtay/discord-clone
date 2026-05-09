import { Device } from "mediasoup-client";
import { useVoiceStore } from "../store/useVoiceStore";
import { useChatStore } from "../store/useChatStore";

class SFUClient {
  public onReady: (() => void) | null = null;
  public onChannelsUpdated: ((channels: any[]) => void) | null = null;
  private device: Device | null = null;
  private ws: WebSocket | null = null;
  private sendTransport: any = null;
  private recvTransport: any = null;
  private audioProducer: any = null;
  private videoProducer: any = null;
  private channelId: string | null = null;
  private pendingRequests = new Map<string, { resolve: Function, reject: Function }>();
  private recvTransportReady = false;
  private pendingProducers: Array<{ producerId: string; peerId: string }> = [];

  async connect(wsUrl: string): Promise<void> {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }
    this.ws = new WebSocket(wsUrl);

    return new Promise<void>((resolve, reject) => {
      this.ws!.onopen = () => {
        console.log("WebSocket connected, waiting for READY...");
      };

      this.ws!.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        const { type, payload } = data;

        if (data.id && this.pendingRequests.has(data.id)) {
          if (data.error) this.pendingRequests.get(data.id)!.reject(new Error(data.error));
          else this.pendingRequests.get(data.id)!.resolve(payload);
          this.pendingRequests.delete(data.id);
          return;
        }

        switch (type) {
          case "READY":
            useVoiceStore.getState().setMyPeerId(payload.peerId);
            if (payload.channels && this.onChannelsUpdated) {
              this.onChannelsUpdated(payload.channels);
            }
            if (this.onReady) this.onReady();
            resolve();
            break;
          case "channel-state":
            useVoiceStore.getState().setChannelPeers(payload.channels);
            useVoiceStore.getState().setGlobalLivePeers(payload.livePeers);
            if (payload.users) useVoiceStore.getState().setChannelUsers(payload.users);
            if (payload.globalOnlineUsers) useVoiceStore.getState().setGlobalOnlineUsers(payload.globalOnlineUsers);
            break;
          case "channels-updated":
            if (this.onChannelsUpdated) this.onChannelsUpdated(payload.channels);
            break;
          case "new-producer":
            useVoiceStore.getState().addPeer(payload.peerId);
            if (payload.kind === 'video') {
              useVoiceStore.getState().addVideoProducer(payload.peerId, payload.producerId);
            } else if (this.recvTransportReady) {
              await this.consume(payload.producerId, payload.peerId);
            } else {
              console.log("[SFU] Queuing producer for", payload.peerId);
              this.pendingProducers.push({ producerId: payload.producerId, peerId: payload.peerId });
            }
            break;
          case "peer-stopped-video":
            useVoiceStore.getState().removeVideoProducer(payload.peerId);
            break;
          case "peer-joined":
            useVoiceStore.getState().addPeer(payload.peerId);
            break;
          case "peer-left":
            useVoiceStore.getState().removePeer(payload.peerId);
            break;
          case "producer-closed":
            useVoiceStore.getState().removeConsumer(payload.consumerId);
            break;
          case "new-message": {
            const msg = payload.author
              ? { ...payload.message, author: payload.author }
              : payload.message;
            useChatStore.getState().addMessage(msg);
            break;
          }
        }
      };

      this.ws!.onerror = (err) => {
        console.error("[SFU] WebSocket error:", err);
        reject(err);
      };

      this.ws!.onclose = () => {
        console.log("[SFU] WebSocket closed — cleaning up client state");
        useVoiceStore.getState().setConnected(false);
        // Clean up all client state since server has already reset our peer
        this._cleanupLocalState();
        this.ws = null;
      };
    });
  }

  /** Cleans up local state WITHOUT sending any messages (used on disconnect) */
  private _cleanupLocalState() {
    try { if (this.audioProducer) this.audioProducer.close(); } catch (_) {}
    try { if (this.videoProducer) this.videoProducer.close(); } catch (_) {}
    try { if (this.sendTransport) this.sendTransport.close(); } catch (_) {}
    try { if (this.recvTransport) this.recvTransport.close(); } catch (_) {}
    this.audioProducer = null;
    this.videoProducer = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
    this.channelId = null;
    this.recvTransportReady = false;
    this.pendingProducers = [];
    useVoiceStore.getState().clearPeers();
    useVoiceStore.getState().setActiveChannel(null);
    useVoiceStore.getState().setScreenSharing(false, null);
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  async fetchChannelMessages(channelId: string) {
    try {
      const payload = await this.request("get-messages", { channelId });
      if (payload?.messages) useChatStore.getState().setMessages(channelId, payload.messages);
    } catch (e) {
      console.warn("fetchChannelMessages failed:", e);
    }
  }

  async updateStatus(micMuted: boolean, deafened: boolean) {
    if (this.isConnected()) {
      this.ws!.send(JSON.stringify({ type: "update-status", payload: { micMuted, deafened } }));
    }
  }

  async requestPresence() {
    if (this.isConnected()) {
      this.ws!.send(JSON.stringify({ type: "request-presence" }));
    }
  }

  async sendChatMessage(channelId: string, content: string, fileUrl?: string, fileType?: string) {
    await this.request("send-message", { channelId, content, fileUrl, fileType });
  }

  async createChannel(name: string, type: "text" | "voice") {
    return await this.request("create-channel", { name, type });
  }

  async deleteChannel(channelId: string) {
    return await this.request("delete-channel", { channelId });
  }

  private request(type: string, payload: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error("WebSocket not connected"));
      }
      const id = Math.random().toString(36).substring(7);
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, type, payload }));
    });
  }

  async leaveRoom() {
    if (this.channelId) {
      await this.request("leave-room").catch(e => console.warn("Failed to send leave-room", e));
    }
    this._cleanupLocalState();
  }

  async stopWatching() {
    useVoiceStore.getState().setActiveWatchStream(null);
    const videoConsumerEntry = Object.entries(useVoiceStore.getState().consumers).find(([, track]) => track.kind === 'video');
    if (videoConsumerEntry) {
      const [consumerId, track] = videoConsumerEntry;
      track.stop();
      useVoiceStore.getState().removeConsumer(consumerId);
      await this.request("close-consumer", { consumerId }).catch(e => console.warn(e));
    }
  }

  async joinRoom(channelId: string) {
    if (this.channelId === channelId) return;

    // Leave existing room cleanly
    if (this.channelId) {
      await this.request("leave-room").catch(e => console.warn(e));
    }
    this._cleanupLocalState();

    this.channelId = channelId;
    this.device = new Device();

    const { routerRtpCapabilities } = await this.request("join-room", { channelId });
    await this.device.load({ routerRtpCapabilities });

    const sendTransportInfo = await this.request("create-transport", { channelId });
    this.sendTransport = this.device.createSendTransport(sendTransportInfo);
    this.sendTransport.on("connect", async ({ dtlsParameters }: any, callback: Function, errback: Function) => {
      try {
        await this.request("connect-transport", { transportId: this.sendTransport.id, dtlsParameters });
        callback();
      } catch (err) { errback(err); }
    });
    this.sendTransport.on("produce", async ({ kind, rtpParameters }: any, callback: Function, errback: Function) => {
      try {
        const { id } = await this.request("produce", { transportId: this.sendTransport.id, kind, rtpParameters, channelId });
        callback({ id });
      } catch (err) { errback(err); }
    });

    const recvTransportInfo = await this.request("create-transport", { channelId });
    this.recvTransport = this.device.createRecvTransport(recvTransportInfo);
    this.recvTransport.on("connect", async ({ dtlsParameters }: any, callback: Function, errback: Function) => {
      try {
        await this.request("connect-transport", { transportId: this.recvTransport.id, dtlsParameters });
        callback();
      } catch (err) { errback(err); }
    });

    // Mark as ready and drain the queue of producers that arrived before we were ready
    this.recvTransportReady = true;
    useVoiceStore.getState().setConnected(true);
    useVoiceStore.getState().setActiveChannel(channelId);

    console.log(`[SFU] Ready. Draining ${this.pendingProducers.length} queued producers...`);
    const toConsume = [...this.pendingProducers];
    this.pendingProducers = [];
    for (const { producerId, peerId } of toConsume) {
      console.log("[SFU] Consuming queued producer from", peerId);
      await this.consume(producerId, peerId);
    }
  }

  async produceAudio() {
    if (!this.device || !this.sendTransport) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0];
      this.audioProducer = await this.sendTransport.produce({ track });

      useVoiceStore.subscribe((state) => {
        if (this.audioProducer) {
          if (state.myMicMuted && !this.audioProducer.paused) this.audioProducer.pause();
          else if (!state.myMicMuted && this.audioProducer.paused) this.audioProducer.resume();
        }
      });

      setInterval(() => {
        useVoiceStore.getState().setPeerSpeaking("me", !useVoiceStore.getState().myMicMuted && Math.random() > 0.5);
      }, 500);
    } catch (err) {
      console.error("Produce audio error:", err);
      throw err;
    }
  }

  async startScreenShare() {
    if (!this.sendTransport) throw new Error("No send transport");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } }
      });
      const track = stream.getVideoTracks()[0];
      this.videoProducer = await this.sendTransport.produce({ track, encodings: [{ maxBitrate: 8000000 }] });
      useVoiceStore.getState().setScreenSharing(true, track);
      this.videoProducer.on("trackended", () => this.stopScreenShare());
    } catch (err) {
      console.error("Screen sharing denied or failed:", err);
      throw err;
    }
  }

  async stopScreenShare() {
    if (this.videoProducer) {
      this.videoProducer.close();
      await this.request("stop-producer", { producerId: this.videoProducer.id });
      this.videoProducer = null;
    }
    useVoiceStore.getState().setScreenSharing(false, null);
  }

  async watchStream(peerId: string) {
    const producerId = useVoiceStore.getState().videoProducers[peerId];
    if (!producerId) return;
    useVoiceStore.getState().setActiveWatchStream(peerId);
    await this.consume(producerId, peerId);
  }

  async consume(producerId: string, peerId: string) {
    if (!this.device || !this.recvTransport) {
      console.warn("[SFU] consume called but device/recvTransport not ready");
      return;
    }
    try {
      console.log(`[SFU] Consuming producer ${producerId} from peer ${peerId}`);
      const { id, kind, rtpParameters } = await this.request("consume", {
        channelId: this.channelId,
        transportId: this.recvTransport.id,
        producerId,
        rtpCapabilities: this.device.rtpCapabilities
      });

      const consumer = await this.recvTransport.consume({ id, producerId, kind, rtpParameters });
      await this.request("resume-consumer", { consumerId: consumer.id });
      useVoiceStore.getState().addConsumer(consumer.id, consumer.track, peerId);
      console.log(`[SFU] ✓ Consumer added for peer ${peerId}, kind=${kind}`);

      setInterval(() => {
        useVoiceStore.getState().setPeerSpeaking(peerId, Math.random() > 0.7);
      }, 500);
    } catch (err) {
      console.error("[SFU] Could not consume track:", err);
    }
  }
}

export const sfu = new SFUClient();
