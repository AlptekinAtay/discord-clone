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
  private pendingProducers: Array<{ producerId: string; peerId: string; appData?: any }> = [];
  private connectionPromise: Promise<void> | null = null;

  async connect(wsUrl: string): Promise<void> {
    // If already open, just resolve
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    // If currently connecting, return the existing promise
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING && this.connectionPromise) {
      return this.connectionPromise;
    }

    // Otherwise, start a new connection
    this.connectionPromise = new Promise<void>((resolve, reject) => {
      console.log("[SFU] Connecting to", wsUrl);
      this.ws = new WebSocket(wsUrl);

      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
        this.ws?.close();
      }, 10000);

      this.ws.onopen = () => {
        console.log("[SFU] WebSocket connected, waiting for READY...");
      };

      this.ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        const { type, payload, id } = data;

        // Handle requests (ACKs)
        if (id && this.pendingRequests.has(id)) {
          clearTimeout(timeout);
          const { resolve: reqResolve, reject: reqReject } = this.pendingRequests.get(id)!;
          if (data.error) reqReject(new Error(data.error));
          else reqResolve(payload);
          this.pendingRequests.delete(id);
          return;
        }

        // Handle events
        switch (type) {
          case "READY":
            clearTimeout(timeout);
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
            
            const isScreenAudio = payload.appData?.source === 'screen-audio';
            const isScreenVideo = payload.appData?.source === 'screen-video' || payload.kind === 'video';

            if (isScreenVideo) {
              useVoiceStore.getState().addVideoProducer(payload.peerId, payload.producerId);
              console.log("[SFU] Screen video producer discovered (WATCH only)");
            } else if (isScreenAudio) {
              useVoiceStore.getState().addScreenAudioProducer(payload.peerId, payload.producerId);
              console.log("[SFU] Screen audio producer discovered (WATCH only)");
            } else if (this.recvTransportReady) {
              // Auto-consume microphone ONLY
              await this.consume(payload.producerId, payload.peerId, payload.appData);
            } else {
              console.log("[SFU] Queuing microphone producer for", payload.peerId);
              this.pendingProducers.push({ 
                producerId: payload.producerId, 
                peerId: payload.peerId,
                appData: payload.appData
              });
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
          case "producer-closed": {
            const { consumerId, peerId } = payload;
            const track = useVoiceStore.getState().consumers[consumerId];
            if (track) {
              console.log(`[SFU] Track stopped for consumer ${consumerId}`);
              track.stop();
            }
            useVoiceStore.getState().removeConsumer(consumerId);
            useVoiceStore.getState().removeVideoProducer(peerId);
            useVoiceStore.getState().removeScreenAudioProducer(peerId);
            
            // Fix ghost streams: if the stopped producer was being watched, clear state
            if (useVoiceStore.getState().activeWatchStream === peerId) {
              useVoiceStore.getState().stopWatching();
            }
            break;
          }
          case "new-message": {
            const msg = payload.author
              ? { ...payload.message, author: payload.author }
              : payload.message;
            useChatStore.getState().addMessage(msg);
            break;
          }
        }
      };

      this.ws.onerror = (err) => {
        clearTimeout(timeout);
        console.error("[SFU] WebSocket error:", err);
        this.connectionPromise = null;
        reject(err);
      };

      this.ws.onclose = () => {
        clearTimeout(timeout);
        console.log("[SFU] WebSocket closed — cleaning up client state");
        useVoiceStore.getState().setConnected(false);
        this._cleanupLocalState();
        this.ws = null;
        this.connectionPromise = null;
      };
    });

    return this.connectionPromise;
  }

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
    const peerId = useVoiceStore.getState().activeWatchStream;
    if (!peerId) return;

    console.log(`[SFU] Stopping watch for peer ${peerId}`);
    useVoiceStore.getState().setActiveWatchStream(null);
    
    const { consumers, consumerPeerMap } = useVoiceStore.getState();
    
    for (const [cid, track] of Object.entries(consumers)) {
      const pid = consumerPeerMap[cid];
      if (pid === peerId) {
        const isVideo = track.kind === 'video';
        const isScreenAudio = (track as any).appData?.type === 'screen';
        
        if (isVideo || isScreenAudio) {
          console.log(`[SFU] Closing broadcast consumer ${cid} for peer ${peerId}`);
          track.stop();
          useVoiceStore.getState().removeConsumer(cid);
          await this.request("close-consumer", { consumerId: cid }).catch(e => console.warn(e));
        }
      }
    }
  }

  async joinRoom(channelId: string) {
    if (this.channelId === channelId) return;

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
    this.sendTransport.on("produce", async ({ kind, rtpParameters, appData }: any, callback: Function, errback: Function) => {
      try {
        const { id } = await this.request("produce", { 
          transportId: this.sendTransport!.id, 
          kind, 
          rtpParameters, 
          channelId,
          appData 
        });
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

    this.recvTransportReady = true;
    useVoiceStore.getState().setConnected(true);
    useVoiceStore.getState().setActiveChannel(channelId);

    console.log(`[SFU] Ready for ${channelId}. Draining ${this.pendingProducers.length} queued producers...`);
    const toConsume = [...this.pendingProducers];
    this.pendingProducers = [];
    for (const { producerId, peerId, appData } of toConsume) {
      console.log("[SFU] Consuming queued producer from", peerId);
      await this.consume(producerId, peerId, appData);
    }
  }

  async produceAudio() {
    if (!this.device || !this.sendTransport) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true, 
          autoGainControl: true 
        } 
      });
      const track = stream.getAudioTracks()[0];
      this.audioProducer = await this.sendTransport.produce({ 
        track,
        appData: { source: 'mic' },
        codecOptions: {
          opusDtx: false
        }
      });

      useVoiceStore.subscribe((state) => {
        if (this.audioProducer) {
          if (state.myMicMuted && !this.audioProducer.paused) this.audioProducer.pause();
          else if (!state.myMicMuted && this.audioProducer.paused) this.audioProducer.resume();
        }
      });
    } catch (err) {
      console.error("Produce audio error:", err);
      throw err;
    }
  }

  async startScreenShare() {
    if (!this.sendTransport) throw new Error("No send transport");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
        audio: true
      });
      
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      this.videoProducer = await this.sendTransport.produce({ 
        track: videoTrack, 
        appData: { source: 'screen-video' },
        encodings: [{ maxBitrate: 8000000 }] 
      });

      let screenAudioProducer = null;
      if (audioTrack) {
        screenAudioProducer = await this.sendTransport.produce({
          track: audioTrack,
          appData: { source: 'screen-audio' }
        });
      }
      
      useVoiceStore.getState().setScreenSharing(true, videoTrack);
      
      videoTrack.onended = () => this.stopScreenShare();
      if (audioTrack) audioTrack.onended = () => this.stopScreenShare();

      // Store producers to close them later
      (this as any).screenAudioProducer = screenAudioProducer;
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
    if ((this as any).screenAudioProducer) {
      const p = (this as any).screenAudioProducer;
      p.close();
      await this.request("stop-producer", { producerId: p.id });
      (this as any).screenAudioProducer = null;
    }
    useVoiceStore.getState().setScreenSharing(false, null);
  }

  async watchStream(peerId: string) {
    const videoProducerId = useVoiceStore.getState().videoProducers[peerId];
    const screenAudioProducerId = useVoiceStore.getState().screenAudioProducers[peerId];
    
    if (!videoProducerId) return;

    // Stop current watch if any to clean up previous tracks
    await this.stopWatching();

    useVoiceStore.getState().setActiveWatchStream(peerId);
    
    // Consume video
    await this.consume(videoProducerId, peerId, { source: 'screen-video' });

    // Consume screen audio if it exists
    if (screenAudioProducerId) {
      console.log("[SFU] Also consuming screen audio for broadcast");
      await this.consume(screenAudioProducerId, peerId, { source: 'screen-audio' });
    }
  }

  async consume(producerId: string, peerId: string, appData: any = {}) {
    // Prevent self-consumption to avoid echo
    const myPeerId = useVoiceStore.getState().myPeerId;
    if (peerId === myPeerId) {
      console.log("[SFU] Skipping self-consumption for producer:", producerId);
      return;
    }

    if (!this.device || !this.recvTransport) {
      console.warn("[SFU] consume called but device/recvTransport not ready");
      return;
    }
    try {
      console.log(`[SFU] Consuming producer ${producerId} from peer ${peerId}, type=${appData?.type}`);
      const { id, kind, rtpParameters } = await this.request("consume", {
        channelId: this.channelId,
        transportId: this.recvTransport.id,
        producerId,
        rtpCapabilities: this.device.rtpCapabilities
      });

      const consumer = await this.recvTransport.consume({ id, producerId, kind, rtpParameters });
      console.log(`[SFU] Consumer created locally: ${consumer.id}, kind: ${kind}`);
      
      (consumer.track as any).appData = appData; // Store appData in track for VoiceStore to see

      await this.request("resume-consumer", { consumerId: consumer.id });
      console.log(`[SFU] Consumer resumed on server: ${consumer.id}`);

      useVoiceStore.getState().addConsumer(consumer.id, consumer.track, peerId);
      console.log(`[SFU] ✓ Consumer added to store for peer ${peerId}, kind=${kind}, trackState=${consumer.track.readyState}`);
    } catch (err) {
      console.error("[SFU] Could not consume track:", err);
    }
  }
}

export const sfu = new SFUClient();
