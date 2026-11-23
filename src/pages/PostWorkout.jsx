import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { CheckCircle, XCircle, ArrowRight, ThumbsDown, Minus, ThumbsUp, Clock, Pause as PauseIcon, Dumbbell, Trophy, Activity, Zap } from 'lucide-react';
import { getRandomQuote } from '../lib/quotes';
import { logWorkoutSession, updateUserProgression, LOCAL_USER_ID } from '../lib/localStore';

export default function PostWorkout() {
  const navigate = useNavigate();
  const location = useLocation();

  // A real arrival carries the engine's summary in history state. A reload or a
  // typed URL does not, and that distinction has to be kept: the fallback below
  // exists only so the screen can render something, and logging it would put a
  // 0-minute "Unknown" row in the history — which the server stores as
  // Incomplete, so it drags down the stats and cannot be told from a genuinely
  // abandoned workout.
  const isRealSession = Boolean(location.state);
  const summary = location.state || {
    status: 'Unknown', active_minutes: 0, pauses: 0, last_exercise: 'None'
  };

  const userId = LOCAL_USER_ID;
  const [feedback, setFeedback] = useState(null);
  const [progressionNote, setProgressionNote] = useState(null);
  const [quote] = useState(getRandomQuote());
  const completed = summary.status === 'Completed';

  // The row this screen owns, stamped by WorkoutEngine. Held in a ref so a
  // re-render cannot mint a second id for the same workout.
  const sessionIdRef = useRef(summary.id || null);
  const loggedRef = useRef(false);

  useEffect(() => {
    // Log as soon as we land, feedback or not: an interrupted workout still
    // counts, and the user may never answer the question below.
    if (loggedRef.current || !isRealSession) return;
    loggedRef.current = true;
    if (!sessionIdRef.current) {
      sessionIdRef.current = `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    logWorkoutSession(userId, {
      id: sessionIdRef.current,
      status: summary.status,
      active_minutes: summary.active_minutes,
      pauses: summary.pauses,
      last_exercise: summary.last_exercise,
      routine_name: summary.routine_name,
    });
    // Runs once per visit. `summary` comes from history state and never changes
    // while this screen is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFeedback = async (value) => {
    setFeedback(value);
    // Nothing was logged, so there is no row to attach feedback to and no
    // routine to progress. The buttons still respond; they just do not lie.
    if (!isRealSession) return;
    // Same id as the mount write, so this updates the row instead of adding one.
    await logWorkoutSession(userId, {
      id: sessionIdRef.current,
      status: summary.status,
      active_minutes: summary.active_minutes,
      pauses: summary.pauses,
      last_exercise: summary.last_exercise,
      routine_name: summary.routine_name,
      feedback: value,
    });
    // Trigger progressive workout adjustments based on feedback
    if (summary.routine) {
      const result = await updateUserProgression(userId, summary.routine, value);
      if (result?.advanced?.length) {
        setProgressionNote(`Up next: ${result.advanced.join(' · ')}`);
      }
    }
  };

  // Reloaded or opened directly: there is no session to summarise. Say so
  // plainly rather than rendering zeros that look like a real, terrible workout.
  if (!isRealSession) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="container" style={{ maxWidth: '430px' }}>
          <div className="glass animate-fade-up" style={{ textAlign: 'center' }}>
            <Activity size={40} style={{ color: 'var(--text-muted)', marginBottom: '12px' }} />
            <h1 style={{ fontSize: 'clamp(1.25rem, 6vw, 1.5rem)', fontWeight: 800, marginBottom: '8px' }}>
              No session to show
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '24px' }}>
              This page summarises a workout you have just finished. Reloading it loses
              that summary (your history is safe on the dashboard).
            </p>
            <button className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={() => navigate('/dashboard')}>
              Back to Dashboard <ArrowRight size={20} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="container" style={{ maxWidth: '520px' }}>
        {/* Status Icon */}
        <div className="animate-scale-in" style={{ textAlign: 'center', marginBottom: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {completed ? (
            <>
              <div style={{
                width: 74, height: 74, borderRadius: 'var(--radius-full)',
                background: 'var(--grad-cool)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', marginBottom: '14px',
                boxShadow: '0 0 34px rgba(15, 185, 166, 0.4)',
              }}>
                <Trophy size={38} color="#fff" />
              </div>
              <h1 className="text-gradient" style={{ fontSize: 'clamp(1.6rem, 8vw, 2.2rem)', fontWeight: 800, marginBottom: 0 }}>
                Workout Complete!
              </h1>
            </>
          ) : (
            <>
              <div style={{
                width: 74, height: 74, borderRadius: 'var(--radius-full)',
                background: 'rgba(245, 158, 11, 0.16)',
                border: '1px solid rgba(245, 158, 11, 0.4)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', marginBottom: '14px',
              }}>
                <Activity size={36} color="var(--warning)" />
              </div>
              <h1 style={{ color: 'var(--warning)', fontSize: 'clamp(1.6rem, 8vw, 2.2rem)', fontWeight: 800, marginBottom: '8px' }}>
                Session Ended
              </h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: 0 }}>
                Every rep counts. You showed up, and that matters.
              </p>
            </>
          )}
        </div>

        {/* Summary Card */}
        <div className="glass glass-topline animate-fade-up delay-1" style={{ marginBottom: '20px' }}>
          <p className="eyebrow" style={{ marginBottom: '14px' }}>Session Summary</p>
          <div className="grid-summary">
            {[
              { icon: <Clock size={20} color="var(--accent-light)" />,
                value: `${summary.active_minutes}m`, label: 'Active Time' },
              { icon: <PauseIcon size={20} color="var(--warning)" />,
                value: summary.pauses, label: 'Pauses' },
              { icon: <Dumbbell size={20} color="var(--primary-light)" />,
                value: summary.last_exercise, label: 'Last Exercise' },
              { icon: completed
                  ? <CheckCircle size={20} color="var(--accent-light)" />
                  : <XCircle size={20} color="var(--danger)" />,
                value: summary.status, label: 'Status' },
            ].map((f) => (
              <div key={f.label} className="summary-figure">
                {f.icon}
                <div>
                  {/* title so a name the ellipsis eats is still readable. */}
                  <div className="summary-value" title={String(f.value)}>{f.value}</div>
                  <div className="summary-label">{f.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Adaptive Feedback */}
        <div className="glass animate-fade-up delay-2" style={{ marginBottom: '20px', textAlign: 'center' }}>
          <h3 style={{ marginBottom: '6px', fontSize: '1rem' }}>How was that workout?</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '16px' }}>
            Your feedback adjusts next session’s intensity
          </p>
          {/* radiogroup, not three loose buttons: it is one choice, and a screen
              reader should say which of the three is taken. */}
          <div className="grid-feedback" role="radiogroup" aria-label="How was that workout?">
            {[
              { value: 'easy',  icon: <ThumbsDown size={20} />, label: 'Too Easy',   colour: 'var(--accent-light)', rgb: '45, 224, 200' },
              { value: 'right', icon: <Minus size={20} />,      label: 'Just Right', colour: 'var(--primary-light)', rgb: '132, 121, 255' },
              { value: 'hard',  icon: <ThumbsUp size={20} />,   label: 'Too Hard',   colour: 'var(--danger)', rgb: '244, 63, 94' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => handleFeedback(opt.value)}
                className={`btn feedback-btn${feedback === opt.value ? ' is-picked' : ''}`}
                role="radio"
                aria-checked={feedback === opt.value}
                style={{ '--fb': opt.colour, '--fb-rgb': opt.rgb }}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>
          {feedback && (
            <p className="animate-fade-in" role="status" style={{
              marginTop: '14px', marginBottom: 0,
              color: 'var(--accent-light)', fontSize: '0.85rem',
            }}>
              {feedback === 'easy' && "We'll push you harder next time!"}
              {feedback === 'right' && "Perfect! Keeping the same intensity."}
              {feedback === 'hard' && "We'll ease up slightly next session."}
            </p>
          )}
          {progressionNote && (
            <p className="animate-fade-in" role="status" style={{
              marginTop: '6px', marginBottom: 0,
              color: 'var(--warning)', fontSize: '0.85rem', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
            }}>
              <Zap size={14} /> {progressionNote}
            </p>
          )}
        </div>

        {/* Quote */}
        <div className="animate-fade-up delay-3" style={{ marginBottom: '20px' }}>
          <div className="quote-card">
            "{quote.text}"
            <span className="quote-author">({quote.author})</span>
          </div>
        </div>

        {/* Continue Button */}
        <button
          className="btn btn-primary btn-lg animate-fade-up delay-4"
          style={{ width: '100%' }}
          onClick={() => navigate('/dashboard')}
        >
          Back to Dashboard <ArrowRight size={20} />
        </button>
      </div>
    </div>
  );
}
