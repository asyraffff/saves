import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, supabase } from './supabase';
import Login from './components/Login';
import Home from './components/Home';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!configured) {
    return (
      <div className="center-page">
        <div className="card narrow">
          <h1>Saves</h1>
          <p className="muted">
            Supabase isn't connected yet. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to{' '}
            <code>.env.local</code> (or your Vercel project settings). See <code>SETUP.md</code>.
          </p>
        </div>
      </div>
    );
  }
  if (session === undefined) return <div className="center-page muted">Loading…</div>;
  if (!session) return <Login />;
  return <Home key={session.user.id} session={session} />;
}
