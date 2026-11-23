import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Pause, Play, Square, Volume2, VolumeX, Mic, MicOff, Music, X,
  Sun, SunDim, SkipForward, Sparkles,
} from 'lucide-react';
import { getRandomQuote } from '../lib/quotes';
import { weeklyCalisthenicsPlan, resolveWeeklyPlanDay } from '../lib/weeklyPlan';
import { PHASE_COLORS, getPhaseColor, phaseVars, isPhaseActive } from '../lib/phaseColor';
import { useWakeLock } from '../lib/useWakeLock';
import ExerciseCanvas3D from '../components/exercise3d/ExerciseCanvas3D';
import FormPreviewModal from '../components/exercise3d/FormPreviewModal';

const defaultPlanDay = resolveWeeklyPlanDay('monday');
const defaultWorkout = defaultPlanDay.executableRoutine;

// Phases where the card shows setup or recovery copy rather than a live rep, so
// the exercise title and image are hidden. Listed once instead of being spelled
// out at three call sites, where they had already drifted apart.
const CHROME_FREE_PHASES = ['REST', 'TRANSITION', 'COMPLETE', 'GET READY', 'WARM-UP'];

export default function WorkoutEngine() {
  const navigate = useNavigate();
  const location = useLocation();

  const activeWorkout = location.state?.routine || defaultWorkout;
  const workoutName = location.state?.routineName || `${weeklyCalisthenicsPlan.title} · ${defaultPlanDay.label} · ${defaultPlanDay.focus}`;

  // Apply Global Settings
  const TIMING = location.state?.routineSettings || defaultPlanDay.routineSettings;

  const [phase, setPhase] = useState("GET READY");
  const [subInfo, setSubInfo] = useState("");
  const [currentEx, setCurrentEx] = useState(null);
  const [exIndex, setExIndex] = useState(-1);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [restQuote, setRestQuote] = useState(null);
  const [show3DModal, setShow3DModal] = useState(false);

  // Voice & music state
  const [voiceActive, setVoiceActive] = useState(false);
  const [showSpotify, setShowSpotify] = useState(false);
  const recognitionRef = useRef(null);
  const voiceActiveRef = useRef(false);

  // On by default: this screen is meant to be propped against a wall and looked
  // at, and a phone that sleeps 30 seconds into a plank makes the app useless.
  // See src/lib/useWakeLock.js for why it cannot be a fire-and-forget request.
  const [keepAwake, setKeepAwake] = useState(true);
  const wakeLock = useWakeLock(keepAwake);

  const [overallProgress, setOverallProgress] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [countdownMax, setCountdownMax] = useState(0);
  const [inWarmup, setInWarmup] = useState(false);

  const pausedRef = useRef(false);
  const stoppedRef = useRef(false);
  const mutedRef = useRef(false);
  const audioCtxRef = useRef(null);
  const pauseCountRef = useRef(0);
  const totalPauseDurRef = useRef(0);
  const pauseStartRef = useRef(0);
  const currentExRef = useRef(null);
  const skipWarmupRef = useRef(false);

  // Set by the effect cleanup, i.e. only when the screen actually goes away.
  // The Stop button and the ESC key also set stoppedRef, and those *should*
  // navigate to the summary, so the two cases need telling apart.
  const leftScreenRef = useRef(false);

  // Every timeout the run loop schedules, so unmount can clear them. The
  // 3-second hold on COMPLETE is the one that bit: leave the screen during it —
  // browser Back, a notification tap — and the timer stayed armed and then
  // navigated to /post-workout from wherever the user had got to.
  const timersRef = useRef(new Set());
  const later = useCallback((fn, ms) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
    return id;
  }, []);

  // Warm-up config arrives once via history state and is fixed for the whole
  // run. Held in a ref so the workout loop does not depend on a fresh array
  // identity every render — that would rebuild runWorkout and restart the
  // session mid-workout.
  const warmupRef = useRef({
    minutes: location.state?.warmUpMinutes || 0,
    activities: location.state?.warmup || [],
  });

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { voiceActiveRef.current = voiceActive; }, [voiceActive]);

  const speak = useCallback((text) => {
    if (mutedRef.current || leftScreenRef.current || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const msg = new SpeechSynthesisUtterance(text);
    msg.rate = 1.0;
    window.speechSynthesis.speak(msg);
  }, []);
  const beep = useCallback((frequency) => {
    // leftScreenRef because the run loop only notices the unmount at its next
    // 100 ms slice; a beep in that window would build a fresh AudioContext
    // right after the cleanup closed the old one, and nothing would close it.
    if (mutedRef.current || leftScreenRef.current) return;
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  }, []);

  // A short buzz on every phase change, so a cue lands even with the phone
  // muted and face-down in a pocket. Not supported on iOS Safari at all, and
  // Chrome ignores it until the user has interacted with the page — both cases
  // are silent no-ops rather than errors.
  const vibrate = useCallback((pattern) => {
    if (mutedRef.current || leftScreenRef.current) return;
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    try { navigator.vibrate(pattern); } catch { /* blocked by policy */ }
  }, []);

  const toggleVoiceControl = () => {
      if (voiceActive) {
          if (recognitionRef.current) recognitionRef.current.stop();
          setVoiceActive(false);
          return;
      }

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
          alert("Speech recognition isn't supported in your browser.");
          return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
          const results = event.results;
          const latest = results[results.length - 1];
          if (latest.isFinal) {
              const command = latest[0].transcript.trim().toLowerCase();
              if (command.includes('pause')) setPaused(true);
              else if (command.includes('play') || command.includes('resume')) setPaused(false);
              else if (command.includes('stop')) stoppedRef.current = true;
          }
      };

      recognition.onend = () => {
          if (recognitionRef.current && voiceActiveRef.current) {
              // start() throws if recognition is already running; ignore it.
              try {
                  recognitionRef.current.start();
              } catch {
                  /* already started */
              }
          }
      };

      recognition.start();
      recognitionRef.current = recognition;
      setVoiceActive(true);
  };

  const interruptibleSleep = useCallback(async (seconds) => {
    let elapsed = 0;
    const slice = 0.1;
    setCountdown(Math.ceil(seconds));
    setCountdownMax(Math.ceil(seconds));
    while (elapsed < seconds) {
      if (stoppedRef.current) throw new Error("Stopped");
      if (pausedRef.current) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }
      if (skipWarmupRef.current) {
        skipWarmupRef.current = false;
        break;
      }
      await new Promise(r => setTimeout(r, slice * 1000));
      elapsed += slice;
      setCountdown(Math.max(0, Math.ceil(seconds - elapsed)));
    }
    setCountdown(0);
  }, []);
  const totalWork = activeWorkout.reduce((sum, ex) => sum + (ex.reps * TIMING.sets), 0);

  const runWorkout = useCallback(async () => {
    const start = Date.now();
    // Stable id for this run, decided once and carried into PostWorkout. The
    // server upserts on it, so logging the session and then attaching feedback
    // updates one row instead of creating two.
    const sessionId = `w-${start}-${Math.random().toString(36).slice(2, 8)}`;
    let completedReps = 0;

    try {
      if (TIMING.prepTime > 0) {
        setPhase("GET READY");
        setSubInfo(workoutName);
        speak("Workout starting. Get ready.");
        await interruptibleSleep(TIMING.prepTime);
      }

      // Warm-up phase
      const warmUpMinutes = warmupRef.current.minutes;
      const warmupActivities = warmupRef.current.activities;
      if (warmUpMinutes > 0) {
        setPhase("WARM-UP");
        const warmupText = warmupActivities.length > 0
          ? warmupActivities.join(" | ")
          : `${warmUpMinutes} min light warm-up`;
        setSubInfo(warmupText);
        speak(`Starting warm-up for ${warmUpMinutes} minutes. Perform light movements.`);
        setInWarmup(true);
        try {
          await interruptibleSleep(warmUpMinutes * 60);
        } finally {
          // finally, not catch: Stop pressed during the warm-up has to keep
          // propagating so the run ends. The old `catch` swallowed it and fell
          // through into the first exercise, which then threw at its own next
          // sleep — the session did stop, but only after flashing "NEXT: ..."
          // on a screen the user had already asked to leave.
          setInWarmup(false);
        }
      }

      for (let i = 0; i < activeWorkout.length; i++) {
        const ex = activeWorkout[i];
        setCurrentEx(ex);
        setExIndex(i);
        currentExRef.current = ex.name;
        setRestQuote(null);

        setPhase(`NEXT: ${ex.name}`);
        setSubInfo(`Exercise ${i + 1} of ${activeWorkout.length}`);
        speak(`Next is ${ex.name}`);
        vibrate(40);
        await interruptibleSleep(3);

        for (let s = 1; s <= TIMING.sets; s++) {
          setPhase(`${ex.name}`);
          setSubInfo(`Set ${s} of ${TIMING.sets}`);
          speak(`Set ${s}`);
          await interruptibleSleep(1.5);

          for (let r = 1; r <= ex.reps; r++) {
            if (stoppedRef.current) throw new Error("Stopped");

            setPhase(`REP ${r} — DOWN`);
            setSubInfo(`${ex.name} · Set ${s}/${TIMING.sets}`);
            beep(1500);
            vibrate(25);
            await interruptibleSleep(ex.tension);

            setPhase("UP");
            setSubInfo(`${ex.name} · Set ${s}/${TIMING.sets}`);
            beep(500);
            vibrate(25);
            await interruptibleSleep(Math.max(ex.reset, 0.2));

            completedReps++;
            setOverallProgress(Math.round((completedReps / totalWork) * 100));
          }

          if (s < TIMING.sets && TIMING.restBetweenSet > 0) {
            setPhase("REST");
            setSubInfo(`Next: Set ${s + 1}`);
            setRestQuote(getRandomQuote());
            speak("Resting");
            vibrate([40, 60, 40]);
            await interruptibleSleep(TIMING.restBetweenSet);
            setRestQuote(null);
          }
        }

        if (i < activeWorkout.length - 1) {
          const currentRest = activeWorkout[i].restSeconds !== undefined && activeWorkout[i].restSeconds !== null
            ? activeWorkout[i].restSeconds
            : TIMING.restBetweenEx;
          if (currentRest > 0) {
            setPhase("TRANSITION");
            setSubInfo(`Up next: ${activeWorkout[i + 1].name}`);
            setRestQuote(getRandomQuote());
            vibrate([40, 60, 40]);
            await interruptibleSleep(currentRest);
            setRestQuote(null);
          }
        }
      }

      setOverallProgress(100);
      setPhase("COMPLETE");
      setSubInfo("Amazing work! 🎉");
      speak("Session Complete! Great job!");
      vibrate([80, 60, 80, 60, 160]);

      const elapsed = (Date.now() - start) / 1000 / 60;
      const activeMinutes = elapsed - (totalPauseDurRef.current / 60);

      later(() => {
        if (leftScreenRef.current) return;
        navigate('/post-workout', { state: {
          id: sessionId,
          status: 'Completed',
          active_minutes: Math.round(activeMinutes * 100) / 100,
          pauses: pauseCountRef.current,
          last_exercise: activeWorkout[activeWorkout.length - 1].name,
          routine_name: workoutName,
          routine: activeWorkout,
        }});
      }, 3000);

    } catch (e) {
      if (e.message !== "Stopped") console.error(e);
      // Unmounting throws "Stopped" through the same path as the Stop button.
      // Navigating here would fight whatever the user is actually looking at,
      // and React would warn about updating an unmounted component.
      else if (!leftScreenRef.current) {
        const elapsed = (Date.now() - start) / 1000 / 60;
        const activeMinutes = elapsed - (totalPauseDurRef.current / 60);
        navigate('/post-workout', { state: {
          id: sessionId,
          status: 'Incomplete',
          active_minutes: Math.round(activeMinutes * 100) / 100,
          pauses: pauseCountRef.current,
          last_exercise: currentExRef.current || 'None',
          routine_name: workoutName,
          routine: activeWorkout,
        }});
      }
    }
  }, [speak, beep, vibrate, interruptibleSleep, navigate, later, totalWork, TIMING, activeWorkout, workoutName]);
  useEffect(() => {
    stoppedRef.current = false;
    leftScreenRef.current = false;
    pauseCountRef.current = 0;
    totalPauseDurRef.current = 0;
    // Captured for the cleanup. The Set is created once and never reassigned,
    // so this is the same object either way — but reading .current in cleanup
    // is the pattern that leads to stale-node bugs, so lint flags it.
    const timers = timersRef.current;
    const kickoff = later(() => {
        if (!stoppedRef.current) runWorkout();
    }, 0);
    return () => {
        clearTimeout(kickoff);
        leftScreenRef.current = true;
        stoppedRef.current = true;
        // Cancel the completion hold and anything else still armed, or it fires
        // after we are gone and navigates over the next screen.
        for (const id of timers) clearTimeout(id);
        timers.clear();
        // Stop voice recognition and any queued speech so the mic and TTS
        // do not keep running after we leave the workout screen.
        voiceActiveRef.current = false;
        if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch { /* not running */ }
            recognitionRef.current = null;
        }
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        // A pattern started right before we left would otherwise keep buzzing
        // on the dashboard.
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            try { navigator.vibrate(0); } catch { /* blocked by policy */ }
        }
        // The oscillator keeps the audio hardware awake on mobile until the
        // context is closed, which on iOS shows as a stuck audio-route icon.
        const ctx = audioCtxRef.current;
        audioCtxRef.current = null;
        if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
    };
  }, [runWorkout, later]);

  const togglePause = useCallback(() => {
    setPaused(prev => {
      const next = !prev;
      if (next) {
        pauseCountRef.current++;
        pauseStartRef.current = Date.now();
      } else {
        if (pauseStartRef.current) {
          totalPauseDurRef.current += (Date.now() - pauseStartRef.current) / 1000;
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (e.code === 'Space') { e.preventDefault(); togglePause(); }
      if (e.code === 'Escape') { stoppedRef.current = true; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePause]);

  const ringRadius = 56;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringProgress = countdownMax > 0 ? countdown / countdownMax : 0;
  const ringDashOffset = ringCircumference * (1 - ringProgress);

  const bgColor = paused ? PHASE_COLORS.PAUSED : getPhaseColor(phase);
  // Pulses only during reps, and never while paused — a breathing screen that
  // is not counting anything reads as "still running".
  const fieldActive = !paused && isPhaseActive(phase);
  const showChrome = !CHROME_FREE_PHASES.includes(phase);
  const wakeLockOn = keepAwake && wakeLock.active;
  return (
    <div
      className={`workout-shell${fieldActive ? ' is-active' : ''}`}
      style={{ ...phaseVars(bgColor), padding: 'clamp(12px, 4vw, 24px)' }}
    >
      {/* The colour field itself. Separate elements so the vignette can animate
          and the per-phase flash can remount without touching the wash. */}
      <div className="phase-field" />
      {/* key on the phase string: React tears the node down and builds a new
          one on every change, which restarts the CSS animation. Without it the
          animation runs once for the whole session. */}
      <div key={phase} className="phase-flash" />

      {/* Overall progress, pinned above the notch inset. */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '4px',
        background: 'rgba(0,0,0,0.28)', zIndex: 12,
      }}>
        <div style={{
          height: '100%', width: `${overallProgress}%`,
          background: 'rgba(255,255,255,0.9)',
          boxShadow: '0 0 12px rgba(255,255,255,0.6)',
          transition: 'width 0.3s ease',
        }} />
      </div>

      {/* Top rail */}
      <div className="workout-rail workout-rail-top">
        <button
          className="btn btn-icon"
          onClick={() => { stoppedRef.current = true; }}
          aria-label="Stop workout"
        >
          <Square size={20} />
        </button>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Screen-awake toggle. Rendered only where the API exists, because a
              switch that cannot do anything is worse than no switch. */}
          {wakeLock.supported && (
            <button
              className="btn btn-icon"
              onClick={() => setKeepAwake((v) => !v)}
              aria-pressed={keepAwake}
              title={wakeLockOn
                ? 'Screen stays awake — tap to allow sleeping'
                : wakeLock.error === 'blocked'
                  ? 'Screen lock unavailable on this connection (needs HTTPS)'
                  : 'Screen may sleep — tap to keep it awake'}
              style={wakeLockOn ? {
                background: 'rgba(255,255,255,0.24)',
                borderColor: 'rgba(255,255,255,0.5)',
              } : undefined}
            >
              {wakeLockOn ? <Sun size={20} /> : <SunDim size={20} />}
            </button>
          )}
          <button
            className={`btn btn-icon ${voiceActive ? 'btn-accent' : ''}`}
            onClick={toggleVoiceControl}
            aria-pressed={voiceActive}
            title="Voice commands (pause / play / stop)"
          >
            {voiceActive ? <Mic size={20} /> : <MicOff size={20} />}
          </button>
          <button
            className="btn btn-icon"
            onClick={() => {
              setPaused(true);
              setShow3DModal(true);
            }}
            title="3D Biomechanical Form Studio"
            aria-label="Open 3D Form Studio"
          >
            <Sparkles size={18} color="var(--accent-light)" />
          </button>
          <button
            className="btn btn-icon"
            onClick={() => setMuted(!muted)}
            aria-pressed={muted}
            aria-label={muted ? 'Unmute cues' : 'Mute cues'}
          >
            {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
        </div>
      </div>
      {/* Main focus card */}
      <div className="workout-card">
        {currentEx && showChrome && (
          <h2 style={{
            fontSize: 'clamp(1.05rem, 4vw, 1.4rem)', fontWeight: 800,
            textTransform: 'uppercase', letterSpacing: '0.06em',
            color: 'rgba(255,255,255,0.9)', marginBottom: '14px',
            textAlign: 'center', maxWidth: '100%', overflowWrap: 'break-word',
          }}>
            {currentEx.name}
          </h2>
        )}

        {currentEx && showChrome && (
          <div style={{ width: '100%', marginBottom: '16px' }}>
            <ExerciseCanvas3D
              exerciseName={currentEx.name}
              phase={phase}
              countdown={countdown}
              countdownMax={countdownMax}
              paused={paused}
              onExpand={() => {
                setPaused(true);
                setShow3DModal(true);
              }}
              height="clamp(190px, 30vh, 255px)"
            />
          </div>
        )}

        {countdown > 0 && (
          <div className="countdown-container" style={{ marginBottom: '20px' }}>
            <svg width="150" height="150" className="progress-ring" aria-hidden="true">
              <circle
                className="progress-ring__circle-bg"
                cx="75" cy="75" r={ringRadius} strokeWidth="7"
                style={{ stroke: 'rgba(0,0,0,0.28)' }}
              />
              <circle
                className="progress-ring__circle"
                cx="75" cy="75" r={ringRadius} strokeWidth="7"
                stroke="rgba(255,255,255,0.95)"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringDashOffset}
              />
            </svg>
            <span
              className="countdown-text"
              style={{ fontSize: 'clamp(2rem, 9vw, 2.75rem)' }}
              aria-live="off"
            >
              {countdown}
            </span>
          </div>
        )}

        {restQuote && (phase === 'REST' || phase === 'TRANSITION') && (
          <div style={{ maxWidth: '440px', textAlign: 'center', marginBottom: '16px', padding: '0 8px' }}>
            <p style={{ fontStyle: 'italic', color: 'rgba(255,255,255,0.85)', fontSize: '0.95rem', marginBottom: '4px' }}>
              "{restQuote.text}"
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>({restQuote.author})</p>
          </div>
        )}

        {/* The one thing you read from across the room. aria-live so a screen
            reader announces each phase without the countdown spamming it. */}
        <h1 className="workout-phase" aria-live="polite">
          {paused ? 'PAUSED' : phase}
        </h1>

        <p className="workout-sub">
          {paused ? 'Tap play or press SPACE to resume' : subInfo}
        </p>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '14px', marginTop: '24px',
        }}>
          {inWarmup && (
            <button
              onClick={() => { skipWarmupRef.current = true; }}
              className="btn btn-ghost"
              style={{ background: 'var(--surface-2)', borderColor: 'var(--surface-3)', color: 'var(--text-primary)' }}
            >
              <SkipForward size={18} /> Skip
            </button>
          )}

          <button
            onClick={togglePause}
            className="workout-primary-btn"
            aria-label={paused ? 'Resume workout' : 'Pause workout'}
          >
            {paused ? <Play size={30} /> : <Pause size={30} />}
          </button>
        </div>
      </div>
      {/* Bottom rail: status line, plus the music toggle. Centred rather than
          corner-pinned so nothing sits under a thumb wrapped around the phone. */}
      <div className="workout-rail workout-rail-bottom">
        {showSpotify && (
          <div
            className="animate-scale-in"
            style={{
              background: 'rgba(6,10,22,0.9)',
              border: '1px solid rgba(255,255,255,0.14)',
              padding: '8px', borderRadius: 'var(--radius-lg)',
              marginBottom: '10px', width: 'min(320px, 100%)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
              <button
                onClick={() => setShowSpotify(false)}
                aria-label="Close music player"
                style={{
                  background: 'none', border: 'none', color: 'var(--text-secondary)',
                  cursor: 'pointer', padding: '2px', lineHeight: 1,
                }}
              >
                <X size={16} />
              </button>
            </div>
            <iframe
              title="Workout playlist"
              style={{ borderRadius: 'var(--radius-md)', display: 'block', width: '100%' }}
              src="https://open.spotify.com/embed/playlist/37i9dQZF1DX76Wlfdnj7AP?utm_source=generator"
              height="152"
              frameBorder="0"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
            />
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            className="btn btn-icon"
            onClick={() => setShowSpotify(!showSpotify)}
            aria-pressed={showSpotify}
            aria-label="Music"
          >
            <Music size={20} />
          </button>

          <span className="pill" style={{ background: 'rgba(0,0,0,0.3)', borderColor: 'rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.8)' }}>
            {overallProgress}% done
          </span>

          {/* Honest about the one case that matters: the toggle is on but the
              browser will not grant the lock, so the screen *will* sleep. */}
          {keepAwake && wakeLock.supported && !wakeLock.active && (
            <span className="pill pill-warn">screen may sleep</span>
          )}
          {!wakeLock.supported && (
            <span className="pill" style={{ background: 'rgba(0,0,0,0.3)', borderColor: 'rgba(255,255,255,0.18)' }}>
              raise your phone’s auto-lock
            </span>
          )}
        </div>

        {/* Keyboard hints are meaningless on a touchscreen. */}
        <div className="only-pointer" style={{
          marginTop: '8px', color: 'rgba(255,255,255,0.55)',
          fontSize: '0.72rem', textAlign: 'center',
        }}>
          SPACE = pause · ESC = stop
        </div>
      </div>

      {/* Remaining exercises, pinned to the side. Shows everything before the
          first exercise starts (exIndex -1), then only what's left. */}
      {activeWorkout.length > 0 && (
        <div className="workout-remaining">
          <span className="workout-remaining-title">Remaining</span>
          {activeWorkout.slice(exIndex + 1).map((ex, j) => (
            <span key={j} className="workout-remaining-item">{ex.name}</span>
          ))}
        </div>
      )}

      {/* 3D Biomechanical Form Studio Modal */}
      <FormPreviewModal
        isOpen={show3DModal}
        onClose={() => setShow3DModal(false)}
        initialExercise={currentEx?.name || 'Backpack curls'}
      />
    </div>
  );
}
