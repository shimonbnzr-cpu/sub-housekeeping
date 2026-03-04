import { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import StaffView from './components/StaffView';
import './App.css';

function App() {
  const [mode, setMode] = useState('dashboard'); // 'dashboard' or 'staff'

  // Check URL param for mode
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlMode = params.get('mode');
    if (urlMode === 'staff') {
      setMode('staff');
    }
  }, []);

  return (
    <>
      {mode === 'dashboard' ? <Dashboard /> : <StaffView />}
    </>
  );
}

export default App;
