import { useState, type FormEvent } from 'react';
import { supabase } from '../supabase';

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { data, error } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (error) return setMsg({ kind: 'error', text: error.message });
    if (mode === 'signup' && !data.session) {
      setMode('signin');
      setMsg({ kind: 'info', text: 'Check your email and tap the confirmation link, then sign in here.' });
    }
  }

  return (
    <div className="center-page">
      <form className="card narrow stack" onSubmit={submit}>
        <div className="brand">
          <img src="/icon.svg" alt="" width={44} height={44} />
          <div>
            <h1>Saves</h1>
            <p className="muted small">Folders for your Threads &amp; TikTok saves</p>
          </div>
        </div>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {msg && <p className={msg.kind === 'error' ? 'error' : 'info'}>{msg.text}</p>}
        <button className="btn primary" disabled={busy}>
          {busy ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setMsg(null);
          }}
        >
          {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}
