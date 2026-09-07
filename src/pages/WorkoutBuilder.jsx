import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Save, Plus, Trash2, GripVertical, RotateCcw, Wand2,
         ChevronUp, ChevronDown } from 'lucide-react';
import { saveCustomWorkout, LOCAL_USER_ID } from '../lib/localStore';

// Spelled the way src/lib/workout-routine.json spells them. Progression keys are
// normalized (see lib/exerciseKey.js) so "Pushups" and "Push-ups" would share a
// row either way, but matching the plan keeps the two lists reading alike.
const PRESET_EXERCISES = [
  "Push-ups", "Incline push-ups", "Decline push-ups", "Diamond push-ups",
  "Pike push-ups", "Pull-ups", "Backpack rows", "Chair dips",
  "Backpack bicep curls", "Backpack squats", "Jump squats", "Reverse lunges",
  "Bulgarian split squats", "Backpack Romanian deadlifts", "Glute bridges",
  "Single-leg calf raises", "Wall sit", "Plank", "Side plank",
  "Leg raises", "Reverse crunches", "Bird dogs", "Dead bugs",
  "Mountain climbers", "Burpees", "Jumping jacks",
];

const DEFAULT_EXERCISES = [
  { name: "Incline push-ups", reps: 10, tension: 2, reset: 0.4 },
  { name: "Jump squats", reps: 17, tension: 2, reset: 0.4 },
  { name: "Glute bridges", reps: 15, tension: 3, reset: 0.4 },
  { name: "Leg raises", reps: 11, tension: 3.5, reset: 0.6 },
  { name: "Plank", reps: 1, tension: 45, reset: 10 },
];

