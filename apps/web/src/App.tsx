import { Home } from './screens/Home';
import { Forgot, Login, Signup, Verify } from './screens/Auth';
import { useApp } from './state';

export function App() {
  const { screen } = useApp();
  return (
    <div className="app">
      {screen === 'login' ? <Login /> : screen === 'signup' ? <Signup /> : screen === 'verify' ? <Verify /> : screen === 'forgot' ? <Forgot /> : <Home />}
    </div>
  );
}
