import { useEffect, useRef } from "react";
import { useVoiceStore } from "../store/useVoiceStore";

export function AudioPlayer({ isDeafened }: { isDeafened: boolean }) {
  const { consumers, consumerStates } = useVoiceStore();
  const audioTracks = Object.entries(consumers).filter(([_, track]) => track.kind === 'audio');

  return (
    <>
      {audioTracks.map(([id, track]) => {
        const state = consumerStates[id] || { volume: 100, isMuted: false };
        return (
          <ConsumerAudio 
            key={id} 
            track={track} 
            globalMuted={isDeafened} 
            userMuted={state.isMuted} 
            volume={state.volume} 
          />
        );
      })}
    </>
  );
}

function ConsumerAudio({ 
  track, 
  globalMuted, 
  userMuted, 
  volume 
}: { 
  track: MediaStreamTrack; 
  globalMuted: boolean; 
  userMuted: boolean; 
  volume: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Setup audio stream when track changes
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !track) return;
    el.srcObject = new MediaStream([track]);
    return () => {
      el.srcObject = null;
    };
  }, [track]);

  // Apply volume/mute changes
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const shouldMute = globalMuted || userMuted;
    el.muted = shouldMute;

    if (shouldMute) {
      // Muted — no need to set volume
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.value = 0;
      }
      return;
    }

    if (volume <= 100) {
      // Simple HTML5 volume — most compatible approach
      el.volume = volume / 100;
      // If we had a gain node from before, reset it to 1
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.value = 1;
      }
    } else {
      // Volume > 100%: use Web Audio GainNode
      el.volume = 1; // Max out element volume
      
      if (!audioCtxRef.current) {
        // Create context lazily only when needed
        const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
        const ctx = new AudioContextClass();
        audioCtxRef.current = ctx;

        const source = ctx.createMediaElementSource(el);
        const gainNode = ctx.createGain();
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        gainNodeRef.current = gainNode;

        if (ctx.state === 'suspended') {
          ctx.resume().catch(console.error);
        }
      }

      if (gainNodeRef.current) {
        gainNodeRef.current.gain.value = volume / 100;
      }
    }
  }, [volume, globalMuted, userMuted]);

  // Cleanup Web Audio context on unmount
  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
        gainNodeRef.current = null;
      }
    };
  }, []);

  return (
    <audio
      ref={audioRef}
      autoPlay
      playsInline
      style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
    />
  );
}
