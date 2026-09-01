import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { CheckCircle, XCircle, ArrowRight, ThumbsDown, Minus, ThumbsUp, Clock, Pause as PauseIcon, Dumbbell, Trophy, Activity } from 'lucide-react';
import { getRandomQuote } from '../lib/quotes';
import { logWorkoutSession, updateUserProgression, LOCAL_USER_ID } from '../lib/localStore';

export default function PostWorkout() {
  const navigate = useNavigate();
  const location = useLocation();
  const summary = location.state || {
    status: 'Unknown', active_minutes: 0, pauses: 0, last_exercise: 'None'
  };

  const userId = LOCAL_USER_ID;
  const [feedback, setFeedback] = useState(null);
  const [saved, setSaved] = useState(false);
  const [quote] = useState(getRandomQuote());
  const completed = summary.status === 'Completed';

  useEffect(() => {
    // Log session locally
    async function save() {
      await logWorkoutSession(userId, {
        status: summary.status,
        active_minutes: summary.active_minutes,
        pauses: summary.pauses,
        last_exercise: summary.last_exercise,
        feedback: feedback,
      });
      setSaved(true);
    }
    if (!saved) save();
  }, []);

  const handleFeedback = async (value) => {
    setFeedback(value);
    // Update session with feedback
    await logWorkoutSession(userId, {
      status: summary.status,
      active_minutes: summary.active_minutes,
      pauses: summary.pauses,
      last_exercise: summary.last_exercise,
      feedback: value,
      type: 'feedback_update',
    });
    // Trigger progressive workout adjustments based on feedback
    if (summary.routine) {
      await updateUserProgression(userId, summary.routine, value);
    }
  };

  return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ maxWidth: '500px', width: '100%' }}>
        {/* Status Icon */}
        <div className="animate-scale-in" style={{ textAlign: 'center', marginBottom: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {completed ? (
            <>
              <Trophy size={48} style={{ color: 'var(--accent)', marginBottom: '8px' }} />
              <h1 style={{ color: 'var(--text-primary)', fontSize: '2rem', fontWeight: 800 }}>
                Workout Complete!
              </h1>
            </>
          ) : (
            <>
              <Activity size={48} style={{ color: 'var(--warning)', marginBottom: '8px' }} />
              <h1 style={{ color: 'var(--warning)', fontSize: '2rem', fontWeight: 800 }}>Session Ended</h1>
              <p style={{ color: 'var(--text-secondary)', marginTop: '8px', fontSize: '0.95rem' }}>
                Every rep counts. You showed up, and that matters.
              </p>
            </>
          )}
        </div>

        {/* Summary Card */}
        <div className="glass animate-fade-up delay-1" style={{ marginBottom: '24px', padding: '24px' }}>
          <h3 style={{ marginBottom: '16px', fontSize: '1rem', color: 'var(--text-secondary)' }}>
            Session Summary
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Clock size={20} color="var(--accent)" />
              <div>
                <div style={{ fontWeight: 700, fontSize: '1.25rem' }}>{summary.active_minutes}m</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Active Time</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <PauseIcon size={20} color="var(--warning)" />
              <div>
                <div style={{ fontWeight: 700, fontSize: '1.25rem' }}>{summary.pauses}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Pauses</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Dumbbell size={20} color="var(--primary-light)" />
              <div>
                <div style={{ fontWeight: 700, fontSize: '1.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>{summary.last_exercise}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Last Exercise</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {completed ?
                <CheckCircle size={20} color="var(--accent)" /> :
                <XCircle size={20} color="var(--danger)" />
              }
              <div>
                <div style={{ fontWeight: 700, fontSize: '1.25rem' }}>{summary.status}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Status</div>
              </div>
            </div>
          </div>
        </div>

        {/* Adaptive Feedback */}
        <div className="glass animate-fade-up delay-2" style={{ marginBottom: '24px', textAlign: 'center', padding: '24px' }}>
          <h3 style={{ marginBottom: '8px', fontSize: '1rem' }}>How was that workout?</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '16px' }}>
            Your feedback adjusts next session's intensity
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            {[
              { value: 'easy', icon: <ThumbsDown size={20} />, label: 'Too Easy', color: 'var(--accent)' },
              { value: 'right', icon: <Minus size={20} />, label: 'Just Right', color: 'var(--primary-light)' },
              { value: 'hard', icon: <ThumbsUp size={20} />, label: 'Too Hard', color: 'var(--danger)' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => handleFeedback(opt.value)}
                className="btn"
                style={{
                  flex: 1,
                  flexDirection: 'column',
                  gap: '4px',
                  padding: '16px 8px',
                  background: feedback === opt.value
                    ? `${opt.color}15`
                    : 'rgba(255,255,255,0.03)',
                  border: feedback === opt.value
                    ? `1px solid ${opt.color}`
                    : '1px solid rgba(255,255,255,0.08)',
                  color: feedback === opt.value ? opt.color : 'var(--text-secondary)',
                  fontSize: '0.8rem',
                }}
              >
                {opt.icon}
                {opt.label}
              </button>
            ))}
          </div>
          {feedback && (
            <p className="animate-fade-in" style={{
              marginTop: '12px', color: 'var(--accent)', fontSize: '0.85rem'
            }}>
              {feedback === 'easy' && "We'll push you harder next time!"}
              {feedback === 'right' && "Perfect! Keeping the same intensity."}
              {feedback === 'hard' && "We'll ease up slightly next session."}
            </p>
          )}
        </div>

        {/* Quote */}
        <div className="animate-fade-up delay-3" style={{ marginBottom: '24px' }}>
          <div className="quote-card">
            "{quote.text}"
            <span className="quote-author">— {quote.author}</span>
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
