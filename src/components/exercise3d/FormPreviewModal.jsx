import React, { useState, useEffect } from 'react';
import { X, Play, Pause, ChevronRight, ChevronLeft, ShieldCheck, AlertCircle, Dumbbell, Sparkles } from 'lucide-react';
import ExerciseCanvas3D from './ExerciseCanvas3D';
import { EXERCISE_STEP_GUIDES, resolveKinematicFamily } from './kinematics';

export default function FormPreviewModal({
  isOpen,
  onClose,
  initialExercise = 'Backpack curls',
}) {
  const [prevInitial, setPrevInitial] = useState(initialExercise);
  const [selectedExercise, setSelectedExercise] = useState(initialExercise);
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [isDemoPlaying, setIsDemoPlaying] = useState(true);
  const [demoPhase, setDemoPhase] = useState('REP 1: DOWN');
  const [demoCountdown, setDemoCountdown] = useState(3);
  const [demoCountdownMax, setDemoCountdownMax] = useState(3);

  // Sync initial exercise when prop changes (React recommended pattern)
  if (initialExercise !== prevInitial) {
    setPrevInitial(initialExercise);
    setSelectedExercise(initialExercise);
    setActiveStepIdx(0);
  }

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const family = resolveKinematicFamily(selectedExercise);
  const stepGuide = EXERCISE_STEP_GUIDES[family] || EXERCISE_STEP_GUIDES.curl;

  // Automated demonstration timer in modal
  useEffect(() => {
    if (!isOpen || !isDemoPlaying) return;

    let timer;
    if (demoPhase.includes('DOWN')) {
      timer = setTimeout(() => {
        setDemoPhase('UP');
        setDemoCountdown(1.5);
        setDemoCountdownMax(1.5);
      }, 3000);
    } else {
      timer = setTimeout(() => {
        setDemoPhase('REP 1: DOWN');
        setDemoCountdown(3);
        setDemoCountdownMax(3);
      }, 1500);
    }

    return () => clearTimeout(timer);
  }, [isOpen, isDemoPlaying, demoPhase]);

  if (!isOpen) return null;

  const currentStep = stepGuide[activeStepIdx] || stepGuide[0];

  const handleStepSelect = (idx) => {
    setActiveStepIdx(idx);
    setIsDemoPlaying(false);
    // When manually selecting a step, set representative phase
    if (idx === 0) {
      setDemoPhase('GET READY');
      setDemoCountdown(0);
      setDemoCountdownMax(1);
    } else if (idx === 1 || idx === 2) {
      setDemoPhase('UP');
      setDemoCountdown(idx === 2 ? 0.1 : 0.7);
      setDemoCountdownMax(1.5);
    } else {
      setDemoPhase('REP 1: DOWN');
      setDemoCountdown(1.5);
      setDemoCountdownMax(3);
    }
  };

  return (
    <div className="exercise3d-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="exercise3d-modal-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="exercise3d-modal-header">
          <div className="exercise3d-modal-title-group">
            <h2 className="exercise3d-modal-title">{selectedExercise} form guide</h2>
          </div>

          <button
            onClick={onClose}
            className="btn btn-icon"
            aria-label="Close form guide"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="exercise3d-modal-body">
          {/* Main 3D Viewport */}
          <div className="exercise3d-modal-canvas-wrap">
            <ExerciseCanvas3D
              exerciseName={selectedExercise}
              phase={demoPhase}
              countdown={demoCountdown}
              countdownMax={demoCountdownMax}
              paused={!isDemoPlaying}
              height="340px"
            />

            {/* Viewport Play / Pause demo strip */}
            <div className="exercise3d-modal-playback-bar">
              <button
                type="button"
                className="btn btn-ghost exercise3d-playback-btn"
                onClick={() => setIsDemoPlaying((v) => !v)}
              >
                {isDemoPlaying ? <Pause size={16} /> : <Play size={16} />}
                <span>{isDemoPlaying ? 'Pause Live Cadence' : 'Resume Auto Cadence'}</span>
              </button>

              <span className="exercise3d-modal-drag-tip">
                Drag to rotate 360°, scroll to zoom
              </span>
            </div>
          </div>

          {/* Interactive Step-by-Step Navigation */}
          <div className="exercise3d-steps-container">
            <div className="exercise3d-steps-header">
              <span className="exercise3d-section-label">Movement breakdown</span>
              <span className="exercise3d-step-counter">
                Step {activeStepIdx + 1} of {stepGuide.length}
              </span>
            </div>

            <div className="exercise3d-step-pills">
              {stepGuide.map((step, idx) => (
                <button
                  key={step.step}
                  type="button"
                  onClick={() => handleStepSelect(idx)}
                  className={`exercise3d-step-pill ${activeStepIdx === idx ? 'active' : ''}`}
                >
                  <span className="exercise3d-step-num">{step.step}</span>
                  <span className="exercise3d-step-name">{step.title}</span>
                </button>
              ))}
            </div>

            {/* Active Step Details Card */}
            <div className="exercise3d-step-detail-card">
              <div className="exercise3d-step-detail-header">
                <ShieldCheck size={18} className="text-accent" />
                <h4 className="exercise3d-step-detail-title">{currentStep.title}</h4>
              </div>
              <p className="exercise3d-step-detail-cue">{currentStep.cue}</p>
              <div className="exercise3d-step-detail-meta">
                <span className="exercise3d-detail-target">
                  <span className="text-muted">Target:</span> {currentStep.muscleTarget}
                </span>
              </div>
            </div>

            {/* Common Mistakes to Avoid */}
            <div className="exercise3d-mistakes-card">
              <div className="exercise3d-mistakes-header">
                <AlertCircle size={16} className="text-warning" />
                <span>Mistakes to avoid</span>
              </div>
              <ul className="exercise3d-mistakes-list">
                <li>Never swing your torso or lean back to hoist the weight up.</li>
                <li>Keep upper arms completely stationary glued to your sides.</li>
                <li>Do not rush the lowering phase; the 3-second negative drives 50%+ of muscle growth.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="exercise3d-modal-footer">
          <button
            onClick={onClose}
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
          >
            Close guide
          </button>
        </div>
      </div>
    </div>
  );
}
