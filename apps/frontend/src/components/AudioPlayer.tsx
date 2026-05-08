import { useEffect, useRef } from "react";
import { useVoiceStore } from "../store/useVoiceStore";

export function AudioPlayer({ isDeafened }: { isDeafened: boolean }) {
  const consumers = useVoiceStore((state) => state.consumers);
  const audioTracks = Object.entries(consumers).filter(([_, track]) => track.kind === 'audio');

  return (
    <>
      {audioTracks.map(([id, track]) => (
        <ConsumerAudio key={id} track={track} muted={isDeafened} />
      ))}
    </>
  );
}

function ConsumerAudio({ track, muted }: { track: MediaStreamTrack; muted: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current && track) {
      audioRef.current.srcObject = new MediaStream([track]);
    }
  }, [track]);

  // Reflect deafen state via the muted attribute
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = muted;
    }
  }, [muted]);

  return <audio ref={audioRef} autoPlay playsInline style={{ display: "none" }} />;
}
