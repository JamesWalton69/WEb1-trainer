import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import WorkoutEngine from './pages/WorkoutEngine';
import WorkoutBuilder from './pages/WorkoutBuilder';
import PostWorkout from './pages/PostWorkout';

function App() {
  return (
    <Router>
      <div className="app-container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/dashboard" element={<Navigate to="/" replace />} />
          <Route path="/workout" element={<WorkoutEngine />} />
          <Route path="/build" element={<WorkoutBuilder />} />
          <Route path="/post-workout" element={<PostWorkout />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
