"use client";

import { Volume2, VolumeX, Volume1, Volume, Minus, Plus } from "lucide-react";

interface VolumeControlsProps {
  volume: number;
  onVolumeChange: (val: number) => void;
  onVolumeStep: (delta: number) => void;
  onToggleMute: () => void;
}

export function VolumeControls({
  volume,
  onVolumeChange,
  onVolumeStep,
  onToggleMute,
}: VolumeControlsProps) {
  let VolumeIcon = Volume2;
  if (volume === 0) VolumeIcon = VolumeX;
  else if (volume < 35) VolumeIcon = Volume;
  else if (volume < 75) VolumeIcon = Volume1;

  const presets = [0, 25, 50, 75, 100];

  return (
    <div className="w-full mt-6 pt-5 border-t border-slate-800/80" aria-label="Server Master Volume Control">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <button
            onClick={onToggleMute}
            className={`p-2 rounded-xl border transition-all ${
              volume === 0
                ? "bg-rose-500/20 text-rose-300 border-rose-500/30"
                : "bg-slate-800/80 text-slate-300 border-slate-700 hover:text-white"
            }`}
            title={volume === 0 ? "Unmute Server Speaker" : "Mute Server Speaker"}
          >
            <VolumeIcon className="w-4 h-4" />
          </button>
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Server Master Volume
          </span>
        </div>
        <span className="px-2.5 py-1 rounded-lg bg-sky-500/20 text-sky-300 text-xs font-bold font-mono border border-sky-500/30">
          {volume}%
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => onVolumeStep(-5)}
          className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition-all active:scale-95"
          title="Decrease volume (-5%)"
        >
          <Minus className="w-4 h-4" />
        </button>

        <div className="relative flex-1 flex items-center">
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => onVolumeChange(parseInt(e.target.value, 10))}
            className="w-full h-2.5 rounded-lg appearance-none cursor-pointer bg-slate-800 focus:outline-none accent-sky-400"
            style={{
              background: `linear-gradient(to right, #38bdf8 0%, #818cf8 ${volume}%, #1e293b ${volume}%, #1e293b 100%)`,
            }}
          />
        </div>

        <button
          onClick={() => onVolumeStep(5)}
          className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition-all active:scale-95"
          title="Increase volume (+5%)"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-2 mt-3 overflow-x-auto pb-1">
        {presets.map((preset) => (
          <button
            key={preset}
            onClick={() => onVolumeChange(preset)}
            className={`px-3 py-1 rounded-xl text-xs font-medium border transition-all ${
              volume === preset
                ? "bg-sky-500/20 text-sky-300 border-sky-500/40"
                : "bg-slate-800/50 text-slate-400 border-slate-700/60 hover:text-white hover:bg-slate-800"
            }`}
          >
            {preset === 0 ? "Mute" : `${preset}%`}
          </button>
        ))}
      </div>
    </div>
  );
}
