import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import {
  ACCENTS,
  PAST_MODES,
  type AppearanceSettings,
} from "./settings";

interface Props {
  settings: AppearanceSettings;
  onChange: (next: AppearanceSettings) => void;
  onClose: () => void;
}

// Right-side slide-over for appearance settings, same interaction
// pattern as VocabPanel: not a modal (no overlay, no focus trap, the
// lyrics keep scrolling behind it), dismissed by Escape or a click
// outside (except on the Settings pill, which is a toggle and handles
// itself).
export default function SettingsPanel({ settings, onChange, onClose }: Props) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (target.closest("[data-settings-toggle]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  return (
    <aside
      className="settings-panel"
      role="dialog"
      aria-label="Appearance settings"
      ref={panelRef}
    >
      <div className="settings-panel-head">
        <span className="settings-panel-title">Settings</span>
        <button
          className="settings-close"
          aria-label="Close settings panel"
          onClick={onClose}
        >
          close
        </button>
      </div>
      <div className="settings-section">
        <span className="settings-label">Active line color</span>
        <div className="settings-swatches">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              className={
                settings.accent === a.id
                  ? "accent-swatch selected"
                  : "accent-swatch"
              }
              style={{ "--swatch": a.color } as CSSProperties}
              aria-pressed={settings.accent === a.id}
              aria-label={`${a.label} active line`}
              title={a.label}
              onClick={() => onChange({ ...settings, accent: a.id })}
            />
          ))}
        </div>
      </div>
      <div className="settings-section">
        <span className="settings-label">Past lines</span>
        <div className="settings-options">
          {PAST_MODES.map((m) => (
            <button
              key={m.id}
              className={
                settings.pastMode === m.id
                  ? "settings-option on"
                  : "settings-option"
              }
              aria-pressed={settings.pastMode === m.id}
              onClick={() => onChange({ ...settings, pastMode: m.id })}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="settings-hint">
          Dim fades lines already sung; bright is the original look; neutral
          matches upcoming lines.
        </span>
      </div>
    </aside>
  );
}
