"use client";
import { useEffect, useState } from "react";
import { persistGymGradeSystem } from "@/lib/storage";

const colors = [
  "Black",
  "White",
  "Red",
  "Orange",
  "Yellow",
  "Green",
  "Blue",
  "Purple",
  "Pink",
  "Gray",
];
const grades = {
  V: Array.from({ length: 18 }, (_, i) => `V${i}`),
  Font: [
    "3",
    "4",
    "5",
    "5+",
    "6A",
    "6A+",
    "6B",
    "6B+",
    "6C",
    "6C+",
    "7A",
    "7A+",
    "7B",
    "7B+",
    "7C",
    "7C+",
    "8A",
    "8A+",
    "8B",
  ],
  Custom: [],
};
export default function ColorGradePicker({
  gym,
  color,
  grade,
  onColor,
  onGrade,
  disabled,
}: {
  gym: string;
  color: string;
  grade: string;
  onColor: (v: string) => void;
  onGrade: (v: string) => void;
  disabled?: boolean;
}) {
  const [preferenceError, setPreferenceError] = useState("");
  const [system, setSystem] = useState<keyof typeof grades>("V");
  useEffect(() => {
    const saved = localStorage.getItem(
      `bouldero-grade:${gym.trim().toLowerCase()}`,
    );
    setSystem(saved === "Font" || saved === "Custom" ? saved : "V");
  }, [gym]);
  return (
    <div className="color-grade-picker">
      {preferenceError && <p role="alert">{preferenceError}</p>}
      <fieldset disabled={disabled}>
        <legend>Color</legend>
        <div className="color-options">
          {colors.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={color.toLowerCase() === value.toLowerCase()}
              onClick={() => onColor(value)}
            >
              <i style={{ background: value.toLowerCase() }} />
              {value}
            </button>
          ))}
        </div>
        <label>
          Other color
          <input
            aria-label="Color"
            value={color}
            maxLength={40}
            required
            onChange={(e) => onColor(e.target.value)}
            placeholder="Choose above or type a color"
          />
        </label>
      </fieldset>
      <label>
        Gym grading system
        <select
          aria-label="Gym grading system"
          value={system}
          disabled={disabled}
          onChange={(e) => {
            const value = e.target.value as keyof typeof grades;
            setSystem(value);
            setPreferenceError("");
            void persistGymGradeSystem(gym, value).catch((error) =>
              setPreferenceError(error.message),
            );
          }}
        >
          <option value="V">V scale</option>
          <option value="Font">Font scale</option>
          <option value="Custom">Gym-specific / other</option>
        </select>
      </label>
      <fieldset disabled={disabled}>
        <legend>Grade</legend>
        <div className="grade-options">
          {grades[system].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={grade === value}
              onClick={() => onGrade(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <label>
          Grade
          <input
            aria-label="Grade"
            required
            maxLength={24}
            value={grade}
            onChange={(e) => onGrade(e.target.value)}
            placeholder={
              system === "Custom"
                ? "Your gym’s grade"
                : "Choose above or type a grade"
            }
          />
        </label>
      </fieldset>
    </div>
  );
}
