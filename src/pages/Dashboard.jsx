import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play, PlusCircle, Activity, Calendar, Flame,
  TrendingUp, Zap, Award, Edit2, Trash2, Dumbbell, X,
  Trophy, Shield, Clock, CheckCircle2, Star
} from 'lucide-react';

const BADGE_ICONS = {
  first_workout: <Award size={22} />,
  streak_3: <Flame size={22} />,
  streak_7: <Zap size={22} />,
  streak_30: <Trophy size={22} />,
  sessions_10: <Dumbbell size={22} />,
  sessions_50: <Shield size={22} />,
  minutes_60: <Clock size={22} />,
  minutes_500: <Activity size={22} />,
  no_pause: <CheckCircle2 size={22} />,
  level_5: <Star size={22} />
};
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { getDailyQuote } from '../lib/quotes';
import {
  getWorkoutHistory, computeStats, computeBadges,
  buildChartData, buildStreakCalendar, getCustomWorkouts, deleteCustomWorkout,
  getUserProgression, getDisplayName, setDisplayName, LOCAL_USER_ID
} from '../lib/localStore';
import { weeklyCalisthenicsPlan, resolveWeeklyPlanDay, applyProgression, getProgressionDisplayList } from '../lib/weeklyPlan';

export default function Dashboard() {
  const navigate = useNavigate();
  // No accounts. The display name is the one preference there is; it syncs
  // through the server's profile table so a second device knows it too. Held in
  // state rather than read from localStorage during render, so renaming does
  // not need a page reload.
  const [userName, setUserName] = useState('Athlete');
  const userId = LOCAL_USER_ID;
  const dailyQuote = getDailyQuote();

  const [stats, setStats] = useState(null);
  const [badges, setBadges] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [streakCells, setStreakCells] = useState([]);
  const [customRoutines, setCustomRoutines] = useState([]);
  const [progressionModifiers, setProgressionModifiers] = useState({});
  const [loading, setLoading] = useState(true);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const weekdayIds = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const todayPlan = resolveWeeklyPlanDay(weekdayIds[new Date().getDay()]);

  useEffect(() => {
    async function loadData() {
      try {
          const name = await getDisplayName();
          if (name) setUserName(name);
          const sessions = await getWorkoutHistory(userId);
          const computedStats = computeStats(sessions);
          const computedBadges = computeBadges(computedStats, sessions);
          const chart = buildChartData(sessions);
          const calendar = buildStreakCalendar(computedStats.completedDates);
          const routines = await getCustomWorkouts(userId);
          const progression = await getUserProgression(userId);
    
          setStats(computedStats);
          setBadges(computedBadges);
          setChartData(chart);
          setStreakCells(calendar);
          setCustomRoutines(routines);
          setProgressionModifiers(progression);
      } catch (err) {
          console.error("Dashboard failed to load:", err);
      } finally {
          setLoading(false);
      }
    }
    loadData();
  }, [userId]);

  const handleChangeName = () => {
    const next = window.prompt('Display name', userName === 'Athlete' ? '' : userName);
    if (next === null) return;
    // Writes locally, queues the push, and returns the cleaned value. No
    // reload: the greeting is state now.
    setUserName(setDisplayName(next) || 'Athlete');
  };

  const handleDeleteRoutine = async (e, routineId) => {
      e.stopPropagation();
      if (!window.confirm('Delete this routine?')) return;
      await deleteCustomWorkout(userId, routineId);
      setCustomRoutines(customRoutines.filter(r => r.id !== routineId));
  };

  const handleStartPlanDay = (dayPlan) => {
      if (dayPlan.isRestDay) return;
      const progressedRoutine = applyProgression(dayPlan.executableRoutine, progressionModifiers);
      navigate('/workout', {
          state: {
              routine: progressedRoutine,
              routineName: `${weeklyCalisthenicsPlan.title} · ${dayPlan.label} · ${dayPlan.focus}`,
              routineSettings: dayPlan.routineSettings,
              warmUpMinutes: dayPlan.warmUpMinutes,
              warmup: dayPlan.warmup,
          }
      });
  };

  const firstName = userName.split(' ')[0];
  const weeklyGoal = 150;
  const weeklyProgress = stats ? Math.min((stats.weeklyMinutes / weeklyGoal) * 100, 100) : 0;
  const circumference = 2 * Math.PI * 52;
  const dashOffset = circumference - (weeklyProgress / 100) * circumference;

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: '1100px' }}>
        {/* HEADER */}
        <header className="animate-fade-up" style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: '12px', marginBottom: '1.5rem', flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0 }}>
            <div className="avatar" style={{
              background: 'var(--grad-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.25rem', fontWeight: 800, color: 'white',
            }}>
              {firstName[0]?.toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <p className="eyebrow" style={{ marginBottom: '2px' }}>
                {new Date().toLocaleDateString(undefined, { weekday: 'long' })}
              </p>
              <h2 style={{
                marginBottom: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                Hey, <span className="text-gradient">{firstName}</span>
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 0 }}>
                {loading ? 'Loading progress…' : `Level ${stats?.level || 1} · ${stats?.streak || 0} day streak`}
              </p>
            </div>
          </div>
          <button
            className="btn btn-ghost"
            onClick={handleChangeName}
            aria-label="Change your display name"
          >
            <Edit2 size={18} /> Name
          </button>
        </header>

        {/* DAILY QUOTE */}
        <div className="animate-fade-up delay-1">
          <div className="quote-card" style={{ marginBottom: '1.5rem' }}>
            "{dailyQuote.text}"
            <span className="quote-author">— {dailyQuote.author}</span>
          </div>
        </div>

        {/* PROGRESS RING AND STATS */}
        <div className="grid-stats animate-fade-up delay-2" style={{ marginBottom: '1.5rem' }}>
          <div className="glass stat-hero" style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gridRow: 'span 2',
          }}>
            <div className="countdown-container">
              <svg width="130" height="130" className="progress-ring" aria-hidden="true">
                <circle className="progress-ring__circle-bg" cx="65" cy="65" r="52" strokeWidth="9" />
                <circle
                  className="progress-ring__circle"
                  cx="65" cy="65" r="52" strokeWidth="9"
                  stroke="url(#progressGradient)"
                  strokeDasharray={circumference}
                  strokeDashoffset={loading ? circumference : dashOffset}
                />
                <defs>
                  <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#8479FF" />
                    <stop offset="100%" stopColor="#0FB9A6" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="countdown-text" style={{ fontSize: '1.35rem' }}>
                {loading ? '…' : `${Math.round(weeklyProgress)}%`}
              </div>
            </div>
            <p className="eyebrow" style={{ marginTop: '0.75rem' }}>Weekly Goal</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 0, fontWeight: 600 }}>
              {loading ? '…' : `${Math.round(stats?.weeklyMinutes || 0)} / ${weeklyGoal} min`}
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: 0 }}>
              {loading ? '' : 'last 7 days'}
            </p>
          </div>

          {[
            { cls: 'stat-purple', icon: <Zap size={22} color="var(--primary-light)" />, tint: 'rgba(91, 75, 245, 0.18)',
              value: loading ? '—' : (stats?.level || 1), label: 'Level' },
            { cls: 'stat-pink', icon: <Flame size={22} color="var(--danger)" />, tint: 'rgba(244, 63, 94, 0.18)',
              value: loading ? '—' : `${stats?.streak || 0}d`, label: 'Streak' },
            { cls: 'stat-green', icon: <Activity size={22} color="var(--accent-light)" />, tint: 'rgba(15, 185, 166, 0.18)',
              value: loading ? '—' : `${Math.round(stats?.totalMinutes || 0)}m`, label: 'Total Active' },
            { cls: 'stat-orange', icon: <Calendar size={22} color="var(--warning)" />, tint: 'rgba(245, 158, 11, 0.18)',
              value: loading ? '—' : (stats?.totalSessions || 0),
              // "Sessions" counts finished workouts while "Total Active" counts
              // every minute trained, so the two tiles disagree unless the
              // partial ones are named.
              label: !loading && stats?.incompleteSessions > 0
                ? `Sessions · +${stats.incompleteSessions} partial`
                : 'Sessions' },
          ].map((tile) => (
            <div key={tile.cls} className={`glass stat-card ${tile.cls}`} style={{
              display: 'flex', alignItems: 'center', gap: '0.85rem',
            }}>
              <div style={{
                width: 44, height: 44, flexShrink: 0, borderRadius: 'var(--radius-md)',
                background: tile.tint, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {tile.icon}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="stat-value">{tile.value}</div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.76rem', marginBottom: 0 }}>
                  {tile.label}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* CUSTOM ROUTINES SECTION */}
        <div className="animate-fade-up delay-3" style={{ marginBottom: '2rem' }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: '12px', marginBottom: '1rem', flexWrap: 'wrap',
          }}>
              <h3 style={{ marginBottom: 0 }}>
                <Dumbbell size={20} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: 'var(--primary-light)' }} />
                Your Routines
              </h3>
              <button className="btn btn-ghost" onClick={() => navigate('/build')}>
                  <PlusCircle size={16} /> Create New
              </button>
          </div>

          <div className="grid-routines">
              {/* Default Quick Start */}
              <div className="glass glass-topline" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                      <h4 style={{ fontSize: '1.05rem', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-light)' }}>
                        <Calendar size={18} /> {weeklyCalisthenicsPlan.title}
                      </h4>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
                        <span className="pill">{weeklyCalisthenicsPlan.equipment}</span>
                        <span className="pill">{weeklyCalisthenicsPlan.workoutTime}</span>
                      </div>
                      <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '0.35rem' }}>
                        Today: <strong style={{ color: 'var(--text-primary)' }}>{todayPlan.label}</strong> · {todayPlan.focus}
                      </p>
                      {!todayPlan.isRestDay && progressionModifiers && Object.keys(progressionModifiers).length > 0 && (
                        <span className="pill pill-live" style={{ marginBottom: '0.35rem' }}>
                          ⚡ Overload applied
                        </span>
                      )}
                      <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.5, marginTop: '0.4rem', marginBottom: 0 }}>
                        {weeklyCalisthenicsPlan.goal}
                      </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto' }}>
                    <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowPlanModal(true)}>
                      View Plan
                    </button>
                    <button
                      className="btn btn-accent"
                      style={{ flex: 1 }}
                      onClick={() => handleStartPlanDay(todayPlan)}
                      disabled={todayPlan.isRestDay}
                    >
                      <Play size={18} /> {todayPlan.isRestDay ? 'Rest Day' : 'Start'}
                    </button>
                  </div>
              </div>

              {/* Custom Routines */}
              {!loading && customRoutines.map(routine => (
                  <div key={routine.id} className="glass" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div>
                          <h4 style={{ fontSize: '1.05rem', marginBottom: '0.35rem' }}>{routine.name}</h4>
                          <span className="pill">{routine.exercises?.length || 0} exercises</span>
                      </div>

                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto' }}>
                          <button
                              className="btn btn-primary"
                              style={{ flex: 1 }}
                              onClick={() => {
                                const progressed = applyProgression(routine.exercises, progressionModifiers);
                                navigate('/workout', { state: { routine: progressed, routineName: routine.name, routineSettings: routine.settings } });
                              }}
                          >
                              <Play size={16} /> Play
                          </button>
                          <button
                              className="btn btn-secondary btn-icon"
                              onClick={() => navigate('/build', { state: { routine } })}
                              aria-label={`Edit ${routine.name}`}
                          >
                              <Edit2 size={16} />
                          </button>
                          <button
                              className="btn btn-icon"
                              style={{ background: 'rgba(244, 63, 94, 0.14)', borderColor: 'rgba(244, 63, 94, 0.35)', color: 'var(--danger)' }}
                              onClick={(e) => handleDeleteRoutine(e, routine.id)}
                              aria-label={`Delete ${routine.name}`}
                          >
                              <Trash2 size={16} />
                          </button>
                      </div>
                  </div>
              ))}
          </div>
        </div>

        {/* CHART & STREAKS Row */}
        <div className="grid-analytics animate-fade-up delay-4" style={{ marginBottom: '2rem' }}>
            <div className="glass">
                <h3 style={{ fontSize: '1.05rem', marginBottom: '1rem' }}>
                <TrendingUp size={18} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: 'var(--primary-light)' }} />
                Activity This Week
                </h3>
                {/* Shorter on a phone, where 220px of chart plus axes crowds
                    everything else off the first screen. */}
                <div style={{ height: 'clamp(170px, 26vh, 220px)', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8479FF" stopOpacity={0.55} />
                        <stop offset="100%" stopColor="#5B4BF5" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="day" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} width={38} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--surface-1)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px', color: 'var(--text-primary)' }}
                      formatter={(value) => [`${value} min`, 'Active Time']}
                    />
                    <Area type="monotone" dataKey="minutes" stroke="#8479FF" strokeWidth={3} fill="url(#chartGradient)" dot={{ r: 3, fill: '#8479FF', strokeWidth: 2, stroke: 'var(--bg-deep)' }} activeDot={{ r: 6, fill: '#2DE0C8' }} />
                    </AreaChart>
                </ResponsiveContainer>
                </div>
            </div>

            <div className="glass">
                <h3 style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>
                <Flame size={18} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: 'var(--danger)' }} />
                Last 28 Days
                </h3>
                <div className="streak-grid">
                {streakCells.map((cell, i) => (
                    <div key={i} className={`streak-cell ${cell.completed ? 'level-4' : 'empty'}`} title={`${cell.date}${cell.completed ? ' ✅' : ''}`} />
                ))}
                </div>
            </div>
        </div>

        {/* BADGES */}
        <div className="glass animate-fade-up delay-5" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1.05rem', marginBottom: '0.85rem' }}>
            <Award size={18} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: 'var(--warning)' }} />
            Achievements
          </h3>
          <div className="grid-badges">
            {badges.map(badge => (
              <div key={badge.id} className={`badge-card ${badge.unlocked ? 'unlocked' : 'locked'}`}>
                <div className="badge-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '32px', color: badge.unlocked ? 'var(--primary-light)' : 'var(--text-muted)' }}>
                  {BADGE_ICONS[badge.id] || <Award size={22} />}
                </div>
                <span style={{ fontSize: '0.74rem', fontWeight: 700 }}>{badge.name}</span>
                <span style={{ fontSize: '0.64rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>{badge.description}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {showPlanModal && (
          <div
            style={{
              position: 'fixed', inset: 0, background: 'rgba(3,6,14,0.86)',
              backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
              zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 'max(12px, var(--safe-l)) 12px max(12px, var(--safe-b))',
            }}
            onClick={() => setShowPlanModal(false)}
          >
              {/* Tapping the sheet must not close it, only the backdrop. */}
              <div
                className="glass animate-scale-in"
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: '100%', maxWidth: '760px',
                  // dvh so the sheet is not taller than the visible viewport on
                  // mobile Safari, which would hide its own scroll end.
                  maxHeight: '86dvh', overflowY: 'auto',
                  WebkitOverflowScrolling: 'touch', position: 'relative',
                  paddingTop: '3.25rem',
                }}
              >
                  <button
                    className="btn btn-icon"
                    style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', zIndex: 2 }}
                    onClick={() => setShowPlanModal(false)}
                    aria-label="Close plan"
                  >
                      <X size={20} />
                  </button>
                  <h2 style={{ fontSize: 'clamp(1.25rem, 5vw, 1.5rem)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Calendar size={22} /> {weeklyCalisthenicsPlan.title}
                  </h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', marginBottom: '0.5rem' }}>
                    {weeklyCalisthenicsPlan.equipment} · {weeklyCalisthenicsPlan.workoutTime}
                  </p>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1rem' }}>
                    {weeklyCalisthenicsPlan.goal}
                  </p>

                  <div style={{ marginBottom: '1.25rem', padding: '0.85rem 1rem', borderRadius: '12px', background: 'rgba(255,255,255,0.04)' }}>
                    <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Rest between sets</p>
                    {weeklyCalisthenicsPlan.restGuidelines.map((item) => (
                      <p key={item} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {item}
                      </p>
                    ))}
                  </div>

                  <div style={{ display: 'grid', gap: '0.85rem' }}>
                    {weeklyCalisthenicsPlan.days.map((day) => {
                      const resolvedDay = resolveWeeklyPlanDay(day.id);
                      return (
                        <div key={day.id} className="glass-solid" style={{ padding: '1rem' }}>
                          <div style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            gap: '0.75rem', marginBottom: '0.6rem', flexWrap: 'wrap',
                          }}>
                            <div style={{ minWidth: 0 }}>
                              <h3 style={{ fontSize: '1rem', marginBottom: '0.2rem' }}>{day.label} — {day.focus}</h3>
                              {day.repeatLabel && (
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 0 }}>{day.repeatLabel}</p>
                              )}
                            </div>
                            {!resolvedDay.isRestDay && (
                              <button className="btn btn-ghost" onClick={() => handleStartPlanDay(resolvedDay)}>
                                <Play size={16} /> Start
                              </button>
                            )}
                          </div>

                          {resolvedDay.warmup?.length > 0 && (
                            <div style={{ marginBottom: '0.65rem' }}>
                              <p style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>Warm-up (5 min)</p>
                              {resolvedDay.warmup.map((item) => (
                                <p key={item} style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item}</p>
                              ))}
                            </div>
                          )}

                          {resolvedDay.workout?.length > 0 && (
                            <div style={{ marginBottom: resolvedDay.core?.length > 0 ? '0.65rem' : 0 }}>
                              <p style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>Workout</p>
                              {getProgressionDisplayList(applyProgression(resolvedDay.executableRoutine, progressionModifiers)).map((item) => (
                                <p key={item} style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item}</p>
                              ))}
                            </div>
                          )}

                          {resolvedDay.core?.length > 0 && (
                            <div>
                              <p style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>Core</p>
                              {resolvedDay.core.map((item) => (
                                <p key={item} style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ marginTop: '1.25rem' }}>
                    <h3 style={{ fontSize: '1rem', marginBottom: '0.6rem' }}>📈 Progression Rules</h3>
                    <div style={{ display: 'grid', gap: '0.6rem' }}>
                      {weeklyCalisthenicsPlan.progressionRules.map((rule) => (
                        <div key={rule.exercise} className="glass-solid" style={{ padding: '0.9rem' }}>
                          <p style={{ fontSize: '0.88rem', fontWeight: 600, marginBottom: '0.25rem' }}>{rule.exercise}</p>
                          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{rule.when}</p>
                          {rule.moveTo && (
                            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: '0.25rem' }}>{rule.moveTo}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
}
