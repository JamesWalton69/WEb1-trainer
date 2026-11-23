import React from 'react';
import { Maximize2, RotateCcw, Eye, Activity, Dumbbell } from 'lucide-react';

/**
 * Biomechanical HUD Overlay rendered directly over the 3D canvas
 */
export default function FormOverlayHUD({
  stats,
  exerciseName,
  onResetCamera,
  onToggleView,
  viewAngle,
  onExpand,
  compact = false,
}) {
  if (!stats) return null;

  const { elbowAngleDeg, muscleActivation, activeStep, formCue, primaryMuscle } = stats;

  return (
    <div className="exercise3d-hud" aria-hidden="true">
      {/* Top Bar: Exercise & Step Pill */}
      <div className="exercise3d-hud-top">
        <div className="exercise3d-badge-pill">
          <Dumbbell size={13} className="text-accent" />
          <span className="exercise3d-badge-text">{activeStep || exerciseName}</span>
        </div>

        <div className="exercise3d-hud-actions">
          {onToggleView && (
            <button
              type="button"
              className="exercise3d-btn-icon"
              onClick={onToggleView}
              title={`Current: ${viewAngle}. Tap to change angle (Front / Side / 45°)`}
              aria-label="Toggle camera view angle"
            >
              <Eye size={14} />
              <span className="exercise3d-btn-label">{viewAngle}</span>
            </button>
          )}

          {onResetCamera && (
            <button
              type="button"
              className="exercise3d-btn-icon"
              onClick={onResetCamera}
              title="Reset 3D camera"
              aria-label="Reset camera"
            >
              <RotateCcw size={14} />
            </button>
          )}

          {onExpand && (
            <button
              type="button"
              className="exercise3d-btn-icon"
              onClick={onExpand}
              title="Expand 3D Form Studio & Step-by-Step Breakdown"
              aria-label="Expand 3D view"
            >
              <Maximize2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Middle/Side Badge: Real-time Biomechanical Angle */}
      <div className="exercise3d-hud-readout">
        <div className="exercise3d-angle-gauge">
          <span className="exercise3d-angle-num">{elbowAngleDeg}°</span>
          <span className="exercise3d-angle-label">Elbow flex</span>
        </div>

        <div className="exercise3d-tension-gauge">
          <div className="exercise3d-tension-header">
            <Activity size={12} className="text-primary-light" />
            <span>Load</span>
            <span className="exercise3d-tension-val">{muscleActivation}%</span>
          </div>
          <div className="exercise3d-tension-track">
            <div
              className={`exercise3d-tension-fill ${muscleActivation > 75 ? 'peak-load' : ''}`}
              style={{
                '--tension-scale': Math.min(muscleActivation, 100) / 100,
              }}
            />
          </div>
        </div>
      </div>

      {/* Bottom Cue Strip */}
      {!compact && formCue && (
        <div className="exercise3d-hud-bottom">
          <div className="exercise3d-form-cue-card">
            <span className="exercise3d-form-cue-title">Form checkpoint</span>
            <p className="exercise3d-form-cue-text">{formCue}</p>
            {primaryMuscle && (
              <span className="exercise3d-muscle-tag">
                <span className="text-muted">Target:</span> {primaryMuscle}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
