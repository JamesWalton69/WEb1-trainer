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
  getUserProgression, LOCAL_USER_ID
} from '../lib/localStore';
import { weeklyCalisthenicsPlan, resolveWeeklyPlanDay, applyProgression, getProgressionDisplayList } from '../lib/weeklyPlan';

export default function Dashboard() {
  const navigate = useNavigate();
  // No accounts: the display name is a local preference and data is namespaced
  // under a single fixed local id.
  const userName = localStorage.getItem('userName') || 'Athlete';
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
    const next = window.prompt('Display name', userName);
    if (next === null) return;
    const trimmed = next.trim();
    if (trimmed) {
      localStorage.setItem('userName', trimmed);
    } else {
      localStorage.removeItem('userName');
    }
    // Re-read on next render.
    window.location.reload();
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
      <div className="animated-bg" />
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      <div className="container" style={{ padding: '1.5rem', maxWidth: '1100px' }}>
        {/* HEADER */}
        <header className="animate-fade-up" style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: '2rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div className="avatar" style={{
              background: 'linear-gradient(135deg, var(--primary), var(--accent))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.2rem', fontWeight: 700, color: 'white',
            }}>
              {firstName[0]?.toUpperCase()}
            </div>
            <div>
              <h2 style={{ fontSize: '1.5rem' }}>Welcome, {firstName}!</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                {loading ? 'Loading progress...' : `Level ${stats?.level || 1} · ${stats?.streak || 0} day streak`}
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
        <div className="animate-fade-up delay-2" style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem', marginBottom: '1.5rem',
        }}>
          <div className="glass" style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gridRow: 'span 2',
          }}>
            <div className="countdown-container">
              <svg width="130" height="130" className="progress-ring">
                <circle className="progress-ring__circle-bg" cx="65" cy="65" r="52" strokeWidth="8" />
                <circle
                  className="progress-ring__circle"
                  cx="65" cy="65" r="52" strokeWidth="8"
                  stroke="url(#progressGradient)"
                  strokeDasharray={circumference}
                  strokeDashoffset={loading ? circumference : dashOffset}
                />
                <defs>
                  <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="var(--primary)" />
                    <stop offset="100%" stopColor="var(--accent)" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="countdown-text" style={{ fontSize: '1.1rem' }}>
                {loading ? '...' : `${Math.round(weeklyProgress)}%`}
              </div>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.5rem' }}>Weekly Goal</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
              {loading ? '...' : `${Math.round(stats?.weeklyMinutes || 0)} / ${weeklyGoal} min`}
            </p>
          </div>

          <div className="glass stat-card stat-purple" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: 'rgba(108, 99, 255, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={22} color="var(--primary-light)" />
            </div>
            <div>
              <h3 style={{ fontSize: '1.4rem' }}>{loading ? '—' : stats?.level || 1}</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Level</p>
            </div>
          </div>

          <div className="glass stat-card stat-pink" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: 'rgba(255, 107, 157, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Flame size={22} color="var(--neon-pink)" />
            </div>
            <div>
              <h3 style={{ fontSize: '1.4rem' }}>{loading ? '—' : `${stats?.streak || 0}d`}</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Streak</p>
            </div>
          </div>

          <div className="glass stat-card stat-green" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: 'rgba(0, 212, 170, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Activity size={22} color="var(--accent)" />
            </div>
            <div>
              <h3 style={{ fontSize: '1.4rem' }}>{loading ? '—' : `${Math.round(stats?.totalMinutes || 0)}m`}</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Total Active</p>
            </div>
          </div>

          <div className="glass stat-card stat-orange" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: 'rgba(255, 140, 66, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Calendar size={22} color="var(--neon-orange)" />
            </div>
            <div>
              <h3 style={{ fontSize: '1.4rem' }}>{loading ? '—' : stats?.totalSessions || 0}</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Sessions</p>
            </div>
          </div>
        </div>

        {/* CUSTOM ROUTINES SECTION */}
        <div className="animate-fade-up delay-3" style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.25rem' }}>
                <Dumbbell size={20} style={{ verticalAlign: 'middle', marginRight: '0.5rem', color: 'var(--primary-light)' }} />
                Your Routines
              </h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn btn-ghost" onClick={() => navigate('/build')} style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
                      <PlusCircle size={16} style={{ marginRight: '0.5rem' }} /> Create New
                  </button>
              </div>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
              {/* Default Quick Start */}
              <div 
                  className="glass-solid" 
                  style={{ display: 'flex', flexDirection: 'column', gap: '16px', border: '1px solid rgba(255, 255, 255, 0.1)' }}
              >
                  <div>
                      <h4 style={{ color: 'var(--accent)', fontSize: '1.1rem', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Calendar size={18} /> {weeklyCalisthenicsPlan.title}
                      </h4>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                        {weeklyCalisthenicsPlan.equipment} · {weeklyCalisthenicsPlan.workoutTime}
                      </p>
                      <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        Today: <strong>{todayPlan.label}</strong> · {todayPlan.focus}
                      </p>
                      {!todayPlan.isRestDay && progressionModifiers && Object.keys(progressionModifiers).length > 0 && (
                        <p style={{ fontSize: '0.78rem', color: 'var(--accent)', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          ⚡ Progressive overload modifiers applied
                        </p>
                      )}
                      <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.5, marginTop: '0.35rem' }}>
                        {weeklyCalisthenicsPlan.goal}
                      </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowPlanModal(true)}>
                      View Plan
                    </button>
                    <button
                      className="btn btn-accent"
                      style={{ flex: 1 }}
                      onClick={() => handleStartPlanDay(todayPlan)}
                      disabled={todayPlan.isRestDay}
                    >
                      <Play size={18} /> {todayPlan.isRestDay ? 'Rest Day' : 'Start Today'}
                    </button>
                  </div>
              </div>

              {/* Custom Routines */}
              {!loading && customRoutines.map(routine => (
                  <div 
                      key={routine.id}
                      className="glass-solid" 
                      style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
                  >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                              <h4 style={{ fontSize: '1.1rem', marginBottom: '0.25rem' }}>{routine.name}</h4>
                              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                {routine.exercises?.length || 0} exercises
                              </p>
                          </div>
                      </div>
                      
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button 
                              className="btn btn-primary" 
                              style={{ flex: 1, padding: '0.5rem' }}
                              onClick={() => {
                                const progressed = applyProgression(routine.exercises, progressionModifiers);
                                navigate('/workout', { state: { routine: progressed, routineName: routine.name, routineSettings: routine.settings } });
                              }}
                          >
                              <Play size={16} /> Play
                          </button>
                          <button 
                              className="btn btn-secondary" 
                              style={{ padding: '0.5rem' }}
                              onClick={() => navigate('/build', { state: { routine } })}
                              title="Edit"
                          >
                              <Edit2 size={16} />
                          </button>
                          <button 
                              className="btn btn-danger" 
                              style={{ padding: '0.5rem', background: 'rgba(255, 107, 107, 0.1)', color: 'var(--danger)' }}
                              onClick={(e) => handleDeleteRoutine(e, routine.id)}
                              title="Delete"
                          >
                              <Trash2 size={16} />
                          </button>
                      </div>
                  </div>
              ))}
          </div>
        </div>

        {/* CHART & STREAKS Row */}
        <div className="animate-fade-up delay-4" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '1.5rem', marginBottom: '2rem' }}>
            <div className="glass">
                <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>
                <TrendingUp size={18} style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} />
                Activity This Week
                </h3>
                <div style={{ height: '220px', minHeight: '220px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                    <defs>
                        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="day" stroke="var(--text-muted)" fontSize={12} />
                    <YAxis stroke="var(--text-muted)" fontSize={12} />
                    <Tooltip contentStyle={{ backgroundColor: 'var(--surface-1)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'var(--text-primary)' }} formatter={(value) => [`${value} min`, 'Active Time']} />
                    <Area type="monotone" dataKey="minutes" stroke="var(--primary)" strokeWidth={3} fill="url(#chartGradient)" dot={{ r: 4, fill: 'var(--primary)', strokeWidth: 2, stroke: 'var(--bg-deep)' }} activeDot={{ r: 6, fill: 'var(--primary-light)' }} />
                    </AreaChart>
                </ResponsiveContainer>
                </div>
            </div>

            <div className="glass">
                <h3 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>
                <Flame size={18} style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} />
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
          <h3 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>
            <Award size={18} style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} />
            Achievements
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '12px' }}>
            {badges.map(badge => (
              <div key={badge.id} className={`badge-card ${badge.unlocked ? 'unlocked' : 'locked'}`}>
                <div className="badge-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '32px', color: badge.unlocked ? 'var(--primary-light)' : 'var(--text-muted)' }}>
                  {BADGE_ICONS[badge.id] || <Award size={22} />}
                </div>
                <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{badge.name}</span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>{badge.description}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {showPlanModal && (
          <div style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)',
              zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
          }}>
              <div className="glass animate-scale-in" style={{ width: '100%', maxWidth: '760px', maxHeight: '88vh', overflowY: 'auto', position: 'relative' }}>
                  <button className="btn-icon" style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'transparent' }} onClick={() => setShowPlanModal(false)}>
                      <X size={24} />
                  </button>

                  <h2 style={{ fontSize: '1.5rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '0.6rem' }}>
                            <div>
                              <h3 style={{ fontSize: '1rem', marginBottom: '0.2rem' }}>{day.label} — {day.focus}</h3>
                              {day.repeatLabel && (
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{day.repeatLabel}</p>
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