export default function WorkoutBuilder() {
  const navigate = useNavigate();
  const location = useLocation();
  const userId = LOCAL_USER_ID;
  
  const editingRoutine = location.state?.routine || null;

  const [routineName, setRoutineName] = useState(editingRoutine?.name || 'My Custom Routine');
  const [exercises, setExercises] = useState(editingRoutine?.exercises || [...DEFAULT_EXERCISES]);
  const [routineId, setRoutineId] = useState(editingRoutine?.id || null);
  
  // Global settings state
  const [settings, setSettings] = useState(editingRoutine?.settings || {
    sets: 3, restBetweenEx: 35, restBetweenSet: 60, prepTime: 10
  });

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [dragIdx, setDragIdx] = useState(null);

  // Smart Generator State
  const [showSmartGen, setShowSmartGen] = useState(false);
  const [smartPrompt, setSmartPrompt] = useState("");

  const addExercise = () => {
    setExercises([...exercises, { name: "Pushups", reps: 10, tension: 2, reset: 0.5 }]);
  };

  const removeExercise = (idx) => {
    setExercises(exercises.filter((_, i) => i !== idx));
  };

  const updateExercise = (idx, field, value) => {
    const updated = [...exercises];
    updated[idx] = { ...updated[idx], [field]: field === 'name' ? value : parseFloat(value) || 0 };
    setExercises(updated);
  };

  const updateSetting = (field, value) => {
    setSettings(prev => ({ ...prev, [field]: parseInt(value) || 0 }));
  };

  const handleSmartGenerate = () => {
      const p = smartPrompt.toLowerCase();
      let generated = [];

      // Local heuristic smart engine
      const isCore = p.includes('core') || p.includes('abs');
      const isLegs = p.includes('leg') || p.includes('lower');
      const isUpper = p.includes('upper') || p.includes('chest') || p.includes('arm');
      const isCardio = p.includes('hiit') || p.includes('sweat') || p.includes('intense');
      const isQuick = p.includes('quick') || p.includes('5 min');

      if (isCore) {
          generated = [
              { name: "Reverse crunches", reps: 20, tension: 1, reset: 0.5 },
              { name: "Leg raises", reps: 15, tension: 2, reset: 0.5 },
              { name: "Plank", reps: 1, tension: 60, reset: 5 },
              { name: "Mountain climbers", reps: 30, tension: 0.5, reset: 0.2 },
          ];
      } else if (isLegs) {
          generated = [
              { name: "Backpack squats", reps: 20, tension: 2, reset: 0.5 },
              { name: "Reverse lunges", reps: 24, tension: 2, reset: 0.5 },
              { name: "Glute bridges", reps: 15, tension: 3, reset: 0.5 },
              { name: "Wall sit", reps: 1, tension: 45, reset: 5 },
          ];
      } else if (isUpper) {
          generated = [
              { name: "Push-ups", reps: 15, tension: 2, reset: 0.5 },
              { name: "Diamond push-ups", reps: 10, tension: 2, reset: 0.5 },
              { name: "Chair dips", reps: 15, tension: 2, reset: 0.5 },
              { name: "Backpack rows", reps: 15, tension: 3, reset: 0.5 },
          ];
      } else if (isCardio) {
          generated = [
              { name: "Burpees", reps: 15, tension: 1.5, reset: 0.5 },
              { name: "Jumping jacks", reps: 40, tension: 1, reset: 0.2 },
              { name: "Jump squats", reps: 20, tension: 1.5, reset: 0.3 },
              { name: "Mountain climbers", reps: 40, tension: 0.5, reset: 0.2 },
          ];
          setSettings(prev => ({ ...prev, restBetweenEx: 15, sets: 4 })); // intense settings!
      } else {
          // Full body default
          generated = [...DEFAULT_EXERCISES];
      }

      if (isQuick) {
          setSettings(prev => ({ ...prev, sets: 2, restBetweenSet: 30, restBetweenEx: 20 }));
      }

      setExercises(generated);
      setShowSmartGen(false);
      setSaveMsg('✨ Routine Auto-Generated!');
      setTimeout(() => setSaveMsg(''), 3000);
  };

  const handleSave = async () => {
    if (!routineName.trim()) {
      setSaveMsg('Please enter a routine name! ❌');
      setTimeout(() => setSaveMsg(''), 3000);
      return;
    }
    setSaving(true);
    // Passing settings as the 5th argument
    const newId = await saveCustomWorkout(userId, routineId, routineName, exercises, settings);
    if (newId) setRoutineId(newId);
    setSaveMsg('Saved successfully! ✅');
    setSaving(false);
    setTimeout(() => {
        setSaveMsg('');
        navigate('/dashboard');
    }, 1500);
  };

  const resetToDefault = () => {
    setExercises([...DEFAULT_EXERCISES]);
  };

  const handleDragStart = (idx) => setDragIdx(idx);
  const handleDragOver = (e) => e.preventDefault();
  const handleDrop = (targetIdx) => {
    if (dragIdx === null || dragIdx === targetIdx) return;
    moveExercise(dragIdx, targetIdx);
    setDragIdx(null);
  };

  // The one reorder primitive. Drag-and-drop calls it with a drop target; the
  // arrow buttons call it with ±1. HTML5 drag events never fire from a touch, so
  // without the buttons the list could not be reordered on a phone at all.
  const moveExercise = (from, to) => {
    if (to < 0 || to >= exercises.length || from === to) return;
    const items = [...exercises];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    setExercises(items);
  };

  return (
    <div className="page">
      <div className="container animate-fade-up" style={{ maxWidth: '750px' }}>
        {/* Header */}
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '12px', flexWrap: 'wrap', marginBottom: '24px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
              <button className="btn btn-icon" onClick={() => navigate(-1)} aria-label="Go back">
                  <ArrowLeft size={20} />
              </button>
              <div style={{ minWidth: 0 }}>
                  <h2 style={{ marginBottom: 2 }}>{editingRoutine ? 'Edit Routine' : 'Workout Builder'}</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginBottom: 0 }}>
                      {/* The instruction differs by input device, so each half is
                          shown only where it is true. */}
                      <span className="only-pointer">Drag to reorder</span>
                      <span className="only-touch">Use the arrows to reorder</span>
                      {' · Edit global timings'}
                  </p>
              </div>
          </div>
          <button className="btn btn-accent" onClick={() => setShowSmartGen(!showSmartGen)}
                  aria-expanded={showSmartGen}>
              <Wand2 size={18} /> Smart Gen
          </button>
        </header>

        {/* Smart Generator Dropdown */}
        {showSmartGen && (
            <div className="glass-solid animate-scale-in" style={{
              marginBottom: '32px', border: '1px solid var(--accent)',
            }}>
                <h4 style={{ color: 'var(--accent-light)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Wand2 size={16} /> Smart Generation Engine
                </h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                    Describe your perfect workout, and I'll build the exercise list and configure the optimal rest times.
                </p>
                {/* Wraps to two rows on a narrow phone rather than crushing the
                    field to nothing beside the button. */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <input
                        className="input"
                        value={smartPrompt}
                        onChange={(e) => setSmartPrompt(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSmartGenerate(); }}
                        placeholder="e.g. 'A quick 10 min brutal core workout'"
                        aria-label="Describe your workout"
                        style={{ flex: '1 1 200px', minWidth: 0 }}
                    />
                    <button className="btn btn-accent" onClick={handleSmartGenerate}
                            style={{ flex: '0 0 auto' }}>
                        Generate
                    </button>
                </div>
            </div>
        )}

        {/* Routine Name Input */}
        <div style={{ marginBottom: '1.5rem' }}>
            <label className="field-label" htmlFor="routine-name">Routine Name</label>
            <input
                id="routine-name"
                type="text"
                value={routineName}
                onChange={(e) => setRoutineName(e.target.value)}
                className="input"
                style={{ fontSize: 'clamp(1rem, 4vw, 1.2rem)', fontWeight: 600, minHeight: '54px' }}
                placeholder="e.g. Morning Hiit"
            />
        </div>

        {/* Global Settings — a named grid, so 768px can drop it to two columns.
            As an inline repeat(4, 1fr) it stayed four columns at 360px and each
            field was about 60px wide. */}
        <div className="glass grid-settings" style={{ marginBottom: '2rem' }}>
            {[
              { key: 'sets', label: 'Sets', title: 'Sets per exercise', min: 1 },
              { key: 'restBetweenEx', label: 'Rest (Ex)', title: 'Rest between exercises (sec)', min: 0 },
              { key: 'restBetweenSet', label: 'Rest (Set)', title: 'Rest between sets (sec)', min: 0 },
              { key: 'prepTime', label: 'Prep Time', title: 'Initial prep time countdown (sec)', min: 0 },
            ].map((f) => (
              <div key={f.key}>
                  <label className="field-label" htmlFor={`set-${f.key}`}>{f.label}</label>
                  <input
                      id={`set-${f.key}`}
                      title={f.title}
                      type="number"
                      inputMode="numeric"
                      className="input"
                      value={settings[f.key]}
                      min={f.min}
                      onChange={(e) => updateSetting(f.key, e.target.value)}
                  />
              </div>
            ))}
        </div>

        {/* Exercise List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
          {exercises.map((ex, i) => (
            <div
              key={i}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(i)}
              onDragEnd={() => setDragIdx(null)}
              className="glass-solid builder-row"
              style={{ opacity: dragIdx === i ? 0.5 : 1, transition: 'opacity 0.2s' }}
            >
              {/* Two reorder affordances for two input devices; the CSS shows
                  exactly one. Both drive moveExercise. */}
              <GripVertical size={18} className="builder-handle only-pointer" aria-hidden="true" />
              <div className="builder-move only-touch">
                <button
                  type="button" className="builder-move-btn"
                  onClick={() => moveExercise(i, i - 1)}
                  disabled={i === 0}
                  aria-label={`Move ${ex.name} up`}
                >
                  <ChevronUp size={15} />
                </button>
                <button
                  type="button" className="builder-move-btn"
                  onClick={() => moveExercise(i, i + 1)}
                  disabled={i === exercises.length - 1}
                  aria-label={`Move ${ex.name} down`}
                >
                  <ChevronDown size={15} />
                </button>
              </div>

              <div style={{
                width: 26, height: 26, borderRadius: 'var(--radius-full)',
                background: 'var(--grad-primary)', color: 'white',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.72rem', fontWeight: 700, flexShrink: 0,
              }}>
                {i + 1}
              </div>

              <div className="builder-fields">
                <select
                  value={ex.name}
                  onChange={(e) => updateExercise(i, 'name', e.target.value)}
                  className="input"
                  aria-label={`Exercise ${i + 1}`}
                >
                  {PRESET_EXERCISES.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                  {!PRESET_EXERCISES.includes(ex.name) && (
                      <option key={ex.name} value={ex.name}>{ex.name}</option>
                  )}
                </select>
                {[
                  { field: 'reps',    label: 'Reps',      title: 'Repetitions', min: 1,   step: 1 },
                  { field: 'tension', label: 'Hold (s)',  title: 'Time under tension on the eccentric phase', min: 0.5, step: 0.5 },
                  { field: 'reset',   label: 'Reset (s)', title: 'Reset time between reps', min: 0.2, step: 0.1 },
                ].map((f) => (
                  <div key={f.field}>
                    <label className="field-label" htmlFor={`ex-${i}-${f.field}`}>{f.label}</label>
                    <input
                      id={`ex-${i}-${f.field}`}
                      title={f.title}
                      type="number"
                      // decimal, not numeric: tension and reset are fractional,
                      // and a numeric keypad on iOS has no decimal point.
                      inputMode="decimal"
                      value={ex[f.field]}
                      min={f.min}
                      step={f.step}
                      onChange={(e) => updateExercise(i, f.field, e.target.value)}
                      className="input"
                    />
                  </div>
                ))}
              </div>

              <button
                className="btn btn-icon"
                onClick={() => removeExercise(i)}
                aria-label={`Remove ${ex.name}`}
                style={{ flexShrink: 0, color: 'var(--danger)' }}
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}

          {exercises.length === 0 && (
            <p style={{
              textAlign: 'center', color: 'var(--text-muted)',
              fontSize: '0.88rem', padding: '1.5rem 0', marginBottom: 0,
            }}>
              No exercises yet — add one, load the default set, or use Smart Gen.
            </p>
          )}
        </div>

        {/* Add + Reset Buttons */}
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={addExercise} style={{ flex: '1 1 160px' }}>
            <Plus size={18} /> Add Exercise
          </button>
          {exercises.length === 0 && (
              <button className="btn btn-ghost" onClick={resetToDefault} style={{ flex: '0 1 auto' }}>
                <RotateCcw size={18} /> Default
              </button>
          )}
        </div>

        {/* Save Button */}
        <button
          className="btn btn-primary btn-lg"
          style={{ width: '100%' }}
          onClick={handleSave}
          disabled={saving || exercises.length === 0}
        >
          <Save size={20} />
          {saving ? 'Saving...' : 'Save Routine'}
        </button>

        {saveMsg && (
          /* role=status so the outcome is announced, not just coloured. */
          <p className="animate-fade-in" role="status" style={{
            textAlign: 'center', marginTop: '0.75rem', marginBottom: 0,
            color: saveMsg.includes('❌') ? 'var(--danger)' : 'var(--accent-light)',
          }}>
            {saveMsg}
          </p>
        )}
      </div>
    </div>
  );
}
