import React, { useState, useRef, useEffect } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useVoiceStore } from "../store/useVoiceStore";

interface UserVolumeControlProps {
  peerId: string;
}

export function UserVolumeControl({ peerId }: UserVolumeControlProps) {
  const { peerAudioConsumerMap, consumerStates, setConsumerVolume, setConsumerMuted } = useVoiceStore();
  const [showSlider, setShowSlider] = useState(false);
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // All hooks unconditionally at the top
  useEffect(() => {
    if (!showSlider) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSlider(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSlider]);

  const consumerId = peerAudioConsumerMap[peerId];
  if (!consumerId) return null;

  const state = consumerStates[consumerId] || { volume: 100, isMuted: false };

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!showSlider && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      // Position popup to the right of the button, vertically centered
      // Ensure it doesn't go off-screen at the bottom
      const popupHeight = 110; // approximate
      let top = rect.top + rect.height / 2;
      if (top + popupHeight / 2 > window.innerHeight - 20) {
        top = window.innerHeight - popupHeight / 2 - 20;
      }
      setPopupPos({ top, left: rect.right + 8 });
    }
    setShowSlider(!showSlider);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setConsumerVolume(consumerId, parseInt(e.target.value));
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConsumerMuted(consumerId, !state.isMuted);
  };

  return (
    <div className="relative flex items-center" ref={containerRef}>
      <button
        ref={btnRef}
        onClick={handleOpen}
        onContextMenu={(e) => { e.preventDefault(); toggleMute(e); }}
        className={`p-1 rounded hover:bg-[#404249] transition-colors ${state.isMuted ? 'text-red-500' : 'text-[#b5bac1] hover:text-[#dbdee1]'}`}
        title={state.isMuted ? "Unmute" : "Volume (Right click to mute)"}
      >
        {state.isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </button>

      {showSlider && (
        <div
          className="fixed bg-gray-900 p-3 rounded-lg shadow-2xl flex flex-col items-center gap-2 border border-[#1f2023]"
          style={{
            top: popupPos.top,
            left: popupPos.left,
            transform: "translateY(-50%)",
            zIndex: 9999,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between w-28 text-[10px] font-bold text-[#949ba4] uppercase">
            <span>Volume</span>
            <span className={state.volume > 100 ? "text-yellow-400" : ""}>{state.volume}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="200"
            value={state.volume}
            onChange={handleVolumeChange}
            onClick={(e) => e.stopPropagation()}
            className="w-28 h-1.5 bg-[#4e5058] rounded-lg appearance-none cursor-pointer accent-[#5865f2]"
          />
          <button
            onClick={toggleMute}
            className={`w-full text-[10px] font-bold py-1.5 rounded transition-colors ${state.isMuted ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-[#4e5058] text-[#dbdee1] hover:bg-[#6d6f78]'}`}
          >
            {state.isMuted ? "🔇 UNMUTE" : "🔕 MUTE"}
          </button>
        </div>
      )}
    </div>
  );
}
