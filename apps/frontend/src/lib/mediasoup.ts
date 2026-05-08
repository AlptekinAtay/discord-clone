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

  async connect(wsUrl: string) {
    if (this.ws) return; // Already connected
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
            // Global state of who is in which channel
            useVoiceStore.getState().setChannelPeers(payload.channels);
            useVoiceStore.getState().setGlobalLivePeers(payload.livePeers);
            if (payload.users) {
              useVoiceStore.getState().setChannelUsers(payload.users);
            }
            if (payload.globalOnlineUsers) {
              useVoiceStore.getState().setGlobalOnlineUsers(payload.globalOnlineUsers);
            }
            break;
          case "channels-updated":
            // Global channel list update
            // We need a way to notify the UI about this. 
            // I'll add a listener or just a callback property.
            if (this.onChannelsUpdated) this.onChannelsUpdated(payload.channels);
            break;
          case "new-producer":
            useVoiceStore.getState().addPeer(payload.peerId);
            if (payload.kind === 'video') {
              useVoiceStore.getState().addVideoProducer(payload.peerId, payload.producerId);
            } else {
              await this.consume(payload.producerId);
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
          // --- CHAT LOGIC ---
          case "new-message": {
            const msg = payload.author
              ? { ...payload.message, author: payload.author }
              : payload.message;
            useChatStore.getState().addMessage(msg);
            break;
          }
          // channel-messages is handled via request() resolve — no push case needed
          // --- CHAT LOGIC ---
        }
      };

      this.ws!.onerror = reject;
      
      this.ws!.onclose = () => {
        useVoiceStore.getState().setConnected(false);
        this.ws = null;
      };
    });
  }

  // --- CHAT LOGIC ---
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  async fetchChannelMessages(channelId: string) {
    try {
      const payload = await this.request("get-messages", { channelId });
      if (payload?.messages) {
        useChatStore.getState().setMessages(channelId, payload.messages);
      }
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
  // ------------------

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
    
    if (this.audioProducer) this.audioProducer.close();
    if (this.videoProducer) this.videoProducer.close();
    if (this.sendTransport) this.sendTransport.close();
    if (this.recvTransport) this.recvTransport.close();
    
    this.audioProducer = null;
    this.videoProducer = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
    this.channelId = null;
    useVoiceStore.getState().clearPeers();
    useVoiceStore.getState().setActiveChannel(null);
    useVoiceStore.getState().setScreenSharing(false, null);
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
    
    await this.leaveRoom(); // Clean up old room if any
    
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

    useVoiceStore.getState().setConnected(true);
    useVoiceStore.getState().setActiveChannel(channelId);
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
      
      this.videoProducer = await this.sendTransport.produce({ 
        track, 
        encodings: [{ maxBitrate: 8000000 }] 
      });
      
      useVoiceStore.getState().setScreenSharing(true, track);
      
      this.videoProducer.on("trackended", () => {
        this.stopScreenShare();
      });
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
    await this.consume(producerId);
  }

  async consume(producerId: string) {
    if (!this.device || !this.recvTransport) return;

    try {
      const { id, kind, rtpParameters } = await this.request("consume", {
        channelId: this.channelId,
        transportId: this.recvTransport.id,
        producerId,
        rtpCapabilities: this.device.rtpCapabilities
      });

      const consumer = await this.recvTransport.consume({
        id,
        producerId,
        kind,
        rtpParameters
      });

      await this.request("resume-consumer", { consumerId: consumer.id });
      useVoiceStore.getState().addConsumer(consumer.id, consumer.track);

      setInterval(() => {
        useVoiceStore.getState().setPeerSpeaking(producerId, Math.random() > 0.7);
      }, 500);
    } catch (err) {
      console.warn("Could not consume track:", err);
    }
  }
}

export const sfu = new SFUClient();
